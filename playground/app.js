import { RECIPE_LIMIT } from './share.js';
import { advancePlayback, engineOverride, filterExamples, formatSize, safeName, timeLimit } from './lib.js';

export const PINNED_VERSION = '0.9.0';
const REQUEST_TIMEOUT = timeLimit(location.href);
const $ = id => document.getElementById(id);
const editor = $('recipe'), canvas = $('preview'), context = canvas.getContext('2d');
const override = engineOverride(location.href), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let version = PINNED_VERSION, worker, pending, requestId = 0, debounce, editGeneration = 0;
let manifest = [], rendered = null, valid = false, position = 0, playing = false, nextAt = 0;
let downloadURLs = [], downloadTimer, zoomChosen = false, unsavedEdits = false, shownExample = '';
// One-shot animations hold their last frame this long before playing again, as the studio's Fluid lab does.
const HOLD = 600;
const aborted = () => Object.assign(new Error('Superseded'), { name: 'AbortError' });
const setStatus = message => { $('status').textContent = message; };

function controls() {
  const busy = Boolean(pending), ready = valid && !busy;
  for (const id of ['copy-link', 'export-frame', 'export-sheet', 'export-gif']) $(id).disabled = !ready;
  $('export-atlas').disabled = !ready || rendered?.kind === 'scene';
  $('export-atlas').title = rendered?.kind === 'scene' ? 'Scenes have no sprite atlas metadata. Download the sheet instead.' : 'Download the sheet PNG and its atlas JSON';
  $('atlas-help').hidden = rendered?.kind !== 'scene';
  $('export-recipe').disabled = busy || !editor.value.trim();
  for (const id of ['animation', 'play', 'step-back', 'step-forward']) $(id).disabled = !rendered;
  $('cancel').hidden = !busy;
  $('retry').hidden = busy || valid || !editor.value.trim();
  $('play').textContent = playing ? 'Pause' : 'Play';
  $('play').setAttribute('aria-pressed', String(playing));
  $('artboard').setAttribute('aria-busy', String(busy));
}
function errorMessage(message, invalidate = true) {
  if (invalidate) { valid = false; playing = false; }
  document.body.dataset.state = 'error';
  $('error').textContent = message; $('error').hidden = false;
  editor.setAttribute('aria-invalid', String(invalidate));
  setStatus(rendered ? 'The last good render is still shown.' : 'No render yet.');
  controls();
}
function clearError() { $('error').hidden = true; $('error').textContent = ''; $('show-error').hidden = true; editor.setAttribute('aria-invalid', 'false'); }
// A JSON error names its line; the button selects that line in the editor without moving the caret while you type.
function offerLine(line) {
  $('show-error').hidden = !line;
  if (line) { $('show-error').textContent = `Go to line ${line}`; $('show-error').dataset.line = String(line); }
}
function examplesList() {
  const selected = $('examples').value, groups = new Map();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose an example…';
  $('examples').replaceChildren(placeholder);
  const labels = { project: 'Sprites and tiles', poses: 'Poses', fluid: 'Fluid effects', fx: 'Particle effects', scene: 'Scenes', normals: 'Normal passes', autotile: 'Autotiles' };
  for (const entry of filterExamples(manifest, version)) {
    if (!groups.has(entry.kind)) { const group = document.createElement('optgroup'); group.label = labels[entry.kind] ?? entry.kind; groups.set(entry.kind, group); $('examples').append(group); }
    const option = document.createElement('option'); option.value = entry.file; option.textContent = entry.title; groups.get(entry.kind).append(option);
  }
  if ([...$('examples').options].some(option => option.value === selected)) $('examples').value = selected;
}
function versionLabel() {
  const shownVersion = rendered?.version ?? version;
  $('engine-version').textContent = `Pixelbolt ${shownVersion}${shownVersion !== version ? ' (last good render)' : ''}${override.base ? ' (local test engine override)' : ''}`;
  $('active-engine').textContent = `Engine ${version}`;
  $('version-notice').hidden = version === PINNED_VERSION;
  $('version-message').textContent = `This recipe was made with Pixelbolt ${version}.`;
  $('use-pin').textContent = `Render on ${PINNED_VERSION} instead`;
  examplesList();
}
function sourceChanged(text, nextVersion) {
  editor.value = text; version = nextVersion; valid = false; unsavedEdits = false; versionLabel();
  $('recipe-size').textContent = formatSize(new TextEncoder().encode(text).length);
}
function stopWorker(reason = aborted()) {
  worker?.terminate(); worker = null;
  if (pending) { const item = pending; pending = null; clearTimeout(item.timer); item.reject(reason); }
  controls();
}
function ensureWorker() {
  if (worker) return;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const started = worker;
  worker.onmessage = ({ data }) => {
    if (!pending || data.id !== pending.id) return;
    if (data.source) { sourceChanged(data.source.text, data.source.version); return; }
    const item = pending; pending = null; clearTimeout(item.timer);
    if (data.error) item.reject(Object.assign(new Error(data.error.message), { name: data.error.name, path: data.error.path, line: data.error.line }));
    else item.resolve(data.result);
  };
  worker.onerror = event => { event.preventDefault(); if (worker === started) stopWorker(new Error(event.message || 'The render worker could not start. Use a static HTTP server and a browser with module worker support.')); };
  worker.onmessageerror = () => { if (worker === started) stopWorker(new Error('The render worker could not return its result. Try rendering again.')); };
}
function request(type, extra = {}) {
  if (pending) stopWorker();
  clearError();
  const isSource = ['render', 'example', 'open', 'link'].includes(type);
  if (isSource) { valid = false; playing = false; }
  document.body.dataset.state = type === 'example' || type === 'link' ? 'loading' : 'rendering';
  setStatus(type === 'export' ? 'Preparing download…' : type === 'share' ? 'Preparing share link…' : 'Loading engine and rendering…');
  return new Promise((resolve, reject) => {
    try {
      ensureWorker();
      const id = ++requestId;
      pending = { id, resolve, reject, timer: setTimeout(() => stopWorker(new Error(`Stopped: rendering took longer than ${REQUEST_TIMEOUT / 1000} s.`)), REQUEST_TIMEOUT) };
      controls();
      worker.postMessage({ id, type, text: editor.value, version, override: override.base, ...extra }, extra.png ? [extra.png] : []);
    } catch (error) { stopWorker(error); reject(error); }
  });
}
const animation = () => rendered?.animations[$('animation').value];
const frameIndex = () => animation()?.frames[position] ?? 0;
function gifSize() {
  if (!rendered) return;
  const scale = Number($('gif-scale').value);
  $('gif-size').textContent = `GIF: ${rendered.width * scale}×${rendered.height * scale} px, ${animation().frames.length} frames, scale ${scale}`;
}
// Until someone picks a zoom, the art gets the largest whole zoom (1 to 16) that fits the preview box.
function fitZoom() {
  if (zoomChosen || !rendered || typeof getComputedStyle !== 'function') return;
  const box = $('artboard'), style = getComputedStyle(box);
  const width = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (!(width > 0 && height > 0)) return;
  $('zoom').value = String(Math.max(1, Math.min(16, Math.floor(Math.min(width / rendered.width, height / rendered.height)))));
}
function draw() {
  if (!rendered) return;
  const frame = rendered.frames[frameIndex()], zoom = Number($('zoom').value);
  canvas.width = rendered.width; canvas.height = rendered.height;
  canvas.style.width = `${rendered.width * zoom}px`; canvas.style.height = `${rendered.height * zoom}px`;
  context.imageSmoothingEnabled = false;
  context.putImageData(new ImageData(new Uint8ClampedArray(frame.data), rendered.width, rendered.height), 0, 0);
  canvas.setAttribute('aria-label', `${rendered.name}, frame ${frame.name}`);
  $('frame-counter').textContent = `${position + 1} / ${animation().frames.length}`;
  $('empty-preview').hidden = true;
  gifSize();
}
function acceptRender(result) {
  const previous = $('animation').value;
  rendered = result; valid = true; position = 0; nextAt = 0;
  version = result.version; versionLabel();
  $('animation').replaceChildren(...Object.keys(result.animations).map(name => {
    const option = document.createElement('option'); option.value = name; option.textContent = name; return option;
  }));
  if (Object.hasOwn(result.animations, previous)) $('animation').value = previous;
  playing = !reducedMotion.matches && animation().frames.length > 1;
  document.body.dataset.state = 'ready'; document.body.dataset.digest = result.digest;
  $('digest').textContent = result.digest; $('kind').textContent = result.kind;
  $('dimensions').textContent = `${result.width}×${result.height} px`;
  $('frame-count').textContent = String(result.frames.length);
  $('warnings').textContent = result.warnings.length ? result.warnings.join('\n') : 'None';
  clearError(); fitZoom(); draw(); controls();
  const animations = Object.keys(result.animations).length;
  setStatus(`Rendered ${result.name} · ${result.frames.length} frames${animations > 1 ? ` in ${animations} animations` : ''}${result.warnings.length ? ' · see warnings in About this render' : ''}.`);
}
async function runRender(type = 'render', extra = {}) {
  clearTimeout(debounce);
  try { acceptRender(await request(type, extra)); }
  catch (error) { if (error.name !== 'AbortError') { errorMessage(error.message); offerLine(error.line); } }
}
function renderEdit() {
  if (editor.value.length > RECIPE_LIMIT || new TextEncoder().encode(editor.value).length > RECIPE_LIMIT) {
    errorMessage(`The recipe is larger than ${RECIPE_LIMIT.toLocaleString('en')} bytes.`); return;
  }
  runRender();
}
function invalidate() {
  editGeneration++; clearTimeout(debounce);
  if (pending) stopWorker();
  valid = false; playing = false; clearError();
  $('share-link').value = ''; $('share-error').hidden = true;
  document.body.dataset.state = 'rendering'; controls();
}
editor.addEventListener('input', () => {
  invalidate(); unsavedEdits = true; $('examples').value = ''; shownExample = '';
  $('recipe-size').textContent = formatSize(new TextEncoder().encode(editor.value).length);
  setStatus('Waiting for edits…'); debounce = setTimeout(renderEdit, 300);
});
$('examples').addEventListener('change', () => {
  if (!$('examples').value) return;
  // A keyboard arrow on the closed menu also changes it, so edits are never dropped silently.
  if (unsavedEdits && !confirm('Replace your edited recipe? Download it or copy its link first if you want to keep it.')) { $('examples').value = shownExample; return; }
  shownExample = $('examples').value;
  invalidate(); runRender('example', { file: shownExample });
});
$('show-error').addEventListener('click', () => {
  const line = Number($('show-error').dataset.line), lines = editor.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
  editor.focus(); editor.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  editor.scrollTop = Math.max(0, (line - 4) * (parseFloat(getComputedStyle(editor).lineHeight) || 20));
});
$('use-pin').addEventListener('click', () => { invalidate(); version = PINNED_VERSION; versionLabel(); renderEdit(); });
$('cancel').addEventListener('click', () => { editGeneration++; clearTimeout(debounce); stopWorker(); errorMessage('Stopped: rendering cancelled.'); });
$('retry').addEventListener('click', renderEdit);

async function openFile(file) {
  if (!file) return;
  invalidate(); const generation = editGeneration;
  try {
    if (/\.png$/i.test(file.name) || file.type === 'image/png') {
      // Bound the input allocation too; recipe decompression has its own stricter limit in share.js.
      if (file.size > 96 * 1024 * 1024) throw new Error('Choose a PNG no larger than 96 MiB.');
      const png = await file.arrayBuffer();
      if (generation === editGeneration) await runRender('open', { png });
    } else if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      if (file.size > RECIPE_LIMIT) throw new Error(`The recipe is larger than ${RECIPE_LIMIT.toLocaleString('en')} bytes.`);
      const text = await file.text();
      if (generation === editGeneration) await runRender('open', { text });
    } else throw new Error('Open a .json recipe or a .png exported by the playground.');
  } catch (error) { if (generation === editGeneration) errorMessage(error.message); }
}
$('open-button').addEventListener('click', () => $('open-file').click());
$('open-file').addEventListener('change', () => { openFile($('open-file').files[0]); $('open-file').value = ''; });
let dragDepth = 0;
document.addEventListener('dragenter', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); dragDepth++; document.body.classList.add('dragging');
});
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); openFile(event.dataTransfer.files[0]);
});

$('copy-link').addEventListener('click', async () => {
  const generation = editGeneration;
  try {
    const result = await request('share', { base: location.origin + location.pathname });
    if (generation !== editGeneration) return;
    $('share-link').value = result.link;
    history.replaceState(null, '', result.link);
    document.body.dataset.state = 'ready'; controls();
    $('share-error').hidden = true;
    try { await navigator.clipboard.writeText(result.link); if (generation === editGeneration) setStatus('Share link copied.'); }
    catch { if (generation === editGeneration) { $('share-link').focus(); $('share-link').select(); setStatus('The link is selected. Press Ctrl+C or Command+C to copy it.'); } }
  } catch (error) {
    if (error.name === 'AbortError') return;
    // A link that is too long is about sharing, not the recipe: the render stays valid and on screen.
    $('share-error').textContent = error.message; $('share-error').hidden = false;
    document.body.dataset.state = valid ? 'ready' : 'error'; controls();
    setStatus('No link made; see the note under Share link.');
  }
});
function clearDownloads() {
  clearTimeout(downloadTimer);
  for (const url of downloadURLs) URL.revokeObjectURL(url);
  downloadURLs = []; $('download-links').replaceChildren(); $('download-links').hidden = true;
}
function download(files) {
  clearDownloads();
  for (const file of files) {
    const url = URL.createObjectURL(new Blob([file.data], { type: file.type })); downloadURLs.push(url);
    const link = document.createElement('a'); link.href = url;
    // Preserve known extension separators; no recipe text can supply a path or HTML filename.
    const filename = file.name.split('.').map(part => safeName(part)).join('.');
    link.download = filename; link.textContent = `Save ${filename} (${formatSize(file.data.length)})`;
    $('download-links').append(link);
    const automatic = document.createElement('a'); automatic.href = url; automatic.download = filename;
    document.body.append(automatic); automatic.click(); automatic.remove();
  }
  $('download-links').hidden = false;
  // Some browsers block the second automatic file. Keep explicit links briefly, then release all blobs.
  downloadTimer = setTimeout(clearDownloads, 120000);
}
for (const kind of ['frame', 'sheet', 'gif', 'atlas', 'recipe']) $(`export-${kind}`).addEventListener('click', async () => {
  try {
    const result = await request('export', { export: kind, frame: frameIndex(), animation: $('animation').value, scale: Number($('gif-scale').value) });
    download(result.files); document.body.dataset.state = valid ? 'ready' : 'error'; controls();
    setStatus(`Download ready.${kind === 'atlas' ? ' If only one file downloaded, use the file links below (available for two minutes).' : ''}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`);
    if (result.warnings.length) $('warnings').textContent = [...(rendered?.warnings ?? []), ...result.warnings].join('\n');
  } catch (error) { if (error.name !== 'AbortError') errorMessage(error.message, false); }
});

function step(delta) {
  if (!rendered) return;
  playing = false; position = (position + delta + animation().frames.length) % animation().frames.length; nextAt = 0; controls(); draw();
}
function togglePlay() {
  if (!rendered) return;
  playing = !playing; nextAt = 0;
  if (playing && position === animation().frames.length - 1) position = 0;
  controls(); draw();
}
$('play').addEventListener('click', togglePlay);
$('step-back').addEventListener('click', () => step(-1));
$('step-forward').addEventListener('click', () => step(1));
$('animation').addEventListener('change', () => { position = 0; nextAt = 0; draw(); });
$('zoom').addEventListener('change', () => { zoomChosen = true; draw(); });
addEventListener('resize', () => { if (!zoomChosen && rendered) { fitZoom(); draw(); } });
$('gif-scale').addEventListener('change', gifSize);
canvas.addEventListener('keydown', event => {
  if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    if (event.key === ' ') togglePlay(); else step(['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
  }
});
function tick(now) {
  if (playing && rendered && !document.hidden) {
    const sequence = animation(), step = advancePlayback({ position, nextAt, now, durations: sequence.frames.map(index => rendered.frames[index].duration), loop: sequence.loop, hold: HOLD });
    position = step.position; nextAt = step.nextAt;
    if (step.moved) draw();
  }
  requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => { nextAt = 0; });
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { playing = false; controls(); } });
addEventListener('pagehide', () => { clearDownloads(); stopWorker(); });
function openHash() {
  if (!location.hash) return false;
  invalidate(); runRender('link', { hash: location.hash }); return true;
}
addEventListener('hashchange', openHash);

async function boot() {
  for (const id of ['zoom', 'gif-scale']) for (let scale = 1; scale <= 16; scale++) {
    const option = document.createElement('option'); option.value = String(scale); option.textContent = `${scale}×`; $(id).append(option);
  }
  $('zoom').value = '8'; $('gif-scale').value = '1';
  $('notice').textContent = override.notice; $('notice').hidden = !override.notice;
  versionLabel(); controls(); requestAnimationFrame(tick);
  if (!globalThis.Worker || !globalThis.CompressionStream || !globalThis.DecompressionStream || !globalThis.crypto?.subtle) {
    errorMessage('This playground needs module workers, CompressionStream and Web Crypto. Use a current browser over HTTPS or localhost.'); return;
  }
  const opened = openHash(), generation = editGeneration;
  try {
    const response = await fetch(new URL('./examples.json', import.meta.url), { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    if (!response.ok) throw new Error(`Examples could not be loaded: HTTP ${response.status}. Paste or open a recipe instead.`);
    manifest = await response.json(); examplesList();
    if (!opened && generation === editGeneration) { $('examples').value = 'forest-spirit.json'; await runRender('example', { file: 'forest-spirit.json' }); }
  } catch (error) { $('notice').textContent = [override.notice, error.message].filter(Boolean).join(' '); $('notice').hidden = false; if (!opened && generation === editGeneration) errorMessage('Examples could not be loaded. Paste or open a recipe to start.'); }
}
boot();
