// Heat conduction, melting/freezing, frost finger growth, ice settling and boiling/evaporating vapour for
// pixelforge-fluid liquids (docs/physics-model.md, sections 3, 4 and 9). Browser-compatible and deterministic.
import { random } from './craft.js';
import { stepElectric, electricFields, MATTER } from './electric.js';
import {
  PER_CELL, LEVEL, ICE,
  fixFaces, createGrid, smoothGeometry, enforce, advectScalars,
  SUPERCOOL, tempOf, energyOf, surfaceTemperatures, warmAir
} from './fluid-grid.js';
import { placementsAt, solidLayer } from './fluid-source.js';
import { SIDES, renderFields, hundredth } from './fluid-render.js';
import {
  deposit, stepGas, clingField, gripFields, carryFields, addParticle, removeParticle, seedCell,
  liquidFields, addBubble, addAir, bubbleEnded
} from './fluid-solvers.js';

// ---- Phase changes ----------------------------------------------------------------------------------------------------
// With `heat`, a liquid's particles carry heat and change phase (docs/physics-model.md, sections 3, 4 and 9), on the gas
// temperature scale: 0 is the room's air, water freezes at `freeze` (−0.5) and boils at `boil` (0.5). Each particle keeps
// its energy, which is its temperature plus its progress through a change: below `freeze` it is the temperature; at
// `freeze` the temperature holds while the energy climbs by `latent` (melting), then rises with it to `boil`, where it
// holds again while the energy climbs by `vaporize` (boiling). Ice melts only once it has taken up all of `latent` and
// water freezes only once it has given it up, so the plateau is the gap that keeps ice from flickering.
// Each step, before the liquid moves, heat flows between particles and their neighbours (`conduct`), from hot or cold
// obstacles (`contact`; an obstacle's `temperature` is a surface property of the solid layer) and between the surface
// and the air (`air`). Ice holds still or settles as a piece; a cell with ICE_CELL ice particles is ICE in the solid
// layer, so the pressure, viscosity and cling solves, air pockets and bubbles meet it as they meet an obstacle. With
// `vapour`, water that boils at the surface (or, with `evaporation`, a share of warm surface water) becomes vapour, which
// the gas step moves through the cells holding neither liquid nor ice, the liquid's cells walls moving with it; a boil
// inside the water makes bubbles (addBubble) that carry their vapour up. Vapour touching anything colder than `dew` beads
// up as dew and drips back; touching ice or an obstacle colder than `frost` it grows into ice; with `sublimate`, ice
// turns straight into vapour at its surface. Matter is kept exactly and counted each frame (see heatAmounts).
const PHASE = 3000, PHASE_SALT = { grain: 1, evaporate: 2, spawnX: 3, spawnY: 4, frost: 5, boil: 6, nucleus: 7, branch: 8, lean: 9, site: 10 }, ICE_CELL = Math.ceil(LEVEL * PER_CELL);
// Frost grows as fingers (see heatStep): the eight directions in turn round the compass, so two a step apart are 45
// degrees apart; the share of the cells beside a flat cold side a finger starts from, the chance a frame that one starts
// anywhere else beside it, and how far from other frost that may be; how readily a stem, a branch and a twig grow
// on (REACH, by generation), so branches stay shorter than their stem; how readily ice with no direction of its own (a
// cube, a frozen fill) and a frost cell that already holds frost take more.
const COMPASS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]], SITES = 0.04, NUCLEI = 0.003, SPACING = 5, REACH = [1, 0.35, 0.12], ROUND = 0.15, THICKEN = 0.04;
// A frost cell that has lost its ice (melted, sublimated, settled away, pushed off by an obstacle) forgets its finger, so
// the empty cell it leaves never goes on taking frost as a finger's tip would. A cell that has started taking frost and
// holds none yet keeps its direction until it does (`frostIce` notes the cells that have held frost).
function forgetFrost(P) {
  const dirs = P.frostDir;
  if (!dirs) return;
  const { ice, frostIce: had } = P;
  for (let c = 0; c < dirs.length; c++) {
    if (dirs[c] < 0) continue;
    if (ice[c]) had[c] = 1;
    else if (had[c]) { dirs[c] = -1; P.frostGen[c] = 0; P.frostLen[c] = 0; had[c] = 0; }
  }
}
export function createHeat(effect, grid) {
  const { W, H, N } = grid, h = effect.heat;
  const P = {
    heat: h, layout: effect.layout, base: effect.solid, places: placementsAt(effect.obstacles, 0), mask: grid.geo ? Uint8Array.from(effect.solid) : grid.solid,
    water: new Uint16Array(N), ice: new Uint16Array(N), sumT: new Float64Array(N), Tc: new Float64Array(N), flux: new Float64Array(N),
    obstacleT: new Float64Array(N), owner: Int16Array.from(effect.layout.owner), iceSpeed: new Float64Array(N), iceMoving: false, input: new Float64Array(N),
    pending: new Float64Array(N), frost: new Float64Array(N), escaped: 0, added: 0, removed: 0, converting: false, step: 0,
    spawnEnergy: energyOf(h, h.ambient, false), spawnFrozen: 0, vapour: null
  };
  P.iceHook = { moving: false, velocity: c => (P.iceSpeed[c] ? [0, P.iceSpeed[c]] : null) };
  if (effect.vapour) {
    const g = createGrid(W, H, Uint8Array.from(effect.solid), effect.walls);
    g.uWall = new Float64Array(g.u.length); g.vWall = new Float64Array(g.v.length);
    const f = () => new Float64Array(N);
    P.vapour = { g, d: f(), T: f().fill(h.ambient), d1: f(), T1: f(), source: f(), step: f(), curl: f(), magnitude: f(), open: new Uint8Array(N).fill(1), liquid: new Uint8Array(N), region: new Int32Array(N), closed: [], sums: [] };
    for (let c = 0; c < N; c++) if (effect.solid[c]) P.vapour.open[c] = 0;
    labelRegions(P.vapour, W, H, effect.walls);
  }
  return P;
}
// Each cell's water and ice particles and their mean temperature.
export function tally(state) {
  const P = state.heat, h = P.heat, { W, H, N } = state.g, { water, ice, sumT, Tc } = P;
  water.fill(0); ice.fill(0); sumT.fill(0);
  for (let k = 0; k < state.n; k++) {
    const i = Math.floor(state.x[k]), j = Math.floor(state.y[k]);
    if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const c = j * W + i;
    if (state.frozen[k]) ice[c]++; else water[c]++;
    sumT[c] += tempOf(h, state.energy[k], state.frozen[k]);
  }
  for (let c = 0; c < N; c++) { const n = water[c] + ice[c]; Tc[c] = n ? sumT[c] / n : 0; }
}
// The vapour's connected regions, and for each the number of its cells if it is closed on every side (0 if it reaches an
// open edge).
function labelRegions(V, W, H, walls) {
  const { open, region } = V, N = W * H, stack = [];
  region.fill(-1); V.closed = [];
  for (let c = 0; c < N; c++) {
    if (!open[c] || region[c] >= 0) continue;
    const r = V.closed.length;
    let leaks = false, cells = 0;
    region[c] = r; stack.push(c);
    while (stack.length) {
      const d = stack.pop(), i = d % W, j = (d - i) / W;
      cells++;
      if ((i === 0 && !walls.left) || (i === W - 1 && !walls.right) || (j === 0 && !walls.top) || (j === H - 1 && !walls.bottom)) leaks = true;
      for (const e of [i > 0 ? d - 1 : -1, i < W - 1 ? d + 1 : -1, j > 0 ? d - W : -1, j < H - 1 ? d + W : -1]) if (e >= 0 && open[e] && region[e] < 0) { region[e] = r; stack.push(e); }
    }
    V.closed.push(leaks ? 0 : cells);
  }
  V.sums = new Float64Array(V.closed.length);
}
// The solid layer after a step's changes: ICE joins the obstacles in the liquid's solid mask and owners, moving at its
// piece's speed while it settles, and what clings to solids reads the new layer. Beside smooth obstacles the grid's
// geometry is traced again from the obstacles' pixels and the ice's (ice meets the liquid pixel by pixel, so nothing is
// smoothed where it touches a smooth obstacle). `moved` says the obstacles have moved this frame (moveObstacles), and
// 'layout' that they cover other cells: the layer takes their places and velocities, and what clings reads it anew.
// Then the vapour's walls: those and the cells the liquid fills. Vapour in a cell that liquid, ice or an obstacle has
// taken moves to the open cells beside it.
export function heatMasks(state, effect, moved = false) {
  const P = state.heat, g = state.g, { W, H, N, walls } = g, { base, water, ice, owner, mask, layout } = P;
  let changed = false;
  for (let c = 0; c < N; c++) {
    const frozen = !base[c] && ice[c] >= ICE_CELL, s = base[c] || frozen ? 1 : 0;
    owner[c] = frozen ? ICE : layout.owner[c];
    if (s !== mask[c]) { mask[c] = s; changed = true; }
  }
  if (changed || moved === 'layout') {
    if (!layout.smooth) {
      // No smooth obstacle shows any more (one vanished on its keys, or left the canvas): the solver meets the pixels
      // again. (Left traced, the geometry of the smooth obstacle that had gone still held the water up, a ghost.)
      if (g.geo) { g.geo = null; g.solid = mask; g.pixels = mask; }
      fixFaces(W, H, mask, walls, g.uFixed, g.vFixed);
    } else {
      const geo = smoothGeometry(mask, layout.smooth, W, H, walls);
      for (let k = 0; k < g.uFixed.length; k++) g.uFixed[k] = geo.uOpen[k] ? 0 : 1;
      for (let k = 0; k < g.vFixed.length; k++) g.vFixed[k] = geo.vOpen[k] ? 0 : 1;
      g.geo = geo; g.solid = geo.solid; g.pixels = geo.pixels; g.weights ??= new Float64Array(N);
    }
  }
  const moving = P.iceMoving;
  if (changed || moved || moving || P.iceHook.moving) {
    P.iceHook.moving = moving;
    const solids = state.solids = solidLayer(effect, { solid: mask, owner }, P.places, W, H, P.iceHook);
    if (state.cling) { if (changed || moved === 'layout') { state.cling = clingField(solids); state.grip = gripFields(solids, effect.obstacles); } state.carry = carryFields(solids); }
    // Faces against moving obstacles and settling ice carry their speed.
    if (solids.moving || g.moved) {
      if (!g.uWall) { g.uWall = new Float64Array(g.u.length); g.vWall = new Float64Array(g.v.length); } else { g.uWall.fill(0); g.vWall.fill(0); }
      g.moved = false;
      const X = W + 1, of = c => (c >= 0 ? solids.velocity(c) : null);
      if (solids.moving) {
        for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) { const s = of(i > 0 ? j * W + i - 1 : -1) ?? of(i < W ? j * W + i : -1); if (s) { g.uWall[j * X + i] = s[0]; g.moved = true; } }
        for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, s = of(j > 0 ? k - W : -1) ?? of(j < H ? k : -1); if (s) { g.vWall[k] = s[1]; g.moved = true; } }
      }
      enforce(g);
    }
  }
  const V = P.vapour;
  if (!V) return;
  const vg = V.g, m = V.d;
  let walled = false;
  for (let c = 0; c < N; c++) {
    const taken = !base[c] && water[c] + ice[c] >= ICE_CELL;
    V.liquid[c] = taken && ice[c] < ICE_CELL ? 1 : 0;
    const s = base[c] || taken ? 1 : 0;
    if (s !== vg.solid[c]) { vg.solid[c] = s; V.open[c] = 1 - s; walled = true; }
  }
  if (!walled) return;
  fixFaces(W, H, vg.solid, walls, vg.uFixed, vg.vFixed);
  for (let c = 0; c < N; c++) {
    if (!vg.solid[c] || !(m[c] > 0)) continue;
    const i = c % W, j = (c - i) / W, near = [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1].filter(e => e >= 0 && V.open[e]);
    if (near.length) for (const e of near) m[e] += m[c] / near.length;
    else (ice[c] >= ICE_CELL ? P.frost : P.pending)[c] += m[c];
    m[c] = 0;
  }
  labelRegions(V, W, H, walls);
}
// A closed region of vapour can't take in more than it lets out: its sources are evened out against the flow through
// its walls (the liquid's surface moving), so the pressure solve has an answer.
function balance(V, g) {
  if (!V.closed.some(Boolean)) return;
  const { W, N, u, v } = g, X = W + 1, { region, closed, sums, step } = V;
  sums.fill(0);
  for (let c = 0; c < N; c++) { const r = region[c]; if (r < 0 || !closed[r]) continue; const i = c % W, j = (c - i) / W; sums[r] += u[j * X + i + 1] - u[j * X + i] + v[c + W] - v[c] - step[c]; }
  for (let c = 0; c < N; c++) { const r = region[c]; if (r >= 0 && closed[r]) step[c] += sums[r] / closed[r]; }
}
// One step of the vapour over the air cells, by the gas step with what differs for a liquid's air (physics-model.md,
// section 7): the liquid's cells are walls moving with it, up is against the liquid's gravity, buoyancy is relative to
// the air's temperature and weight to the room vapour fills, sources are what boiled off or condensed (evened out in a
// sealed region), and the vapour is matter, so advection keeps it: semi-Lagrangian advection neither keeps nor loses
// mass exactly, so the vapour is scaled back to what it held less what left through open edges.
export function stepVapour(state, effect, dt) {
  const P = state.heat, V = P.vapour, s = effect.vapour, h = effect.heat, g = V.g, L = state.g, { W, H, N, u, v, uFixed, vFixed, uWall, vWall } = g, X = W + 1, { d: m, T } = V;
  const scale = s.expansion / PER_CELL, { base, obstacleT, Tc } = P;
  // Faces against the liquid move with it, and those between a moving obstacle and the air with the obstacle.
  const lu = L.uWall, lv = L.vWall, edge = (a, b) => (base[a] && V.open[b]) || (base[b] && V.open[a]);
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) { const k = j * X + i, c = j * W + i; uWall[k] = !uFixed[k] ? 0 : (i > 0 && V.liquid[c - 1]) || (i < W && V.liquid[c]) ? L.u[k] : lu && i > 0 && i < W && edge(c - 1, c) ? lu[k] : 0; }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; vWall[k] = !vFixed[k] ? 0 : (j > 0 && V.liquid[k - W]) || (j < H && V.liquid[k]) ? L.v[k] : lv && j > 0 && j < H && edge(k - W, k) ? lv[k] : 0; }
  // Solid cells read as their own temperature (the liquid's, an obstacle's or the air's) and hold no vapour.
  for (let c = 0; c < N; c++) if (g.solid[c]) { m[c] = 0; T[c] = base[c] ? (obstacleT[c] === obstacleT[c] ? obstacleT[c] : h.ambient) : Tc[c]; }
  stepGas(V, s, dt, {
    forces() {
      const [gx, gy] = effect.gravity, pull = Math.sqrt(gx * gx + gy * gy), ux = pull ? -gx / pull : 0, uy = pull ? -gy / pull : 0;
      const lift = (a, b) => s.buoyancy * ((T[a] + T[b]) * 0.5 - h.ambient) - s.weight * (m[a] + m[b]) * 0.5 * scale;
      if ((s.buoyancy || s.weight) && uy) for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; v[k] += dt * uy * lift(k - W, k); }
      if ((s.buoyancy || s.weight) && ux) for (let j = 0; j < H; j++) for (let i = 1; i < W; i++) { const c = j * W + i; u[j * X + i] += dt * ux * lift(c - 1, c); }
    },
    sources() { V.step.set(V.source); balance(V, g); return V.step; },
    carry() {
      let before = 0, out = 0;
      for (let c = 0; c < N; c++) before += m[c];
      const { walls } = g;
      for (let j = 0; j < H; j++) { if (!walls.left && u[j * X] < 0) out -= m[j * W] * u[j * X] * dt; if (!walls.right && u[j * X + W] > 0) out += m[j * W + W - 1] * u[j * X + W] * dt; }
      for (let i = 0; i < W; i++) { if (!walls.top && v[i] < 0) out -= m[i] * v[i] * dt; if (!walls.bottom && v[H * W + i] > 0) out += m[(H - 1) * W + i] * v[H * W + i] * dt; }
      advectScalars(g, dt, [[m, V.d1], [T, V.T1]], false);
      let after = 0;
      for (let c = 0; c < N; c++) after += V.d1[c];
      const keep = before - out > 0 ? before - out : 0, ratio = after > 0 ? keep / after : 0;
      P.escaped += before - (after > 0 ? keep : 0);
      for (let c = 0; c < N; c++) { m[c] = V.d1[c] * ratio; T[c] = g.solid[c] ? T[c] : V.T1[c]; }
      // Spread: vapour diffuses between open neighbours (pairwise, so none is made or lost).
      if (s.spread) {
        const next = V.d1, rate = s.spread * dt;
        next.set(m);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          const c = j * W + i;
          if (!V.open[c]) continue;
          if (i < W - 1 && V.open[c + 1]) { const f = rate * (m[c] - m[c + 1]); next[c] -= f; next[c + 1] += f; }
          if (j < H - 1 && V.open[c + W]) { const f = rate * (m[c] - m[c + W]); next[c] -= f; next[c + W] += f; }
        }
        m.set(next);
      }
      // The air drifts back toward the room's temperature, and faded vapour leaves the books.
      const cool = 1 - s.cooling * dt, fade = 1 - s.dissipation * dt;
      for (let c = 0; c < N; c++) {
        if (!V.open[c]) continue;
        T[c] = h.ambient + (T[c] - h.ambient) * cool;
        if (s.dissipation) { P.escaped += m[c] * (1 - fade); m[c] *= fade; }
      }
    }
  });
}
// Vapour leaving water or ice: `amount` particles' worth into `cell` (or out through an open edge, -1), at temperature
// t. It fills `expansion` / PER_CELL cells per particle at its own temperature, which it shares with the air in its cell,
// and pushes the air out of its way over this step; boiled into a sealed air pocket, it adds to the pocket's air.
function ventVapour(state, effect, cell, amount, t, dt) {
  const P = state.heat;
  if (cell < 0) { P.escaped += amount; return; }
  const V = P.vapour, scale = effect.vapour.expansion / PER_CELL, W = V.g.W;
  V.T[cell] = (V.T[cell] + scale * amount * t) / (1 + scale * amount); V.d[cell] += amount; V.source[cell] += scale * amount / dt;
  if (state.air) addAir(state, cell % W, Math.floor(cell / W), scale * amount);
}
// A boil bubble that ends hands its vapour on: where it reached the air, to the vapour there (or in the open cell beside
// it); off the canvas, out of the books; anywhere else (its life over, or taken by a solid), back to the water there.
function ventBubble(run, p) {
  const { state, effect } = run, P = state.heat, V = P.vapour, { W, H } = V.g, i = Math.floor(p.x), j = Math.floor(p.y);
  if (p.end === 'edge' || i < 0 || j < 0 || i >= W || j >= H) { P.escaped += p.steam; return; }
  const c = j * W + i, near = p.end === 'air' ? [c, j > 0 ? c - W : -1, i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1].find(e => e >= 0 && V.open[e]) : undefined;
  if (near !== undefined) ventVapour(state, effect, near, p.steam, P.heat.boil, 1 / effect.substeps);
  else if (!P.base[c]) P.pending[c] += p.steam;
  else P.escaped += p.steam;
}
// What happens to a bubble that ends: a boil bubble lets its vapour out (ventBubble), and with air pockets any other one
// gives its air to the pocket it rises into. Null when nothing needs to know.
export const endedOf = run => {
  const { state } = run, pockets = state.air ? bubbleEnded(state) : null, steam = state.heat && state.heat.vapour;
  if (!pockets && !steam) return null;
  return p => { if (p.steam && steam) ventBubble(run, p); else if (pockets) pockets(p); };
};
// Electricity over a liquid (stage 3 of physics-model.md section 11, before heat): the electric layer solves through the
// air, the vapour's gas, whose flow carries the plasma and whose temperature its current heats, and through the water and
// ice, cells holding ICE_CELL particles or more, as they stood after the last step. The Joule heat of the water's and ice's
// cells goes into every particle there through `input`, so an arc that strikes the water boils it where it lands.
export function electricStep(state, effect, dt) {
  const P = state.heat, E = state.electric, { N } = state.g, { water, ice, input } = P, base = P.base, matter = P.matter ??= new Uint8Array(N);
  for (let c = 0; c < N; c++) matter[c] = base[c] || water[c] + ice[c] < ICE_CELL ? 0 : ice[c] >= ICE_CELL ? MATTER.ice : MATTER.water;
  input.fill(0);
  stepElectric(E, P.vapour, effect, dt, { matter, warm: (c, heat) => { input[c] += heat; } });
}
// Each step, before the liquid moves (physics-model.md, section 11): heat flows, particles change phase, vapour condenses
// or deposits, and the solid layer follows; on a frame's first step, unheld ice settles. Rates are per frame, scaled by
// the step. `effect` carries this frame's keyed settings (gravity).
export function heatStep(run, effect, dt, first) {
  const { state } = run, P = state.heat, h = P.heat, g = state.g, { W, H, N, walls } = g, { base, water, ice, Tc, obstacleT, flux } = P, V = P.vapour;
  const { energy, frozen } = state, seed = effect.seed, step = P.step++;
  surfaceTemperatures(state.solids, obstacleT);
  tally(state);
  forgetFrost(P);
  // Heat flows (each coefficient at most 0.2 a frame, so no particle overshoots its neighbours).
  const closedAt = (x, y) => (x < 0 ? walls.left : x >= W ? walls.right : y < 0 ? walls.top : walls.bottom);
  flux.fill(0);
  for (let k = 0; k < state.n; k++) {
    const i = Math.floor(state.x[k]), j = Math.floor(state.y[k]), c = j * W + i, t = tempOf(h, energy[k], frozen[k]);
    // `input` is heat another stage puts into the water and ice of a cell, per frame: the electric step's Joule heat
    // from an arc that reaches the water (physics-model.md section 10), and zero without one.
    let gain = h.conduct * (Tc[c] - t) + P.input[c];
    // A particle in the open corner of a smooth obstacle's pixel touches that obstacle.
    if (base[c] && obstacleT[c] === obstacleT[c]) gain += h.contact * (obstacleT[c] - t);
    for (const [di, dj] of SIDES) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= W || y >= H) { if (!closedAt(x, y)) gain += h.air * (h.ambient - t); continue; }
      const n = y * W + x;
      if (base[n]) { if (obstacleT[n] === obstacleT[n]) gain += h.contact * (obstacleT[n] - t); } else if (water[n] + ice[n]) gain += h.conduct * (Tc[n] - t);
      else { const q = h.air * ((V ? V.T[n] : h.ambient) - t); gain += q; flux[n] -= q; }
    }
    energy[k] += gain * dt;
  }
  // The air takes the heat the surface gave it, and hot or cold obstacles warm or chill the air beside them.
  if (V) { for (let c = 0; c < N; c++) if (V.open[c]) V.T[c] += flux[c] * dt; warmAir(V.T, V.open, obstacleT, W, H, h.contact * dt); }
  // Where vapour leaves a particle: the open cell above it (against gravity), beside it or below it, or its own.
  const [gx, gy] = effect.gravity, vertical = Math.abs(gy) >= Math.abs(gx), up = vertical ? [0, gy > 0 ? -1 : 1] : [gx > 0 ? -1 : 1, 0];
  const order = [up, [up[1], up[0]], [-up[1], -up[0]], [-up[0], -up[1]]];
  const airAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? !closedAt(x, y) : !base[y * W + x] && water[y * W + x] + ice[y * W + x] < ICE_CELL);
  const surface = (i, j) => water[j * W + i] + ice[j * W + i] < ICE_CELL || airAt(i - 1, j) || airAt(i + 1, j) || airAt(i, j - 1) || airAt(i, j + 1);
  const vent = (i, j) => {
    for (const [di, dj] of order) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= W || y >= H) { if (!closedAt(x, y)) return -1; continue; }
      if (V.open[y * W + x]) return y * W + x;
    }
    return V.open[j * W + i] ? j * W + i : -2;
  };
  if (V) V.source.fill(0);
  P.converting = true;
  const top = h.boil + h.latent + h.vaporize, dry = h.freeze + h.latent + h.vaporize, bubbles = V && effect.vapour.bubbles;
  for (let k = state.n - 1; k >= 0; k--) {
    const e = energy[k], i = Math.floor(state.x[k]), j = Math.floor(state.y[k]);
    if (frozen[k]) {
      if (!h.sublimate) { if (e >= h.freeze + h.latent) { frozen[k] = 0; state.fall[k] = 0; } continue; }
      // Sublimating ice waits at its freezing point for the heat of melting and boiling both, then leaves its surface.
      if (e < dry) continue;
      const to = surface(i, j) ? vent(i, j) : -2;
      if (to === -2) { energy[k] = dry; continue; }
      removeParticle(state, k); ventVapour(state, effect, to, 1, h.freeze, dt);
      continue;
    }
    // Water below its freezing point (less a seeded share of `grain` for this particle, so a front grows ragged) freezes
    // where it touches ice or an obstacle colder than freezing, or anywhere once it is SUPERCOOL below: ice needs a seed.
    // Water chilled from above stays liquid until the ice creeping from a cold shore reaches it, a cell a step.
    if (e < h.freeze - (h.grain ? 0.25 * h.grain * random(seed, PHASE, state.id[k], PHASE_SALT.grain) : 0)) {
      const c = j * W + i, seeded = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (ice[y * W + x] > 0 || (base[y * W + x] && obstacleT[y * W + x] < h.freeze));
      if (ice[c] || e < h.freeze - SUPERCOOL || (base[c] && obstacleT[c] < h.freeze) || seeded(i - 1, j) || seeded(i + 1, j) || seeded(i, j - 1) || seeded(i, j + 1)) { frozen[k] = 1; state.vx[k] = 0; state.vy[k] = 0; continue; }
    }
    if (!V) { if (e > top) energy[k] = top; continue; }
    // Each particle boils after its own seeded share of `vaporize` (half to all of it, and half again), so a pot heated
    // evenly from below bubbles steadily instead of in bursts.
    const t = tempOf(h, e, 0), mine = h.boil + h.latent + h.vaporize * (0.5 + random(seed, PHASE, state.id[k], PHASE_SALT.boil));
    let boiled = e >= mine;
    if (!boiled && h.evaporation && t > h.freeze) { const share = (t - h.freeze) / (h.boil - h.freeze), chance = h.evaporation * dt * (share < 1 ? share * share : 1); boiled = random(seed, PHASE, step, state.id[k], PHASE_SALT.evaporate) < chance && surface(i, j); }
    if (!boiled) continue;
    if (surface(i, j)) { const to = vent(i, j); if (to !== -2) { removeParticle(state, k); ventVapour(state, effect, to, 1, t, dt); continue; } }
    // Boiled inside the water: a bubble that carries its vapour up and lets it out at the surface (see ventBubble). With
    // no bubbles set, or at the spark limit, the particle waits at the boil until it reaches the surface.
    if (!bubbles || !addBubble(run.sparks, run.totals, bubbles, state.x[k], state.y[k], salt => random(seed, PHASE, step, state.id[k], salt), { steam: 1, born: run.clock })) { if (e > mine) energy[k] = mine; continue; }
    removeParticle(state, k);
  }
  if (V) {
    // Vapour touching something colder than `dew` condenses, a share each frame. Onto water it joins the water a particle
    // at a time; on an obstacle or ice it gathers as dew, drawn as water, until the cell holds a full cell's worth and
    // drips off as a drop. Touching ice or an obstacle colder than `frost` it grows into ice instead, fastest where it
    // touches the ice at one point (the tip of a finger), with seeded grain; a particle's worth becomes an ice particle at
    // a seeded spot. Condensing in a sealed air pocket takes from the pocket's air.
    const spawn = (c, n, t, solid) => {
      const i = c % W, j = (c - i) / W;
      P.spawnFrozen = solid ? 1 : 0; P.spawnEnergy = energyOf(h, t, solid);
      addParticle(state, i + 0.1 + 0.8 * random(seed, PHASE, step, c, n, PHASE_SALT.spawnX), j + 0.1 + 0.8 * random(seed, PHASE, step, c, n, PHASE_SALT.spawnY), 0, 0);
    };
    const scale = effect.vapour.expansion / PER_CELL, m = V.d;
    for (let c = 0; c < N; c++) {
      const i = c % W, j = (c - i) / W;
      // Vapour the liquid closed over (see heatMasks), or a bubble's that ended in the water, joins it.
      if (!V.open[c]) { for (let n = 0; P.pending[c] >= 1 && !base[c]; n++) { P.pending[c] -= 1; spawn(c, n + 16, Tc[c], false); } continue; }
      if (!(m[c] > 0) && !(P.pending[c] >= 1)) continue;
      let coldest = Infinity, firm = Infinity;
      for (const [di, dj] of SIDES) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const n = y * W + x;
        if (base[n]) { if (obstacleT[n] < firm) firm = obstacleT[n]; } else if (ice[n] >= ICE_CELL) { if (Tc[n] < firm) firm = Tc[n]; } else if (water[n] + ice[n] >= ICE_CELL && Tc[n] < coldest) coldest = Tc[n];
      }
      if (firm < coldest) coldest = firm;
      // Frost grows as fingers (physics-model.md section 9), off any of the eight neighbours that is frost or a solid
      // colder than `frost`, into air below freezing. Each frost cell keeps the direction it grew in (`frostDir`), its
      // generation (`frostGen`: a stem, a branch, a twig) and its length along its finger (`frostLen`). Vapour turns to
      // frost in the cell straight ahead of a finger's tip, as readily as its generation's REACH, or, by a seeded draw
      // (`branch`, a third as often off a branch, never off a twig, and only off every other cell), in one 45 degrees to
      // its side: a branch of the next generation that grows straight on its own way. Never beside or behind a tip, so a
      // finger stays a pixel wide and forks like a fern, its branches shorter than its stem and a pixel apart. A cell
      // touching frost of another finger takes none, so fingers stop short of each other; a frost cell thickens slowly
      // into solid ice; ice with no direction (a cube) frosts over slowly every way. The vapour diffusing to the tips feeds
      // them, so they reach out into the humid air.
      let weight = 0, rime = firm, gone = 0, from = -1, best = 0, frosty = 0, walls = 0, ox = 0, oy = 0, gen = 0, parent = -1, wall = -1, length = 0, near = false;
      if (h.frost !== null && V.T[c] < h.freeze) {
        const dirs = P.frostDir ??= new Int8Array(N).fill(-1), gens = P.frostGen ??= new Uint8Array(N), lens = P.frostLen ??= new Uint8Array(N), touched = P.touched ??= new Int32Array(8);
        P.frostIce ??= new Uint8Array(N);
        for (let k = 0; k < 8; k++) {
          const x = i + COMPASS[k][0], y = j + COMPASS[k][1];
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const n = y * W + x, cold = base[n] ? obstacleT[n] : ice[n] ? Tc[n] : Infinity;
          if (ice[n] || cold < h.frost) near = true;
          if (!(cold < h.frost)) continue;
          if (cold < rime) rime = cold;
          // The step from that neighbour to this cell, as a direction.
          const step = (k + 4) % 8;
          if (base[n]) { walls++; wall = n; ox += COMPASS[step][0]; oy += COMPASS[step][1]; continue; }
          touched[frosty++] = n;
          const d = dirs[n], turn = d < 0 ? -1 : Math.min((step - d + 8) % 8, (d - step + 8) % 8), at = gens[n];
          // A branch sprouts only off every other cell of a finger (its length from where it started is odd), so side
          // branches lie a pixel apart instead of merging into a band.
          const w = d < 0 ? ROUND : turn === 0 ? REACH[at < 2 ? at : 2] : turn === 1 && at < 2 && lens[n] % 2 === 1 && random(seed, PHASE, n, step, PHASE_SALT.branch) < h.branch * (at ? 0.3 : 1) ? REACH[at + 1] : 0;
          weight += w;
          if (w > best) { best = w; from = step; gen = turn === 1 ? at + 1 : at; parent = n; length = turn === 1 ? 0 : (lens[n] + 1) & 255; }
        }
        // A finger starts off a cold obstacle at seeded sites: SITES of the open cells beside a flat side (each touches three
        // of the obstacle's cells) and nine times as many in a corner, where the cold is on two sides (it touches five).
        // Elsewhere along a bare stretch of cold surface (no frost within SPACING pixels) one starts by a seeded draw each
        // step, NUCLEI a frame beside a flat side, so every cold surface frosts in time. A finger grows straight out from
        // the surface, or out of a corner along its diagonal, leaning a step either way by a seeded draw off a flat side:
        // corners first, fingers apart, instead of a rim.
        const bare = () => { for (let y = j - SPACING; y <= j + SPACING; y++) for (let x = i - SPACING; x <= i + SPACING; x++) if (x >= 0 && y >= 0 && x < W && y < H && ice[y * W + x]) return false; return true; };
        const site = (walls - 2) * (walls - 2);
        if (walls > 2 && !frosty && (random(seed, PHASE, c, PHASE_SALT.site) < SITES * site || (random(seed, PHASE, step, c, PHASE_SALT.nucleus) < NUCLEI * dt * site && bare()))) {
          let out = COMPASS.findIndex(([x, y]) => x === Math.sign(ox) && y === Math.sign(oy));
          if (out >= 0 && walls <= 3) out = (out + 8 + Math.floor(3 * random(seed, PHASE, c, PHASE_SALT.lean)) - 1) % 8;
          if (out >= 0) { weight += 1; best = 1; from = out; gen = 0; parent = wall; length = 0; }
        }
        // A cell that has started taking frost, and has not a particle of it yet, goes on as it started, while frost or a
        // cold solid is beside it (never in mid-air).
        if (!ice[c] && dirs[c] >= 0 && near && REACH[gens[c] < 2 ? gens[c] : 2] > best) { best = REACH[gens[c] < 2 ? gens[c] : 2]; weight = best; from = dirs[c]; gen = gens[c]; length = lens[c]; parent = -1; }
        // A cell touching frost of another finger (any not beside the one it grows from) takes none, so fingers stop short
        // of each other.
        const px = parent % W, py = (parent - px) / W, other = n => n !== parent && (base[parent] || Math.abs(n % W - px) > 1 || Math.abs((n - n % W) / W - py) > 1);
        if (ice[c]) weight = THICKEN;
        else if (parent >= 0) for (let k = 0; k < frosty; k++) if (other(touched[k])) { weight = 0; break; }
        if (weight > 1) weight = 1;
      }
      if (weight) {
        const grain = h.grain ? 1 - h.grain + 2 * h.grain * random(seed, PHASE, c, PHASE_SALT.frost) : 1;
        gone = Math.min(m[c], h.deposit * dt * m[c] * weight * grain);
        firm = rime;
        P.frost[c] += gone;
        if (!ice[c] && from >= 0) { P.frostDir[c] = from; P.frostGen[c] = gen; P.frostLen[c] = length; }
      } else if (!h.sublimate && coldest < h.dew && !(h.frost !== null && rime < h.frost)) {
        // (Vapour beside a surface cold enough to frost waits for a finger to reach it rather than beading as dew.)
        gone = h.condense * dt * m[c];
        P.pending[c] += gone;
      }
      if (gone) { m[c] -= gone; V.source[c] -= gone * scale / dt; if (state.air) addAir(state, i, j, -gone * scale); }
      for (let n = 0; P.frost[c] >= 1; n++) { P.frost[c] -= 1; spawn(c, n, firm < h.freeze ? firm : h.freeze, true); }
      const t = coldest < h.dew ? coldest : h.dew;
      if (firm < h.dew) { if (P.pending[c] >= PER_CELL) { P.pending[c] -= PER_CELL; P.spawnFrozen = 0; P.spawnEnergy = energyOf(h, t, false); seedCell(state, i, j, PER_CELL, 0, [0, 0], [seed, PHASE, step, c]); } } else for (let n = 0; P.pending[c] >= 1; n++) { P.pending[c] -= 1; spawn(c, n + 8, t, false); }
    }
  }
  P.converting = false;
  if (first) { tally(state); settleIce(state, effect); }
  tally(state);
  heatMasks(state, effect);
}
// Ice that touches no obstacle (nor a closed edge) and has nothing under it falls as one piece, a whole number of pixels a
// frame, speeding up with gravity; obstacles, other ice and water flanking most of it hold it up (ice floats), and water
// in the cells it falls into is pushed aside along the row. So an ice cube whose underside melts settles into its puddle
// instead of hanging over it. While it moves, its cells carry its speed in the solid layer, so what clings to it moves
// with it. Pieces are the 4-connected cells holding any ice, and frost joins them across corners too: a finger grows at 45
// degrees, its cells touching only at a corner, and it is one piece with the frost it grew from (taken four ways, its
// branches broke off and fell). Gravity along y only.
const DIAGONALS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
function settleIce(state, effect) {
  const P = state.heat, g = state.g, { W, H, N, walls } = g, { base, water, ice, iceSpeed } = P, [gx, gy] = effect.gravity, dirs = P.frostDir;
  const was = P.iceMoving;
  P.iceMoving = false;
  if (was) iceSpeed.fill(0);
  if (!gy || Math.abs(gx) > Math.abs(gy)) return;
  const dir = gy > 0 ? 1 : -1, pull = Math.abs(gy);
  if (!P.piece) { P.piece = new Int32Array(N); P.cover = new Uint8Array(N); }
  const { piece, cover } = P, pieces = [], stack = [];
  piece.fill(-1);
  for (let c = 0; c < N; c++) {
    if (!ice[c] || piece[c] >= 0) continue;
    const id = pieces.length, cells = [];
    let held = false;
    piece[c] = id; stack.push(c);
    while (stack.length) {
      const d = stack.pop(), i = d % W, j = (d - i) / W;
      cells.push(d);
      for (const [di, dj] of SIDES) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= W || y >= H) { if (x < 0 ? walls.left : x >= W ? walls.right : y < 0 ? walls.top : walls.bottom) held = true; continue; }
        const e = y * W + x;
        if (base[e]) held = true; else if (ice[e] && piece[e] < 0) { piece[e] = id; stack.push(e); }
      }
      if (dirs) for (const [di, dj] of DIAGONALS) {
        const x = i + di, y = j + dj, e = y * W + x;
        if (x >= 0 && y >= 0 && x < W && y < H && ice[e] && piece[e] < 0 && (dirs[d] >= 0 || dirs[e] >= 0)) { piece[e] = id; stack.push(e); }
      }
    }
    pieces.push({ cells, held, speed: 0 });
  }
  if (pieces.every(p => p.held)) return;
  for (let k = 0; k < state.n; k++) if (state.frozen[k]) { const p = pieces[piece[Math.floor(state.y[k]) * W + Math.floor(state.x[k])]]; if (p && state.fall[k] > p.speed) p.speed = state.fall[k]; }
  pieces.forEach((p, id) => {
    if (p.held) return;
    const speed = p.speed + pull, want = Math.max(1, Math.floor(speed + 0.5));
    // It floats where water lies beside it along rows holding most of its cells: then water under it holds it up.
    let wet = 0;
    for (const c of p.cells) {
      const i = c % W, j = (c - i) / W, beside = x => x >= 0 && x < W && piece[j * W + x] !== id && water[j * W + x] >= ICE_CELL;
      let l = i, r = i;
      while (l > 0 && piece[j * W + l - 1] === id) l--;
      while (r < W - 1 && piece[j * W + r + 1] === id) r++;
      if (beside(l - 1) || beside(r + 1)) wet++;
    }
    const floats = wet >= 0.85 * p.cells.length;
    // How far it may fall: every cell's destination is in it already or open, empty of other ice (and of water, afloat).
    const free = d => p.cells.every(c => {
      const i = c % W, j = (c - i) / W + dir * d;
      if (j < 0 || j >= H) return false;
      const e = j * W + i;
      return piece[e] === id || (!base[e] && !ice[e] && (!floats || water[e] < ICE_CELL));
    });
    let d = 0;
    while (d < want && free(d + 1)) d++;
    p.move = d; p.speed = d ? speed : 0;
  });
  cover.fill(0);
  pieces.forEach(p => { if (p.move) for (const c of p.cells) { cover[c + dir * p.move * W] = 1; iceSpeed[c + dir * p.move * W] = dir * p.move; P.iceMoving = true; } });
  // Frost that settles keeps its fingers: each cell's direction, generation and length move with it.
  if (dirs) pieces.forEach(p => {
    if (!p.move) return;
    const shift = dir * p.move * W, kept = p.cells.map(c => [dirs[c], P.frostGen[c], P.frostLen[c], P.frostIce[c]]);
    for (const c of p.cells) { dirs[c] = -1; P.frostGen[c] = 0; P.frostLen[c] = 0; P.frostIce[c] = 0; }
    p.cells.forEach((c, k) => { const e = c + shift; [dirs[e], P.frostGen[e], P.frostLen[e], P.frostIce[e]] = kept[k]; });
  });
  for (let k = 0; k < state.n; k++) {
    if (!state.frozen[k]) continue;
    const p = pieces[piece[Math.floor(state.y[k]) * W + Math.floor(state.x[k])]];
    if (!p || p.held) { state.fall[k] = 0; continue; }
    state.fall[k] = p.speed;
    if (p.move) state.y[k] += dir * p.move;
  }
  // Water in a cell a piece now covers moves along its row to the nearest cell that no ice or obstacle holds.
  for (let k = 0; k < state.n; k++) {
    if (state.frozen[k]) continue;
    const i = Math.floor(state.x[k]), j = Math.floor(state.y[k]);
    if (!cover[j * W + i]) continue;
    for (let step = 1; step < W; step++) {
      const l = i - step, r = i + step, open = x => x >= 0 && x < W && !cover[j * W + x] && !base[j * W + x] && !ice[j * W + x];
      if (open(l)) { state.x[k] += l - i; break; }
      if (open(r)) { state.x[k] += r - i; break; }
    }
  }
}
// The ledger (physics-model.md, section 4), in cells' worth: water (dew included), ice (frost not yet a particle
// included), vapour (in the air and in boil bubbles), and since the first frame what emitters added and what drains, open
// edges and fading took. Water + ice + vapour + taken − added stays what the fills held.
export function heatAmounts(run) {
  const { state } = run, P = state.heat, V = P.vapour;
  let water = 0, ice = 0, vapour = 0;
  for (const p of run.sparks) if (p.steam) vapour += p.steam;
  for (let k = 0; k < state.n; k++) if (state.frozen[k]) ice++; else water++;
  for (let c = 0; c < state.g.N; c++) { water += P.pending[c]; ice += P.frost[c]; vapour += V ? V.d[c] : 0; }
  return { water: hundredth(water / PER_CELL), ice: hundredth(ice / PER_CELL), vapour: hundredth(vapour / PER_CELL), added: hundredth(P.added / PER_CELL), taken: hundredth((P.removed + P.escaped) / PER_CELL) };
}
// The ice and vapour fields the looks read, after liquidFields: ice is drawn cell by cell (crisp), vapour as a gas.
export function heatFields(run) {
  const { state } = run, P = state.heat, { N } = state.g, [density, temperature] = run.base, [iceD, iceT] = run.iceBase, V = P.vapour;
  for (let c = 0; c < N; c++) {
    iceD[c] = P.ice[c] / PER_CELL; iceT[c] = P.ice[c] ? P.Tc[c] : 0;
    temperature[c] = P.water[c] ? P.Tc[c] : 0;
    // Dew is drawn as water from a particle's worth in a cell, crisp, as a bead.
    if (P.pending[c]) density[c] += P.pending[c] / ICE_CELL;
  }
  if (!V) return;
  const [vd, vt, vs] = run.vapourBase, scale = run.effect.vapour.expansion / PER_CELL, { W, u, v } = V.g;
  for (let c = 0; c < N; c++) {
    const i = c % W, j = (c - i) / W, x = (u[j * (W + 1) + i] + u[j * (W + 1) + i + 1]) * 0.5, y = (v[c] + v[c + W]) * 0.5;
    vd[c] = V.open[c] ? V.d[c] * scale : 0; vt[c] = V.open[c] ? V.T[c] : 0; vs[c] = Math.sqrt(x * x + y * y);
  }
  // Plasma burns in the air, so the vapour's look draws it.
  if (state.electric) electricFields(state.electric, V, run.vapourBase[4], run.vapourBase[5]);
}
// A frame of a liquid with heat: vapour first, the water over it, then the ice, each through its own look, and the
// outline round the water and ice.
export function renderHeat(run, width, height, drawn, hold) {
  const { view, state } = run, P = state.heat, N = width * height, V = P.vapour, plain = { strays: false, corners: false };
  const iced = new Uint8Array(N);
  for (let c = 0; c < N; c++) iced[c] = view.solid[c] || P.ice[c] >= ICE_CELL ? 1 : 0;
  const chars = renderFields({ ...view, solid: iced, outline: 0 }, run.base, width, height, null, hold, 'water');
  const frost = renderFields({ ...view, liquid: false, look: view.iceLook ?? view.look, outline: 0, cleanup: plain }, run.iceBase, width, height, null, hold, 'ice');
  for (let c = 0; c < N; c++) if (frost[c]) chars[c] = frost[c];
  const body = Uint16Array.from(chars);
  if (V && view.vapour.look.length) {
    const steam = renderFields({ ...view, liquid: false, look: view.vapour.look, solid: V.g.solid, outline: 0, cleanup: plain }, run.vapourBase, width, height, null, hold, 'vapour');
    for (let c = 0; c < N; c++) if (!chars[c] && steam[c]) chars[c] = steam[c];
  }
  if (drawn) for (let c = 0; c < N; c++) drawn[c] = chars[c] ? 1 : 0;
  if (view.outline) for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const c = j * width + i;
    if (body[c] || view.front[c] || view.solid[c]) continue;
    if ((i > 0 && body[c - 1]) || (i < width - 1 && body[c + 1]) || (j > 0 && body[c - width]) || (j < height - 1 && body[c + width])) chars[c] = view.outline;
  }
  return chars;
}

