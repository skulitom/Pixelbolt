import { loadAll, frameAt, animationDone } from './assets.js';
import { Renderer, VIEW_W, VIEW_H } from './render.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { World } from './world.js';
import { TILE, COLS, ROWS, at, isSand, isGrass } from './map.js';
import { neighbourMask } from './pixelforge/autotile.js';

const NAMES = ['water', 'shore', 'grass', 'dock', 'props', 'flora', 'rocks', 'lighthouse', 'cottage', 'lamp', 'boat', 'keeper', 'crab', 'jelly', 'gull', 'fisher', 'fx', 'slash', 'pickups', 'ui', 'dialog', 'font'];
const ATLAS_OF = { palm: 'flora', oak: 'flora', 'boulder-a': 'rocks', 'boulder-b': 'rocks', lighthouse: 'lighthouse', cottage: 'cottage', lamp: 'lamp', fisher: 'fisher', boat: 'boat' };
const PHASES = { day: [1, 1, 1], dusk: [1.0, 0.8, 0.64], night: [0.2, 0.25, 0.46] };
const canvas = document.getElementById('game'), stage = document.getElementById('stage');
const status = document.getElementById('status');

const [atlases, fontMap] = await Promise.all([loadAll(NAMES), fetch('./assets/font.map.json').then(r => r.json())]);
const renderer = new Renderer(canvas), ui = new UI(renderer.out, atlases, fontMap), input = new Input(document), sound = new Sound();
// The keeper atlas carries the pose anchors and marker points (blade tips, held item) the simulation needs.
let world = new World(atlases.keeper.meta), mode = 'title', paused = false, typed = 0, typeClock = 0, last = performance.now(), accumulator = 0;
let ambient = [1, 1, 1], cam = { x: 0, y: 0 }, endingShown = false, fps = { frames: 0, time: 0, value: 60 };
window.__tidewatch = { get world() { return world; }, get mode() { return mode; }, get renderer() { return renderer; }, get fps() { return fps.value; }, get cam() { return cam; }, get typed() { return typed; },
  start: () => { if (mode === 'title') mode = 'play'; },
  // Deterministic stepping for tests and headless panes where requestAnimationFrame is throttled.
  advance(ms) { let now = performance.now(); for (let t = 0; t < ms; t += 1000 / 60) { now += 1000 / 60; accumulator += 1000 / 60; fps.frames = 0; tick(1000 / 60, now); } } };

// Static terrain: Pixelbolt's blob masks are resolved once; each shore tile plays its own compiled surf cycle.
const masks = [];
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  masks.push({ sand: isSand(x, y) ? neighbourMask('blob', (dx, dy) => isSand(x + dx, y + dy)) : -1, grass: isGrass(x, y) ? neighbourMask('blob', (dx, dy) => isGrass(x + dx, y + dy)) : -1, variant: 'abc'[(x * 7 + y * 13 + ((x * y) % 5)) % 3] });
}
function drawTerrain(time) {
  const x0 = Math.max(0, Math.floor(cam.x / TILE)), y0 = Math.max(0, Math.floor(cam.y / TILE));
  const x1 = Math.min(COLS - 1, Math.floor((cam.x + VIEW_W) / TILE)), y1 = Math.min(ROWS - 1, Math.floor((cam.y + VIEW_H) / TILE));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const m = masks[y * COLS + x], c = at(x, y);
    if (m.sand !== 255 || c === 'D') renderer.draw(atlases.water, frameAt(atlases.water, `shimmer-${m.variant}`, time + (x % 2) * 130), x * TILE, y * TILE);
    if (m.sand >= 0) renderer.draw(atlases.shore, frameAt(atlases.shore, `surf-${m.sand}`, time), x * TILE, y * TILE);
    if (m.grass >= 0) renderer.draw(atlases.grass, `grass-${m.grass}`, x * TILE, y * TILE);
    if (c === 'D' || c === 'P') {
      const side = at(x - 1, y) === c ? 'r' : 'l', end = at(x, y + 1) !== 'D';
      renderer.draw(atlases.dock, c === 'P' ? `posts-${side}` : end ? `end-${side}` : `deck-${side}`, x * TILE, y * TILE);
    }
  }
}
// Sprites are drawn at their ground point; each atlas frame's anchor says which pixel stands there.
function place(atlasName, frame, x, y, opts) { renderer.draw(atlases[atlasName], frame, x, y, opts); }
function shadow(x, y, w) { for (const [dy, inset] of [[-1, 2], [0, 0], [1, 2]]) renderer.rect(x - w / 2 + inset, y + dy, w - inset * 2, 1, 'rgba(27,21,40,0.35)'); }
function propFrame(p, time) {
  switch (p.kind) {
    case 'lighthouse': return world.flags.lit ? frameAt(atlases.lighthouse, 'night', time) : 'unlit';
    case 'cottage': return world.phase === 'day' ? 'day' : 'night';
    case 'lamp': return world.phase === 'day' ? 'off' : frameAt(atlases.lamp, 'on', time + p.id * 97);
    case 'palm': return frameAt(atlases.flora, 'palm', time + p.id * 310);
    case 'oak': return 'oak-0';
    case 'bush': return p.cut ? 'bush-cut' : 'bush';
    case 'grass': return p.cut ? 'grass-cut' : frameAt(atlases.props, 'grass-sway', time + p.x * 7);
    case 'chest': return p.open ? 'chest-open' : 'chest';
    case 'fisher': return frameAt(atlases.fisher, 'idle', time);
    case 'boat': return frameAt(atlases.boat, 'bob', time);
    default: return p.kind;
  }
}
function playerFrame(p) {
  if (p.state === 'hold') return 'hold-up';
  if (p.state === 'hurt') return p.dir === 'r' || p.dir === 'l' ? `hurt-${p.dir}` : 'hurt-d';
  const anim = p.state === 'attack' ? `attack-${p.dir}` : p.state === 'walk' ? `walk-${p.dir}` : `idle-${p.dir}`;
  return frameAt(atlases.keeper, anim, p.t);
}
function drawWorld(time) {
  drawTerrain(time);
  for (const p of world.props) if (p.alive && p.flat) place('props', p.kind, p.x, p.y);
  const list = [];
  for (const p of world.props) if (p.alive && !p.flat) list.push({ y: p.y + (p.kind === 'boat' ? -40 : 0), draw: () => place(ATLAS_OF[p.kind] ?? 'props', propFrame(p, time), p.x, p.y) });
  for (const e of world.enemies) if (e.alive) list.push({ y: e.y, draw: () => {
    shadow(e.x, e.y, e.kind === 'crab' ? 14 : 10);
    const anim = e.state === 'snap' ? 'snap' : e.state === 'hurt' ? 'hurt' : e.state === 'hop' ? 'hop' : e.state === 'walk' ? 'walk' : 'idle';
    const atlas = atlases[e.kind], lift = e.kind === 'jelly' && e.state === 'hop' && e.t > 110 && e.t < 400 ? Math.round(Math.sin((e.t - 110) / 290 * Math.PI) * 6) : 0;
    place(e.kind, frameAt(atlas, anim, e.t), e.x, e.y - lift, { flip: e.kind === 'crab' && e.dir < 0 && e.state !== 'snap' });
  } });
  for (const k of world.pickups) list.push({ y: k.y, draw: () => { shadow(k.x, k.y, 8); place('pickups', frameAt(atlases.pickups, k.kind, k.t), k.x, k.y - Math.round(k.z)); } });
  const p = world.player;
  list.push({ y: p.y, draw: () => {
    shadow(p.x, p.y, 12);
    if (p.inv > 0 && p.state !== 'hurt' && Math.floor(p.inv / 70) % 2) return;
    place('keeper', playerFrame(p), p.x, p.y);
    if (p.state === 'hold' && p.held) { const pose = atlases.keeper.frames['hold-up'], item = pose.points.item; place('pickups', frameAt(atlases.pickups, p.held, p.t), p.x - pose.anchorPx.x + item.x, p.y - pose.anchorPx.y + item.y); }
  } });
  list.sort((a, b) => a.y - b.y).forEach(item => item.draw());
  for (const e of world.effects) place(e.atlas, frameAt(atlases[e.atlas], e.anim, e.t), e.x, e.y, { lightPasses: e.atlas !== 'slash' });
  world.effects = world.effects.filter(e => !animationDone(atlases[e.atlas], e.anim, e.t));
  for (const g of world.gulls) place('gull', frameAt(atlases.gull, Math.floor(g.t / 2400) % 3 === 2 ? 'glide' : 'flap', g.t), g.x, g.y, { flip: g.vx < 0 });
}
function lightsFor(time) {
  const lights = [], f = world.flags;
  for (const p of world.props) {
    if (p.kind === 'lamp' && world.phase !== 'day') lights.push({ x: p.x, y: p.y - 24, z: 14, radius: 60, color: [1, 0.72, 0.4], intensity: 1.35 + (frameAt(atlases.lamp, 'on', time + p.id * 97) === 'on-1' ? 0.15 : 0) });
    if (p.kind === 'cottage' && world.phase !== 'day') for (const dx of [-12, 13]) lights.push({ x: p.x + dx, y: p.y - 16, z: 10, radius: 42, color: [1, 0.75, 0.42], intensity: 1.1 });
    if (p.kind === 'lighthouse' && f.lit) lights.push({ x: p.x, y: p.y - 98, z: 40, radius: 124, color: [1, 0.92, 0.62], intensity: 1.2 });
    if (p.item === 'flint' && !p.cut && world.phase !== 'day') lights.push({ x: p.x, y: p.y - 4, z: 4, radius: 16, color: [1, 0.6, 0.3], intensity: 1.2 });
  }
  for (const k of world.pickups) if (k.kind === 'flint') lights.push({ x: k.x, y: k.y - 6, z: 6, radius: 24, color: [1, 0.6, 0.3], intensity: 1.3 });
  if (world.phase === 'night') {
    const p = world.player; lights.push({ x: p.x, y: p.y - 14, z: 12, radius: 50, color: [0.95, 0.78, 0.55], intensity: 0.9 });
    for (let i = 0; i < 8; i++) { const fx = (i * 97 % 22 + 6) * TILE + Math.sin(time / 900 + i) * 20, fy = (i * 53 % 10 + 13) * TILE + Math.cos(time / 1100 + i * 2) * 14; if (Math.sin(time / 400 + i * 1.7) > -0.2) lights.push({ x: fx, y: fy, z: 5, radius: 10, color: [0.75, 1, 0.45], intensity: 1.1 }); }
  }
  return lights;
}
function updateCamera(dt) {
  const p = world.player;
  let tx = p.x - VIEW_W / 2, ty = p.y - 12 - VIEW_H / 2;
  if (mode === 'title') { tx = 190 + Math.sin(world.time / 7000) * 170; ty = 300 + Math.cos(world.time / 9000) * 110; }
  if (world.flags.ending > 0 && world.flags.ending < 7000) { const lh = world.props.find(q => q.kind === 'lighthouse'); tx = lh.x - VIEW_W / 2; ty = lh.y - 140; }
  const k = mode === 'title' || world.flags.ending ? Math.min(1, dt / 600) : 1;
  cam.x += (Math.max(0, Math.min(COLS * TILE - VIEW_W, tx)) - cam.x) * k; cam.y += (Math.max(0, Math.min(ROWS * TILE - VIEW_H, ty)) - cam.y) * k;
  cam = { x: Math.round(cam.x), y: Math.round(cam.y) };
}
function drawTitle(time) {
  const g = renderer.out, word = 'TIDEWATCH', scale = 3;
  let w = ui.measure(word) * scale, x = Math.floor((VIEW_W - w) / 2);
  for (const [dx, dy, color] of [[2, 2, '#1b1528'], [0, 0, '#fcd04a']]) {
    let cx = x;
    for (const ch of word) { const name = fontMap[ch], f = atlases.font.lookup.get(name); g.drawImage(ui.tint(color), f.x, f.y, f.w, f.h, cx + dx, 34 + dy, f.w * scale, f.h * scale); cx += ui.widths.get(name) * scale; }
  }
  const sub = 'A Pixelbolt showcase'; ui.text(sub, Math.floor((VIEW_W - ui.measure(sub)) / 2), 66, '#d2d9e8');
  if (Math.floor(time / 500) % 2) { const t = 'Press Enter or tap to begin'; ui.text(t, Math.floor((VIEW_W - ui.measure(t)) / 2), 124, '#ffffff'); }
}
function drawEnding(time) {
  const e = world.flags.ending, g = renderer.out;
  const fade = e < 1200 ? e / 1200 : e < 2400 ? 1 - (e - 1200) / 1200 : 0;
  if (fade > 0) { g.fillStyle = `rgba(27,21,40,${fade.toFixed(3)})`; g.fillRect(0, 0, VIEW_W, VIEW_H); }
  if (e > 300 && e < 2200) { const t = 'You climb the long stair...'; ui.text(t, Math.floor((VIEW_W - ui.measure(t)) / 2), 76, '#d2d9e8'); }
  if (e >= 2600 && e < 7000) { const t = 'The lamp of Tidewatch burns again!'; ui.panel(24, 124, 192, 24); ui.text(t, Math.floor((VIEW_W - ui.measure(t)) / 2), 132, '#fcd04a'); }
  if (e >= 7000) {
    ui.panel(28, 22, 184, 116);
    const title = 'THE LIGHT IS LIT', t = world.stats.time;
    ui.text(title, Math.floor((VIEW_W - ui.measure(title)) / 2), 32, '#fcd04a');
    // Variable-width glyphs: labels and values are drawn in two columns instead of padding with spaces.
    [['Time', `${Math.floor(t / 60000)}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}`, '#ffffff'], ['Sea glass', world.stats.glass, '#97e3e3'], ['Defeated', world.stats.defeated, '#ff806a'], ['Grass cut', world.stats.cut, '#c4df6a'], ['Pots broken', world.stats.pots, '#f0b87c']]
      .forEach(([label, value, color], i) => { ui.text(label, 52, 52 + i * 10, color); ui.text(String(value), 188 - ui.measure(String(value)), 52 + i * 10, color); });
    for (const [i, line] of ['Press Enter to explore', 'the island by night'].entries()) ui.text(line, Math.floor((VIEW_W - ui.measure(line)) / 2), 112 + i * 10, '#d2d9e8');
  }
}
function handleEvents() {
  for (const ev of world.events) {
    if (ev.type === 'swing') sound.swing(); else if (ev.type === 'hit') sound.hit(); else if (ev.type === 'cut') sound.cut(); else if (ev.type === 'smash') sound.smash();
    else if (ev.type === 'glass') sound.pickup(); else if (ev.type === 'heart') sound.heart(); else if (ev.type === 'hurt') sound.hurt(); else if (ev.type === 'item') sound.fanfare();
    else if (ev.type === 'ignite') sound.ignite(); else if (ev.type === 'defeat') sound.smash();
  }
  world.events = [];
}
function step(dt) {
  if (mode === 'title') { world.time += dt; world.gulls.forEach(g => { g.t += dt; g.x += g.vx * dt / 1000; if (g.x > COLS * TILE + 30) g.x = -30; if (g.x < -30) g.x = COLS * TILE + 30; }); if (input.take('act') || input.take('attack')) { mode = 'play'; } return; }
  if (input.take('pause')) paused = !paused;
  if (paused) return;
  if (world.messages.length) {
    typeClock += dt; const target = world.messages[0].text.length;
    while (typeClock > 22 && typed < target) { typed++; typeClock -= 22; if (typed % 3 === 0) sound.blip(); }
    if (input.take('act') || input.take('attack')) { if (typed < target) typed = target; else { world.messages.shift(); typed = 0; typeClock = 0; } }
  }
  if (world.flags.ending >= 1200 && !world.flags.lit) { world.flags.lit = true; world.phase = 'night'; }
  if (world.flags.ending >= 7000 && !endingShown) endingShown = true;
  if (endingShown && world.flags.ending >= 7000 && (input.take('act') || input.take('attack'))) { world.flags.ending = 0; endingShown = false; }
  world.update(dt, input);
  handleEvents();
}
function frame(now) {
  const dt = Math.min(100, now - last); last = now; accumulator += dt;
  tick(dt, now);
  requestAnimationFrame(frame);
}
// One simulation + render pass. Also used by the deterministic test hook below.
function tick(dt, now) {
  fps.frames++; fps.time += dt; if (fps.time > 1000) { fps.value = Math.round(fps.frames * 1000 / fps.time); fps.frames = 0; fps.time = 0; }
  if (input.take('sound')) { const on = sound.toggle(); document.getElementById('sound').setAttribute('aria-pressed', String(on)); }
  if (input.take('fullscreen')) toggleFullscreen();
  while (accumulator >= 1000 / 60) { step(1000 / 60); accumulator -= 1000 / 60; }
  input.endFrame();
  updateCamera(dt);
  const target = mode === 'title' ? PHASES.dusk : PHASES[world.phase];
  ambient = ambient.map((v, i) => v + (target[i] - v) * Math.min(1, dt / 1400));
  const needsLight = ambient.some(v => v < 0.995) || world.phase !== 'day' || mode === 'title';
  const time = world.time;
  const lighthouse = world.props.find(q => q.kind === 'lighthouse');
  renderer.begin(cam, needsLight ? { ambient, bands: 4, lights: lightsFor(time), beam: world.flags.lit ? { x: lighthouse.x, y: lighthouse.y - 98, angle: time / 1400 % (Math.PI * 2) - Math.PI, width: 0.17, length: 300, intensity: 1.1, water: (x, y) => at(x >> 4, y >> 4) === '~' } : null } : null);
  drawWorld(time);
  renderer.finish();
  if (mode === 'title') drawTitle(now);
  else {
    ui.hud({ hp: world.player.hp, maxHp: world.player.maxHp, glass: world.stats.glass, items: world.flags });
    if (world.messages.length) ui.dialog(world.messages[0], typed, Math.floor(now / 300) % 2);
    if (world.flags.ending) drawEnding(now);
    if (paused) { ui.panel(80, 64, 80, 28); ui.text('Paused', 102, 74, '#fcd04a'); }
  }
}
function fit() {
  const scale = Math.max(1, Math.floor(Math.min(stage.clientWidth / VIEW_W, (innerHeight - 24) / VIEW_H)));
  canvas.style.width = `${VIEW_W * scale}px`; canvas.style.height = `${VIEW_H * scale}px`;
}
function toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.(); }
addEventListener('resize', fit); document.addEventListener('fullscreenchange', fit); fit();
document.getElementById('sound').addEventListener('click', e => { const on = sound.toggle(); e.currentTarget.setAttribute('aria-pressed', String(on)); canvas.focus(); });
document.getElementById('fullscreen').addEventListener('click', () => { toggleFullscreen(); canvas.focus(); });
canvas.addEventListener('pointerdown', () => { if (mode === 'title') mode = 'play'; canvas.focus(); });
status.textContent = ''; canvas.focus();
// Paint the first frame immediately; requestAnimationFrame may be throttled in background or hidden pages.
tick(0, performance.now());
requestAnimationFrame(frame);
