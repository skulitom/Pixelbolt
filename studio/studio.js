import { renderProject, buildAtlas, parseColor, reviewPixels, onionPixels, animationPosition, animationNeighbors, inlineSharedPalette, MAX_REQUEST_BYTES } from '/core.js';
import { animationGIF } from '/gif.js';
import { createDraftStore, claimTab, openTabs } from '/draft.js';
import { compilePoses } from '/authoring.js';
import { inspectMotion } from '/motion.js';

const $ = id => document.getElementById(id);
const source = $('source'), canvas = $('canvas'), context = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let project, spec, atlas, frameImages = [], selected = 0, playing = !reducedMotion, mode = 'animation';
let position = 0;
let poseMetadata = null, motionReview = null;
// The editor holds the recipe as written, and Save JSON writes it, so a palette that links a shared file keeps its
// `$ref`. Only the drawing puts the file's colours in. The page reads no file: `pixelbolt preview` sends the one file
// the recipe it opened links, and a recipe that names another file, or any file when there is none, is not drawn.
let sharedPalette = null;
const isLinked = value => value?.palette !== null && typeof value?.palette === 'object' && Object.hasOwn(value.palette, '$ref');
function withSharedPalette(value) {
  if (!isLinked(value)) return value;
  const where = `${value.format === 'pixelforge-poses' ? 'poses' : 'project'}.palette.$ref`, reference = JSON.stringify(value.palette.$ref);
  if (!sharedPalette) throw new Error(`${where}: the studio reads a shared palette file only for the recipe pixelbolt preview opened, so it cannot draw ${reference}. Open this recipe with pixelbolt preview <file>, or put its colours in the palette.`);
  if (sharedPalette.$ref !== value.palette.$ref) throw new Error(`${where}: the studio has only ${JSON.stringify(sharedPalette.$ref)}, the palette file of the recipe pixelbolt preview opened, so it cannot draw ${reference}. Open this recipe with pixelbolt preview <file>.`);
  return inlineSharedPalette(value, sharedPalette);
}
const compileSource = value => { const drawn = withSharedPalette(value); return drawn?.format === 'pixelforge-poses' ? compilePoses(drawn) : { recipe: drawn, metadata: null }; };
let elapsed = 0, lastTime = 0, zoom = 12, dirty = false, valid = false, compileTimer, toastTimer, loadVersion = 0;
// The recipe text last sent to Save JSON. The page cannot tell whether the browser kept that file or the save was
// cancelled, so it stays `dirty`: the draft is kept and leaving or replacing the recipe still asks.
let sent = null;
// An unsaved recipe is kept as a draft in this browser, under this tab's own id, which is known once the tab has
// claimed it (`drafts` is null until then). `offer` is a draft found at start-up that the user has not yet restored or
// discarded: this tab's own from before a reload, whose place new edits do not take until the user chooses, or one a
// closed tab left. `offers` are the closed tabs' drafts still to show after it.
const browserStorage = name => { try { return globalThis[name]; } catch { return null; } };
const locks = navigator.locks ?? null, claimed = claimTab(browserStorage('sessionStorage'), locks);
let drafts = null, offer = null, offers = [], draftTimer, draftWarned = false;
const ownOffer = () => offer !== null && offer.id === drafts.id;
const examples = [{ file: 'forest-spirit', title: 'Forest spirit', type: 'Character · 6 frames' }, { file: 'ember', title: 'Campfire', type: 'Effect · 4 frames' }, { file: 'coin', title: 'Golden coin', type: 'Collectible · 6 frames' }, { file: 'shrine', title: 'Moonlit shrine', type: 'Dither, rewrite, rim light · 2 frames' }, { file: 'caption', title: 'Caption', type: 'Text, for video · 8 frames' }, { file: 'swing', title: 'Sword swing', type: 'Rotated, tweened poses · 5 frames' }, { file: 'effects', title: 'Particle effects', type: 'Compiled fx · 57 frames' }];
const title = name => name.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
function imageCanvas(data, width, height) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0); return c;
}
function thumbnail(c) {
  const image = document.createElement('img'); image.src = c.toDataURL('image/png'); image.alt = ''; return image;
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000); }
function download(data, filename, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function playState() { $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation'); }
function reviewMotion() {
  if (motionReview) return motionReview;
  const speed = $('motion-speed').value, ground = $('motion-ground').value;
  motionReview = inspectMotion(project, { animation: $('animation').value, metadata: poseMetadata, scale: 1,
    ...(speed !== '' && { speed: Number(speed) }), ...(ground !== '' && { ground: Number(ground) }) });
  const names = { slide: 'Foot slide', ground: 'Ground contact', poseSpread: 'Pose changes', loopSeam: 'Loop join' };
  const report = motionReview.motion, details = {
    slide: `${Math.max(0, ...report.slide.map(p => p.pixels ?? 0))} px`,
    ground: `${Math.max(0, ...report.groundErrors.map(p => Math.abs(p.pixels)))} px from ground`,
    poseSpread: `${Math.round(Math.min(1, ...report.poseSpread.map(p => p.share)) * 100)}% minimum`,
    loopSeam: `${report.loopSeam.maximum}° maximum`
  };
  $('motion-summary').textContent = Object.entries(report.checks).map(([key, pass]) => `${names[key] ?? key}: ${pass === null ? 'unavailable' : `${pass ? 'pass' : 'check'} (${details[key]})`}`).join(' · ');
  return motionReview;
}
function render() {
  if (!project) return;
  const isSheet = mode === 'sheet', isMotion = mode === 'motion';
  let review;
  try { if (isMotion) review = reviewMotion(); }
  catch (error) { $('motion-summary').textContent = error.message; return; }
  const width = isMotion ? review.nativeSheet.width : isSheet ? atlas.width : project.width, height = isMotion ? review.nativeSheet.height : isSheet ? atlas.height : project.height;
  canvas.width = width; canvas.height = height;
  context.imageSmoothingEnabled = false;
  const animation = project.animations[$('animation').value];
  const pixels = isMotion ? review.nativeSheet.data : isSheet ? atlas.data : $('onion').getAttribute('aria-pressed') === 'true' ? onionPixels(project, animation, position) : project.frames[selected].data;
  context.putImageData(new ImageData(new Uint8ClampedArray(reviewPixels(pixels, $('review-view').value)), width, height), 0, 0);
  if (!isSheet && !isMotion && poseMetadata && $('contacts').getAttribute('aria-pressed') === 'true') {
    const pose = poseMetadata.poses[project.frames[selected].name], ground = $('motion-ground').value;
    context.fillStyle = '#506473';
    if (ground !== '') context.fillRect(0, Number(ground) + 1, width, 1);
    context.fillStyle = '#ffce53';
    for (const marker of pose.markers) if (pose.contacts?.includes(marker.name)) context.fillRect(marker.at[0] - 1, marker.at[1] + 1, 3, 1);
  }
  const native = $('native-canvas'); native.width = project.width; native.height = project.height;
  native.getContext('2d').drawImage(frameImages[selected], 0, 0);
  const fit = Math.max(1, Math.floor(($('artboard').clientWidth - 48) / width));
  const displayScale = isSheet || isMotion ? Math.min(zoom, fit) : zoom;
  canvas.style.width = `${width * displayScale}px`; canvas.style.height = `${height * displayScale}px`;
  $('canvas-wrap').style.setProperty('--pixel-size', `${displayScale}px`);
  $('canvas-wrap').classList.toggle('grid', $('grid').getAttribute('aria-pressed') === 'true');
  $('frame-counter').textContent = `${String(position + 1).padStart(2, '0')} / ${String(animation.frames.length).padStart(2, '0')}`;
  const neighbors = animationNeighbors(animation, position);
  $('onion').title = `Previous (pink): ${neighbors.previous === null ? 'none' : project.frames[animation.frames[neighbors.previous]].name}; next (cyan): ${neighbors.next === null ? 'none' : project.frames[animation.frames[neighbors.next]].name}`;
  $('canvas').setAttribute('aria-label', isMotion ? `${project.name} motion review` : isSheet ? `${project.name} sprite sheet` : `${project.name}, frame ${project.frames[selected].name}`);
  document.querySelectorAll('.frame').forEach((button, i) => { button.classList.toggle('active', i === position); button.setAttribute('aria-pressed', String(i === position)); });
}
function animationChanged() {
  elapsed = 0;
  motionReview = null;
  $('motion-speed').value = poseMetadata?.animations[$('animation').value]?.speed ?? '';
  const animation = project.animations[$('animation').value];
  position = 0;
  selected = animation.frames[0];
  $('frame-count').textContent = `${animation.frames.length} playback entries · ${project.frames.length} source poses`;
  $('timeline').replaceChildren(...animation.frames.map((index, sequencePosition) => {
    const frame = project.frames[index];
    const button = document.createElement('button'); button.className = 'frame'; button.title = `${frame.name} · ${frame.duration}ms`; button.setAttribute('aria-label', `Select position ${sequencePosition + 1}: ${frame.name}`);
    const block = document.createElement('div'); block.className = 'frame-image';
    const number = document.createElement('span'); number.className = 'number'; number.textContent = String(sequencePosition + 1).padStart(2, '0');
    block.append(thumbnail(frameImages[index]), number);
    const caption = document.createElement('small');
    const label = document.createElement('span'); label.textContent = frame.name;
    const time = document.createElement('span'); time.textContent = `${frame.duration}ms`; caption.append(label, time);
    button.append(block, caption);
    button.addEventListener('click', () => {
      selected = index; position = sequencePosition; playing = false;
      elapsed = animation.frames.slice(0, position).reduce((sum, i) => sum + project.frames[i].duration, 0);
      playState(); setMode('animation'); render();
    });
    return button;
  }));
  $('timing').textContent = `${(animation.duration / 1000).toFixed(2)}s ${animation.loop ? 'loop' : 'once'}`;
  render();
}
function compile() {
  clearTimeout(compileTimer);
  try {
    const nextSpec = JSON.parse(source.value.replace(/^\uFEFF/, ''));
    const compiled = compileSource(nextSpec), nextProject = renderProject(compiled.recipe), nextAtlas = buildAtlas(nextProject);
    spec = compiled.recipe; poseMetadata = compiled.metadata; project = nextProject; atlas = nextAtlas;
    motionReview = null;
    $('motion-view').disabled = !poseMetadata; $('contacts').disabled = !poseMetadata;
    $('motion-tools').hidden = !poseMetadata;
    $('motion-ground').value = poseMetadata?.rig?.ground ?? '';
    if (!poseMetadata && mode === 'motion') mode = 'animation';
    frameImages = project.frames.map(f => imageCanvas(f.data, project.width, project.height));
    $('project-name').textContent = title(project.name);
    $('dimensions').textContent = `${project.width} × ${project.height} px`;
    $('source-filename').textContent = `${project.name}${poseMetadata ? '.poses' : ''}.json`;
    $('frame-count').textContent = `${project.frames.length} frames`;
    const oldAnimation = $('animation').value;
    $('animation').replaceChildren(...Object.keys(project.animations).map(key => { const option = document.createElement('option'); option.value = key; option.textContent = title(key); return option; }));
    if (project.animations[oldAnimation]) $('animation').value = oldAnimation;
    // A linked palette names its file here; the swatches show its colours, which the editor only links.
    const linked = isLinked(nextSpec) ? nextSpec.palette.$ref : null;
    $('color-count').textContent = `${Object.keys(project.palette).length} colors${linked ? ` · ${linked.split(/[\\/]/).pop()}` : ''}`;
    $('color-count').title = linked ? `The palette links ${linked}, drawn with that file as pixelbolt preview read it; entries in the recipe win.` : '';
    $('palette').replaceChildren(...Object.entries(project.palette).map(([key, value]) => {
      const button = document.createElement('button'); button.className = 'swatch'; button.style.background = value;
      button.title = `${key}: ${value}`; button.setAttribute('aria-label', `Color ${key}: ${value}`);
      const [r, g, b] = parseColor(value); button.style.color = r * .299 + g * .587 + b * .114 > 150 ? '#263b42' : '#fff';
      button.textContent = key.length === 1 ? key : '';
      button.addEventListener('click', () => { $('color-info').textContent = `${key}  ${value}`; });
      return button;
    }));
    $('error').hidden = true;
    $('compile-status').textContent = project.warnings.length ? project.warnings.join(' ') : '● All pixels accounted for';
    $('export').disabled = false; valid = true; animationChanged(); setMode(mode);
    source.dispatchEvent(new CustomEvent('pixelbolt:rendered'));
  } catch (error) {
    valid = false; $('error').textContent = error.message; $('error').hidden = false;
    $('compile-status').textContent = 'Fix the recipe to update the preview'; $('export').disabled = true;
  }
}
function keepDraft() {
  clearTimeout(draftTimer);
  if (!drafts || !dirty || ownOffer()) return;
  if (!drafts.save(source.value, $('source-filename').textContent) && !draftWarned) { draftWarned = true; toast('This browser is not keeping drafts (storage is off or full). Use Save JSON.'); }
}
// The recipe on screen was replaced on purpose, so this tab's draft is no longer needed. Other tabs' drafts are never
// touched here.
function settle() { dirty = false; sent = null; clearTimeout(draftTimer); if (drafts && !ownOffer()) drafts.clear(); }
// Whether the recipe on screen may be replaced: always when it has no edits; otherwise the user is asked.
const mayReplace = (question = 'Replace your edited recipe? Save JSON first if you want to keep it.') => !dirty
  || confirm(source.value === sent ? 'Replace this recipe? Save JSON sent it to your browser; if that save was cancelled, choose Cancel and save again.' : question);
// Shows the next draft to offer, or hides the offer when there is none.
function offerDraft(next) {
  offer = next ?? null; $('draft').hidden = !offer;
  if (!offer) return;
  const when = new Date(offer.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), more = offers.length;
  $('draft-text').textContent = ownOffer()
    ? `A draft of ${offer.name}, last edited ${when}, is kept in this browser. Until you choose, new edits are not kept as a draft.`
    : `A draft of ${offer.name} from another tab, last edited ${when}, is kept in this browser.${more ? ` ${more} more from other tabs ${more === 1 ? 'is' : 'are'} offered after it.` : ''}`;
}
function setSource(value, exampleFile) {
  loadVersion++;
  source.value = JSON.stringify(value, null, 2); settle();
  document.querySelectorAll('.example').forEach(button => button.classList.toggle('active', button.dataset.file === exampleFile));
  compile(); playState();
}
async function loadExample(example) {
  if (!mayReplace()) return;
  const version = ++loadVersion;
  try {
    const response = await fetch(`/examples/${example.file}.json`);
    if (!response.ok) throw new Error(`Could not load example: HTTP ${response.status}`);
    const value = await response.json();
    if (version === loadVersion) setSource(value, example.file);
  } catch (error) { toast(error.message); }
}
function setMode(next) {
  mode = next;
  for (const [id, value] of [['animation-view', 'animation'], ['sheet-view', 'sheet'], ['motion-view', 'motion']]) { $(id).classList.toggle('active', value === mode); $(id).setAttribute('aria-pressed', String(value === mode)); }
  $('motion-summary').hidden = mode !== 'motion';
  $('artboard-caption').textContent = mode === 'motion' ? 'Movement at left · poses at right · yellow marks planted feet' : mode === 'sheet' ? 'Export layout · transparent padding' : 'Transparent background';
  render();
}
source.addEventListener('input', () => { dirty = true; valid = false; $('export').disabled = true; clearTimeout(compileTimer); compileTimer = setTimeout(compile, 20); clearTimeout(draftTimer); draftTimer = setTimeout(keepDraft, 400); });
// Tab indents, as in any code editor, but must not trap the keyboard: Shift+Tab always moves back, and Escape lets
// the next Tab move on.
let leavingEditor = false;
source.addEventListener('keydown', event => {
  if (event.key === 'Escape') { leavingEditor = true; return; }
  if (event.key === 'Tab' && !event.shiftKey && !leavingEditor) { event.preventDefault(); const start = source.selectionStart; source.setRangeText('  ', start, source.selectionEnd, 'end'); source.dispatchEvent(new Event('input')); }
  if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) leavingEditor = false;
});
source.addEventListener('blur', () => { leavingEditor = false; });
$('play').addEventListener('click', () => { if (!project) return; playing = !playing; if (playing) { if (elapsed >= project.animations[$('animation').value].duration) elapsed = 0; setMode('animation'); } playState(); });
$('animation').addEventListener('change', animationChanged);
$('zoom').addEventListener('change', () => { zoom = Number($('zoom').value); render(); });
$('review-view').addEventListener('change', render);
for (const id of ['grid', 'onion', 'contacts']) $(id).addEventListener('click', () => { $(id).setAttribute('aria-pressed', String($(id).getAttribute('aria-pressed') !== 'true')); render(); });
$('animation-view').addEventListener('click', () => setMode('animation'));
$('sheet-view').addEventListener('click', () => setMode('sheet'));
$('motion-view').addEventListener('click', () => setMode('motion'));
for (const id of ['motion-speed', 'motion-ground']) $(id).addEventListener('change', () => { motionReview = null; render(); });
$('guide-toggle').addEventListener('click', () => $('guide').showModal());
$('guide-close').addEventListener('click', () => $('guide').close());
$('open').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  try {
    if (file.size > MAX_REQUEST_BYTES) throw new Error(`Choose a project no larger than ${MAX_REQUEST_BYTES / (1024 * 1024)} MiB.`);
    const value = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); renderProject(compileSource(value).recipe);
    if (!mayReplace()) return;
    setSource(value); toast(`Opened ${file.name}`);
  } catch (error) { toast(error.message); } finally { $('file').value = ''; }
});
$('new').addEventListener('click', () => {
  if (!mayReplace()) return;
  setSource({ version: 1, name: 'new-sprite', width: 16, height: 16, palette: { g: '#72b58d' }, frames: [{ name: 'idle', duration: 150, ops: [] }] });
  source.focus();
});
// The browser may ask where to save, and the page never learns whether the file was kept, so nothing is settled here:
// the draft stays until the user edits again (the draft then follows) or confirms replacing or leaving the recipe.
$('save').addEventListener('click', () => {
  const filename = `${project?.name ?? 'sprite'}.pixel.json`;
  download(source.value, filename, 'application/json'); sent = source.value;
  toast(`Sent ${filename} to your browser to save.${dirty ? ' Until you load another recipe, its draft is kept here too.' : ''}`); keepDraft();
});
$('gif').addEventListener('click', () => {
  compile(); if (!valid) { toast('Fix the recipe to export a GIF.'); return; }
  try {
    const gif = animationGIF(project, $('animation').value, { scale: zoom });
    download(gif.data, `${project.name}-${gif.animation}.gif`, 'image/gif');
    toast(`GIF saved: ${gif.width} × ${gif.height} px.${gif.partialAlpha ? ` ${gif.partialAlpha} partly transparent pixels became fully transparent or opaque; the gif command can blend them onto a background.` : ''}`);
  } catch (error) { toast(error.message); }
});
// Frames for a video editor: the server builds them exactly as `pixelbolt sequence` does. The dialog also shows that
// call, and the MCP one, because agents are who usually make these.
const framesSettings = () => ({ fps: $('frames-fps').value, animation: $('animation').value, ...($('frames-size').value ? { size: $('frames-size').value } : { scale: zoom }) });
function showFramesCall() {
  const settings = framesSettings(), sizing = settings.size ? `--size ${settings.size}` : `--scale ${settings.scale}`;
  $('frames-call').textContent = `pixelbolt sequence ${project.name}.pixel.json --fps ${settings.fps} ${sizing} --animation ${settings.animation} --out frames\n\npixel_render { "revision": "…", "sequence": ${JSON.stringify(settings)} }`;
}
$('frames').addEventListener('click', () => { compile(); if (!valid) { toast('Fix the recipe to export frames.'); return; } showFramesCall(); $('frames-dialog').showModal(); });
for (const id of ['frames-fps', 'frames-size']) $(id).addEventListener('change', showFramesCall);
$('frames-close').addEventListener('click', () => $('frames-dialog').close());
$('frames-export').addEventListener('click', async () => {
  const button = $('frames-export'); button.disabled = true; button.textContent = 'Making frames…';
  try {
    const response = await fetch('/api/sequence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: spec, sequence: framesSettings() }) });
    if (!response.ok) { const body = await response.text(); try { throw new Error(JSON.parse(body).error); } catch (error) { if (error instanceof SyntaxError) throw new Error(body); throw error; } }
    const summary = JSON.parse(response.headers.get('X-PixelForge-Sequence') ?? '{}');
    download(await response.blob(), `${project.name}-${$('animation').value}-frames.zip`);
    $('frames-dialog').close();
    toast(`Frames saved: ${summary.frames} PNGs, ${summary.width} × ${summary.height}, ${summary.fps} fps.${summary.notes ? ' The README in the ZIP explains how the timing was fitted.' : ''}`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Export frames'; }
});
$('draft-restore').addEventListener('click', () => {
  if (!mayReplace('Replace your edited recipe with the draft? Save JSON first if you want to keep it.')) return;
  loadVersion++; source.value = offer.text; dirty = true;
  // A closed tab's draft becomes this tab's: it is kept under this tab's id before the closed tab's copy goes.
  if (!ownOffer() && drafts.save(offer.text, offer.name)) drafts.forget(offer.id);
  // Other closed tabs' drafts stay kept and are offered on the next visit.
  offers = []; offerDraft(null);
  document.querySelectorAll('.example').forEach(button => button.classList.remove('active'));
  compile(); playState(); toast('Draft restored. Save JSON to keep it.');
});
$('draft-discard').addEventListener('click', () => {
  if (ownOffer()) drafts.clear(); else drafts.forget(offer.id);
  offerDraft(offers.shift()); keepDraft();
});
$('export').addEventListener('click', async () => {
  compile(); if (!valid) return;
  const button = $('export'), original = button.textContent; button.disabled = true; button.textContent = 'Packing assets…';
  try {
    const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
    if (!response.ok) { const body = await response.text(); try { throw new Error(JSON.parse(body).error); } catch (error) { if (error instanceof SyntaxError) throw new Error(body); throw error; } }
    download(await response.blob(), `${project.name}.zip`); toast('Your sprite bundle is ready');
  } catch (error) { toast(error.message); }
  finally { button.textContent = original; button.disabled = !valid; }
});
addEventListener('resize', render);
addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
addEventListener('pagehide', keepDraft);
document.addEventListener('visibilitychange', () => { lastTime = 0; if (document.hidden) keepDraft(); });
function tick(time) {
  const delta = lastTime ? time - lastTime : 0; lastTime = time;
  if (project && playing && mode === 'animation' && !document.hidden) {
    const a = project.animations[$('animation').value]; elapsed += delta * Number($('speed').value);
    const nextPosition = animationPosition(project, a, elapsed), next = a.frames[nextPosition];
    if (!a.loop && elapsed >= a.duration) { playing = false; playState(); }
    if (position !== nextPosition) { selected = next; position = nextPosition; render(); }
  }
  requestAnimationFrame(tick);
}
async function boot() {
  try {
    for (const example of examples) {
      const response = await fetch(`/examples/${example.file}.json`); const value = await response.json(), preview = renderProject(compileSource(value).recipe);
      const button = document.createElement('button'); button.className = 'example'; button.dataset.file = example.file;
      const label = document.createElement('span'), strong = document.createElement('strong'), small = document.createElement('small');
      strong.textContent = example.title; small.textContent = example.type; label.append(strong, small);
      button.append(thumbnail(imageCanvas(preview.frames[0].data, preview.width, preview.height)), label);
      button.addEventListener('click', () => loadExample(example)); $('examples').append(button);
    }
    $('example-count').textContent = String($('examples').children.length).padStart(2, '0');
    // This tab's own draft comes first (a reload); then those of tabs that are closed now, newest first. Drafts of
    // tabs that are still open stay theirs.
    const id = await claimed, open = await openTabs(locks);
    // The recipe as written, and the palette file it links, before any draft is offered: a restored draft that links
    // the file is drawn with it.
    const [initial, linked] = await Promise.all([fetch('/project.json'), fetch('/shared-palette.json')].map(async response => (await response).json()));
    sharedPalette = linked;
    drafts = createDraftStore(browserStorage('localStorage'), { id });
    const own = drafts.load();
    offers = [...(own ? [{ ...own, id }] : []), ...drafts.others(open)];
    offerDraft(offers.shift());
    if (initial) setSource(initial); else await loadExample(examples[0]);
    playState(); requestAnimationFrame(tick);
  } catch (error) { $('error').hidden = false; $('error').textContent = error.message; $('export').disabled = true; }
}
boot();
