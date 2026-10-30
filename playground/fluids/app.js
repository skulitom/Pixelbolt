import { shareLink } from '../share.js';
import { engineBase, engineOverride, formatSize } from '../lib.js';
import { PRESETS, presetById, TOY_VERSION, RECORD_FRAMES, MAX_POKES, GIF_MS, STAGE, pushPoke, puffPoke, applyPoke, fitLink, readToyLink, toyLink, fitZoom, gifScale, stirRadius } from './lib.js';

const $ = id => document.getElementById(id);
const canvas = $('fluid'), context = canvas.getContext('2d'), stage = $('stage'), ghost = $('ghost');
const override = engineOverride(location.href), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
// A press that has not moved this far (in art pixels) after HOLD_MS becomes a pour; one that moves first is a stir.
const MOVE = 1.5, HOLD_MS = 150, TAP_FRAMES = 3, MAX_SPEED = 8;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// `run` is the effect on screen: its runner, frame count since its start, recorded pokes, an optional replay of a
// shared link, and the frames kept for the GIF. A newer start supersedes an older one still loading.
let run = null, generation = 0, loading = null, running = !reducedMotion.matches, last = 0, carry = 0;
let gesture = null, tap = null, keyPush = null, keyPour = false, ghostUntil = 0;
const engines = new Map(), sources = new Map();
const setStatus = message => { $('status').textContent = message; };
const seconds = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.floor(s / 60)} min ${s % 60} s`; };

function controls() {
  const ready = Boolean(run) && !loading;
  for (const id of ['pause', 'restart', 'copy-link']) $(id).disabled = !ready;
  $('save-gif').disabled = !ready || !run.ring.length;
  $('pause').textContent = running ? 'Pause' : 'Play';
  $('pause').setAttribute('aria-pressed', String(!running));
  for (const button of $('presets').children) button.setAttribute('aria-pressed', String(button.value === (loading?.id ?? run?.preset.id)));
  document.body.dataset.state = loading ? 'loading' : run ? 'ready' : 'error';
}
function note(text) { $('stage-note').textContent = text; $('stage-note').hidden = !text; }

function engineFor(version) {
  const base = engineBase(version, override.base);
  if (!engines.has(base)) {
    engines.set(base, Promise.all(['fluid', 'gif', 'core'].map(name => import(new URL(`${name}.js`, base))))
      .then(([fluid, gif, core]) => ({ base, fluid, gif, core }))
      .catch(() => { engines.delete(base); throw new Error(override.base ? 'The local test engine could not be loaded.' : `Pixelbolt ${version} could not be loaded from jsDelivr. Check your connection and try again.`); }));
  }
  return engines.get(base);
}
function sourceFor(base, file) {
  const url = new URL(`../examples/${file}`, base).href;
  if (!sources.has(url)) {
    sources.set(url, fetch(url, { credentials: 'omit', redirect: 'error' })
      .then(response => { if (!response.ok) throw new Error(`The effect could not be loaded (HTTP ${response.status}).`); return response.json(); })
      .catch(error => { sources.delete(url); throw error instanceof SyntaxError || /HTTP/.test(error.message) ? error : new Error('The effect could not be loaded. Check your connection and try again.'); }));
  }
  return sources.get(url).then(source => structuredClone(source));
}

// Starts an effect from its first frame, optionally replaying a shared recording.
async function start(id, { version = TOY_VERSION, frames = 0, pokes = [] } = {}) {
  const preset = presetById(id), mine = ++generation;
  loading = preset; gesture = null; tap = null; controls();
  note(`Warming up the ${preset.title.toLowerCase()}…`);
  try {
    const engine = await engineFor(version), source = await sourceFor(engine.base, preset.file);
    if (mine !== generation) return;
    // Let the note paint before the warm-up, which simulates one cycle (up to a few hundred milliseconds).
    await new Promise(resolve => setTimeout(resolve, 0));
    if (mine !== generation) return;
    const live = engine.fluid.createLiveFluid(source), effect = Object.values(source.effects)[0];
    run = { preset, version, engine, live, width: live.width, height: live.height, duration: effect.duration ?? 70,
      t: 0, pokes: pokes.slice(), replay: frames ? { at: 0, frames } : null, ring: [] };
    canvas.width = run.width; canvas.height = run.height;
    canvas.setAttribute('aria-label', `Live pixel-art ${preset.title.toLowerCase()}`);
    $('hint').textContent = preset.hint;
    $('cli').textContent = `pixelbolt compile ${preset.file} --out ${preset.id}.json`;
    $('active-engine').textContent = `· engine ${version}${override.base ? ' (local test override)' : ''}`;
    loading = null; layout(); draw(); note('');
    if (!running) setStatus(`Paused, as your system asks for less motion. ${run.replay ? `Press Play to watch the ${seconds(frames * run.duration)} someone shared.` : 'Press Play or touch the effect to start.'}`);
    else if (run.replay) setStatus(`Replaying ${seconds(frames * run.duration)} that someone shared. Touch the effect to take over.`);
    else setStatus('');
    // The remix link opens this effect's recipe in the playground, on the same engine version.
    $('remix').href = '../';
    shareLink(source, version, { base: new URL('../', location.href).href }).then(link => { if (mine === generation) $('remix').href = link; }, () => {});
  } catch (error) {
    if (mine !== generation) return;
    loading = null; note(''); setStatus(error.message);
  } finally { if (mine === generation) controls(); }
}

function layout() {
  if (!run) return;
  const box = stage.getBoundingClientRect(), { cssWidth, cssHeight } = fitZoom(Math.max(1, box.width - 32), Math.max(1, box.height - 32), run.width, run.height, devicePixelRatio || 1);
  canvas.style.width = `${cssWidth}px`; canvas.style.height = `${cssHeight}px`;
}
function draw() {
  const { rgba } = run.live.render();
  context.putImageData(new ImageData(rgba, run.width, run.height), 0, 0);
  return rgba;
}

// What the hand does to the effect this frame. Holding pours (a liquid) or adds heat and smoke (a gas); dragging pushes
// with the pointer's speed, in art pixels per frame.
function pour(x, y) {
  return run.live.kind === 'liquid' ? puffPoke({ x, y, radius: 2.5, density: 1 }, 'liquid') : puffPoke({ x, y, radius: 3, density: 0.6, temperature: 1 }, 'gas');
}
function handPokes(now) {
  const pokes = [], { width, height } = run, clamp = value => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, value));
  if (gesture) {
    if (gesture.mode === 'pending' && now - gesture.downAt >= HOLD_MS) gesture.mode = 'pour';
    if (gesture.mode === 'stir') {
      const vx = clamp(gesture.x - gesture.lastX), vy = clamp(gesture.y - gesture.lastY);
      if (Math.abs(vx) + Math.abs(vy) >= 0.25) pokes.push(pushPoke({ x: gesture.x, y: gesture.y, vx, vy, radius: stirRadius(width, height) }));
    } else if (gesture.mode === 'pour') pokes.push(pour(gesture.x, gesture.y));
    gesture.lastX = gesture.x; gesture.lastY = gesture.y;
  }
  if (tap) { pokes.push(pour(tap.x, tap.y)); if (--tap.left <= 0) tap = null; }
  const [sx, sy] = run.preset.spot;
  if (keyPour) pokes.push(pour(width * sx, height * sy));
  if (keyPush) pokes.push(pushPoke({ x: width * 0.5, y: height * 0.6, vx: keyPush[0] * 3, vy: keyPush[1] * 3, radius: stirRadius(width, height) }));
  return pokes;
}
function showGhost(poke, now) {
  const rect = canvas.getBoundingClientRect(), size = poke.r / 2 * rect.width / run.width;
  Object.assign(ghost.style, { left: `${poke.x / 4 / run.width * 100}%`, top: `${poke.y / 4 / run.height * 100}%`, width: `${size}px`, height: `${size}px` });
  ghost.classList.toggle('pour', poke.op !== 0); ghost.hidden = false; ghostUntil = now + 250;
}
// One frame: a replay's pokes for it, or the hand's (recorded for links), then the simulation and the picture.
function tick(now) {
  const current = run;
  if (current.replay) {
    while (current.replay.at < current.pokes.length && current.pokes[current.replay.at].f === current.t) {
      const poke = current.pokes[current.replay.at++];
      applyPoke(current.live, poke); showGhost(poke, now);
    }
  } else {
    for (const poke of handPokes(now)) {
      applyPoke(current.live, poke);
      if (current.t < RECORD_FRAMES && current.pokes.length < MAX_POKES) current.pokes.push({ ...poke, f: current.t });
    }
  }
  current.live.step(); current.t++;
  current.ring.push(draw());
  if (current.ring.length > Math.ceil(GIF_MS / current.duration)) current.ring.shift();
  if (current.replay && current.t >= current.replay.frames) { current.replay = null; setStatus(`That was the shared poke. Your turn: ${current.preset.hint.charAt(0).toLowerCase()}${current.preset.hint.slice(1)}`); }
  if (!ghost.hidden && now >= ghostUntil) ghost.hidden = true;
  if (current.ring.length === 1) controls();
}
function loop(now) {
  requestAnimationFrame(loop);
  if (!run || loading || !running || document.hidden) { last = 0; return; }
  if (!last) { last = now; return; }
  carry += now - last; last = now;
  // A slow device drops time rather than falling further and further behind.
  for (let steps = 0; carry >= run.duration && steps < 4; steps++) { tick(now); carry -= run.duration; }
  if (carry >= run.duration) carry = 0;
}
function setRunning(value) { running = value; last = 0; carry = 0; controls(); }
// Touching the effect during a replay ends it: the pokes already replayed stay, so a new link carries them on.
function takeOver() {
  if (run?.replay) { run.pokes = run.pokes.slice(0, run.replay.at); run.replay = null; ghost.hidden = true; setStatus('Your turn. Copy link shares the shared poke and yours together.'); }
  if (!running) { setRunning(true); if (!run?.replay) setStatus(''); }
}

const artPoint = event => {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width * run.width, y: (event.clientY - rect.top) / rect.height * run.height };
};
canvas.addEventListener('pointerdown', event => {
  if (!run || loading || gesture || event.button > 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  try { canvas.setPointerCapture(event.pointerId); } catch {}
  takeOver();
  const at = artPoint(event);
  gesture = { id: event.pointerId, mode: 'pending', downAt: performance.now(), x: at.x, y: at.y, startX: at.x, startY: at.y, lastX: at.x, lastY: at.y };
});
canvas.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.id) return;
  const at = artPoint(event);
  gesture.x = at.x; gesture.y = at.y;
  if (gesture.mode === 'pending' && Math.hypot(at.x - gesture.startX, at.y - gesture.startY) > MOVE) gesture.mode = 'stir';
});
const release = event => {
  if (!gesture || event.pointerId !== gesture.id) return;
  // A quick tap still pours a little.
  if (gesture.mode === 'pending' && event.type === 'pointerup') tap = { x: gesture.x, y: gesture.y, left: TAP_FRAMES };
  gesture = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('keydown', event => {
  if (!run || loading) return;
  if (ARROWS[event.key]) { event.preventDefault(); takeOver(); keyPush = ARROWS[event.key]; }
  else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); takeOver(); keyPour = true; }
});
canvas.addEventListener('keyup', event => {
  if (ARROWS[event.key] && keyPush === ARROWS[event.key]) keyPush = null;
  if (event.key === ' ' || event.key === 'Enter') keyPour = false;
});
canvas.addEventListener('blur', () => { keyPush = null; keyPour = false; });

for (const preset of PRESETS) {
  const button = document.createElement('button');
  button.type = 'button'; button.value = preset.id; button.textContent = preset.title; button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    if (loading?.id === preset.id) return;
    history.replaceState(null, '', `#p=${preset.id}`);
    start(preset.id);
  });
  $('presets').append(button);
}
$('pause').addEventListener('click', () => { setRunning(!running); setStatus(running ? '' : 'Paused.'); });
$('restart').addEventListener('click', () => {
  if (!run) return;
  history.replaceState(null, '', `#${run.version === TOY_VERSION ? '' : `v=${run.version}&`}p=${run.preset.id}`);
  start(run.preset.id, { version: run.version });
});

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('save-gif').addEventListener('click', () => {
  if (!run?.ring.length) return;
  const { width, height, ring, duration, preset, engine } = run, scale = gifScale(width, height);
  try {
    const frames = ring.map((rgba, n) => ({ name: `frame ${n + 1}`, width: width * scale, height: height * scale, data: engine.core.scalePixels(rgba, width, height, scale) }));
    const gif = engine.gif.framesGIF(frames, { fps: { numerator: 1000, denominator: duration }, background: STAGE });
    download(gif.data, `pixelbolt-${preset.id}.gif`, 'image/gif');
    setStatus(`Saved ${seconds(ring.length * duration)} of the ${preset.title.toLowerCase()} as a ${width * scale}×${height * scale} GIF (${formatSize(gif.data.length)}).`);
  } catch (error) { setStatus(`The GIF could not be made: ${error.message}`); }
});
$('copy-link').addEventListener('click', async () => {
  if (!run) return;
  const current = run, base = location.origin + location.pathname;
  const frames = current.replay ? Math.max(current.replay.frames, current.t) : Math.min(current.t, RECORD_FRAMES);
  const pokes = current.pokes.filter(poke => poke.f < frames);
  try {
    const fit = pokes.length ? await fitLink(base, { version: current.version, preset: current.preset.id, frames, pokes }) : { link: await toyLink(base, { version: current.version, preset: current.preset.id }), frames: 0, cut: false };
    if (current !== run) return;
    // The address names the link too, keeping any query (such as a local test engine) that the shared link leaves out.
    history.replaceState(null, '', location.search + fit.link.slice(fit.link.indexOf('#')));
    $('share-link').value = fit.link;
    const what = !pokes.length ? `It opens the ${current.preset.title.toLowerCase()}; poke it first and the link replays what you did.`
      : `It replays ${seconds(fit.frames * current.duration)} on the ${current.preset.title.toLowerCase()}${fit.cut ? ', as much as fits in a link' : current.t > RECORD_FRAMES && !current.replay ? ', the most a link records; press Start again for a new recording' : ''}.`;
    try { await navigator.clipboard.writeText(fit.link); $('share-link').hidden = true; setStatus(`Link copied. ${what}`); }
    catch { $('share-link').hidden = false; $('share-link').focus(); $('share-link').select(); setStatus(`The link is selected: press Ctrl+C or Command+C to copy it. ${what}`); }
  } catch (error) { setStatus(error.message); }
});

// A link pasted into this tab, or Back and Forward between links, opens that effect and replays what it carries.
async function openHash() {
  let shared = { preset: PRESETS[0].id };
  if (location.hash.length > 1) {
    try { shared = await readToyLink(location.hash); }
    catch (error) { await start(PRESETS[0].id); setStatus(`${error.message} Showing the campfire instead.`); return; }
  }
  await start(shared.preset, shared);
}
addEventListener('hashchange', openHash);
addEventListener('resize', layout);
document.addEventListener('visibilitychange', () => { last = 0; });
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) setRunning(false); });

// On a loopback page only, tests can step frames themselves: a hidden browser tab barely runs animation frames.
if (loopback) {
  globalThis.fluidToy = {
    advance(frames = 1, now = performance.now()) { for (let n = 0; n < frames && run && !loading; n++) tick(now); return run?.t; },
    get state() { return run && { preset: run.preset.id, version: run.version, t: run.t, pokes: run.pokes.length, replaying: Boolean(run.replay), frames: run.ring.length, width: run.width, height: run.height, kind: run.live.kind, loading: Boolean(loading) }; }
  };
}

controls();
if (!globalThis.CompressionStream || !globalThis.DecompressionStream) { note(''); setStatus('This page needs a current browser (one with CompressionStream).'); }
else { openHash(); requestAnimationFrame(loop); }
