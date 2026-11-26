// Gas (stable fluids + carriers), liquid (FLIP/APIC + cohesion/adhesion + air pockets) and spark/bubble/whitewater
// solvers for pixelforge-fluid. Browser-compatible and deterministic.
import { fail } from './core.js';
import { pick, pickWhole } from './authoring.js';
import { random, sinDeg, cosDeg } from './craft.js';
import { createElectric, stepElectric, electricFields } from './electric.js';
import {
  STRAND, LIMITS, MAX_SPEED, PER_CELL, LEVEL, SALT, WHITEWATER, STIFFNESS, EDGE,
  bilinear, createGrid, gridFor, TL, TR, BL, BR, CLEARANCE, outlineAt, slideSmooth, sampleU, sampleV,
  enforce, project, advectVelocity, advectScalars, slope, sharpenVelocity,
  viscous, strainForce, strainRates, GRAIN_SLEEP, grainRests, grainFriction, grainPieces,
  confine, crossesSolid, extrapolate, SURFACE_HEAT, energyOf, surfaceTemperatures, warmAir
} from './fluid-grid.js';
import { placementsAt, solidLayer, valueNoise, emitterState, coverage, reach, profile, push, spread } from './fluid-source.js';
import { bodyWater, bodyWalls, NEAR_BODY_FLIP } from './fluid-bodies.js';

export const pushesWater = (effect, s) => s.rise !== null && (s.lift > 0 || !!effect.air);
export const crowded = path => fail(path, `more than ${LIMITS.particles} liquid particles; lower the emitters' density or rate, or the fill`);

export function emitGas(g, state, e, index, cycle, seed, along = cycle, share = 1, factor = 1) {
  const { W, H, u, v, pixels: solid } = g, { d, T, source } = state, here = emitterState(e, index, cycle, seed, along, factor), { x, y, flicker } = here, r = reach(e);
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r)), y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
  if (x0 > x1 || y0 > y1) return here;
  // A burst adds its amounts once; a rate emitter raises its cells toward them every frame (a negative amount drains),
  // so a steady source holds its level instead of piling up.
  if (e.carry) return throwCarriers(g, state, e, index, cycle, seed, here);
  const feed = (a, c, amount, w, strength) => {
    if (e.burst) a[c] += amount * w * strength;
    else if (amount >= 0) { const target = amount * strength; if (a[c] < target) a[c] += (target - a[c]) * w; }
    else a[c] *= 1 - w * Math.min(1, -amount * strength);
    if (a[c] < 0) a[c] = 0;
  };
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const c = j * W + i, w = coverage(e, i + 0.5 - x, j + 0.5 - y);
    if (!w || solid[c]) continue;
    const strength = flicker(i + 0.5, j + 0.5), amounts = strength * profile(e, i + 0.5 - x, j + 0.5 - y);
    if (e.density) feed(d, c, e.density, w, amounts);
    if (e.temperature) feed(T, c, e.temperature, w, amounts);
    if (e.expand) source[c] += spread(e) * w * strength * share;
  }
  const moving = e.steer;
  const drive = (a, k, px, py, axis) => {
    const w = coverage(e, px - x, py - y), strength = flicker(px, py);
    if (!w) return;
    if (moving) { const target = push(e, px - x, py - y, axis, 0); a[k] += e.burst ? target * w * strength : (target - a[k]) * Math.min(1, w * strength); }
    if (e.noise) a[k] += e.noise * w * strength * (2 * valueNoise(seed, index, cycle, axis ? SALT.noiseY : SALT.noiseX, px, py) - 1);
  };
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1 + 1; i++) if (!g.uFixed[j * (W + 1) + i]) drive(u, j * (W + 1) + i, i, j + 0.5, 0);
  for (let j = y0; j <= y1 + 1; j++) for (let i = x0; i <= x1; i++) if (!g.vFixed[j * W + i]) drive(v, j * W + i, i + 0.5, j, 1);
  return here;
}

// Dust and thrown smoke: an emitter with `carry` puts its smoke and heat on carriers, one per covered cell (each frame,
// for a rate emitter), launched with the emitter's push (velocity, vortex, expand outward and noise). A puff of gas can't
// be thrown through still air (the air must get out of its way, so the pressure solve halves its speed at once and the
// rest blurs away within a few pixels), but dust is grains, and grains keep their momentum. Each carrier loses about
// `drag` of the difference between its velocity and the air's each frame, falls by its `gravity`, hands `release` of
// what it still carries to the air each frame, and drops the rest where it meets an obstacle. What it carries is drawn
// with the smoke, so the cloud travels with the carriers and the air keeps what they leave behind.
function throwCarriers(g, state, e, index, cycle, seed, here) {
  const { W, H, pixels: solid } = g, { x, y, flicker } = here, r = reach(e), list = state.carriers;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r)), y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const c = j * W + i, px = i + 0.5, py = j + 0.5, w = coverage(e, px - x, py - y);
    if (!w || solid[c]) continue;
    const amount = flicker(px, py) * profile(e, px - x, py - y) * w, d = e.density * amount, t = e.temperature * amount;
    if (!(d > 0) && !(t > 0)) continue;
    if (list.length >= LIMITS.carriers) { state.overflow = true; return here; }
    let vx = push(e, px - x, py - y, 0, e.expand), vy = push(e, px - x, py - y, 1, e.expand);
    if (e.noise) { vx += e.noise * (2 * valueNoise(seed, index, cycle, SALT.noiseX, px, py) - 1); vy += e.noise * (2 * valueNoise(seed, index, cycle, SALT.noiseY, px, py) - 1); }
    list.push({ x: px, y: py, vx, vy, d: d > 0 ? d : 0, T: t > 0 ? t : 0, carry: e.carry });
  }
  return here;
}
// Adds `value` to the cell centres around (x, y) with bilinear weights over the open ones, so nothing is lost where
// some of them are obstacles' pixels (or beyond the canvas).
export function deposit(a, solid, W, H, x, y, value) {
  const fx = x - 0.5, fy = y - 0.5, i = Math.floor(fx), j = Math.floor(fy), s = fx - i, t = fy - j;
  const open = (ci, cj) => ci >= 0 && cj >= 0 && ci < W && cj < H && !solid[cj * W + ci];
  const w00 = open(i, j) ? (1 - s) * (1 - t) : 0, w10 = open(i + 1, j) ? s * (1 - t) : 0, w01 = open(i, j + 1) ? (1 - s) * t : 0, w11 = open(i + 1, j + 1) ? s * t : 0, sum = w00 + w10 + w01 + w11;
  if (!(sum > 0)) return;
  if (w00) a[j * W + i] += w00 / sum * value;
  if (w10) a[j * W + i + 1] += w10 / sum * value;
  if (w01) a[(j + 1) * W + i] += w01 / sum * value;
  if (w11) a[(j + 1) * W + i + 1] += w11 / sum * value;
}
// Moves carrier `p` along its path toward (x1, y1) as far as the open cells go: to just short of the first cell that
// is an obstacle or beyond the canvas (a closed edge), inside the last open cell, walking cell by cell as crossesSolid
// does. So a fast carrier drops its smoke against the wall it hits, not a whole step short of it.
function stopShort(solid, W, H, p, x1, y1) {
  const x0 = p.x, y0 = p.y, dx = x1 - x0, dy = y1 - y0, si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  let i = Math.floor(x0), j = Math.floor(y0), li = i, lj = j, t = 1;
  let tx = si ? ((si > 0 ? i + 1 : i) - x0) / dx : 2, ty = sj ? ((sj > 0 ? j + 1 : j) - y0) / dy : 2;
  const stepX = si ? si / dx : 0, stepY = sj ? sj / dy : 0;
  for (let n = Math.abs(Math.floor(x1) - i) + Math.abs(Math.floor(y1) - j); n > 0; n--) {
    let enter;
    if (tx < ty) { enter = tx; i += si; tx += stepX; } else { enter = ty; j += sj; ty += stepY; }
    if (i < 0 || j < 0 || i >= W || j >= H || solid[j * W + i]) { t = enter; break; }
    li = i; lj = j;
  }
  const x = x0 + dx * t, y = y0 + dy * t;
  p.x = x < li + 0.01 ? li + 0.01 : x > li + 0.99 ? li + 0.99 : x;
  p.y = y < lj + 0.01 ? lj + 0.01 : y > lj + 0.99 ? lj + 0.99 : y;
}
function moveCarriers(state, dt) {
  const { g, d, T, carriers: list } = state, { W, H, u, v, pixels: solid } = g;
  let kept = 0;
  for (let k = 0; k < list.length; k++) {
    const p = list[k], { drag, release, gravity } = p.carry;
    p.vx += (sampleU(g, u, p.x, p.y) - p.vx) * drag * dt + gravity[0] * dt;
    p.vy += (sampleV(g, v, p.x, p.y) - p.vy) * drag * dt + gravity[1] * dt;
    if (p.vx > MAX_SPEED) p.vx = MAX_SPEED; else if (p.vx < -MAX_SPEED) p.vx = -MAX_SPEED;
    if (p.vy > MAX_SPEED) p.vy = MAX_SPEED; else if (p.vy < -MAX_SPEED) p.vy = -MAX_SPEED;
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, { walls } = g;
    // Carriers that leave through an open edge take their smoke with them; one that meets an obstacle or a closed edge
    // drops it all there.
    const closed = (nx < 0 && walls.left) || (nx >= W && walls.right) || (ny < 0 && walls.top) || (ny >= H && walls.bottom);
    if (!closed && (nx < 0 || ny < 0 || nx >= W || ny >= H)) continue;
    const hit = closed || crossesSolid(solid, W, H, p.x, p.y, nx, ny) || solid[Math.floor(ny) * W + Math.floor(nx)];
    if (!hit) { p.x = nx; p.y = ny; } else stopShort(solid, W, H, p, nx, ny);
    const part = hit ? 1 : release * dt, dd = p.d * part, tt = p.T * part;
    if (dd) deposit(d, solid, W, H, p.x, p.y, dd);
    if (tt) deposit(T, solid, W, H, p.x, p.y, tt);
    p.d -= dd; p.T -= tt;
    if (hit || (p.d < 0.002 && p.T < 0.002)) continue;
    list[kept++] = p;
  }
  list.length = kept;
}

// ---- Gas --------------------------------------------------------------------------------------------------------------
export function createGas(effect, width, height) {
  const g = gridFor(effect, width, height), N = g.N;
  const state = { g, solids: solidLayer(effect, effect.layout, placementsAt(effect.obstacles, 0), width, height), d: new Float64Array(N), T: new Float64Array(N), source: new Float64Array(N), d1: new Float64Array(N), T1: new Float64Array(N), curl: new Float64Array(N), magnitude: new Float64Array(N), open: new Uint8Array(N) };
  if (effect.emitters.some(e => e.carry)) { state.carriers = []; state.carriedD = new Float64Array(N); state.carriedT = new Float64Array(N); }
  for (let c = 0; c < N; c++) state.open[c] = g.solid[c] ? 0 : 1;
  if (effect.electric) state.electric = createElectric(effect, width, height);
  return state;
}
// One step of a gas: a gas effect over its open cells, or, with `over` (see stepVapour), the vapour over a liquid's air
// cells, which brings its own forces, sources and carrying of the vapour; the rest is the same.
export function stepGas(state, effect, dt, over = null) {
  const { g, d, T, d1, T1 } = state, { W, H, u, v } = g;
  if (state.electric) stepElectric(state.electric, state, effect, dt);
  if (over) over.forces();
  else {
    // Buoyancy lifts hot cells (y is down) and density weighs smoke down; wind pushes everything.
    if (effect.buoyancy || effect.weight || effect.wind[1]) for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, a = (j - 1) * W + i, b = j * W + i;
      v[k] += dt * (-effect.buoyancy * (T[a] + T[b]) * 0.5 + effect.weight * (d[a] + d[b]) * 0.5 + effect.wind[1]);
    }
    if (effect.wind[0]) for (let k = 0; k < u.length; k++) u[k] += dt * effect.wind[0];
  }
  if (effect.vorticity) confine(g, effect.vorticity, dt, state.curl, state.magnitude);
  enforce(g);
  advectVelocity(g, dt);
  if (effect.sharp) sharpenVelocity(g, dt);
  if (effect.drag) { const keep = 1 - effect.drag * dt; for (let k = 0; k < u.length; k++) u[k] *= keep; for (let k = 0; k < v.length; k++) v[k] *= keep; }
  enforce(g);
  if (effect.viscosity) viscous(g, state.open, effect, dt);
  project(g, state.open, effect.iterations, over ? over.sources() : state.source);
  for (const a of [u, v]) for (let k = 0; k < a.length; k++) { if (a[k] > MAX_SPEED) a[k] = MAX_SPEED; else if (a[k] < -MAX_SPEED) a[k] = -MAX_SPEED; }
  if (over) { over.carry(); return; }
  advectScalars(g, dt, [[d, d1], [T, T1]], effect.sharp);
  const fade = 1 - effect.dissipation * dt, cool = 1 - effect.cooling * dt;
  for (let c = 0; c < g.N; c++) { d[c] = d1[c] * fade; T[c] = T1[c] * cool; }
  // Hot and cold obstacles warm or chill the air touching them.
  if (effect.warm) warmAir(T, state.open, surfaceTemperatures(state.solids, state.hot ??= new Float64Array(g.N)), W, H, SURFACE_HEAT * dt);
  if (state.carriers) moveCarriers(state, dt);
}
export function gasFields(state, out) {
  const { g, d, T } = state, { W, H, u, v } = g, [density, temperature, speed] = out;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i, x = (u[j * (W + 1) + i] + u[j * (W + 1) + i + 1]) * 0.5, y = (v[j * W + i] + v[(j + 1) * W + i]) * 0.5;
    density[c] = d[c]; temperature[c] = T[c]; speed[c] = Math.sqrt(x * x + y * y);
  }
  // What carriers still hold shows with the smoke.
  if (state.carriers) {
    const { carriedD, carriedT, carriers: list } = state, solid = g.pixels;
    carriedD.fill(0); carriedT.fill(0);
    for (const p of list) { if (p.d) deposit(carriedD, solid, W, H, p.x, p.y, p.d); if (p.T) deposit(carriedT, solid, W, H, p.x, p.y, p.T); }
    for (let c = 0; c < g.N; c++) { density[c] += carriedD[c]; temperature[c] += carriedT[c]; }
  }
  if (state.electric) electricFields(state.electric, state, out[4], out[5]);
}

// ---- Liquid -----------------------------------------------------------------------------------------------------------
export function createLiquid(effect, width, height) {
  // With heat, ice joins the obstacles in the solver's solid cells, so the grid keeps a mask of its own (beside smooth
  // obstacles, the mask its geometry is traced from: see heatMasks).
  const g = effect.heat && !effect.smooth ? createGrid(width, height, Uint8Array.from(effect.solid), effect.walls) : gridFor(effect, width, height), N = g.N, U = g.u.length, V = g.v.length, solids = solidLayer(effect, effect.layout, placementsAt(effect.obstacles, 0), width, height);
  g.release = true;
  const state = {
    g, solids, n: 0, next: 0, keys: effect.heat ? PHASE_KEYS : PARTICLE_KEYS, ...(effect.heat && { energy: new Float64Array(1024), frozen: new Float64Array(1024), fall: new Float64Array(1024) }),
    x: new Float64Array(1024), y: new Float64Array(1024), vx: new Float64Array(1024), vy: new Float64Array(1024), id: new Float64Array(1024),
    pvx: new Float64Array(1024), pvy: new Float64Array(1024),
    uw: new Float64Array(U), vw: new Float64Array(V), uOld: new Float64Array(U), vOld: new Float64Array(V), uValid: new Uint8Array(U), vValid: new Uint8Array(V),
    fluid: new Uint8Array(N), cells: new Uint16Array(N), target: new Float64Array(N), splat: new Float64Array(N), blur: new Float64Array(N), speedSum: new Float64Array(N),
    pullU: effect.tension ? new Float64Array(U) : null, pullV: effect.tension ? new Float64Array(V) : null,
    cux: new Float64Array(1024), cuy: new Float64Array(1024), cvx: new Float64Array(1024), cvy: new Float64Array(1024), ea: new Float64Array(1024), eb: new Float64Array(1024), apic: effect.apic,
    cling: effect.most.adhesion ? clingField(solids) : null, grip: effect.most.adhesion ? gripFields(solids, effect.obstacles) : null, carry: null,
    strands: effect.look.some(layer => layer.field === STRAND),
    pressure: effect.most.viscosity || effect.most.yield || effect.granular ? new Float64Array(N) : null,
    grains: effect.granular ? { flowU: new Float64Array(U), flowV: new Float64Array(V), ra: new Float64Array(N), rb: new Float64Array(N), spin: new Float64Array(N), eta: new Float64Array(N), rigid: new Uint8Array(N), piece: new Int32Array(N), stack: new Int32Array(N), preU: new Float64Array(U), preV: new Float64Array(V), impact: new Float64Array(N), inner: new Uint8Array(N), flowPressure: new Float64Array(N), spread: new Float64Array(N), none: new Float64Array(N) } : null,
    air: effect.air ? { label: new Int32Array(N).fill(-1), before: new Int32Array(N).fill(-1), stack: new Int32Array(N), pressure: new Float64Array(N), regions: [], release: [], made: [] } : null,
    strain: effect.most.yield ? { a: new Float64Array(N), b: new Float64Array(N), count: new Float64Array(N), stiff: new Float64Array(N), shear: new Float64Array((width + 1) * (height + 1)), ra: new Float64Array(N), rb: new Float64Array(N), spin: new Float64Array(N), flowU: new Float64Array(U), flowV: new Float64Array(V), flowPressure: new Float64Array(N), spread: new Float64Array(N), none: new Float64Array(N) } : null
  };
  // An arc over the liquid runs through its air, the vapour's gas (see electricStep).
  if (effect.electric) state.electric = createElectric(effect, width, height);
  return state;
}
// Adhesion makes the liquid hold on to walls and obstacles (and anything beyond a closed edge). A pull toward them would
// do nothing, since the pressure solve takes away any pull that is the slope of a field, so instead a particle within a
// cell of a solid holds on to it, as static friction holds: it does not move away from the solid unless it is pulled
// away faster than 2 × adhesion × closeness pixels per frame, and then only by the excess. Closeness is the solids
// blurred over a cell, ¼ in the middle of a cell beside a solid. Particles still slide along a solid freely, so a film
// stays under a ledge, on a spoon or down a jar's side while the rest of the liquid falls or drains away. Away is
// measured from a moving solid as it moves, so what clings to a spoon is lifted with it (see carryFields). Every solid
// of the solid layer counts, closed edges included. `value(owner)` weighs each solid by its owner; the default counts
// every one as 1.
export function clingField(solids, value = null) {
  const { W, H, solid, ownerAt } = solids, field = new Float64Array(W * H);
  const solidAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? ownerAt(x, y) === EDGE : solid[y * W + x]) ? (value ? value(ownerAt(x, y)) : 1) : 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sum = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += solidAt(i + di, j + dj) * (di ? 1 : 2) * (dj ? 1 : 2);
    field[j * W + i] = sum / 16;
  }
  return field;
}
// Solids with their own adhesion: closeness to the solids that take the effect's adhesion (`plain`: the rest, ice and
// closed edges) and to those with their own, weighed by it (`own`). Each step the hold is the effect's adhesion times
// `plain` plus `own`. Null when no solid has its own.
export function gripFields(solids, obstacles) {
  if (!obstacles.some(o => o.props.adhesion !== null)) return null;
  const own = o => solids.props(o)?.adhesion ?? null;
  return { plain: clingField(solids, o => (own(o) === null ? 1 : 0)), own: clingField(solids, o => own(o) ?? 0), grip: new Float64Array(solids.N) };
}
// The moving solids near each cell, two pixels round, for what clings to them: how near (`near`), and summed with the
// same weights their velocity (`u`, `v`) and how far their whole-pixel place is ahead of where they really are (`du`,
// `dv`), so a particle reads the velocity as u / near. An obstacle moves in whole pixels, jumping a pixel at a time, but
// clinging is measured from where it really is along its move, so a film on it moves smoothly instead of being left a
// pixel behind at each jump. Null while nothing moves.
export function carryFields(solids) {
  if (!solids.moving) return null;
  const { W, H, N } = solids, f = () => new Float64Array(N), near = f(), u = f(), v = f(), du = f(), dv = f();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sum = 0, su = 0, sv = 0, sdu = 0, sdv = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const at = y * W + x, s = solids.velocity(at);
      if (!s) continue;
      const w = (3 - (di < 0 ? -di : di)) * (3 - (dj < 0 ? -dj : dj)), [ax, ay] = solids.ahead(at);
      sum += w; su += w * s[0]; sv += w * s[1]; sdu += w * ax; sdv += w * ay;
    }
    const c = j * W + i;
    near[c] = sum; u[c] = su; v[c] = sv; du[c] = sdu; dv[c] = sdv;
  }
  return { near, u, v, du, dv };
}
// A particle's position, velocity, id, its velocity before this frame's steps (for whitewater impacts), for APIC the
// slopes of the flow around it (du/dx, du/dy, dv/dx, dv/dy), and for yield stress its strain (stretch, shear).
// With heat, each particle also has its energy and whether it is ice (see the phase section).
const PARTICLE_KEYS = ['x', 'y', 'vx', 'vy', 'id', 'pvx', 'pvy', 'cux', 'cuy', 'cvx', 'cvy', 'ea', 'eb'], PHASE_KEYS = [...PARTICLE_KEYS, 'energy', 'frozen', 'fall'];
export function addParticle(state, x, y, vx, vy) {
  if (state.n === state.x.length) {
    if (state.n >= LIMITS.particles) { state.full = true; return false; }
    for (const key of state.keys) { const grown = new Float64Array(Math.min(LIMITS.particles, state.n * 2)); grown.set(state[key]); state[key] = grown; }
  }
  const k = state.n++;
  state.x[k] = x; state.y[k] = y; state.vx[k] = vx; state.vy[k] = vy; state.id[k] = state.next++; state.pvx[k] = vx; state.pvy[k] = vy;
  state.cux[k] = 0; state.cuy[k] = 0; state.cvx[k] = 0; state.cvy[k] = 0; state.ea[k] = 0; state.eb[k] = 0;
  if (state.heat) { const P = state.heat; state.energy[k] = P.spawnEnergy; state.frozen[k] = P.spawnFrozen; state.fall[k] = 0; if (!P.converting) P.added++; }
  return true;
}
export function removeParticle(state, k) {
  if (state.heat && !state.heat.converting) state.heat.removed++;
  const last = --state.n;
  for (const key of state.keys) state[key][k] = state[key][last];
}
export function countCells(state) {
  const { g, cells } = state, { W, H } = g;
  cells.fill(0);
  for (let k = 0; k < state.n; k++) {
    const i = Math.floor(state.x[k]), j = Math.floor(state.y[k]);
    if (i >= 0 && j >= 0 && i < W && j < H && cells[j * W + i] < 65535) cells[j * W + i]++;
  }
}
// Places up to `want` particles in a cell on a jittered 2 × 2 pattern, keyed so the same source fills the same way. Spots
// inside a smooth obstacle's outline stay empty.
export function seedCell(state, i, j, want, have, velocity, key) {
  const { geo } = state.g;
  for (let k = have; k < want; k++) {
    const sx = (k % 2) * 0.5, sy = (Math.floor(k / 2) % 2) * 0.5, x = i + sx + 0.05 + 0.4 * random(...key, k, SALT.jitterX), y = j + sy + 0.05 + 0.4 * random(...key, k, SALT.jitterY);
    if (geo && outlineAt(geo, x, y) < CLEARANCE) continue;
    if (!addParticle(state, x, y, velocity[0], velocity[1])) return false;
  }
  return true;
}
export function fillLiquid(state, effect) {
  const { g } = state, { W, H, pixels: solid } = g;
  effect.fills.forEach((fill, f) => {
    if (state.heat) {
      const h = effect.heat, P = state.heat, t = fill.phase.temperature ?? h.ambient;
      // A vapour fill holds still vapour of that density in its open cells, at its temperature.
      if (fill.phase.vapour) {
        const V = P.vapour, mass = fill.phase.vapour * PER_CELL / effect.vapour.expansion;
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!solid[j * W + i] && fill.inside(i + 0.5, j + 0.5)) { V.d[j * W + i] += mass; V.T[j * W + i] = t; }
        return;
      }
      P.spawnFrozen = fill.phase.frozen ? 1 : 0; P.spawnEnergy = energyOf(h, t, fill.phase.frozen);
    }
    if (fill.burst) { burstFill(state, effect, fill, f); return; }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!solid[j * W + i] && fill.inside(i + 0.5, j + 0.5)) seedCell(state, i, j, PER_CELL, 0, fill.velocity, [effect.seed, 1000 + f, i, j]);
  });
}
// A fill that bursts: an outward velocity inside one connected blob is something an incompressible liquid can't have,
// so the pressure solve would cancel it. Instead the fill breaks into `pieces` seeded pieces (each cell joins the
// nearest of that many seeded cells) with a one-pixel gap of air between neighbours, and each piece flies straight out
// from the fill's middle at its own speed, plus the fill's velocity. A piece moving as one is divergence-free, so the
// pressure solve keeps it.
function burstFill(state, effect, fill, f) {
  const { W, H, pixels: solid } = state.g, cells = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!solid[j * W + i] && fill.inside(i + 0.5, j + 0.5)) cells.push(j * W + i);
  if (!cells.length) return;
  const { pieces, speed } = fill.burst, seeds = [];
  for (let k = 0; seeds.length < Math.min(pieces, cells.length) && k < 8 * pieces; k++) {
    const c = cells[Math.min(cells.length - 1, Math.floor(random(effect.seed, 1000 + f, k, SALT.spawn) * cells.length))];
    if (!seeds.includes(c)) seeds.push(c);
  }
  const piece = new Int16Array(W * H).fill(-1);
  for (const c of cells) {
    const x = c % W, y = (c - x) / W;
    let best = 0, near = Infinity;
    seeds.forEach((s, n) => { const dx = s % W - x, dy = (s - (s % W)) / W - y, d = dx * dx + dy * dy; if (d < near) { near = d; best = n; } });
    piece[c] = best;
  }
  // A cell beside a piece numbered lower becomes the gap between them.
  let kept = cells.filter(c => { const x = c % W, y = (c - x) / W, n = piece[c]; return !((x > 0 && piece[c - 1] >= 0 && piece[c - 1] < n) || (x < W - 1 && piece[c + 1] >= 0 && piece[c + 1] < n) || (y > 0 && piece[c - W] >= 0 && piece[c - W] < n) || (y < H - 1 && piece[c + W] >= 0 && piece[c + W] < n)); });
  // Liquid breaks into blobs, not shards: twice over, a cell with four or fewer of its eight neighbours in its own piece
  // is trimmed off (its water goes back to the piece, as a gap's does), so the straight-cut pieces fly as rounded blobs,
  // where an elastic liquid would keep their corners all the way down. A piece of six cells or fewer stays whole.
  for (let pass = 0; pass < 2; pass++) {
    const left = new Int16Array(W * H).fill(-1), size = seeds.map(() => 0);
    for (const c of kept) { left[c] = piece[c]; size[piece[c]]++; }
    kept = kept.filter(c => {
      if (size[piece[c]] <= 6) return true;
      const x = c % W, y = (c - x) / W;
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && left[c + dy * W + dx] === piece[c]) same++;
      return same > 4;
    });
  }
  // The middle of the whole shape on the canvas, obstacles' pixels included.
  let cx = 0, cy = 0, area = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (fill.inside(i + 0.5, j + 0.5)) { cx += i + 0.5; cy += j + 0.5; area++; }
  cx /= area; cy /= area;
  const sums = seeds.map(() => [0, 0, 0]);
  for (const c of kept) { const s = sums[piece[c]]; s[0] += c % W + 0.5; s[1] += Math.floor(c / W) + 0.5; s[2]++; }
  const velocities = sums.map(([sx, sy, n], k) => {
    if (!n) return fill.velocity;
    const dx = sx / n - cx, dy = sy / n - cy, d = Math.sqrt(dx * dx + dy * dy), v = pick(speed, random(effect.seed, 1000 + f, k, SALT.speed));
    return d < 0.5 ? fill.velocity : [fill.velocity[0] + v * dx / d, fill.velocity[1] + v * dy / d];
  });
  for (const c of kept) { const i = c % W, j = (c - i) / W; seedCell(state, i, j, PER_CELL, 0, velocities[piece[c]], [effect.seed, 1000 + f, i, j]); }
  // The gaps' water goes to their own pieces, a cell's worth to each of its cells in turn, so a burst keeps its volume;
  // the crowded pieces swell a little as they fly. A piece that is all gap (a small fill in many pieces) hands its
  // water to the piece of the nearest kept cell.
  const own = seeds.map(() => []), extra = seeds.map(() => 0), keep = new Set(kept);
  for (const c of kept) own[piece[c]].push(c);
  for (const c of cells) {
    if (keep.has(c)) continue;
    let to = piece[c];
    if (!own[to].length) {
      const x = c % W, y = (c - x) / W;
      let near = Infinity;
      for (const k of kept) { const dx = k % W - x, dy = (k - (k % W)) / W - y, d = dx * dx + dy * dy; if (d < near) { near = d; to = piece[k]; } }
    }
    extra[to]++;
  }
  own.forEach((list, n) => {
    for (let k = 0; k < extra[n] && list.length; k++) {
      const c = list[k % list.length], i = c % W, j = (c - i) / W, have = PER_CELL * (1 + Math.floor(k / list.length));
      seedCell(state, i, j, have + PER_CELL, have, velocities[n], [effect.seed, 1000 + f, i, j]);
    }
  });
}
export function emitLiquid(state, e, index, cycle, seed, along = cycle, factor = 1) {
  const { g } = state, { W, H, pixels: solid } = g, here = emitterState(e, index, cycle, seed, along, factor), { x, y, flicker } = here, r = reach(e);
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r)), y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
  const velocityAt = (px, py) => [push(e, px - x, py - y, 0, e.expand), push(e, px - x, py - y, 1, e.expand)];
  if (state.heat) { state.heat.spawnFrozen = 0; state.heat.spawnEnergy = energyOf(state.heat.heat, e.warmth ?? state.heat.heat.ambient, false); }
  // Particles already inside follow the emitter's push (a jet), or drain away through it.
  for (let k = state.n - 1; k >= 0; k--) {
    const px = state.x[k], py = state.y[k], w = coverage(e, px - x, py - y);
    if (!w) continue;
    const strength = flicker(px, py);
    if (e.density < 0 && random(seed, index, cycle, SALT.drain, state.id[k]) < -e.density * Math.min(1, w * strength * profile(e, px - x, py - y))) { removeParticle(state, k); continue; }
    const [tx, ty] = velocityAt(px, py), f = Math.min(1, w * strength);
    if (e.steer || e.expand) {
      if (e.burst) { state.vx[k] += tx * w * strength; state.vy[k] += ty * w * strength; } else { state.vx[k] += (tx - state.vx[k]) * f; state.vy[k] += (ty - state.vy[k]) * f; }
    }
    if (e.noise) { state.vx[k] += e.noise * w * strength * (2 * valueNoise(seed, index, cycle, SALT.noiseX, px, py) - 1); state.vy[k] += e.noise * w * strength * (2 * valueNoise(seed, index, cycle, SALT.noiseY, px, py) - 1); }
  }
  if (e.density > 0 && x0 <= x1 && y0 <= y1) {
    countCells(state);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const c = j * W + i, w = coverage(e, i + 0.5 - x, j + 0.5 - y);
      if (!w || solid[c]) continue;
      const want = Math.floor(PER_CELL * e.density * Math.min(1, w * flicker(i + 0.5, j + 0.5) * profile(e, i + 0.5 - x, j + 0.5 - y)) + 0.5);
      if (want > state.cells[c] && !seedCell(state, i, j, want, state.cells[c], velocityAt(i + 0.5, j + 0.5), [seed, index, cycle, SALT.spawn, i, j])) return here;
    }
  }
  return here;
}
// Adds `value` to the four lattice points around (fx, fy) with bilinear weights, and the weights to `weights` if given.
function splat(a, weights, nx, ny, fx, fy, value) {
  const i = Math.floor(fx), j = Math.floor(fy), s = fx - i, t = fy - j;
  const add = (x, y, w) => { if (x >= 0 && y >= 0 && x < nx && y < ny && w) { a[y * nx + x] += w * value; if (weights) weights[y * nx + x] += w; } };
  add(i, j, (1 - s) * (1 - t)); add(i + 1, j, s * (1 - t)); add(i, j + 1, (1 - s) * t); add(i + 1, j + 1, s * t);
}
// As splat, onto the cell centres of a W × H canvas, from a particle at (px, py), with its whole weight shared among the
// centres it could be in: none goes into an obstacle pixel, off the canvas or across a corner where two obstacle pixels
// touch (nor, beside a smooth obstacle, to a centre with the outline between it and the particle). So a wall soaks up
// none of the water beside it: a full cell walled in on three sides, or a crack one pixel wide, holds as much as open
// water does, and nothing shows on the far side of a thin wall.
function splatOpen(a, weights, W, H, px, py, value, solid, geo) {
  const fx = px - 0.5, fy = py - 0.5, i = Math.floor(fx), j = Math.floor(fy), s = fx - i, t = fy - j;
  // The particle's own cell, and beside smooth obstacles the corners it is cut off at.
  const ci = Math.floor(px), cj = Math.floor(py), cut = geo && ci >= 0 && cj >= 0 && ci < W && cj < H ? geo.across[cj * W + ci] : 0;
  let dropped = false;
  const reach = (x, y, w) => {
    if (!w) return 0;
    const shut = x < 0 || y < 0 || x >= W || y >= H || solid[y * W + x]
      // The centre diagonal to the particle's own cell, past the corner they share.
      || (x !== ci && y !== cj && (geo ? cut & (y < cj ? (x < ci ? TL : TR) : x < ci ? BL : BR) : solid[cj * W + x] && solid[y * W + ci]))
      || (geo && outlineAt(geo, (px + x + 0.5) / 2, (py + y + 0.5) / 2) < 0);
    if (shut) dropped = true;
    return shut ? 0 : w;
  };
  const w00 = reach(i, j, (1 - s) * (1 - t)), w10 = reach(i + 1, j, s * (1 - t)), w01 = reach(i, j + 1, (1 - s) * t), w11 = reach(i + 1, j + 1, s * t);
  // In open water the weights already sum to one, and stay exactly as they are.
  const scale = dropped ? 1 / (w00 + w10 + w01 + w11) : 1;
  if (!(scale < Infinity)) return;
  const add = (x, y, w) => { if (w) { a[y * W + x] += w * scale * value; weights[y * W + x] += w * scale; } };
  add(i, j, w00); add(i + 1, j, w10); add(i, j + 1, w01); add(i + 1, j + 1, w11);
}
// As splat, with the particle's local flow (APIC): each lattice point gets value + gx (x − fx) + gy (y − fy), so a turning
// or shearing patch of liquid hands the grid its turning and shearing, not only its mean velocity.
function splatAffine(a, weights, nx, ny, fx, fy, value, gx, gy) {
  const i = Math.floor(fx), j = Math.floor(fy), s = fx - i, t = fy - j;
  const add = (x, y, w) => { if (x >= 0 && y >= 0 && x < nx && y < ny && w) { a[y * nx + x] += w * (value + gx * (x - fx) + gy * (y - fy)); weights[y * nx + x] += w; } };
  add(i, j, (1 - s) * (1 - t)); add(i + 1, j, s * (1 - t)); add(i, j + 1, (1 - s) * t); add(i + 1, j + 1, s * t);
}
function transfer(state) {
  const { g, uw, vw, uValid, vValid, fluid } = state, { W, H, u, v, solid } = g;
  u.fill(0); v.fill(0); uw.fill(0); vw.fill(0); fluid.fill(0);
  // Ice holds still and takes no part in the flow (where enough of it gathers, its cells are solid).
  const frozen = state.heat ? state.frozen : null;
  for (let k = 0; k < state.n; k++) {
    if (frozen && frozen[k]) continue;
    const x = state.x[k], y = state.y[k];
    if (state.apic) {
      splatAffine(u, uw, W + 1, H, x, y - 0.5, state.vx[k], state.cux[k], state.cuy[k]);
      splatAffine(v, vw, W, H + 1, x - 0.5, y, state.vy[k], state.cvx[k], state.cvy[k]);
    } else {
      splat(u, uw, W + 1, H, x, y - 0.5, state.vx[k]);
      splat(v, vw, W, H + 1, x - 0.5, y, state.vy[k]);
    }
    const i = Math.floor(x), j = Math.floor(y);
    if (i >= 0 && j >= 0 && i < W && j < H && !solid[j * W + i]) fluid[j * W + i] = 1;
  }
  // A pixel step that a smooth outline cuts through holds liquid in its open corner whenever liquid lies beside that
  // corner, so the step bears the liquid's pressure instead of draining it like open air.
  if (g.geo) {
    const { open, uOpen, vOpen } = g.geo, X = W + 1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (fluid[c] || !(open[c] > 0 && open[c] < 0.5)) continue;
      if ((i > 0 && uOpen[j * X + i] && fluid[c - 1]) || (i < W - 1 && uOpen[j * X + i + 1] && fluid[c + 1]) || (j > 0 && vOpen[c] && fluid[c - W]) || (j < H - 1 && vOpen[c + W] && fluid[c + W])) fluid[c] = 1;
    }
  }
  // The wake of a moving obstacle: the cells it has left in the last WAKE frames, while liquid or solid closes them in,
  // are liquid even with no particles in them, so the liquid flows in behind the obstacle as it moves (or is drawn up
  // after it) instead of leaving a hole that a thick liquid would take many frames to close. Air reaching them, through
  // each other, ends that for good: the obstacle has left the liquid there.
  const { wake } = state;
  if (wake && wake.cells.length) {
    const { left: wl, right: wr, top: wt, bottom: wb } = g.walls, mark = wake.mark, aired = [];
    for (const c of wake.cells) if (!fluid[c] && !solid[c]) mark[c] = 1;
    const open = (c, inside, wall) => (inside ? !fluid[c] && !solid[c] && !mark[c] : !wall);
    for (const c of wake.cells) {
      const i = c % W, j = (c - i) / W;
      if (mark[c] === 1 && (open(c - 1, i > 0, wl) || open(c + 1, i < W - 1, wr) || open(c - W, j > 0, wt) || open(c + W, j < H - 1, wb))) { mark[c] = 2; aired.push(c); }
    }
    while (aired.length) {
      const c = aired.pop(), i = c % W, j = (c - i) / W;
      for (const d of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1]) if (d >= 0 && mark[d] === 1) { mark[d] = 2; aired.push(d); }
    }
    for (const c of wake.cells) { if (mark[c] === 1) fluid[c] = 1; else if (mark[c] === 2) wake.left[c] = 0; mark[c] = 0; }
    wake.cells = wake.cells.filter(c => wake.left[c]);
  }
  for (let k = 0; k < u.length; k++) { if (uw[k] > 0) u[k] /= uw[k]; uValid[k] = uw[k] > 0 || g.uFixed[k] ? 1 : 0; }
  for (let k = 0; k < v.length; k++) { if (vw[k] > 0) v[k] /= vw[k]; vValid[k] = vw[k] > 0 || g.vFixed[k] ? 1 : 0; }
  // The liquid beside each body's faces, as its particles hand it on, before the faces take the bodies' velocities.
  if (state.coupling && state.coupling.list.length) bodyWater(g, state.coupling);
  enforce(g);
  extrapolate(u, uValid, W + 1, H, 2); extrapolate(v, vValid, W, H + 1, 2);
}
// Cohesion: the liquid is drawn up its smoothed density, which only matters at the surface (inside, the density is
// level). Drops hold together and thin sheets gather into strands instead of drifting apart as mist. It is a force on
// the grid's faces before the pressure solve, as gravity is, so the pressure holds a resting surface against it. (Added
// to each particle's velocity after the solve, it stayed there, built up step after step and went round every transfer,
// so a resting liquid kept a speed it never moved by and a thin one, with APIC, trembled for ever.) Half of it is the
// difference in density across each face, which the pressure balances exactly at rest; half is sampled at the
// particles and spread onto the faces as their velocities are, which keeps a small falling drop round where a pixel-wide
// difference cannot tell its end from its sides.
function cohere(state, strength, room) {
  const { g, fluid, blur: rho, cells, uw, vw } = state, { W, H, u, v, solid, uFixed, vFixed } = g, X = W + 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let sum = 0, weights = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj;
      // Obstacles take no part, so liquid neither clings to walls nor shies away from them; beside a smooth one a cell
      // counts by its open share, and a cut step's open corner not at all.
      if (x < 0 || y < 0 || x >= W || y >= H || (room ? room[y * W + x] < 0.5 : solid[y * W + x])) continue;
      const w = (di ? 1 : 2) * (dj ? 1 : 2);
      sum += cells[y * W + x] * w; weights += room ? w * room[y * W + x] : w;
    }
    rho[j * W + i] = weights ? sum / weights / PER_CELL : 0;
  }
  // Each face between two cells, one of them liquid, is pushed toward the denser one.
  const half = 0.5 * strength;
  for (let j = 0; j < H; j++) for (let i = 1; i < W; i++) {
    const k = j * X + i, c = j * W + i;
    if (!uFixed[k] && (fluid[c - 1] || fluid[c])) u[k] += half * (rho[c] - rho[c - 1]);
  }
  for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (!vFixed[c] && (fluid[c - W] || fluid[c])) v[c] += half * (rho[c] - rho[c - W]);
  }
  // Each particle's pull, the density's difference across the two cells around it, is spread with the weights the
  // transfer gave its velocity (the particles have not moved since).
  const { pullU, pullV } = state, frozen = state.heat ? state.frozen : null;
  pullU.fill(0); pullV.fill(0);
  for (let k = 0; k < state.n; k++) {
    if (frozen && frozen[k]) continue;
    const x = state.x[k], y = state.y[k], fx = x - 0.5, fy = y - 0.5;
    splat(pullU, null, W + 1, H, x, y - 0.5, 0.5 * half * (bilinear(rho, W, H, fx + 1, fy) - bilinear(rho, W, H, fx - 1, fy)));
    splat(pullV, null, W, H + 1, x - 0.5, y, 0.5 * half * (bilinear(rho, W, H, fx, fy + 1) - bilinear(rho, W, H, fx, fy - 1)));
  }
  for (let k = 0; k < u.length; k++) if (uw[k] > 0 && !uFixed[k]) u[k] += pullU[k] / uw[k];
  for (let k = 0; k < v.length; k++) if (vw[k] > 0 && !vFixed[k]) v[k] += pullV[k] / vw[k];
}
export function stepLiquid(state, effect, dt) {
  const { g, fluid, target, uOld, vOld } = state, { W, H, u, v, solid, walls } = g;
  transfer(state);
  const coupling = state.coupling && state.coupling.list.length ? state.coupling : null;
  uOld.set(u); vOld.set(v);
  for (let k = 0; k < u.length; k++) u[k] += dt * effect.gravity[0];
  for (let k = 0; k < v.length; k++) v[k] += dt * effect.gravity[1];
  // Bubbles with lift hand that share of their buoyancy to the water around them, as if that much of it weighed nothing:
  // a column of bubbles drives an upwelling.
  const lifts = state.lifts;
  if (lifts) for (let b = 0; b < lifts.length; b += 3) {
    const x = lifts[b], y = lifts[b + 1], a = lifts[b + 2] * dt;
    splat(u, null, W + 1, H, x, y - 0.5, -a * effect.gravity[0]); splat(v, null, W, H + 1, x - 0.5, y, -a * effect.gravity[1]);
  }
  if (effect.drag) { const keep = 1 - effect.drag * dt; for (let k = 0; k < u.length; k++) u[k] *= keep; for (let k = 0; k < v.length; k++) v[k] *= keep; }
  if (effect.yield) strainForce(state, effect, dt);
  countCells(state);
  const room = g.geo ? g.geo.open : null;
  if (effect.tension) cohere(state, effect.tension * dt, room);
  if (coupling) bodyWalls(g, coupling);
  enforce(g);
  // An obstacle moving away from the liquid behind it draws the liquid after it only as far as the liquid can follow:
  // against a crowded cell its face holds still for the step, so the crowd spreads instead of being packed ever tighter
  // against the pixels it has not yet left (liquid running off a lifted spoon gathers below it as a drop).
  if (g.moved) {
    const { uWall, vWall, uFixed, vFixed } = g, X = W + 1, crowded = c => !solid[c] && state.cells[c] > PER_CELL;
    for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
      const k = j * X + i, w = uWall[k];
      if (uFixed[k] && w && (w > 0 ? i > 0 && crowded(j * W + i - 1) : i < W && crowded(j * W + i))) u[k] = 0;
    }
    for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, w = vWall[k];
      if (vFixed[k] && w && (w > 0 ? j > 0 && crowded(k - W) : j < H && crowded(k))) v[k] = 0;
    }
  }
  // Crowded cells spread and sparse cells inside the liquid draw particles in, so splashes neither shrink the volume nor
  // thin it out into a larger, emptier one. Cells on the surface only spread.
  const wet = c => solid[c] || fluid[c];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    // Beside a smooth obstacle a cell holds particles for its open share; the open corners of cut steps take no part.
    if (room && room[c] < 0.5) { target[c] = 0; continue; }
    const error = room ? state.cells[c] / (PER_CELL * room[c]) - 1 : state.cells[c] / PER_CELL - 1;
    const interior = fluid[c] && (i > 0 ? wet(c - 1) : walls.left) && (i < W - 1 ? wet(c + 1) : walls.right) && (j > 0 ? wet(c - W) : walls.top) && (j < H - 1 ? wet(c + W) : walls.bottom);
    target[c] = error > 0 || interior ? 0.5 * error : 0;
    if (state.grains) state.grains.inner[c] = interior ? 1 : 0;
  }
  // A yield-stress liquid is strained by its flow alone: the spreading has a solve of its own after the flow's, which
  // moves the particles without straining them. (Strained by it, the liquid stored springiness that only mended the
  // particles' spacing, and a resting slime rocked for ever.)
  // Grains are strained by their flow alone in the same way: friction that read the spacing's mending as shear never let
  // a resting heap hold.
  const grains = effect.granular ? state.grains : null, split = effect.yield > 0 || !!grains;
  const spreading = split ? (grains ?? state.strain).none : target;
  // Grains: the velocities before the pressure solve, to measure how hard it stopped them (grainFriction).
  if (grains) { grains.preU.set(u); grains.preV.set(v); }
  g.airP = effect.air ? sealAir(state, effect, dt) : null;
  project(g, fluid, effect.iterations, spreading, coupling);
  g.pockets = null;
  // Grains: friction from the pressure just solved, as a viscosity the thick solve below applies (grainFriction).
  const friction = grains ? grainFriction(state, effect, dt) : null;
  // A thick liquid resists the flow the pressure solve has just made (a heap slumping under its own weight) before it
  // moves, then is made divergence-free again. That second solve starts from no pressure and leaves the first's in
  // place to start the next step from.
  const thick = effect.viscosity || effect.yield || grains;
  if (thick) {
    viscous(g, fluid, effect, dt, effect.yield ? state.strain.stiff : friction);
    state.pressure.set(g.p); g.p.fill(0);
    project(g, fluid, effect.iterations, spreading);
    g.p.set(state.pressure);
  }
  // Grains that hold move as rigid pieces, at rest on what they press on.
  if (grains) grainPieces(state, effect);
  const uValid = new Uint8Array(state.uValid.length), vValid = new Uint8Array(state.vValid.length);
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) { const k = j * (W + 1) + i; uValid[k] = g.uFixed[k] || (i > 0 && fluid[j * W + i - 1]) || (i < W && fluid[j * W + i]) ? 1 : 0; }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; vValid[k] = g.vFixed[k] || (j > 0 && fluid[(j - 1) * W + i]) || (j < H && fluid[j * W + i]) ? 1 : 0; }
  if (split) {
    const held = grains ?? state.strain, { flowPressure } = held;
    if (!grains) {
      const { flowU, flowV } = state.strain;
      flowU.set(u); flowV.set(v);
      extrapolate(flowU, Uint8Array.from(uValid), W + 1, H, 3); extrapolate(flowV, Uint8Array.from(vValid), W, H + 1, 3);
      strainRates(state, flowU, flowV);
    }
    // The spreading's solve starts from the last step's, as the flow's starts from the last step's pressure.
    flowPressure.set(g.p); g.p.set(held.spread);
    // The pockets pushed in the flow's solve; this one only mends the spacing. Grains that hold mend it inside a heap only,
    // where grains just trade places to fill its gaps: mended at the surface too, a heap's crowded grains spread over it and
    // it crept flatter for ever, and never mended, its gaps stayed and showed as holes.
    if (grains) for (let c = 0; c < g.N; c++) if (grains.rigid[c] && !grains.inner[c]) target[c] = 0;
    const airP = g.airP;
    g.airP = null;
    project(g, fluid, effect.iterations, target);
    g.airP = airP;
    held.spread.set(g.p); g.p.set(flowPressure);
  }
  extrapolate(u, uValid, W + 1, H, 3); extrapolate(v, vValid, W, H + 1, 3);
  // FLIP: particles keep their own velocity plus the grid's change, blended with the grid velocity (PIC) to calm noise.
  // In a thick liquid a particle's own jitter, finer than the grid, fades as the grid's finest ripples do under its
  // viscosity, so the FLIP share shrinks where the liquid is thick. With APIC the grid share also hands each particle the
  // slopes of the flow around it, which it carries and hands back, so the calm share keeps swirls instead of smearing them.
  const flip = effect.flip, mu = thick ? g.visc.mu : null, cling = state.cling, normal = cling ? new Float64Array(2) : null, carry = state.carry;
  // With obstacles of their own adhesion, the hold is weighed this step from the effect's adhesion and theirs.
  const grip = state.grip ? state.grip.grip : null;
  if (grip) { const { plain, own } = state.grip; for (let c = 0; c < g.N; c++) grip[c] = effect.adhesion * plain[c] + own[c]; }
  const slopes = state.apic ? new Float64Array(2) : null, limit = effect.yield / (2 * STIFFNESS);
  const { geo } = g, stepped = geo ? geo.stepped : solid, velocity = geo ? new Float64Array(2) : null, landing = geo ? new Float64Array(2) : null;
  const frozen = state.heat ? state.frozen : null, near = state.nearBodies;
  for (let k = state.n - 1; k >= 0; k--) {
    if (frozen && frozen[k]) { state.vx[k] = 0; state.vy[k] = 0; continue; }
    let x = state.x[k], y = state.y[k];
    const cell = Math.floor(y) * W + Math.floor(x), pu = sampleU(g, u, x, y), pv = sampleV(g, v, x, y);
    // Beside a body the share is at most NEAR_BODY_FLIP: the noise particles keep at the faces of a moving body is what
    // the body floats on, and at the default share it rocked a floating plank harder every frame. Further out the liquid
    // keeps its own share, splashes and all.
    const share = grains && grains.rigid[cell] ? 0 : Math.min(near && near[cell] ? NEAR_BODY_FLIP : 1, mu ? flip / (1 + 8 * dt * mu[cell]) : flip);
    state.vx[k] = share * (state.vx[k] + pu - sampleU(g, uOld, x, y)) + (1 - share) * pu;
    state.vy[k] = share * (state.vy[k] + pv - sampleV(g, vOld, x, y)) + (1 - share) * pv;
    if (slopes) {
      slope(u, W + 1, H, x, y - 0.5, slopes); state.cux[k] = slopes[0]; state.cuy[k] = slopes[1];
      slope(v, W, H + 1, x - 0.5, y, slopes); state.cvx[k] = slopes[0]; state.cvy[k] = slopes[1];
    }
    // Yield stress: the particle's strain grows by this step's rate of strain, turns with the flow, and is capped at the
    // yield strain; strain beyond the cap is plastic flow, which the liquid does not spring back from. The turn keeps the
    // strain's size (a Cayley rotation): turned a step at a time along the tangent, it grew a little every step, and the
    // growth set a resting slime rocking for ever.
    if (limit) {
      const c = Math.floor(y) * W + Math.floor(x), { ra, rb, spin } = state.strain, ea = state.ea[k], eb = state.eb[k];
      const turn = dt * spin[c], q = turn * turn / 4;
      let na = ((1 - q) * ea - turn * eb) / (1 + q) + dt * ra[c], nb = ((1 - q) * eb + turn * ea) / (1 + q) + dt * rb[c];
      const size = na * na + nb * nb;
      if (size > limit * limit) { const scale = limit / Math.sqrt(size); na *= scale; nb *= scale; }
      state.ea[k] = na; state.eb[k] = nb;
    }
    if (state.vx[k] > MAX_SPEED) state.vx[k] = MAX_SPEED; else if (state.vx[k] < -MAX_SPEED) state.vx[k] = -MAX_SPEED;
    if (state.vy[k] > MAX_SPEED) state.vy[k] = MAX_SPEED; else if (state.vy[k] < -MAX_SPEED) state.vy[k] = -MAX_SPEED;
    const mx = x + 0.5 * dt * pu, my = y + 0.5 * dt * pv;
    let nx = x + dt * sampleU(g, u, mx, my), ny = y + dt * sampleV(g, v, mx, my);
    // A grain that barely moves, lying on grains that hold or on a solid, sleeps where it is: on a resting heap the
    // spacing's small mending kept a loose surface grain hopping across a cell edge for ever.
    if (grains && !grains.rigid[cell] && pu * pu + pv * pv < GRAIN_SLEEP * GRAIN_SLEEP && grainRests(g, grains, cell, effect.gravity)) {
      state.vx[k] = 0; state.vy[k] = 0; nx = x; ny = y;
    }
    // Beside a moving obstacle: its velocity here (wx, wy), and how far its whole-pixel place is ahead of where it really
    // is at the end of this step (sx, sy), so the particle meets it where it really is.
    let wx = 0, wy = 0, sx = 0, sy = 0;
    if (carry) {
      const fx = x - 0.5, fy = y - 0.5, near = bilinear(carry.near, W, H, fx, fy);
      if (near > 0) {
        const ahead = 1 - state.phase;
        wx = bilinear(carry.u, W, H, fx, fy) / near; wy = bilinear(carry.v, W, H, fx, fy) / near;
        sx = bilinear(carry.du, W, H, fx, fy) / near + ahead * wx; sy = bilinear(carry.dv, W, H, fx, fy) / near + ahead * wy;
      }
    }
    if (cling) {
      // Closeness is measured from where a moving obstacle really is, and away is away from where it is going: what
      // clings to it moves with it.
      const fx = x - 0.5 + sx, fy = y - 0.5 + sy, close = bilinear(cling, W, H, fx, fy);
      let hold;
      if (grip) { hold = 2 * bilinear(grip, W, H, fx, fy); slope(grip, W, H, fx, fy, normal); } else { hold = 2 * effect.adhesion * close; slope(cling, W, H, fx, fy, normal); }
      const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1]);
      if (close > 0 && hold > 0 && length > 0) {
        const ux = normal[0] / length, uy = normal[1] / length;
        const away = (nx - x - dt * wx) * ux + (ny - y - dt * wy) * uy, leaving = (state.vx[k] - wx) * ux + (state.vy[k] - wy) * uy;
        if (away < 0) { const keep = Math.min(-away, hold * dt); nx += keep * ux; ny += keep * uy; }
        if (leaving < 0) { const keep = Math.min(-leaving, hold); state.vx[k] += keep * ux; state.vy[k] += keep * uy; }
      }
    }
    if (walls.left && nx < 0.01) { nx = 0.01; if (state.vx[k] < 0) state.vx[k] = 0; }
    if (walls.right && nx > W - 0.01) { nx = W - 0.01; if (state.vx[k] > 0) state.vx[k] = 0; }
    if (walls.top && ny < 0.01) { ny = 0.01; if (state.vy[k] < 0) state.vy[k] = 0; }
    if (walls.bottom && ny > H - 0.01) { ny = H - 0.01; if (state.vy[k] > 0) state.vy[k] = 0; }
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) { removeParticle(state, k); continue; }
    // Particles never enter an obstacle, however far they move in a step: they slide along it, or stay put and lose the
    // speed into it. A smooth obstacle's outline turns them along it, keeping their speed along the outline.
    const blocked = (px, py) => crossesSolid(stepped, W, H, x, y, px, py);
    if (blocked(nx, ny)) {
      if (!blocked(nx, y)) { ny = y; state.vy[k] = 0; }
      else if (!blocked(x, ny)) { nx = x; state.vx[k] = 0; }
      else { nx = x; ny = y; state.vx[k] = 0; state.vy[k] = 0; }
    }
    if (geo) {
      velocity[0] = state.vx[k]; velocity[1] = state.vy[k];
      if (slideSmooth(geo, W, H, x, y, nx, ny, velocity, landing)) {
        nx = landing[0]; ny = landing[1]; state.vx[k] = velocity[0]; state.vy[k] = velocity[1];
        if (walls.left && nx < 0.01) { nx = 0.01; if (state.vx[k] < 0) state.vx[k] = 0; }
        if (walls.right && nx > W - 0.01) { nx = W - 0.01; if (state.vx[k] > 0) state.vx[k] = 0; }
        if (walls.top && ny < 0.01) { ny = 0.01; if (state.vy[k] < 0) state.vy[k] = 0; }
        if (walls.bottom && ny > H - 0.01) { ny = H - 0.01; if (state.vy[k] > 0) state.vy[k] = 0; }
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { removeParticle(state, k); continue; }
      }
    }
    state.x[k] = nx; state.y[k] = ny;
  }
}
// ---- Air pockets -----------------------------------------------------------------------------------------------------
// Air is every cell that is neither solid nor holding liquid. Air joined to an open canvas edge is at zero pressure, as
// before. With `air` on, a sealed region of air is a pocket that keeps its air: it is tracked from step to step by the
// cells it shares with the last step's regions, and its pressure follows the gas law, in pixels of head: stiffness ×
// (air / volume − 1), where its air is the volume it had at zero pressure and its volume counts its empty cells and the
// empty share of the liquid cells around it. The air goes with the cells: pockets that merge add their air, one that
// splits shares its air by how many of its cells each piece holds (a piece that has opened to the outside takes its
// cells' share with it and no more), and a pocket that closes round open air takes that air in, a cell's worth a cell.
// (Shared by the pieces' whole sizes, a pocket that split off a piece just as it opened gave nearly all its air to
// the outdoors, and one that closed round open air and a small pocket kept only the small pocket's: either way a bottle
// was left at the hardest pull the gas law gives and drew the last of its water up to its roof.)
// A bubble is a pocket too small for the grid to show, so a sealed region becomes a pocket only once it holds
// POCKET_START cells' worth. A smaller one with no pocket before it, air a splash or a pour has trapped, lets its air go
// once, as bubbles (when `air.bubbles` says how to draw them) that start in the liquid at its edge, and closes as before;
// gaps under POCKET_END between jostling particles just close. A pocket squeezed below POCKET_END, which the 3 × 3 blur
// that draws the surface would fill in anyway, lets its air go the same way. Bubbles that rise into a pocket give it
// their air back (see absorber). Returns each cell's pocket pressure in the solver's units.
// A film of liquid is not thrown by the air on its two sides: across a seal up to SEAL cells thick (straight through
// the liquid, along a row or a column) between two pockets, or a pocket and the open air, air passes until the two
// pressures differ by no more than the film's own head, a pixel a cell. That is the most a film at rest holds (its
// thickness lying over or under the air, nothing standing beside it), so nothing at rest loses air by it. (Pocket air is
// soft, so a pocket's pull is worth many cells of air: the last thin plug in a bottle's neck, or a film between a
// stretched pocket and a fresh one, was shot up the bottle instead.)
// A pocket draws air up through liquid that hangs under it. Liquid held under a pocket with air beneath it (a bottle
// upside down, the open air at its mouth; a cap of water over a hollow) does not stay: air climbs through it. The grid
// shows that only as one finger as wide as the opening, which climbs slowly and stays joined to the air it came from. So
// a bottle never glugged: it hollowed out under a cap of water that hung from its stretched pocket, and each time the
// finger let the pocket's pull go, the soft air threw the cap back up to the roof. Instead the air passes, as it does
// through a film, and bubbles show it. Down each column (along gravity) from a pocket, through liquid, to air that
// pulls less than the pocket, air passes at the rate an opening that wide trades air for liquid: DRAW × w × √(gravity ×
// w) square pixels a frame over the w columns between the two, and no more than evens their pressures. A column counts
// only where its liquid is held, not falling: its pressure climbs towards its foot by half its weight or more over
// HANG cells (in free fall nothing is lighter than anything else, so no air climbs a falling stream), and, with
// `air.bubbles`, it runs down slower than the bubbles rise. The pocket has the air at once, as a bottle's does when a
// bubble pushes in at its mouth and the water it moves aside squeezes the pocket. Every GULP square pixels, a bubble
// holding that much starts at the foot of one of the columns, in turn, and rises to be seen; it has given its air
// already (its `passed`) and adds nothing where it ends.
const POCKET_START = 12, POCKET_END = 3, SEAL = 4, DRAW = 2, GULP = 4, HANG = 3;
function sealAir(state, effect, dt) {
  const { g, fluid, cells, air } = state, { W, H, N, solid, uFixed, vFixed } = g, X = W + 1, room = g.geo ? g.geo.open : null;
  const label = air.before, before = air.label, { stack, pressure } = air, old = air.regions, regions = [];
  air.label = label; air.before = before;
  label.fill(-1);
  const open = c => !solid[c] && !fluid[c] && label[c] < 0;
  for (let c0 = 0; c0 < N; c0++) {
    if (!open(c0)) continue;
    const id = regions.length, region = { volume: 0, open: false, x: 0, y: 0, cells: 0, air: 0, owed: 0, tracked: false, spent: false, edge: -1 };
    regions.push(region);
    let top = 0;
    stack[top++] = c0; label[c0] = id;
    while (top) {
      const c = stack[--top], i = c % W, j = (c - i) / W;
      region.cells++; region.x += i + 0.5; region.y += j + 0.5;
      // Through every open face: to the next air cell, or out through an open canvas edge.
      const reach = (fixed, inside, d) => {
        if (fixed) return;
        if (!inside) region.open = true;
        else if (open(d)) { label[d] = id; stack[top++] = d; } else if (fluid[d] && (region.edge < 0 || cells[d] > cells[region.edge])) region.edge = d;
      };
      reach(uFixed[j * X + i], i > 0, c - 1); reach(uFixed[j * X + i + 1], i < W - 1, c + 1); reach(vFixed[c], j > 0, c - W); reach(vFixed[c + W], j < H - 1, c + W);
    }
    region.volume = region.cells;
  }
  // The empty share of each liquid cell goes to an air region beside it.
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (!fluid[c] || solid[c]) continue;
    const capacity = PER_CELL * (room ? room[c] : 1), empty = 1 - cells[c] / capacity;
    if (!(empty > 0) || capacity < PER_CELL / 2) continue;
    const r = i > 0 && !uFixed[j * X + i] && label[c - 1] >= 0 ? label[c - 1] : i < W - 1 && !uFixed[j * X + i + 1] && label[c + 1] >= 0 ? label[c + 1]
      : j > 0 && !vFixed[c] && label[c - W] >= 0 ? label[c - W] : j < H - 1 && !vFixed[c + W] && label[c + W] >= 0 ? label[c + W] : -1;
    if (r >= 0) regions[r].volume += empty;
  }
  // What each region holds of the last step's air, by the cells they share: how many of each pocket's cells (`links`,
  // out of the `kept` cells of that pocket that are still air), how many that stood in open air (`fresh`), and whether
  // any of a region that has let its air go. The air it has drawn but not yet shown (`owed`, see DRAW) goes with it.
  const links = new Map(), from = regions.map(() => []), kept = new Float64Array(old.length), fresh = new Float64Array(regions.length);
  for (let c = 0; c < N; c++) {
    const r = label[c], q = before[c];
    if (r < 0 || q < 0 || !old[q]) continue;
    if (old[q].spent) regions[r].spent = true;
    if (old[q].open) fresh[r]++;
    if (!old[q].tracked) continue;
    const key = q * N + r, shared = links.get(key);
    if (shared === undefined) from[r].push(q);
    links.set(key, (shared ?? 0) + 1); kept[q]++;
  }
  // Its air rises as bubbles from the fullest liquid cell beside it, if that is at least half full; one with no liquid
  // around it (the last of a bottle draining) makes none.
  const release = (region, volume) => {
    region.spent = true;
    const e = region.edge;
    if (effect.air.bubbles && volume > 0.5 && e >= 0 && cells[e] >= PER_CELL / 2) air.release.push(e % W + 0.5, Math.floor(e / W) + 0.5, volume, 0);
  };
  old.forEach((q, n) => { if (q.tracked && !kept[n]) release(q, q.volume); });
  // Bubbles that gathered under a ceiling into a pocket's worth (see carvePocket) bring their air to the region their cells
  // are in now: a new pocket starts with it, one they joined adds it, and in open air it is gone (vented).
  const made = new Float64Array(regions.length);
  for (let k = 0; k < air.made.length; k += 2) { const r = label[air.made[k]]; if (r >= 0) made[r] += air.made[k + 1]; }
  air.made.length = 0;
  regions.forEach((region, r) => {
    if (region.open) return;
    if (from[r].length) {
      for (const q of from[r]) { const share = links.get(q * N + r) / kept[q]; region.air += old[q].air * share; region.owed += old[q].owed * share; }
      region.air += made[r] + fresh[r];
      region.tracked = true;
    } else if (made[r]) { region.air = made[r]; region.tracked = true; }
    else if (region.volume >= POCKET_START) { region.air = region.volume; region.tracked = true; }
    else if (region.volume >= POCKET_END && !region.spent) release(region, region.volume);
    if (region.tracked && region.volume < POCKET_END) { release(region, region.volume); region.tracked = false; }
  });
  // Thin seals (see SEAL): the thinnest between each pair of regions, found from each air cell rightwards and downwards,
  // and then the air that passes, pair by pair in the order found. The open air gives and takes without changing.
  const stiffness = effect.air.stiffness, seals = new Map(), holds = r => regions[r].tracked || regions[r].open;
  const at = r => (regions[r].tracked ? stiffness * (regions[r].air / regions[r].volume - 1) : 0);
  for (let c = 0; c < N; c++) {
    const r = label[c];
    if (r < 0 || !holds(r)) continue;
    for (const down of [false, true]) {
      for (let d = c, thick = 0; thick <= SEAL;) {
        const i = d % W, j = (d - i) / W;
        if (down ? j === H - 1 || vFixed[d + W] : i === W - 1 || uFixed[j * X + i + 1]) break;
        d += down ? W : 1;
        if (solid[d]) break;
        const q = label[d];
        if (q < 0) { thick++; continue; }
        if (thick && q !== r && holds(q) && (regions[r].tracked || regions[q].tracked)) {
          const key = Math.min(r, q) * regions.length + Math.max(r, q);
          if (!(seals.get(key) <= thick)) seals.set(key, thick);
        }
        break;
      }
    }
  }
  for (const [key, thick] of seals) {
    const b = key % regions.length, a = (key - b) / regions.length;
    const gap = at(a) - at(b);
    if (Math.abs(gap) <= thick) continue;
    const from = regions[gap > 0 ? a : b], to = regions[gap > 0 ? b : a];
    const passes = (Math.abs(gap) - thick) / (stiffness * ((from.tracked ? 1 / from.volume : 0) + (to.tracked ? 1 / to.volume : 0)));
    if (from.tracked) from.air -= passes;
    if (to.tracked) to.air += passes;
  }
  // Drawn air (see DRAW): down each column from a pocket, along gravity, through liquid that is held to air that pulls
  // less; then way by way, in the order found. `head` is a pixel of depth in the solver's pressure.
  const [gx, gy] = effect.gravity, pull = Math.sqrt(gx * gx + gy * gy), head = dt * Math.max(0.05, pull);
  if (pull > 0) {
    const vertical = Math.abs(gy) >= Math.abs(gx), fall = vertical ? (gy > 0 ? W : -W) : gx > 0 ? 1 : -1, rise = effect.air.bubbles ? effect.air.bubbles.rise : null;
    const shut = d => { const i = d % W, j = (d - i) / W; return vertical ? (gy > 0 ? j === H - 1 || vFixed[d + W] : j === 0 || vFixed[d]) : gx > 0 ? i === W - 1 || uFixed[j * X + i + 1] : i === 0 || uFixed[j * X + i]; };
    // How fast the liquid in a cell ran along gravity at the end of the last step.
    const runs = d => { const i = d % W, j = (d - i) / W; return vertical ? 0.5 * (state.vOld[d] + state.vOld[d + W]) * Math.sign(gy) : 0.5 * (state.uOld[j * X + i] + state.uOld[j * X + i + 1]) * Math.sign(gx); };
    const ways = new Map();
    for (let c = 0; c < N; c++) {
      const r = label[c];
      if (r < 0 || !regions[r].tracked) continue;
      for (let d = c, thick = 0; !shut(d);) {
        d += fall;
        if (solid[d]) break;
        const q = label[d];
        if (q < 0) { thick++; continue; }
        const foot = d - fall, span = Math.min(HANG, thick - 1);
        if (thick && q !== r && holds(q) && (rise === null || runs(foot) < rise) && g.p[foot] - g.p[foot - fall * span] >= 0.5 * span * head) {
          const key = r * regions.length + q, way = ways.get(key);
          if (way) way.push(foot); else ways.set(key, [foot]);
        }
        break;
      }
    }
    for (const [key, feet] of ways) {
      const q = key % regions.length, r = (key - q) / regions.length, upper = regions[r], lower = regions[q], gap = at(q) - at(r), w = feet.length;
      if (!(gap > 0)) continue;
      let passes = Math.min(DRAW * w * Math.sqrt(pull * w) * dt, gap / (stiffness * (1 / upper.volume + (lower.tracked ? 1 / lower.volume : 0))));
      if (lower.tracked) { passes = Math.min(passes, lower.air / 2); lower.air -= passes; }
      upper.air += passes;
      if (!effect.air.bubbles) continue;
      upper.owed += passes;
      if (upper.owed < GULP) continue;
      air.turn = ((air.turn ?? 0) + 1) % 1024;
      const e = feet[(7 * air.turn) % w];
      air.release.push(e % W + 0.5, Math.floor(e / W) + 0.5, upper.owed, 1);
      upper.owed = 0;
    }
  }
  // The gas law, in pixels of head, scaled to the solver's pressure (gravity × depth per step): Pn now and its slope P'.
  // A pocket inside the law's range is an unknown of the solve (see projectLiquid); one squeezed or stretched past four
  // times pushes no harder and holds that pressure, so a nearly closed pocket cannot fling the liquid.
  const index = regions.map(() => -1), Pn = [], C = [];
  pressure.fill(0);
  regions.forEach((region, r) => {
    if (!region.tracked) return;
    const ratio = region.air / region.volume;
    if (ratio > 0.25 && ratio < 4) { index[r] = Pn.length; Pn.push(stiffness * (ratio - 1) * head); C.push(region.volume / (stiffness * ratio * head * dt)); return; }
    const held = stiffness * (Math.min(4, Math.max(0.25, ratio)) - 1) * head;
    for (let c = 0; c < N; c++) if (label[c] === r) pressure[c] = held;
  });
  const node = air.node ??= new Int32Array(N);
  for (let c = 0; c < N; c++) node[c] = label[c] >= 0 ? index[label[c]] : -1;
  g.pockets = Pn.length ? { node, Pn: Float64Array.from(Pn), C: Float64Array.from(C) } : null;
  air.regions = regions;
  return pressure;
}
export function liquidFields(state, out) {
  const { g, splat: count, blur, speedSum } = state, { W, H, pixels: solid, geo } = g, [density, , speed] = out, frozen = state.heat ? state.frozen : null;
  count.fill(0); speedSum.fill(0);
  for (let k = 0; k < state.n; k++) {
    // Ice is drawn by its own look (see heatFields).
    if (frozen && frozen[k]) continue;
    const x = state.x[k], y = state.y[k], value = Math.sqrt(state.vx[k] * state.vx[k] + state.vy[k] * state.vy[k]);
    splatOpen(speedSum, count, W, H, x, y, value, solid, geo);
  }
  // A light 3 × 3 blur over the open cells turns particles into a continuous surface. Obstacle pixels hold no water and
  // take no part, so a wall thins neither the water beside it nor a pocket walled in on three sides (past a smooth
  // obstacle, a dry cell also skips a corner inside its outline).
  const across = geo ? geo.across : null;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const wet = count[j * W + i] > 0;
    let sum = 0, weights = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= W || y >= H || solid[y * W + x]) continue;
      if (across && !wet && di && dj && (across[j * W + i] & (dj < 0 ? (di < 0 ? TL : TR) : di < 0 ? BL : BR))) continue;
      const w = (di ? 1 : 2) * (dj ? 1 : 2);
      sum += count[y * W + x] * w; weights += w;
    }
    blur[j * W + i] = weights ? sum / weights : 0;
  }
  // Speed only counts where there is some water (a quarter of a full cell), so a thin, fast stream or a falling drop
  // can be drawn by its speed without a halo around every particle.
  for (let c = 0; c < g.N; c++) { density[c] = solid[c] ? 0 : blur[c] / PER_CELL; speed[c] = count[c] > 0 && density[c] >= 0.25 ? speedSum[c] / count[c] : 0; }
  if (state.strands) strandField(state, density, out[3]);
}

// Strands: liquid stretched thinner than the density can draw. The blur spreads a string one particle wide over three
// pixels, so it falls below LEVEL and vanishes long before it breaks. The strand field is 1 along a one-pixel path
// through the cells that hold particles but not enough density: a path joining two separate pieces of drawn liquid (a
// string between a spoon and a pool), or one hanging at least STRAND_REACH pixels off one piece (what is left of a string
// that has snapped). Shorter nubs and fringes on a surface, and particles loose in the air, are not strands, so a
// surface is neither thickened nor dusted with stray pixels. 0 elsewhere. Paths step to all eight neighbours, straight
// steps first, and are as short as the particles allow, so a string is drawn without doubled corners.
const STRAND_REACH = 3;
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
function strandField(state, density, out) {
  const { g } = state, { W, H, N, pixels: solid } = g;
  const s = state.strandScratch ??= { count: new Uint16Array(N), body: new Int32Array(N), part: new Int32Array(N), dist: new Int32Array(N), from: new Int32Array(N), queue: new Int32Array(N) };
  const { count, body, part, dist, from, queue } = s;
  out.fill(0); count.fill(0); body.fill(-1); part.fill(-1);
  for (let k = 0; k < state.n; k++) { const i = Math.floor(state.x[k]), j = Math.floor(state.y[k]); if (i >= 0 && j >= 0 && i < W && j < H) count[j * W + i]++; }
  const drawn = c => !solid[c] && density[c] >= LEVEL, loose = c => !solid[c] && density[c] < LEVEL && count[c] > 0;
  // Each cell's neighbours, with -1 off the canvas.
  const next = (c, d) => { const i = c % W + AROUND[d][0], j = (c - c % W) / W + AROUND[d][1]; return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  // Pieces of drawn liquid, then of loose cells, each labelled through its eight neighbours.
  const label = (is, into) => {
    let pieces = 0;
    for (let c = 0; c < N; c++) {
      if (into[c] >= 0 || !is(c)) continue;
      let head = 0, tail = 0;
      into[c] = pieces; queue[tail++] = c;
      while (head < tail) { const a = queue[head++]; for (let d = 0; d < 8; d++) { const b = next(a, d); if (b >= 0 && into[b] < 0 && is(b)) { into[b] = pieces; queue[tail++] = b; } } }
      pieces++;
    }
    return pieces;
  };
  label(drawn, body);
  const pieces = label(loose, part);
  // Gathers each loose piece's cells (in scan order) and the drawn pieces beside them.
  const cells = Array.from({ length: pieces }, () => []);
  for (let c = 0; c < N; c++) if (part[c] >= 0) cells[part[c]].push(c);
  const touching = (c, out) => { for (let d = 0; d < 8; d++) { const b = next(c, d); if (b >= 0 && body[b] >= 0 && !out.includes(body[b])) out.push(body[b]); } return out; };
  // Breadth-first distances through one loose piece from the cells `start` accepts; returns the cells in reach order.
  const spread = (list, start) => {
    let head = 0, tail = 0;
    for (const c of list) { dist[c] = -1; from[c] = -1; }
    for (const c of list) if (start(c)) { dist[c] = 0; queue[tail++] = c; }
    while (head < tail) { const a = queue[head++]; for (let d = 0; d < 8; d++) { const b = next(a, d); if (b >= 0 && part[b] === part[a] && dist[b] < 0) { dist[b] = dist[a] + 1; from[b] = a; queue[tail++] = b; } } }
    return queue.slice(0, tail);
  };
  const mark = c => { for (let a = c; a >= 0; a = from[a]) out[a] = 1; };
  for (const list of cells) {
    const near = new Map();
    for (const c of list) near.set(c, touching(c, []));
    const bodies = [];
    for (const c of list) for (const b of near.get(c)) if (!bodies.includes(b)) bodies.push(b);
    if (bodies.length >= 2) {
      // A bridge: the shortest path from the first piece to each of the others.
      spread(list, c => near.get(c).includes(bodies[0]));
      for (const other of bodies.slice(1)) {
        let end = -1;
        for (const c of list) if (dist[c] >= 0 && near.get(c).includes(other) && (end < 0 || dist[c] < dist[end])) end = c;
        if (end >= 0) mark(end);
      }
    } else if (bodies.length === 1) {
      // A hanging thread: the path to its far end, if it reaches far enough.
      const order = spread(list, c => near.get(c).length > 0), end = order.at(-1);
      if (dist[end] + 1 >= STRAND_REACH) mark(end);
    }
  }
}


// ---- Sparks -----------------------------------------------------------------------------------------------------------
// Single pixels carried by the flow: embers, sparkles, debris, bubbles. A looping effect spawns them during the
// recorded cycle only (bubbles that push the water from its warm-up on, see pushesWater) and draws the part of a life that
// runs past the end at the start, so they loop exactly. `born`, in a loop, is the frame such a bubble is born on.
export function spawnSparks(list, e, index, cycle, here, seed, total, born) {
  // The count follows the emitter's pulse and flicker, rounded up or down by a seeded draw.
  const s = e.sparks, n = Math.floor(s.count * here.flicker(here.x, here.y) / e.strength + random(seed, index, cycle, SALT.sparks));
  for (let k = 0; k < n; k++) {
    if (total.alive >= LIMITS.sparks) return false;
    const r = salt => random(seed, index, cycle, k, salt);
    let x = here.x, y = here.y;
    if (e.radius !== null) { const d = e.radius * Math.sqrt(r(SALT.sparkX)), a = 360 * r(SALT.sparkY); x += d * cosDeg(a); y += d * sinDeg(a); }
    else { x += (r(SALT.sparkX) - 0.5) * e.area[0]; y += (r(SALT.sparkY) - 0.5) * e.area[1]; }
    const angle = pick(s.angle, r(SALT.angle)), speed = pick(s.speed, r(SALT.speed));
    list.push({ s, x, y, vx: cosDeg(angle) * speed, vy: sinDeg(angle) * speed, age: 0, life: pickWhole(s.life, r(SALT.life)), ...(s.rise !== null && bubbleOf(s, r)), ...(s.rise !== null && born !== undefined && { born }) });
    total.alive++; total.spawned++;
  }
  return true;
}
// In a liquid, spray (sparks that ignore the flow) that has left the water ends where it falls back in, and a bubble
// that leaves it pops: it is drawn as a ring for one frame and as two droplets the next.
const sparkColor = p => p.s.colors[Math.min(p.s.colors.length - 1, Math.floor(p.age * p.s.colors.length / p.life))].charCodeAt(0);
// `gravity` is a liquid's gravity this frame (keys change it), which whitewater and droplets without their own follow.
export function moveSparks(list, g, density, total, liquid, pops, gravity, ended, gather) {
  const { W, H, u, v, pixels: solid } = g;
  let waiting = false;
  for (let k = list.length - 1; k >= 0; k--) {
    const p = list[k], s = p.s;
    p.age++;
    let fx = s.follow ? sampleU(g, u, p.x, p.y) * s.follow : 0, fy = s.follow ? sampleV(g, v, p.x, p.y) * s.follow : 0;
    if (s.rise !== null) {
      if (moveBubble(p, g, density, gravity, fx, fy, pops)) waiting ||= p.under; else { if (ended) ended(p); list.splice(k, 1); total.alive--; }
      continue;
    }
    // A liquid's grid holds no flow out in the air (no air is simulated), so a spark riding it would hang where it left
    // the water. Once out, an emitter's spark keeps the flow's velocity as its own and flies on as a droplet: it falls,
    // and ends where it falls back in, as spray does.
    if (s.fling && s.follow && !p.flung) {
      const ci = Math.floor(p.x), cj = Math.floor(p.y);
      // Out means no water at all here, not merely too little to draw: a thin, fast stream still carries its foam.
      if (ci >= 0 && cj >= 0 && ci < W && cj < H && !(density[cj * W + ci] > 0)) { p.vx += fx; p.vy += fy; p.flung = true; p.out = true; }
    }
    if (p.flung) { fx = 0; fy = 0; }
    const fall = gravity && s.inherit && (p.flung || !s.fling) ? gravity : s.gravity;
    p.vx = (p.vx + fall[0]) * (1 - s.drag); p.vy = (p.vy + fall[1]) * (1 - s.drag);
    p.px = p.x; p.py = p.y; p.x += fx + p.vx; p.y += fy + p.vy;
    const i = Math.floor(p.x), j = Math.floor(p.y), inside = i >= 0 && j >= 0 && i < W && j < H, wet = liquid && inside && density[j * W + i] >= LEVEL;
    // A spark that meets an obstacle anywhere along this frame's path ends there, not only one that lands inside it.
    const finite = Number.isFinite(p.x + p.y), hit = finite && crossesSolid(solid, W, H, p.px, p.py, p.x, p.y);
    const popped = s.pop && !wet && finite && !hit;
    // Whitewater foam rides the surface: it ends once the flow has carried it under, with water on every side, or once
    // it is lifted off into the air, with no water beside it.
    const dry = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !solid[y * W + x] && density[y * W + x] < LEVEL;
    const soaked = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !solid[y * W + x] && density[y * W + x] >= LEVEL;
    const sunk = p.foam && (wet ? !dry(i - 1, j) && !dry(i + 1, j) && !dry(i, j - 1) && !dry(i, j + 1) : !soaked(i - 1, j) && !soaked(i + 1, j) && !soaked(i, j - 1) && !soaked(i, j + 1));
    if (popped) pops.push({ x: p.x, y: p.y, size: s.size, code: sparkColor(p), age: 0 });
    // Spray still in the air when its life runs out flies on, for up to its life again, until it falls back in, hits
    // something or leaves the canvas, so a droplet never vanishes in mid-air.
    const spent = p.age >= (liquid && !s.follow && p.out && !wet ? 2 * p.life : p.life);
    if (spent || !finite || hit || popped || (wet && p.out) || sunk || p.x < -16 || p.y < -16 || p.x > W + 16 || p.y > H + 16) { list.splice(k, 1); total.alive--; }
    else if (liquid && inside && !wet && !s.follow) p.out = true;
  }
  if (waiting) mergeBubbles(list, g, total, gather);
}

// ---- Bubbles ----------------------------------------------------------------------------------------------------------
// A bubble's state: how much air it holds (in square pixels, so its size is the square root, 1 to 3 pixels across) and
// where its sway starts.
function bubbleOf(s, r) {
  return { vol: s.size * s.size, size: s.size, phase: s.wobble ? 360 * r(SALT.wobble) : 0, under: false };
}
// Makes a bubble at (x, y), at rest in the water, in `list` (a run's sparks, counted in `total`, its totals): `s` are its
// settings (as readSparks reads them, with rise), `r` a seeded draw for its life and sway, and `extra` fields of the
// caller's own, such as another amount of air (`vol` and `size`) or a boil's vapour. Every stage that makes bubbles goes
// through it. Returns false, adding nothing, at the spark limit. When a bubble ends, moveSparks hands it to its `ended`
// hook with `end` set: 'air' where it reached the air (above water, or in a pocket), 'life', 'solid' or 'edge'.
export function addBubble(list, total, s, x, y, r, extra) {
  if (total.alive >= LIMITS.sparks) return false;
  list.push({ s, x, y, vx: 0, vy: 0, age: 0, life: pickWhole(s.life, r(SALT.life)), ...bubbleOf(s, r), ...extra });
  total.alive++; total.spawned++;
  return true;
}
// How far along a ceiling a bubble looks for a way up, in pixels, and how many degrees its sway turns each frame (a sway
// every eight frames).
const BUBBLE_REACH = 5, SWAY = 45;
export const bubbleSize = vol => Math.min(3, Math.floor(Math.sqrt(vol) + 0.5));
// Whether a bubble of `size` centred at (x, y) lies in open cells: no obstacle pixel under it, and nothing past a closed edge.
function bubbleFits(g, x, y, size) {
  const { W, H, pixels: solid, walls } = g, half = (size - 1) / 2, x0 = Math.floor(x - half), y0 = Math.floor(y - half);
  for (let j = y0; j < y0 + size; j++) for (let i = x0; i < x0 + size; i++) {
    if (i < 0 ? walls.left : i >= W ? walls.right : j < 0 ? walls.top : j >= H ? walls.bottom : solid[j * W + i]) return false;
  }
  return true;
}
// Air in the water. A bubble rises against the liquid's gravity at `rise` pixels per frame relative to the water, so it
// rises steadily through still water and the currents carry it (`follow`); what is left of its launch speed fades by
// `drag`, and `wobble` sways it from side to side. It never enters an obstacle or a closed edge: it keeps the part of its
// move that is free, sliding along whatever stops it, and under a ceiling it slides toward the nearest way up within
// BUBBLE_REACH pixels (up a slope, out from under a ledge) or waits there, where bubbles that touch merge. It ends where it
// reaches the air (bursting, with `pop`), at the end of its life, or off the canvas. Returns whether it lives on.
function moveBubble(p, g, density, gravity, fx, fy, pops) {
  const s = p.s, { W, H, pixels: solid } = g, ci = Math.floor(p.x), cj = Math.floor(p.y);
  const gx = gravity ? gravity[0] : 0, gy = gravity ? gravity[1] : 0, pull = Math.sqrt(gx * gx + gy * gy), ux = pull ? -gx / pull : 0, uy = pull ? -gy / pull : 0;
  // A solid that has moved onto it (a ledge coming down, drifting ice) pushes it out to the nearest open spot below or
  // beside it, within two pixels; with none, or where it was born inside one, the solid takes it.
  if (ci >= 0 && cj >= 0 && ci < W && cj < H && solid[cj * W + ci]) {
    const vertical = Math.abs(uy) >= Math.abs(ux), [bx, by] = vertical ? [0, -Math.sign(uy)] : [-Math.sign(ux), 0], [sx, sy] = vertical ? [1, 0] : [0, 1];
    let out = null;
    for (let d = 1; d <= 2 && !out && p.age > 1; d++) for (const [ox, oy] of [[bx * d, by * d], [sx * d, sy * d], [-sx * d, -sy * d]]) {
      if (!bubbleFits(g, p.x + ox, p.y + oy, p.size)) continue;
      out = [ox, oy];
      break;
    }
    if (!out) { p.end = 'solid'; return false; }
    p.x += out[0]; p.y += out[1];
  }
  const x = p.x, y = p.y;
  p.vx = (p.vx + s.gravity[0]) * (1 - s.drag); p.vy = (p.vy + s.gravity[1]) * (1 - s.drag);
  const sway = s.wobble ? s.wobble * (sinDeg(p.phase + SWAY * p.age) - sinDeg(p.phase + SWAY * (p.age - 1))) : 0;
  const size = p.size, clear = (x0, y0, x1, y1) => bubbleFits(g, x1, y1, size) && !crossesSolid(solid, W, H, x0, y0, x1, y1);
  let nx = x + fx + p.vx + s.rise * ux - sway * uy, ny = y + fy + p.vy + s.rise * uy + sway * ux;
  p.px = x; p.py = y;
  if (!Number.isFinite(nx + ny)) { p.end = 'edge'; return false; }
  if (!clear(x, y, nx, ny)) {
    if (clear(x, y, nx, y)) { ny = y; p.vy = 0; } else if (clear(x, y, x, ny)) { nx = x; p.vx = 0; } else { nx = x; ny = y; p.vx = 0; p.vy = 0; }
  }
  // Up is the axis nearest against gravity; across is the other one.
  const vertical = Math.abs(uy) >= Math.abs(ux), ax = vertical ? 0 : Math.sign(ux), ay = vertical ? Math.sign(uy) : 0, bx = vertical ? 1 : 0, by = vertical ? 0 : 1;
  p.under = s.rise > 0 && pull > 0 && !bubbleFits(g, nx + ax, ny + ay, size);
  if (p.under) {
    // The nearest place along the ceiling, within reach along a free path, where the way up is open: the higher side of a
    // slope, or the edge of a ledge. Where both sides are as near, the side of its cell the bubble is on.
    let best = 0;
    for (let d = 1; d <= BUBBLE_REACH && !best; d++) {
      const open = side => clear(nx, ny, nx + side * d * bx, ny + side * d * by) && bubbleFits(g, nx + side * d * bx + ax, ny + side * d * by + ay, size);
      const left = open(-1), right = open(1);
      if (left && right) best = (vertical ? nx - Math.floor(nx) : ny - Math.floor(ny)) < 0.5 ? -d : d;
      else if (left) best = -d;
      else if (right) best = d;
    }
    if (best) {
      const step = Math.min(Math.abs(best), s.rise) * Math.sign(best), tx = nx + step * bx, ty = ny + step * by;
      if (clear(nx, ny, tx, ty)) { nx = tx; ny = ty; }
    }
  }
  p.x = nx; p.y = ny;
  const i = Math.floor(nx), j = Math.floor(ny), inside = i >= 0 && j >= 0 && i < W && j < H, wet = inside && density[j * W + i] >= LEVEL;
  if (p.fresh) p.fresh--;
  else if (!wet) {
    if (s.pop) pops.push({ x: nx, y: ny, size, code: sparkColor(p), age: 0, born: p.born });
    p.end = inside ? 'air' : 'edge';
    return false;
  }
  if (!inside) { p.end = 'edge'; return false; }
  if (p.age >= p.life) { p.end = 'life'; return false; }
  return true;
}
// Bubbles waiting under a ceiling that touch merge into one bubble holding the air of both, as large as that air, where
// their air was on average. A bubble holds at most twelve square pixels of air (it is drawn 3 pixels across from nine), so
// a merge past that waits, as does one that would not fit there. The merged bubble lives as long as the longer-lived of
// the two. With air pockets on, two that touch but cannot merge, holding GATHER square pixels of air or more between them,
// become a pocket instead (`gather`, see gatherOf), and both end: under a flat ceiling no bubble of three pixels fits, so
// bubbles there stop growing at six.
const GATHER = 8;
function mergeBubbles(list, g, total, gather) {
  const waiting = list.filter(p => p.under);
  for (let a = 0; a < waiting.length; a++) {
    const p = waiting[a];
    if (p.gone) continue;
    for (let b = a + 1; b < waiting.length; b++) {
      const q = waiting[b];
      if (q.gone) continue;
      const reach = (p.size + q.size) / 2, dx = q.x - p.x, dy = q.y - p.y;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const vol = p.vol + q.vol, size = bubbleSize(vol), mx = (p.x * p.vol + q.x * q.vol) / vol, my = (p.y * p.vol + q.y * q.vol) / vol;
      const [x, y] = q.s !== p.s || vol > 12 ? [null, null] : bubbleFits(g, mx, my, size) ? [mx, my] : bubbleFits(g, p.x, p.y, size) ? [p.x, p.y] : bubbleFits(g, q.x, q.y, size) ? [q.x, q.y] : [null, null];
      if (x === null) { if (gather && vol >= GATHER && gather(p, q)) { p.gone = q.gone = true; break; } continue; }
      p.vx = (p.vx * p.vol + q.vx * q.vol) / vol; p.vy = (p.vy * p.vol + q.vy * q.vol) / vol;
      if (q.life - q.age > p.life - p.age) { p.age = q.age; p.life = q.life; }
      p.x = x; p.y = y; p.vol = vol; p.size = size; q.gone = true;
      if (q.steam) p.steam = (p.steam ?? 0) + q.steam;
      if (q.passed) p.passed = (p.passed ?? 0) + q.passed;
      if (q.vol > p.vol - q.vol && q.born !== undefined) p.born = q.born;
    }
  }
  for (let k = list.length - 1; k >= 0; k--) if (list[k].gone) { list.splice(k, 1); total.alive--; }
}

// Whitewater: each particle at the surface (in the air, or in a cell with air beside it) whose velocity changed by at
// least `impact` this frame throws spray along that change, or one moving at `speed` throws it along its own motion. The
// direction is tipped away from the water (down the density gradient) and turned by up to `spread` degrees, so spray
// leaves a landing outward and up and a stream sideways. Each qualifying particle throws with the layer's chance, a
// seeded draw keyed by the particle, so the same source throws the same droplets. Spray is drawn once it is out. A bubble
// layer (`rise`) picks particles in the body of the water instead, two cells from air every way, and leaves a bubble at
// rest in the water there: air a plunging stream or a landing drop has driven in, which the flow carries and which rises.
// `throws(layer)` says whether a layer throws this frame (a loop's warm-up makes only bubbles that push the water, see
// pushesWater), and `born`, in a loop, tags those bubbles with their frame.
export function throwWhitewater(state, effect, density, list, cycle, total, throws, born) {
  const { W, H, pixels: solid, geo } = state.g, air = (i, j) => i >= 0 && j >= 0 && i < W && j < H && !solid[j * W + i] && density[j * W + i] < LEVEL;
  const at = (i, j) => (i >= 0 && j >= 0 && i < W && j < H && !solid[j * W + i] ? density[j * W + i] : 0);
  const spray = effect.whitewater.some(w => w.rise === null && throws(w)), bubbles = effect.whitewater.some(w => w.rise !== null && throws(w));
  if (!spray && !bubbles) return true;
  for (let k = 0; k < state.n; k++) {
    const x = state.x[k], y = state.y[k], i = Math.floor(x), j = Math.floor(y);
    // Beside a smooth obstacle a particle may sit in the open corner of a step's pixel; spray starts only from open cells.
    if (geo && solid[j * W + i]) continue;
    const surface = air(i, j) || air(i - 1, j) || air(i + 1, j) || air(i, j - 1) || air(i, j + 1);
    if (surface ? !spray : !bubbles) continue;
    // Bubbles start in a body of water, two cells from air every way, not in a stream a few pixels thick.
    if (!surface && (air(i - 2, j) || air(i + 2, j) || air(i, j - 2) || air(i, j + 2))) continue;
    const vx = state.vx[k], vy = state.vy[k], dx = vx - state.pvx[k], dy = vy - state.pvy[k];
    const nx = at(i - 1, j) - at(i + 1, j), ny = at(i, j - 1) - at(i, j + 1), out = Math.sqrt(nx * nx + ny * ny);
    for (let layer = 0; layer < effect.whitewater.length; layer++) {
      const w = effect.whitewater[layer], [ax, ay] = w.impact !== null ? [dx, dy] : [vx, vy], amount = Math.sqrt(ax * ax + ay * ay);
      if ((w.rise !== null) === surface || amount < (w.impact ?? w.speed) || !throws(w)) continue;
      const r = salt => random(effect.seed, WHITEWATER + layer, cycle, state.id[k], salt);
      if (r(SALT.spawn) >= w.chance) continue;
      if (total.alive >= LIMITS.sparks) return false;
      if (w.rise !== null) {
        addBubble(list, total, w, x, y, r, born !== undefined && pushesWater(effect, w) ? { born } : null);
        continue;
      }
      let ux = ax / amount + (out ? nx / out : 0), uy = ay / amount + (out ? ny / out : 0);
      const tipped = Math.sqrt(ux * ux + uy * uy);
      if (tipped > 1e-6) { ux /= tipped; uy /= tipped; } else { ux = ax / amount; uy = ay / amount; }
      const turn = (2 * r(SALT.angle) - 1) * w.spread, c = cosDeg(turn), sn = sinDeg(turn), speed = amount * w.throw;
      list.push({ s: w, x, y, vx: (ux * c - uy * sn) * speed, vy: (ux * sn + uy * c) * speed, age: 0, life: pickWhole(w.life, r(SALT.life)), hide: !w.follow, foam: w.follow > 0 });
      total.alive++; total.spawned++;
    }
  }
  return true;
}

// Adds `amount` of air (square pixels at zero pressure) to the pocket at cell (i, j) or beside it, as the last step found
// them, and returns whether there was one: a bubble rising into a pocket, or vapour boiling into it, raises its pressure.
export function addAir(state, i, j, amount) {
  const { air, g } = state, { W, H } = g;
  for (const [x, y] of [[i, j], [i, j - 1], [i, j + 1], [i - 1, j], [i + 1, j]]) {
    const r = x >= 0 && y >= 0 && x < W && y < H ? air.label[y * W + x] : -1, region = r >= 0 ? air.regions[r] : null;
    if (region && region.tracked) { region.air += amount; return true; }
  }
  return false;
}
// A bubble that rises into a pocket gives it its air, less what a pocket has had of it already (`passed`: drawn air,
// see sealAir).
export const bubbleEnded = state => p => { if (p.end === 'air') addAir(state, Math.floor(p.x), Math.floor(p.y), p.vol - (p.passed ?? 0)); };
// With air pockets on, bubbles waiting under a ceiling that touch and hold more air together than a bubble can (see
// mergeBubbles) become a pocket there (physics-model.md section 7): carvePocket clears the cells under the ceiling for
// their air. A boil's bubbles, which carry vapour, stay bubbles. Null without pockets.
export const gatherOf = run => {
  const { state } = run;
  if (!state.air) return null;
  return (p, q) => !p.steam && !q.steam && !p.passed && !q.passed && carvePocket(state, run.gravity, (p.x * p.vol + q.x * q.vol) / (p.vol + q.vol), (p.y * p.vol + q.y * q.vol) / (p.vol + q.vol), p.vol + q.vol);
};
// Clears a pocket for `vol` square pixels of air at (x, y), under a ceiling: as many whole cells as the air fills, the
// highest first (against `gravity`, the nearest axis, as a bubble rises) and then the nearest along the ceiling, each
// beside one already taken, down to six cells below the start. The liquid in them moves along gravity, in its own
// column, to the first cell below that stays liquid, where it crowds the cells until the pressure spreads it: the water
// under the pocket gives way and rises elsewhere (a particle with only solid below stays, and the pocket is a cell
// smaller). The pocket's air reaches sealAir through `air.made`. Returns false, changing nothing, where there is not
// room for POCKET_START cells.
function carvePocket(state, gravity, x, y, vol) {
  const { g, air } = state, { W, H, N } = g, solid = g.solid, [gx, gy] = gravity, vertical = Math.abs(gy) >= Math.abs(gx);
  // Down along gravity, as a cell step, and across.
  const down = vertical ? (gy >= 0 ? W : -W) : gx >= 0 ? 1 : -1, i0 = Math.floor(x), j0 = Math.floor(y);
  if (i0 < 0 || j0 < 0 || i0 >= W || j0 >= H || solid[j0 * W + i0]) return false;
  const want = Math.max(POCKET_START, Math.round(vol)), take = air.carve ??= new Uint8Array(N), cells = [];
  // How far down along gravity a cell lies from the start, and how far across.
  const depth = c => { const i = c % W, j = (c - i) / W; return vertical ? (gy >= 0 ? j - j0 : j0 - j) : gx >= 0 ? i - i0 : i0 - i; };
  const across = c => { const i = c % W, j = (c - i) / W; return vertical ? Math.abs(i - i0) : Math.abs(j - j0); };
  const near = c => { const i = c % W; return [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c + W < N ? c + W : -1]; };
  let frontier = [j0 * W + i0];
  take[frontier[0]] = 2;
  while (cells.length < want && frontier.length) {
    let best = 0;
    for (let k = 1; k < frontier.length; k++) {
      const a = frontier[k], b = frontier[best], da = depth(a), db = depth(b);
      if (da < db || (da === db && (across(a) < across(b) || (across(a) === across(b) && a < b)))) best = k;
    }
    const c = frontier[best];
    frontier.splice(best, 1);
    take[c] = 1; cells.push(c);
    for (const d of near(c)) if (d >= 0 && !take[d] && !solid[d] && depth(d) <= depth(cells[0]) + 6) { take[d] = 2; frontier.push(d); }
  }
  const room = cells.length >= POCKET_START;
  for (const c of frontier) take[c] = 0;
  if (!room) { for (const c of cells) take[c] = 0; return false; }
  // Each particle in a cleared cell goes down its column to the first cell that stays liquid (not cleared, not solid).
  for (let k = 0; k < state.n; k++) {
    const i = Math.floor(state.x[k]), j = Math.floor(state.y[k]);
    if (i < 0 || j < 0 || i >= W || j >= H || take[j * W + i] !== 1) continue;
    let c = j * W + i, steps = 0;
    while (c >= 0 && c < N && take[c] === 1 && steps++ < H) { const next = c + down; if (next < 0 || next >= N || (!vertical && Math.floor(next / W) !== Math.floor(c / W))) { c = -1; break; } c = next; }
    if (c < 0 || c >= N || solid[c] || take[c]) continue;
    const ci = c % W, cj = (c - ci) / W;
    state.x[k] += ci - i; state.y[k] += cj - j;
  }
  for (const c of cells) take[c] = 0;
  air.made.push(cells[0], vol);
  return true;
}
// The air of pockets that this frame's steps let go rises as bubbles from where each pocket was: up to nine square pixels
// of air (a bubble 3 pixels across) each, side by side along the row, drawing from their own random stream. For its first
// two frames a bubble lives on where the gap it came from has not closed yet. `born` tags a loop's bubbles with their frame.
// `air.release` holds x, y, the air and whether a pocket has had that air already (drawn air, see sealAir) for each.
const POCKETS = 3000;
export function releaseAir(air, effect, list, cycle, total, born) {
  const s = effect.air.bubbles, out = air.release;
  for (let k = 0, n = 0; k < out.length; k += 4) {
    let volume = out[k + 2];
    for (let m = 0; volume > 0.5; m++, n++) {
      const vol = Math.min(9, volume), r = salt => random(effect.seed, POCKETS, cycle, n, salt);
      volume -= vol;
      if (!addBubble(list, total, s, out[k] + 3 * (m % 2 ? (m + 1) / 2 : -m / 2), out[k + 1], r, { vol, size: bubbleSize(vol), fresh: 2, ...(out[k + 3] && { passed: vol }), ...(born !== undefined && { born }) })) return false;
    }
  }
  out.length = 0;
  return true;
}
