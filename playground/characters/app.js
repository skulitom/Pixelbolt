import { shareLink, embedRecipe } from '../share.js';
import { encodePNG } from '../png.js';
import { engineBase, engineOverride, formatSize } from '../lib.js';
import {
  CHARACTERS, CHARACTER_TOY_VERSION, SPEEDS, BACKGROUNDS,
  characterById, recolorSource, groupAnimations, pickAnimation, fourWayAnimations,
  characterLink, readCharacterLink, fitZoom, gifScale, safeName, normalizeHex
} from './lib.js';

const $ = id => document.getElementById(id);
const canvas = $('character'), context = canvas.getContext('2d'), stage = $('stage');
const bundled = document.documentElement.dataset.bundled === 'true';
const override = bundled ? { base: null, notice: '' } : engineOverride(location.href);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ARROWS = { ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'right', ArrowLeft: 'left' };

let state = null, generation = 0, loading = null;
let playing = !reducedMotion.matches, framePos = 0, lastTick = 0, elapsed = 0;
let speed = 1, fourWayGrid = false, currentBg = BACKGROUNDS[0].id;
const engines = new Map(), sources = new Map();

const setStatus = message => { $('status').textContent = message; };
const note = text => { $('stage-note').textContent = text; $('stage-note').hidden = !text; };

function downloadFile(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function engineFor(version) {
  const base = bundled ? new URL('./engine/', location.href).href : engineBase(version, override.base);
  if (!engines.has(base)) {
    engines.set(base, Promise.all(['core', 'authoring', 'gif', 'godot'].map(name => import(new URL(`${name}.js`, base))))
      .then(([core, authoring, gif, godot]) => ({ base, core, authoring, gif, godot }))
      .catch(() => {
        engines.delete(base);
        throw new Error(bundled ? 'The bundled character engine could not be loaded.'
          : override.base ? 'The local test engine could not be loaded.'
          : `Pixelbolt ${version} could not be loaded from jsDelivr. Check your connection and try again.`);
      }));
  }
  return engines.get(base);
}

async function sourceFor(base, file) {
  const primary = bundled ? new URL(`./presets/${file}`, location.href).href : new URL(`../examples/${file}`, base).href;
  if (!sources.has(primary)) {
    const load = async url => {
      const response = await fetch(url, { credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    sources.set(primary, load(primary).catch(async error => {
      if (!bundled) {
        // Fall back to sibling examples or bundled presets when testing newly added kits before CDN publish.
        for (const fallback of [new URL(`../../examples/${file}`, location.href).href, new URL(`./presets/${file}`, location.href).href]) {
          try { return await load(fallback); } catch { /* try next */ }
        }
      }
      sources.delete(primary);
      throw new Error(`Could not load ${file} (${error.message}).`);
    }));
  }
  return structuredClone(await sources.get(primary));
}

function activeAnimation() {
  if (!state) return null;
  return state.project.animations[state.animation] ?? Object.values(state.project.animations)[0] ?? null;
}

function recompile() {
  if (!state) return;
  const source = recolorSource(state.baseSource, state.palette);
  const compiled = state.engine.authoring.compilePoses(source);
  const project = state.engine.core.renderProject(compiled.recipe);
  state.source = source;
  state.recipe = compiled.recipe;
  state.project = project;
  state.grouped = groupAnimations(Object.keys(project.animations));
  if (!project.animations[state.animation]) {
    state.animation = pickAnimation(Object.keys(project.animations), 'down', 'walk');
  }
  if (!state.grouped.availableDirections.length) fourWayGrid = false;
  framePos = 0; elapsed = 0;
  updateCanvasSize();
  renderCurrentFrame();
  updateControls();
  if (!bundled) {
    const mine = generation;
    shareLink(source, state.version, { base: new URL('../', location.href).href })
      .then(link => { if (mine === generation) $('remix').href = link; }, () => {});
  }
}

function updateCanvasSize() {
  if (!state) return;
  const { width, height } = state.project;
  const w = fourWayGrid ? width * 2 + 4 : width;
  const h = fourWayGrid ? height * 2 + 4 : height;
  canvas.width = w; canvas.height = h;
  const box = stage.getBoundingClientRect();
  const { cssWidth, cssHeight } = fitZoom(Math.max(1, box.width - 32), Math.max(1, box.height - 32), w, h, devicePixelRatio || 1);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
}

function renderCurrentFrame() {
  if (!state) return;
  const { project } = state;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (fourWayGrid) {
    const quad = fourWayAnimations(Object.keys(project.animations), state.animation.startsWith('stand') ? 'stand' : 'walk');
    if (quad) {
      const positions = [[0, 0], [project.width + 4, 0], [0, project.height + 4], [project.width + 4, project.height + 4]];
      for (let i = 0; i < 4; i++) {
        const anim = project.animations[quad[i].animation];
        const fi = anim.frames[framePos % anim.frames.length];
        const frame = project.frames[fi];
        context.putImageData(new ImageData(frame.data, project.width, project.height), positions[i][0], positions[i][1]);
      }
      const lead = project.animations[quad[0].animation];
      $('frame-counter').textContent = `4-Way · ${(framePos % lead.frames.length) + 1} / ${lead.frames.length}`;
      return;
    }
  }
  const anim = activeAnimation();
  if (!anim) return;
  const fi = anim.frames[framePos % anim.frames.length];
  const frame = project.frames[fi];
  context.putImageData(new ImageData(frame.data, project.width, project.height), 0, 0);
  $('frame-counter').textContent = `${(framePos % anim.frames.length) + 1} / ${anim.frames.length}`;
}

function buildThemes() {
  const container = $('themes');
  container.replaceChildren();
  if (!state) return;
  for (const theme of state.character.themes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = theme.title;
    btn.setAttribute('aria-pressed', String(state.theme === theme.id));
    btn.addEventListener('click', () => {
      state.theme = theme.id;
      state.palette = { ...state.baseSource.palette, ...theme.palette };
      buildSwatches();
      recompile();
      setStatus(`Applied ${theme.title} palette.`);
    });
    container.append(btn);
  }
}

function buildSwatches() {
  const container = $('swatches');
  container.replaceChildren();
  if (!state) return;
  const labels = state.character.labels ?? {};
  for (const [key, value] of Object.entries(state.palette)) {
    const hex = normalizeHex(value) ?? '#000000';
    const label = document.createElement('label');
    label.className = 'swatch';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = hex.slice(0, 7);
    input.setAttribute('aria-label', `${labels[key] ?? key} color`);
    input.addEventListener('input', () => {
      state.theme = '';
      state.palette[key] = input.value;
      recompile();
    });
    const text = document.createElement('span');
    text.className = 'swatch-name';
    text.textContent = labels[key] ?? key;
    label.append(input, text);
    container.append(label);
  }
}

function updateControls() {
  const ready = Boolean(state) && !loading;
  for (const id of ['pause', 'step-back', 'step-forward', 'animation', 'speed', 'reset-colors', 'export-gif', 'export-sheet', 'export-atlas', 'export-godot', 'export-recipe', 'copy-link']) {
    $(id).disabled = !ready;
  }
  $('pause').textContent = playing ? 'Pause' : 'Play';
  $('pause').setAttribute('aria-pressed', String(!playing));
  for (const button of $('presets').children) {
    button.setAttribute('aria-pressed', String(button.value === (loading?.id ?? state?.character.id)));
  }
  const has4Way = Boolean(ready && state.grouped.availableDirections.length === 4);
  for (const dir of ['down', 'up', 'right', 'left']) {
    const btn = $(`dir-${dir}`);
    btn.disabled = !has4Way;
    btn.setAttribute('aria-pressed', String(has4Way && !fourWayGrid && state.animation.endsWith(`-${dir}`)));
  }
  $('dir-all').disabled = !has4Way;
  $('dir-all').setAttribute('aria-pressed', String(has4Way && fourWayGrid));

  if (ready) {
    const select = $('animation');
    const names = Object.keys(state.project.animations);
    if (select.options.length !== names.length || [...select.options].some((o, i) => o.value !== names[i])) {
      select.replaceChildren(...names.map(name => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        return opt;
      }));
    }
    select.value = state.animation;
    for (const btn of $('themes').children) {
      btn.setAttribute('aria-pressed', String(btn.textContent === state.character.themes.find(t => t.id === state.theme)?.title));
    }
  }
  document.body.dataset.state = loading ? 'loading' : state ? 'ready' : 'error';
}

async function loadCharacter(id, { version = CHARACTER_TOY_VERSION, animation = '', palette = {}, speed: initialSpeed } = {}) {
  const character = characterById(id) ?? CHARACTERS[0];
  const mine = ++generation;
  loading = character;
  fourWayGrid = false;
  updateControls();
  note(`Loading ${character.title}…`);
  try {
    const engine = await engineFor(version);
    const baseSource = await sourceFor(engine.base, character.file);
    if (mine !== generation) return;
    if (initialSpeed && SPEEDS.includes(initialSpeed)) {
      speed = initialSpeed;
      $('speed').value = String(speed);
    }
    const mergedPalette = { ...baseSource.palette };
    for (const [k, v] of Object.entries(palette)) {
      const hex = normalizeHex(v);
      if (hex && Object.hasOwn(mergedPalette, k)) mergedPalette[k] = hex;
    }
    const hasCustom = Object.keys(mergedPalette).some(k => normalizeHex(mergedPalette[k]) !== normalizeHex(baseSource.palette[k]));
    state = {
      character, version, engine, baseSource, source: baseSource, recipe: null, project: null,
      grouped: null, animation, palette: mergedPalette, theme: hasCustom ? '' : character.themes[0].id
    };
    loading = null;
    $('hint').textContent = character.hint;
    $('cli').textContent = `pixelbolt compile ${character.file} --out ${character.id}.json`;
    $('active-engine').textContent = bundled ? '· offline bundle' : `· engine ${version}${override.base ? ' (local test override)' : ''}`;
    buildThemes();
    buildSwatches();
    recompile();
    note('');
    setStatus('');
  } catch (error) {
    if (mine !== generation) return;
    loading = null; note(''); setStatus(error.message);
  } finally {
    if (mine === generation) updateControls();
  }
}

function tick(now) {
  requestAnimationFrame(tick);
  if (!state || !playing || document.hidden) { lastTick = now; return; }
  const dt = Math.min(200, Math.max(0, now - lastTick));
  lastTick = now;
  const anim = activeAnimation();
  if (!anim || anim.frames.length <= 1) return;
  elapsed += dt * speed;
  const currentFrame = state.project.frames[anim.frames[framePos % anim.frames.length]];
  const duration = Math.max(20, currentFrame.duration ?? 110);
  if (elapsed >= duration) {
    elapsed -= duration;
    framePos = (framePos + 1) % anim.frames.length;
    renderCurrentFrame();
  }
}

function step(delta) {
  const anim = activeAnimation();
  if (!anim) return;
  playing = false;
  framePos = (framePos + delta + anim.frames.length) % anim.frames.length;
  renderCurrentFrame();
  updateControls();
}

function selectDirection(dir) {
  if (!state || state.grouped.availableDirections.length < 4) return;
  fourWayGrid = false;
  const currentAction = state.animation.startsWith('stand-') ? 'stand' : 'walk';
  state.animation = pickAnimation(Object.keys(state.project.animations), dir, currentAction);
  framePos = 0; elapsed = 0;
  updateCanvasSize();
  renderCurrentFrame();
  updateControls();
}

// Wire static controls once on startup.
for (const item of CHARACTERS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.value = item.id;
  btn.textContent = item.title;
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => loadCharacter(item.id, { version: state?.version ?? CHARACTER_TOY_VERSION }));
  $('presets').append(btn);
}

for (const bg of BACKGROUNDS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.value = bg.id;
  btn.textContent = bg.title;
  btn.setAttribute('aria-pressed', String(bg.id === currentBg));
  btn.addEventListener('click', () => {
    currentBg = bg.id;
    stage.dataset.bg = bg.id;
    for (const child of $('backgrounds').children) child.setAttribute('aria-pressed', String(child.value === bg.id));
  });
  $('backgrounds').append(btn);
}

for (const factor of SPEEDS) {
  const opt = document.createElement('option');
  opt.value = String(factor);
  opt.textContent = `${factor}×`;
  $('speed').append(opt);
}
$('speed').value = '1';

if (bundled) {
  $('remix').hidden = true;
  $('about-links').hidden = true;
}

$('pause').addEventListener('click', () => { playing = !playing; lastTick = performance.now(); updateControls(); });
$('step-back').addEventListener('click', () => step(-1));
$('step-forward').addEventListener('click', () => step(1));
$('animation').addEventListener('change', event => {
  if (!state) return;
  fourWayGrid = false;
  state.animation = event.target.value;
  framePos = 0; elapsed = 0;
  updateCanvasSize();
  renderCurrentFrame();
  updateControls();
});
$('speed').addEventListener('change', event => { speed = Number(event.target.value) || 1; });

for (const dir of ['down', 'up', 'right', 'left']) {
  $(`dir-${dir}`).addEventListener('click', () => selectDirection(dir));
}
$('dir-all').addEventListener('click', () => {
  if (!state || state.grouped.availableDirections.length < 4) return;
  fourWayGrid = !fourWayGrid;
  updateCanvasSize();
  renderCurrentFrame();
  updateControls();
});

$('reset-colors').addEventListener('click', () => {
  if (!state) return;
  state.theme = state.character.themes[0].id;
  state.palette = { ...state.baseSource.palette };
  buildSwatches();
  recompile();
  setStatus('Restored original character colors.');
});

canvas.addEventListener('keydown', event => {
  if (event.key === ' ') {
    event.preventDefault();
    playing = !playing;
    lastTick = performance.now();
    updateControls();
  } else if (ARROWS[event.key]) {
    event.preventDefault();
    selectDirection(ARROWS[event.key]);
  }
});

// Exports: GIF, Sprite Sheet PNG (with embedded editable recipe), Atlas JSON, Godot 4 .tres, Editable .poses.json, Share Link.
$('export-gif').addEventListener('click', () => {
  if (!state) return;
  try {
    const scale = gifScale(state.project.width, state.project.height);
    const gif = state.engine.gif.animationGIF(state.project, state.animation, { scale });
    const name = `${safeName(state.character.id)}-${safeName(state.animation)}.gif`;
    downloadFile(name, gif.data, 'image/gif');
    setStatus(`Saved ${name} (${formatSize(gif.data.length)}, ${scale}×).`);
  } catch (error) { setStatus(error.message); }
});

$('export-sheet').addEventListener('click', async () => {
  if (!state) return;
  try {
    const atlas = state.engine.core.buildAtlas(state.project);
    let png = await encodePNG(atlas.data, atlas.width, atlas.height);
    try { png = await embedRecipe(png, state.source, state.version); } catch { /* keep plain png if huge */ }
    const name = `${safeName(state.character.id)}-sheet.png`;
    downloadFile(name, png, 'image/png');
    setStatus(`Saved ${name} (${atlas.width}×${atlas.height}, ${formatSize(png.length)}) with editable recipe embedded.`);
  } catch (error) { setStatus(error.message); }
});

$('export-atlas').addEventListener('click', () => {
  if (!state) return;
  const atlas = state.engine.core.buildAtlas(state.project);
  const text = JSON.stringify(atlas.metadata, null, 2) + '\n';
  const name = `${safeName(state.character.id)}.atlas.json`;
  downloadFile(name, text, 'application/json');
  setStatus(`Saved ${name} (${formatSize(text.length)}).`);
});

$('export-godot').addEventListener('click', () => {
  if (!state) return;
  const atlas = state.engine.core.buildAtlas(state.project);
  const sheetName = `${safeName(state.character.id)}-sheet.png`;
  const { text } = state.engine.godot.spriteFrames(atlas.metadata, sheetName);
  const name = `${safeName(state.character.id)}.tres`;
  downloadFile(name, text, 'text/plain');
  setStatus(`Saved Godot 4 SpriteFrames ${name} (pair with ${sheetName}).`);
});

$('export-recipe').addEventListener('click', () => {
  if (!state) return;
  const text = JSON.stringify(state.source, null, 2) + '\n';
  const name = `${safeName(state.character.id)}.poses.json`;
  downloadFile(name, text, 'application/json');
  setStatus(`Saved editable ${name} (${formatSize(text.length)}).`);
});

$('copy-link').addEventListener('click', async () => {
  if (!state) return;
  try {
    const base = `${location.origin}${location.pathname}`;
    const link = characterLink(base, {
      version: state.version,
      character: state.character.id,
      animation: state.animation,
      speed,
      palette: state.palette,
      basePalette: state.baseSource.palette
    });
    const box = $('share-link');
    box.value = link; box.hidden = false;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
      setStatus('Copied share link with your character and custom colors.');
    } else {
      box.focus(); box.select();
      setStatus('Share link ready below.');
    }
  } catch (error) { setStatus(error.message); }
});

addEventListener('resize', updateCanvasSize);
requestAnimationFrame(tick);

// Boot from URL hash if present, else start on Four-way Knight.
try {
  const initial = location.hash ? readCharacterLink(location.hash) : { version: CHARACTER_TOY_VERSION, character: CHARACTERS[0].id };
  loadCharacter(initial.character, initial);
} catch (error) {
  setStatus(error.message);
  loadCharacter(CHARACTERS[0].id);
}

