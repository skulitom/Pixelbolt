// Fluid effects compiled to ordinary, editable recipes. A pixelforge-fluid source names effects; each runs a small
// fluid simulation on a grid with one cell per canvas pixel and bakes every frame into palette `grid` operations on
// the source's own palette, so inspect, patch, overlay and export work unchanged and no colour outside the palette
// can appear. Gases (smoke, fire, steam, explosions, magic) use Stam-style stable fluids on a staggered grid; liquids
// (water, splashes, drips, potions) use FLIP/APIC particles with cohesion, adhesion, implicit viscosity, yield stress,
// granular friction, air pockets, phase changes and rigid-body coupling. Browser-compatible and deterministic.
// createLiveFluid runs the same simulation a frame at a time for interactive pages, with pushes, puffs and boosts.
import { renderProject, parseColor, fail, isObject, sameWidth } from './core.js';
import { fields, number, integer } from './authoring.js';
import { random } from './craft.js';
import { atan2Deg } from './shapes.js';
import { electricWork } from './electric.js';
import { createBodyWorld, drawBodies, readSubpixels, framesFit, scaleAnchor } from './bodies.js';
import { createLight, codeGrid } from './light.js';
import { FLUID_KINDS, FLUID_FIELDS, FLUID_WALLS, OBSTACLE_SURFACES, LIMITS, PER_CELL, SALT, WAKE, REFILL, smooth, gridFor, enforce, energyOf } from './fluid-grid.js';
import { identifier, onCanvas, placementsAt, layoutKey, buildLayout, solidLayer, readEffect, active, laidSteps, coverage } from './fluid-source.js';
import { couplingOf, NEAR_BODY, placeBodies, stepBodies, posesOf, sceneOf, blendPoses, closingView, bodiesFigures } from './fluid-bodies.js';
import { renderFields, stepShine, frameLight, shineCodes, bodiesOver, fineLight, handBack, drawSparks, measureFrame, columns } from './fluid-render.js';
import {
  pushesWater, crowded, emitGas, createGas, stepGas, gasFields,
  createLiquid, clingField, gripFields, carryFields, removeParticle, countCells, seedCell,
  fillLiquid, emitLiquid, stepLiquid, liquidFields,
  spawnSparks, moveSparks, throwWhitewater, gatherOf, releaseAir
} from './fluid-solvers.js';
import { createHeat, tally, heatMasks, stepVapour, endedOf, electricStep, heatStep, heatAmounts, heatFields, renderHeat } from './fluid-heat.js';

export { FLUID_KINDS, FLUID_FIELDS, FLUID_WALLS, OBSTACLE_SURFACES };

// ---- Simulation -------------------------------------------------------------------------------------------------------
// Cell updates per cell per step, for the work budget: one per pressure sweep plus the transfers and advection. A thick
// fluid's viscosity solve (and a liquid's second pressure solve) costs about two more per sweep, a yield-stress liquid's
// spreading solve one more, sharp advection about thirty.
const stepWork = effect => effect.iterations * (effect.most.yield || effect.granular ? 4 : effect.most.viscosity ? 3 : 1) + 10 + (effect.sharp ? 30 : 0) + electricWork(effect) + (effect.vapour ? effect.vapour.iterations + 20 : effect.heat ? 4 : 0);
// A loop simulates its warm-up cycles, the recorded cycle, and as long again as its longest-lived spark (a liquid's
// spray may fly on for its life again; a bubble never does), the bubbles of air pockets included.
const sparkSpan = (s, liquid) => (liquid && !s.follow && s.rise === null ? 2 : 1) * s.life[1];
const sparkTail = effect => Math.max(0, ...effect.emitters.map(e => (e.sparks ? sparkSpan(e.sparks, effect.liquid) : 0)), ...effect.whitewater.map(w => sparkSpan(w, effect.liquid)), effect.air && effect.air.bubbles ? effect.air.bubbles.life[1] : 0);
const makesBubbles = effect => effect.emitters.some(e => e.sparks && pushesWater(effect, e.sparks)) || effect.whitewater.some(w => pushesWater(effect, w)) || !!(effect.air && effect.air.bubbles);
// A boil's bubbles are made by the water, not by an emitter: a loop draws those born in its recorded cycle and simulates
// on for up to another cycle, until they have all ended, drawing them from frame 0 again (see simulate).
const boilTail = effect => (effect.loop && effect.vapour && effect.vapour.bubbles ? effect.frames : 0);
const simulatedFrames = effect => effect.loop ? (effect.warmup + 1) * effect.frames + Math.max(sparkTail(effect), boilTail(effect)) : effect.frames;
const SPARKS_FULL = `more than ${LIMITS.sparks} sparks are alive at once; lower the sparks' count or life`;
const AIR_FULL = `more than ${LIMITS.sparks} sparks and bubbles are alive at once; lower the sparks' count or life, or the air bubbles' life`;
const WHITEWATER_FULL = `more than ${LIMITS.sparks} sparks and whitewater droplets are alive at once; lower the whitewater chance or life`;

// One running simulation of an effect, shared by compileFluid and the live runner: the solver's state, the fields the
// look reads (density, temperature and speed), the sparks in flight, and the obstacles' layout now (`view` is the effect
// with that layout's masks, for drawing).
function createRun(effect, width, height, path) {
  const N = width * height, state = effect.liquid ? createLiquid(effect, width, height) : createGas(effect, width, height);
  if (effect.heat) state.heat = createHeat(effect, state.g);
  if (effect.liquid) { fillLiquid(state, effect); if (state.full) crowded(path); }
  // A gas's plasma has two fields more (ionization and current, after the strand's place); over a liquid the vapour's.
  const fieldSet = (electric = false) => Array.from({ length: electric ? 6 : 3 }, () => new Float64Array(N)), base = [...fieldSet(), ...Array.from({ length: effect.electric && !effect.liquid ? 3 : 1 }, () => new Float64Array(N))];
  const run = { effect, view: effect, layout: effect.layout, state, base, sparks: [], pops: [], totals: { alive: 0, spawned: 0, maxAlive: 0 }, maxParticles: effect.liquid ? state.n : 0, fields: base, hold: { prev: null, now: null },
    shine: effect.shine ? { memory: createLight(width, height), level: new Float64Array(N), across: new Float64Array(N), power: new Float64Array(N), lit: new Float64Array(N) } : null };
  // A liquid with heat also has the ice's fields and the vapour's, which a loop's seam blends with the rest. What the
  // fills made is where the ledger starts (it counts what emitters add from here on), and a frozen fill is solid at once.
  if (state.heat) {
    run.iceBase = fieldSet(); run.vapourBase = fieldSet(!!effect.electric); run.fields = [...base, ...run.iceBase, ...run.vapourBase];
    state.heat.added = 0; tally(state); heatMasks(state, effect);
  }
  return run;
}
// Obstacles that move on cue. When the layout for frame `cycle` differs from the last, the solver's masks are rebuilt
// for it. Through every frame of a key's `over`, the faces against the obstacle carry its speed along the ramp (in
// pixels per frame, before rounding to whole pixels), so the pressure solve pushes the fluid ahead of it steadily;
// beside smooth obstacles the closed share of a part-open face carries it. Fluid in the cells it now covers is shoved
// along its move to the first open cell, never through another solid. A jump (a key with no `over`), an obstacle
// appearing or vanishing, and the place a loop comes round to are cuts, not moves: they push nothing. Liquid with no
// open cell along the move, or under a cut, keeps its matter (`squeezed`): it goes to the nearest open cell out of the
// gap; a gas there is lost. With heat the grid stays and heatMasks reshapes it, with the ice, and builds the solid
// layer; ice stops what is pushed as an obstacle does.
function moveObstacles(run, cycle) {
  const { effect, state } = run, places = placementsAt(effect.obstacles, cycle), key = layoutKey(places), before = run.layout, P = state.heat;
  let g = state.g;
  const { W, H } = g, X = W + 1, changed = key !== before.key;
  if (changed) {
    const layout = buildLayout(effect.obstacles, W, H, places);
    run.layout = layout;
    run.view = { ...effect, solid: layout.solid, front: layout.front, smooth: layout.smooth, see: layout.see };
  }
  if (P) { P.places = places; if (changed) { P.layout = run.layout; P.base = run.layout.solid; } heatMasks(state, effect, changed ? 'layout' : 'moved'); }
  else if (changed) {
    const next = gridFor(run.view, W, H);
    next.u.set(g.u); next.v.set(g.v); next.p.set(g.p); next.release = g.release;
    if (g.visc) next.visc = g.visc;
    if (g.sharp) next.sharp = g.sharp;
    state.g = g = next;
    if (state.open) for (let c = 0; c < g.N; c++) state.open[c] = g.solid[c] ? 0 : 1;
  }
  // The solid layer for this frame; what clings to the solids reads it.
  const layout = run.layout, owner = layout.owner, solids = P ? state.solids : state.solids = solidLayer(effect, layout, places, W, H), { speed } = solids;
  // The cells within NEAR_BODY of a body's, where the liquid's particles keep less of their own motion (see stepLiquid).
  if (effect.bodies && effect.liquid && !effect.granular) {
    const near = state.nearBodies ??= new Uint8Array(g.N);
    near.fill(0);
    for (let c = 0; c < g.N; c++) {
      if (!layout.solid[c] || owner[c] < 0 || effect.obstacles[owner[c]].body === undefined) continue;
      const i = c % W, j = (c - i) / W;
      for (let y = Math.max(0, j - NEAR_BODY); y <= Math.min(H - 1, j + NEAR_BODY); y++) for (let x = Math.max(0, i - NEAR_BODY); x <= Math.min(W - 1, i + NEAR_BODY); x++) near[y * W + x] = 1;
    }
  }
  if (state.cling && !P) {
    if (changed) { state.cling = clingField(solids); state.grip = gripFields(solids, effect.obstacles); }
    state.carry = carryFields(solids);
  }
  // A frame older, the wake lets go of the cells it has held for WAKE frames, and of those an obstacle now covers.
  const { wake } = state;
  if (wake && wake.cells.length) {
    for (const c of wake.cells) if (wake.left[c] && (g.solid[c] || !--wake.left[c])) wake.left[c] = 0;
    wake.cells = wake.cells.filter(c => wake.left[c]);
  }
  const of = c => (c >= 0 ? solids.velocity(c) : null);
  if (!P && (solids.moving || g.moved || changed)) {
    if (!g.uWall) { g.uWall = new Float64Array(g.u.length); g.vWall = new Float64Array(g.v.length); } else { g.uWall.fill(0); g.vWall.fill(0); }
    g.moved = false;
    for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) { const s = of(i > 0 ? j * W + i - 1 : -1) ?? of(i < W ? j * W + i : -1); if (s) { g.uWall[j * X + i] = s[0]; g.moved = true; } }
    for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, s = of(j > 0 ? k - W : -1) ?? of(j < H ? k : -1); if (s) { g.vWall[k] = s[1]; g.moved = true; } }
    enforce(g);
  }
  if (effect.bodies && effect.liquid && !effect.granular) state.coupling = couplingOf(effect, layout, places, W, H, P ? P.mask : layout.solid, state.coupling);
  if (!changed) return;
  const shift = effect.obstacles.map((o, i) => { const at = places[i], was = before.places[i]; return o.blocks && at.show && was.show && !at.jump && cycle > 0 && (at.x !== was.x || at.y !== was.y) ? [at.x - was.x, at.y - was.y] : null; });
  const covered = c => layout.solid[c] && !before.solid[c];
  // The cells a moving obstacle has just left join its wake (see transfer); a cut leaves none.
  if (effect.liquid) {
    // A body leaves a wake as it turns, too, not only as it moves a whole pixel.
    for (let c = 0; c < g.N; c++) if (before.solid[c] && !layout.solid[c] && before.owner[c] >= 0 && (shift[before.owner[c]] || (cycle > 0 && effect.obstacles[before.owner[c]].body !== undefined))) {
      // Made when the first cell is left, not when an obstacle first has a velocity: a fixed body turning on the spot in
      // sand has none (its turning is not the sand's), and its cells come and go all the same.
      const wake = state.wake ??= { cells: [], left: new Uint8Array(g.N), mark: new Uint8Array(g.N) };
      if (!wake.left[c]) wake.cells.push(c);
      wake.left[c] = WAKE;
    }
  }
  // The cells each moving obstacle passed over on its way, from every cell it held to where that cell is now. An
  // obstacle that moves more pixels than it is thick leaves some of them open behind it: the fluid there was in its
  // path, so it goes ahead of it too, as from the cells it covers, instead of being passed through.
  const swept = new Int16Array(g.N).fill(-1);
  effect.obstacles.forEach((o, i) => {
    const s = shift[i];
    if (!s) return;
    const was = before.places[i], steps = Math.ceil(2 * Math.sqrt(s[0] * s[0] + s[1] * s[1]));
    o.rows.forEach((row, j) => {
      for (let k = 0; k < row.length; k++) if (row[k] !== '.' && row[k] !== ' ') {
        for (let step = 1; step < steps; step++) {
          // Off the canvas (an obstacle that hangs off an edge) there are no cells to sweep.
          const px = Math.floor(was.x + k + 0.5 + s[0] * step / steps), py = Math.floor(was.y + j + 0.5 + s[1] * step / steps);
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const c = py * W + px;
          if (swept[c] < 0) swept[c] = i;
        }
      }
    });
  });
  const passed = c => swept[c] >= 0 && !layout.solid[c] && !before.solid[c], solid = P ? P.mask : layout.solid;
  // The open cell nearest (x, y), up to 4 cells away, for fluid a body landed on; -1 where there is none.
  const nearestOpen = (x, y) => {
    const i0 = Math.floor(x), j0 = Math.floor(y);
    for (let r = 1; r <= 4; r++) {
      let best = -1, least = Infinity;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H || solid[j * W + i]) continue;
        const d = (i + 0.5 - x) * (i + 0.5 - x) + (j + 0.5 - y) * (j + 0.5 - y);
        if (d < least) { least = d; best = j * W + i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  // A body that moved onto fluid without moving a whole pixel (it turned, or slid less) shoves it along that cell's own
  // motion (its velocity plus its turning there), or straight out from its centre where that cell hardly moves.
  const outward = (o, x, y) => {
    const at = places[o];
    if (effect.obstacles[o].body === undefined || !at.show) return null;
    const dx = x - at.cx, dy = y - at.cy, mx = at.vx - at.w * dy, my = at.vy + at.w * dx, m = Math.sqrt(mx * mx + my * my), d = Math.sqrt(dx * dx + dy * dy);
    return m > 0.05 ? [mx / m, my / m] : d > 1e-9 ? [dx / d, dy / d] : [0, -1];
  };
  // The first open cell along a move from (x, y), passing only through cells the same obstacle has just covered or
  // passed over; -1 where another solid or the canvas edge comes first.
  const landing = (x, y, o, s) => {
    const length = Math.sqrt(s[0] * s[0] + s[1] * s[1]), ux = s[0] / length, uy = s[1] / length;
    for (let step = 1; step <= 2 * length + 4; step++) {
      const px = x + 0.5 * step * ux, py = y + 0.5 * step * uy;
      if (px < 0 || py < 0 || px >= W || py >= H) return -1;
      const c = Math.floor(py) * W + Math.floor(px);
      if (!solid[c]) { if (passed(c) && swept[c] === o) continue; return c; }
      // A body's fluid may pass through any of its own cells: a turning paddle shoves water ahead of it through itself.
      if (owner[c] !== o || (!covered(c) && effect.obstacles[o].body === undefined)) return -1;
    }
    return -1;
  };
  // The cells each body has just left beside the liquid (liquid on a side of them), each able to take PER_CELL
  // particles. Liquid a body moves onto goes into the nearest of its own, within REFILL pixels: a turning paddle covers about
  // as many cells ahead as it leaves behind, and left to drift in, the liquid would leave a hole behind each arm for frames,
  // drawn as a fresh surface in the deep. It still takes the body's speed there, so the paddle stirs. A body falling into
  // a pool leaves its cells in the air, so its splash goes ahead of it as before. The liquid beside a cell is in the open
  // cells beside it: the liquid in a cell the body now covers is moving, and counted, it went from under a plank sinking
  // into a pool's top row to the cells the plank had left, on top of it, as a sheet of water that held it under. Sand is
  // shoved ahead, not refilled behind: it doesn't flow back, and moved round behind a crate it let the crate swim down a
  // heap.
  let vacated = null;
  if (effect.liquid && effect.bodies && !effect.granular) {
    const held = new Uint8Array(g.N);
    for (let k = 0; k < state.n; k++) { const c = Math.floor(state.y[k]) * W + Math.floor(state.x[k]); if (c >= 0 && c < g.N && held[c] < 255) held[c]++; }
    vacated = new Map();
    for (let c = 0; c < g.N; c++) {
      const o = before.owner[c];
      if (!before.solid[c] || layout.solid[c] || o < 0 || effect.obstacles[o].body === undefined) continue;
      const i = c % W, j = (c - i) / W;
      let sides = 0;
      for (const d of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1]) if (d >= 0 && held[d] && !solid[d]) sides++;
      if (!sides) continue;
      if (!vacated.has(o)) vacated.set(o, []);
      vacated.get(o).push({ c, room: PER_CELL - held[c] });
    }
  }
  const refill = (o, x, y) => {
    const list = vacated?.get(o);
    if (!list) return -1;
    let best = null, least = REFILL * REFILL;
    for (const spot of list) {
      if (spot.room <= 0) continue;
      const dx = spot.c % W + 0.5 - x, dy = Math.floor(spot.c / W) + 0.5 - y, d = dx * dx + dy * dy;
      if (d <= least) { least = d; best = spot; }
    }
    if (!best) return -1;
    best.room--;
    return best.c;
  };
  // Where liquid an obstacle has closed on goes when nothing is open along its move (it met another solid: a piston
  // back against its chamber's end wall, a crusher on the floor) or it made no move (a gate shown on top of liquid, a
  // jump, the place a loop comes round to): the nearest open cell that has room, by a walk through the cells the
  // obstacle has just covered, so out of the gap it closed, sideways or up; failing that through any of its own cells,
  // so a pocket it seals on every side leaks past it. Never through another solid, and -1 only where the obstacle and
  // other solids shut it in altogether. A cell has room for twice what fills it, so what is squeezed out stays by where
  // it came out and the pressure solve spreads it from there. (It was removed instead: a piston that came back to sit
  // against the end wall took 72 of 1,008 particles of slime with it, in sight, and a valve shown in a nozzle 84.)
  let crowd = null, walk = null, walked = null, pass = 0;
  const squeezed = (from, o) => {
    if (!crowd) {
      crowd = new Uint16Array(g.N); walk = new Int32Array(g.N); walked = new Int32Array(g.N);
      for (let k = 0; k < state.n; k++) { const c = Math.floor(state.y[k]) * W + Math.floor(state.x[k]); if (c >= 0 && c < g.N && !solid[c]) crowd[c]++; }
    }
    for (const fresh of [true, false]) {
      pass++;
      let head = 0, tail = 0;
      walk[tail++] = from; walked[from] = pass;
      while (head < tail) {
        const c = walk[head++];
        if (!solid[c] && crowd[c] < 2 * PER_CELL) { crowd[c]++; return c; }
        const i = c % W, j = (c - i) / W;
        for (const n of [j > 0 ? c - W : -1, i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j < H - 1 ? c + W : -1]) {
          if (n < 0 || walked[n] === pass || (solid[n] && (owner[n] !== o || (fresh && !covered(n))))) continue;
          walked[n] = pass; walk[tail++] = n;
        }
      }
    }
    return -1;
  };
  if (effect.liquid) {
    const moved = state.coupling && state.coupling.list.length ? new Map(state.coupling.list.map(b => [b.obstacle, b])) : null;
    for (let k = state.n - 1; k >= 0; k--) {
      const x = state.x[k], y = state.y[k], c = Math.floor(y) * W + Math.floor(x);
      if (!covered(c) && !passed(c)) continue;
      const o = covered(c) ? owner[c] : swept[c], back = effect.obstacles[o].body !== undefined ? refill(o, x, y) : -1;
      if (back >= 0) {
        const at = places[o], bx = back % W + 0.5, by = Math.floor(back / W) + 0.5, mx = at.vx - at.w * (by - at.cy), my = at.vy + at.w * (bx - at.cx);
        state.x[k] = bx + (random(effect.seed, state.id[k], SALT.drain, 7) - 0.5) * 0.9; state.y[k] = by + (random(effect.seed, state.id[k], SALT.drain, 8) - 0.5) * 0.9;
        // A body the liquid's pressure moves (see couplingOf) trades its push with the liquid round it in the solve.
        if (!at.mass) { state.vx[k] = mx; state.vy[k] = my; }
        continue;
      }
      const s = shift[o] ?? outward(o, x, y), to = s ? landing(x, y, o, s) : -1;
      // Fluid a body lands on keeps its matter: with nowhere along the move, it goes to the nearest open cell.
      if (to < 0 && effect.obstacles[o].body !== undefined) { const near = nearestOpen(x, y); if (near >= 0) { state.x[k] = near % W + 0.5; state.y[k] = Math.floor(near / W) + 0.5; continue; } }
      if (to < 0) {
        const out = squeezed(c, o);
        if (out < 0) { removeParticle(state, k); continue; }
        state.x[k] = out % W + 0.5 + (random(effect.seed, state.id[k], SALT.drain, 7) - 0.5) * 0.9; state.y[k] = Math.floor(out / W) + 0.5 + (random(effect.seed, state.id[k], SALT.drain, 8) - 0.5) * 0.9;
        continue;
      }
      // Into the open cell the walk reached, just past the obstacle, moving at least as fast as it does. A body the
      // liquid's pressure moves pays for that: the particle and the body meet as one knock that sticks, so a stone
      // throws what it lands on nearly at its own speed and a light plank landing flat is stopped by it. (Given the
      // body's speed for nothing, the liquid under a plank moved with it already, and the solve let it drive on.)
      const length = Math.sqrt(s[0] * s[0] + s[1] * s[1]), ux = s[0] / length, uy = s[1] / length, tx = to % W, ty = (to - tx) / W;
      let px = x, py = y;
      while (Math.floor(px) !== tx || Math.floor(py) !== ty) { px += 0.5 * ux; py += 0.5 * uy; }
      state.x[k] = px; state.y[k] = py;
      const along = state.vx[k] * ux + state.vy[k] * uy, body = moved ? moved.get(o) : undefined;
      if (body) {
        const pace = body.vx * ux + body.vy * uy, share = body.im / (body.im + PER_CELL);
        if (along < pace) {
          const meet = pace - (pace - along) * share;
          state.vx[k] += (meet - along) * ux; state.vy[k] += (meet - along) * uy;
          body.vx += (meet - pace) * ux; body.vy += (meet - pace) * uy; body.dvx += (meet - pace) * ux; body.dvy += (meet - pace) * uy;
        }
        continue;
      }
      const pace = speed[o] ? Math.sqrt(speed[o][0] * speed[o][0] + speed[o][1] * speed[o][1]) : length;
      if (along < pace) { state.vx[k] += (pace - along) * ux; state.vy[k] += (pace - along) * uy; }
    }
  } else {
    const { d, T } = state;
    for (let c = 0; c < g.N; c++) {
      if ((!covered(c) && !passed(c)) || (!d[c] && !T[c])) continue;
      const o = covered(c) ? owner[c] : swept[c], s = shift[o] ?? outward(o, c % W + 0.5, Math.floor(c / W) + 0.5), to = s ? landing(c % W + 0.5, Math.floor(c / W) + 0.5, o, s) : -1;
      if (to >= 0) { d[to] += d[c]; T[to] += T[c]; }
      d[c] = 0; T[c] = 0;
    }
  }
}
// The stamps of the obstacles drawn under or over the fluid, at their places in a layout. An obstacle that hangs off the
// canvas copies only the part of its symbol on it, so the frame draws nothing outside the canvas.
const stampsOf = (effect, layout, draw, width, height) => effect.obstacles.flatMap((o, i) => {
  const at = layout.places[i];
  if (o.draw !== draw || !at.show) return [];
  const part = onCanvas(o.rows, at.x, at.y, width, height);
  if (!part) return [];
  if (part.w === o.rows[0].length && part.h === o.rows.length) return [{ op: 'stamp', symbol: o.symbol, x: at.x, y: at.y }];
  return [{ op: 'copy', symbol: o.symbol, sx: part.sx, sy: part.sy, w: part.w, h: part.h, x: at.x + part.sx, y: at.y + part.sy }];
});
// Frame `t` of a run, `cycle` within the effect's cycle: every active emitter adds its share, its strength scaled by
// `factors[index]` when given. Returns where each emitter was, or null where it was idle, for its sparks.
function emitFrame(run, t, cycle, factors = null) {
  const { effect, state } = run, { frames, loop, seed, emitters, liquid } = effect;
  if (!liquid) state.source.fill(0);
  return emitters.map((e, index) => {
    if (!active(e, cycle)) return null;
    const factor = factors ? factors[index] : 1;
    const emit = (along, share) => (liquid ? emitLiquid(state, e, index, cycle, seed, along, factor) : emitGas(state.g, state, e, index, cycle, seed, along, share, factor));
    // A rate emitter that orbits, or follows a moving obstacle, is laid along the path it covered since the last frame,
    // about a pixel apart, so a fast one leaves a smooth trail instead of a string of beads; its expansion is shared
    // out along the way. A carrying emitter throws once a frame: carriers already fly, and laying it along its path
    // would throw one per covered cell at every point.
    if (!(e.orbit || e.follow) || e.burst || e.carry || !t || !active(e, loop ? (cycle + frames - 1) % frames : cycle - 1)) return emit(cycle, 1);
    const steps = laidSteps(e, cycle);
    for (let k = 1; k < steps; k++) emit(cycle - 1 + k / steps, 1 / steps);
    return emit(cycle, 1 / steps);
  });
}
// The solver's substeps for one frame, with the settings its keys give frame `cycle` of the effect's cycle.
function solveFrame(run, cycle) {
  const { state } = run, effect = run.effect.schedule ? { ...run.effect, ...run.effect.schedule[cycle] } : run.effect, dt = 1 / effect.substeps;
  if (state.electric) { state.electric.cycle = cycle; state.electric.layout = run.layout; }
  // Whitewater measures how much each particle's velocity changes over the frame's steps, not what emitters set.
  if (effect.liquid && effect.whitewater.length) { state.pvx.set(state.vx.subarray(0, state.n)); state.pvy.set(state.vy.subarray(0, state.n)); }
  if (effect.liquid) state.lifts = liftsOf(run.sparks);
  if (state.air) state.air.release.length = 0;
  const vapour = state.heat && state.heat.vapour;
  // `phase`: how much of the frame has passed at the end of each step, for what clings to moving obstacles.
  for (let s = 0; s < effect.substeps; s++) {
    state.phase = (s + 1) / effect.substeps;
    if (!effect.liquid) { stepGas(state, effect, dt); continue; }
    if (state.electric) electricStep(state, effect, dt);
    if (state.heat) heatStep(run, effect, dt, s === 0);
    stepLiquid(state, effect, dt);
    if (vapour) stepVapour(state, effect, dt);
  }
  if (effect.liquid) run.maxParticles = Math.max(run.maxParticles, state.n);
}
// Where the bubbles with lift are, and how much of their buoyancy each hands on (its share times its air), or null.
function liftsOf(sparks) {
  let lifts = null;
  for (const p of sparks) if (p.s.lift) (lifts ??= []).push(p.x, p.y, p.s.lift * p.vol);
  return lifts;
}
const fieldsOf = run => {
  if (!run.effect.liquid) return gasFields(run.state, run.base);
  liquidFields(run.state, run.base);
  if (run.state.heat) heatFields(run);
};
// A frame's pixels from the fields. The drawing holds each pixel's bands from the frame drawn before it (run.hold, see
// renderFields), so every simulated frame is drawn once, in order, warm-up included.
const drawFrame = (run, width, height, drawn = null) => {
  const { hold } = run;
  hold.now = {};
  const chars = run.state.heat ? renderHeat(run, width, height, drawn, hold) : renderFields(run.view, run.base, width, height, drawn, hold);
  hold.prev = hold.now;
  return chars;
};
// Sparks move with this frame's flow; then, while `spawning`, new ones join where their emitters were (`here`) and
// whitewater where the water throws it, and while `bubbling` the bubbles that push the water do (see pushesWater; a
// loop makes those from its warm-up on, tagged with the frame they are born on). Returns the message for the spark
// limit if it kept any out, or null.
function sparkFrame(run, here, cycle, spawning, bubbling = spawning) {
  const { effect, state, base, sparks, totals } = run;
  const gravity = effect.liquid ? (effect.schedule ? effect.schedule[cycle].gravity : effect.gravity) : null;
  run.gravity = gravity;
  moveSparks(sparks, state.g, base[0], totals, effect.liquid, run.pops, gravity, endedOf(run), gatherOf(run));
  let full = null;
  if (spawning || bubbling) {
    const born = effect.loop ? run.clock : undefined, throws = s => (pushesWater(effect, s) ? bubbling : spawning);
    effect.emitters.forEach((e, index) => { if (!full && here[index] && e.sparks && throws(e.sparks) && !spawnSparks(sparks, e, index, cycle, here[index], effect.seed, totals, pushesWater(effect, e.sparks) ? born : undefined)) full = SPARKS_FULL; });
    if (!full && effect.whitewater.length && !throwWhitewater(state, effect, base[0], sparks, cycle, totals, throws, born)) full = WHITEWATER_FULL;
    if (!full && bubbling && state.air && state.air.release.length && !releaseAir(state.air, effect, sparks, cycle, totals, born)) full = AIR_FULL;
  }
  totals.maxAlive = Math.max(totals.maxAlive, totals.alive);
  return full;
}
// Runs one effect and returns its frames' operations plus figures for the metadata.
function simulate(effect, context) {
  // Bodies move their obstacles each frame, so a run works on its own copies of them.
  if (effect.bodies) effect = { ...effect, obstacles: effect.obstacles.map(o => (o.body === undefined ? o : { ...o })) };
  const { width, height, path } = context, { frames, loop, liquid } = effect, N = width * height;
  const run = createRun(effect, width, height, path), { state, base } = run, all = run.fields;
  const crowd = effect.bodies ? createBodyWorld({ substeps: 8, iterations: 6, gravity: effect.gravity, walls: effect.walls, obstacles: effect.bodies.statics, bodies: effect.bodies.list }, { width, height }) : null;
  if (crowd) crowd.advance(0);
  // The bodies' hits so far after each frame, so a loop counts its cycle's own.
  const hitsAt = crowd ? [crowd.stats.hits] : null;
  // A loop warms up for whole cycles under its periodic forcing, keeps the fields of the last cycle's closing frames,
  // and blends its own closing frames toward them: the last frame then flows into frame 0 as that cycle's did.
  const begin = effect.warmup * frames, total = simulatedFrames(effect), blend = effect.blend;
  // A loop draws the bubbles born in its recorded cycle only (a boil's, and those of emitters, whitewater and air pockets
  // that push the water, see pushesWater), on every frame they live, wrapped round to frame 0 as sparks are; those born
  // in its warm-up still carry their vapour and lift the water, unseen. Once none of its own is left, and no spark's tail
  // is still to come, the run stops. (Drawn as they came, the warm-up's bubbles stood at frame 0 where the cycle's own
  // should have been, and bubbles popped in and out where the loop repeats.)
  const bubbling = loop && makesBubbles(effect);
  const shown = loop && (boilTail(effect) || bubbling) ? p => p.born === undefined || (p.born >= begin && p.born < begin + frames) : null, done = (effect.warmup + 1) * frames + sparkTail(effect);
  const tail = loop ? Array.from({ length: blend }, () => all.map(() => new Float64Array(N))) : [], seam = loop ? Array.from({ length: blend + 1 }, () => null) : null;
  const chars = Array.from({ length: frames }, () => null), drawn = Array.from({ length: frames }, () => []), n = context.subpixels ?? 1, fine = [];
  // The light of each recorded frame, and for a loop the light of the warm-up's closing frames, which its own closing
  // frames are blended toward as the fields are; and the pixels each frame's bodies drew, which their light lies on.
  const lights = run.shine ? Array.from({ length: frames }, () => null) : null, shineTail = lights && loop ? Array.from({ length: blend }, () => null) : null, painted = [];
  const peak = { density: 0, temperature: 0, speed: 0, ...(effect.electric && { ionization: 0, current: 0 }) }, figures = Array.from({ length: frames }, () => null), layouts = Array.from({ length: frames }, () => effect.layout);
  // A loop's bodies, where they were in the warm-up's closing frames, which its own closing frames are drawn blended toward,
  // and what those frames drew the fluid against (see closingView).
  const poses = crowd && loop ? Array.from({ length: blend }, () => null) : null, scenes = poses ? poses.map(() => null) : null;
  let ran = 0;
  for (let t = 0; t < total; t++, ran++) {
    if (shown && t >= done && !run.sparks.some(p => p.born !== undefined && shown(p))) break;
    run.clock = t;
    const cycle = loop ? t % frames : t, out = t - begin, recording = !loop || (out >= 0 && out < frames);
    if (effect.moving) { if (crowd) placeBodies(run, crowd, cycle); moveObstacles(run, cycle); }
    const here = emitFrame(run, t, cycle);
    solveFrame(run, cycle);
    if (liquid && state.full) crowded(path);
    if (state.overflow) fail(path, `more than ${LIMITS.carriers} carriers are in the air at once; lower the carrying emitters' size or rate, or raise their release`);
    // Bodies step on every simulated frame, warm-up included; what reads the fields reads this frame's.
    const onward = () => { if (crowd && t + 1 < total) { stepBodies(run, crowd, cycle, t + 1); hitsAt[t + 1] = crowd.stats.hits; } };
    fieldsOf(run);
    if (loop && out < 0) {
      // The warm-up's closing frames keep their fields for the seam; its sparks and bubbles move on through it (held still
      // there, bubbles waited `blend` frames under the water while it flowed on).
      if (out >= -blend) {
        tail[out + blend].forEach((field, f) => field.set(all[f]));
        if (poses) { poses[out + blend] = posesOf(crowd, run.heldCells); scenes[out + blend] = sceneOf(run, state); }
      }
      if (lights) { stepShine(run, width, height); if (out >= -blend) shineTail[out + blend] = Float64Array.from(run.shine.lit); }
      if (run.sparks.length || bubbling) { const full = sparkFrame(run, here, cycle, false, bubbling); if (full) fail(path, full); }
      // The warm-up is drawn too, unseen, so the drawing's memory of each pixel's bands (see renderFields) runs on into
      // frame 0 as it runs through the cycle; the memories of its last blend + 1 frames are kept for the seam (handBack).
      if (crowd && state.wake) run.view.wakes = { fluid: state.fluid, left: state.wake.left };
      drawFrame(run, width, height);
      if (out >= -blend - 1) seam[out + blend + 1] = run.hold.prev;
      onward();
      continue;
    }
    // A looping effect spawns sparks during the recorded cycle only (bubbles that push the water from the warm-up on, unseen
    // until the cycle); those still alive after it are drawn from frame 0.
    const full = sparkFrame(run, here, cycle, recording, recording || bubbling);
    if (full) fail(path, full);
    // Bubbles live through a loop's warm-up too (they carry vapour and lift the water); only the recorded cycle on draws them.
    const list = loop && out < 0 ? null : drawn[(loop ? out : t) % frames];
    if (list) drawSparks(run, (x, y, code) => { if (x >= 0 && y >= 0 && x < width && y < height && !run.view.front[y * width + x]) list.push(y * width + x, code); }, shown);
    if (!recording) { onward(); continue; }
    const frame = loop ? out : t, k = frame - (frames - blend), closing = loop && k >= 0;
    // A loop's closing frame with bodies: the bodies as drawn (blended toward the warm-up's poses) and the view its fluid
    // is drawn against (see closingView), so the last frame draws the warm-up's last exactly and frame 0 follows it.
    const shownBodies = crowd && closing && poses[k] ? blendPoses(crowd, poses[k], smooth((k + 1) / blend)) : crowd ? crowd.bodies : null;
    if (crowd && state.wake) run.view.wakes = { fluid: state.fluid, left: state.wake.left };
    const view = run.view, closingScene = crowd && closing && scenes[k] ? scenes[k] : null;
    if (closing) {
      const w = smooth((k + 1) / blend);
      if (!closingScene) for (let f = 0; f < all.length; f++) { const a = all[f], b = tail[k][f]; for (let c = 0; c < N; c++) a[c] = a[c] * (1 - w) + b[c] * w; }
      else {
        // Where a body is now but wasn't then, the fluid is the warm-up's; where it was then but isn't now, the cycle's own
        // until the last frame: blended there, each body left a hole of its shape in the liquid between the two.
        const now = view.solid, then = closingScene.solid;
        for (let f = 0; f < all.length; f++) {
          const a = all[f], b = tail[k][f];
          for (let c = 0; c < N; c++) { const wc = w >= 1 || now[c] === then[c] ? w : now[c] ? 1 : 0; a[c] = a[c] * (1 - wc) + b[c] * wc; }
        }
      }
      handBack(run.hold, seam[k], w, effect.seed);
      if (closingScene) run.view = closingView(run, shownBodies, cycle, closingScene, w, effect.seed);
    }
    if (lights) {
      stepShine(run, width, height);
      if (closing) { const w = smooth((k + 1) / blend), lit = run.shine.lit, then = shineTail[k]; for (let c = 0; c < N; c++) lit[c] = lit[c] * (1 - w) + then[c] * w; }
      lights[frame] = frameLight(run);
    }
    for (let c = 0; c < N; c++) {
      if (base[0][c] > peak.density) peak.density = base[0][c];
      if (base[1][c] > peak.temperature) peak.temperature = base[1][c];
      if (base[2][c] > peak.speed) peak.speed = base[2][c];
    }
    if (effect.electric) { const plasma = liquid ? run.vapourBase : base; for (let c = 0; c < N; c++) { if (plasma[4][c] > peak.ionization) peak.ionization = plasma[4][c]; if (plasma[5][c] > peak.current) peak.current = plasma[5][c]; } }
    chars[frame] = drawFrame(run, width, height);
    figures[frame] = measureFrame(chars[frame], base, run.view.solid, width, height, liquid ? state.n : null);
    if (state.heat) Object.assign(figures[frame], heatAmounts(run));
    layouts[frame] = run.layout;
    // Bodies are drawn where the fluid met them this frame (a loop's closing frames blended toward where the warm-up's
    // were, as its fields are), then pulled by it and stepped to the next.
    run.view = view;
    if (crowd) {
      // Finer than the fluid's pixels (subpixels), they are drawn on their own over it; else into its pixels.
      if (n > 1) fine[frame] = drawBodies(shownBodies, width, height, effect.bodies.symbols, n);
      else { const own = bodiesOver(shownBodies, chars[frame], width, height, effect.bodies.symbols); if (lights) painted[frame] = own; }
      onward();
    }
  }
  // Sparks draw over the fluid; obstacles drawn over it sit in front of both.
  const output = chars.map((grid, i) => {
    const list = drawn[i];
    for (let k = 0; k < list.length; k += 2) grid[list[k]] = list[k + 1];
    let left = width, top = height, right = -1, bottom = -1;
    for (let c = 0; c < N; c++) if (grid[c]) { const x = c % width, y = Math.floor(c / width); if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
    const ops = stampsOf(effect, layouts[i], 'under', width, height);
    let pixels = 0;
    if (right >= 0) {
      const rows = [];
      for (let y = top; y <= bottom; y++) { let row = ''; for (let x = left; x <= right; x++) { const ch = grid[y * width + x]; row += ch ? String.fromCharCode(ch) : '.'; if (ch) pixels++; } rows.push(row); }
      ops.push({ op: 'grid', x: left, y: top, rows });
    }
    // What is drawn at the bodies' own pixels when they are finer than the fluid's: the bodies, and their light.
    const sharp = [];
    if (fine[i]?.op) { ops.push(fine[i].op); sharp.push(fine[i].op); pixels += Math.round(fine[i].pixels / (n * n)); }
    ops.push(...stampsOf(effect, layouts[i], 'over', width, height));
    // The light, last: over the obstacles, whose faces it lights. Bodies drawn finer than the fluid's pixels take theirs
    // at their own, in a grid after it (see fineLight), and the fluid's light leaves out the cells they are drawn in.
    if (lights) {
      let sparks = null;
      for (let k = 0; k < list.length; k += 2) (sparks ??= new Uint8Array(N))[list[k]] = 1;
      const codes = shineCodes(effect, layouts[i], lights[i], grid, sparks, painted[i] ?? null, width, height);
      const finer = fine[i]?.op ? fineLight(effect.shine, lights[i], codes, fine[i].op, width, height, n) : null;
      const light = codeGrid(codes, width, height, finer && (c => !finer.cells[c]));
      if (light) ops.push(light);
      if (finer?.op) { ops.push(finer.op); sharp.push(finer.op); }
    }
    // Drawn n times finer, the fluid and its obstacles are enlarged to the bodies' pixels.
    return { ops: n > 1 ? ops.map(op => (sharp.includes(op) ? op : { ...op, x: op.x * n, y: op.y * n, scale: n })) : ops, pixels };
  });
  const round = value => Math.floor(value * 1000 + 0.5) / 1000;
  const { totals } = run;
  return {
    ...(crowd && bodiesFigures(crowd, hitsAt, effect, begin)),
    output, steps: ran * effect.substeps, peak: { density: round(peak.density), ...(!liquid && { temperature: round(peak.temperature) }), speed: round(peak.speed), ...(effect.electric && { ionization: round(peak.ionization), current: round(peak.current) }) },
    ...(liquid && { particles: run.maxParticles }), sparks: { spawned: totals.spawned, maxAlive: totals.maxAlive }, figures: columns(figures)
  };
}

// Reads a whole source and checks it as compileFluid does. Each effect is read in turn, checked against the frame
// limit, and passed to `each(name, effect, { width, height, path })`, which returns its frames' operations (or null to
// leave them empty, as a live runner does). The renderer then checks the recipe, so a live runner gets every check
// compileFluid makes before simulating, with the same paths and messages, except the work budget: compileFluid counts
// every frame of every effect before simulating it, while a live runner steps one frame at a time and bounds its warm-up.
function buildRecipe(source, each) {
  fields(source, ['format', 'version', 'name', 'width', 'height', 'subpixels', 'palette', 'symbols', 'anchor', 'effects', 'sheet'], 'fluid');
  if (source.format !== 'pixelforge-fluid' || source.version !== 1) fail('fluid', 'expected version-1 pixelforge-fluid');
  const palette = source.palette ?? {};
  if (!isObject(palette)) fail('fluid.palette', 'expected a palette object');
  const width = integer(source.width, 'fluid.width', 4, 128), height = integer(source.height, 'fluid.height', 4, 128);
  const subpixels = readSubpixels(source.subpixels, 'fluid', width, height, source.effects);
  const symbols = source.symbols ?? {};
  if (!isObject(symbols)) fail('fluid.symbols', 'expected named symbols for obstacles');
  for (const [name, rows] of Object.entries(symbols)) {
    identifier(name, `fluid.symbols.${name}`);
    if (!Array.isArray(rows) || !rows.length || rows.length > 128 || typeof rows[0] !== 'string' || !rows[0].length || rows.some(row => typeof row !== 'string')) fail(`fluid.symbols.${name}`, 'expected 1–128 equal-width text rows');
    sameWidth(rows, `fluid.symbols.${name}`);
  }
  if (!isObject(source.effects) || !Object.keys(source.effects).length || Object.keys(source.effects).length > LIMITS.effects) fail('fluid.effects', `expected 1–${LIMITS.effects} named effects`);
  const frames = [], animations = {}, seen = new Set();
  for (const [name, value] of Object.entries(source.effects)) {
    const path = `fluid.effects.${name}`;
    identifier(name, path);
    // Effect names become animation and frame names, which must be unique ignoring case for portable bundles.
    if (seen.has(name.toLowerCase())) fail(path, 'effect names must be unique ignoring case; they name animations and frames');
    seen.add(name.toLowerCase());
    const effect = readEffect(value, path, { width, height, palette, symbols });
    if (frames.length + effect.frames > 256) fail('fluid.effects', `the effects make more than 256 frames; a recipe holds at most 256`);
    framesFit(frames.length + effect.frames, width, height, subpixels, 'fluid');
    const ops = each(name, effect, { width, height, path, subpixels });
    const names = effect.durations.map((duration, i) => {
      frames.push({ name: `${name}-${i}`, duration, ...(ops?.[i].length && { ops: ops[i] }) });
      return `${name}-${i}`;
    });
    animations[name] = { frames: names, ...(!effect.loop && { loop: false }) };
  }
  const recipe = { version: 1, name: source.name, width: width * subpixels, height: height * subpixels, palette, ...(Object.keys(symbols).length && { symbols }), ...(source.anchor !== undefined && { anchor: scaleAnchor(source.anchor, subpixels) }), frames, animations, ...(source.sheet !== undefined && { sheet: source.sheet }) };
  renderProject(recipe);
  return recipe;
}

// The recipe, figures for each effect, and `warnings` (only when there are any): setups that compile but make nothing or
// look stuck, each naming the field to change.
export function compileFluid(source) {
  const metadata = { format: 'pixelforge-fluid-metadata', version: 1, effects: {} }, warnings = [];
  let work = 0;
  const recipe = buildRecipe(source, (name, effect, context) => {
    // Bounded work, checked before each effect is simulated: about one update per cell per pressure sweep, per step,
    // summed over the source's effects. The presets need at most 61 million.
    work += context.width * context.height * simulatedFrames(effect) * effect.substeps * stepWork(effect);
    if (work > LIMITS.work) fail(context.path, `the simulations need about ${Math.round(work / 1e6)} million cell updates, more than ${LIMITS.work / 1e6} million; lower frames, warmup, substeps, iterations or the canvas size`);
    const run = simulate(effect, context), effectWarnings = [...effect.warnings, ...(run.notes ?? [])];
    if (effect.shine && run.peak[effect.shine.name] < effect.shine.from) effectWarnings.push(`${context.path}.shine.from is ${effect.shine.from}, above the most ${effect.shine.name} the gas reaches (${run.peak[effect.shine.name]}), so nothing shines: lower it`);
    warnings.push(...effectWarnings);
    metadata.effects[name] = {
      kind: effect.kind, frames: effect.frames, loop: effect.loop, seed: effect.seed, steps: run.steps, ...(effect.loop && { warmup: effect.warmup, blend: effect.blend }),
      peak: run.peak, ...(run.particles !== undefined && { particles: run.particles }), sparks: run.sparks,
      pixels: run.output.map(frame => frame.pixels), ...(!effect.loop && { residue: run.output.at(-1).pixels }), figures: run.figures, ...(run.bodies && { bodies: run.bodies }), ...(effectWarnings.length && { warnings: effectWarnings })
    };
    return run.output.map(frame => frame.ops);
  });
  return JSON.parse(JSON.stringify({ recipe, metadata, ...(warnings.length && { warnings }) }));
}

// ---- Live runner ------------------------------------------------------------------------------------------------------
// Live pushes and puffs draw from their own random streams, keyed apart from the emitters and whitewater.
const LIVE = 2000;
// Inputs waiting for the next step; past this, the oldest are dropped.
const QUEUED = 1024;
// Pointer-driven inputs clamp to their range instead of failing, so a fast flick can't throw mid-interaction.
const clamp = (value, path, min, max) => {
  if (typeof value !== 'number' || Number.isNaN(value)) fail(path, `expected a number (values beyond ${min} to ${max} are clamped)`);
  return value < min ? min : value > max ? max : value;
};
// A soft disc: 1 at its centre, falling smoothly to 0 at its rim.
const soft = (dx, dy, radius) => { const s = (dx * dx + dy * dy) / (radius * radius); return s >= 1 ? 0 : (1 - s) * (1 - s); };
// The renderer's alpha compositing (core.js), so render() draws exactly what a compiled frame shows.
function composite(data, at, color) {
  const a = color[3] / 255;
  if (a === 0) return;
  if (a === 1) { data.set(color, at); return; }
  const old = data[at + 3] / 255, out = a + old * (1 - a);
  for (let c = 0; c < 3; c++) data[at + c] = Math.round((color[c] * a + data[at + c] * old * (1 - a)) / out);
  data[at + 3] = Math.round(out * 255);
}

// Runs one effect of a source live, a frame at a time, for interactive pages: step it, push its flow, puff smoke or
// water into it, boost an emitter, and render the current frame with the effect's own look. The same source and the same
// calls give the same pixels in every engine. Emitters, pulses and orbits cycle with the frame number modulo the
// effect's frames, as a loop's do (a one-shot repeats); there is no seam to blend, and sparks join on every frame.
export function createLiveFluid(source, options = {}) {
  fields(options, ['effect', 'warmup'], 'live');
  const names = [];
  let chosen = null;
  const recipe = buildRecipe(source, (name, effect, context) => {
    names.push(name);
    if (!chosen && (options.effect ?? name) === name) chosen = { effect, ...context };
    return null;
  });
  if (!chosen) fail('live.effect', `no effect named ${JSON.stringify(options.effect)}; the source has ${names.join(', ')}`);
  const { effect, width, height, path } = chosen, { emitters, liquid, seed } = effect, N = width * height;
  const warmup = options.warmup === undefined ? effect.frames : integer(options.warmup, 'live.warmup', 0, 2048);
  // The warm-up runs before the runner returns, so it keeps compileFluid's work budget; stepping afterwards has none.
  const frameWork = N * effect.substeps * stepWork(effect);
  if (warmup * frameWork > LIMITS.work) fail('live.warmup', `warming up ${warmup} frames${options.warmup === undefined ? ' (the default: one cycle)' : ''} needs about ${Math.round(warmup * frameWork / 1e6)} million cell updates, more than ${LIMITS.work / 1e6} million; warm up at most ${Math.floor(LIMITS.work / frameWork)} frames, or lower substeps or iterations`);

  // Colours by palette key, and the obstacles stamped under and over the fluid, composited in a compiled frame's order.
  const palette = {}, colours = new Map();
  for (const [key, value] of Object.entries(recipe.palette)) {
    const rgba = parseColor(value);
    palette[key] = `#${rgba.slice(0, rgba[3] === 255 ? 3 : 4).map(v => v.toString(16).padStart(2, '0')).join('')}`;
    if (key.length === 1) colours.set(key.charCodeAt(0), rgba);
  }
  let under, underKeys, over, stamped = null;
  // The obstacles drawn under and over the fluid, for the layout the run has now.
  const stampLayers = layout => {
    under = new Uint8ClampedArray(N * 4); underKeys = new Uint16Array(N); over = []; stamped = layout.key;
    effect.obstacles.forEach((o, n) => {
      const at = layout.places[n];
      if (o.draw === 'none' || !at.show) return;
      recipe.symbols[o.symbol].forEach((row, j) => {
        if (at.y + j < 0 || at.y + j >= height) return;
        for (let i = Math.max(0, -at.x); i < Math.min(row.length, width - at.x); i++) {
          if (row[i] === '.' || row[i] === ' ') continue;
          const c = (at.y + j) * width + at.x + i, code = row.charCodeAt(i);
          if (o.draw === 'under') { composite(under, c * 4, colours.get(code)); underKeys[c] = code; } else over.push(c, code);
        }
      });
    });
  };

  // Bodies move their obstacles each frame, so the runner works on its own copies of them.
  const own = effect.bodies ? { ...effect, obstacles: effect.obstacles.map(o => (o.body === undefined ? o : { ...o })) } : effect;
  const run = createRun(own, width, height, path), { state } = run, boosts = emitters.map(() => ({ factor: 1, frames: 0 }));
  const crowd = own.bodies ? createBodyWorld({ substeps: 8, iterations: 6, gravity: own.gravity, walls: own.walls, obstacles: own.bodies.statics, bodies: own.bodies.list }, { width, height }) : null;
  if (crowd) crowd.advance(0);
  let t = 0, queue = [], overlay = [], frame = null;
  const put = (x, y, code) => { if (x >= 0 && y >= 0 && x < width && y < height && !run.view.front[y * width + x]) overlay.push(y * width + x, code); };
  // One frame: the emitters (boosted), then the queued pushes and puffs in the order they were made, the solver, the
  // fields and the sparks. Live runs never stop at a limit: particles, sparks and droplets beyond it are not added, and
  // the limits compileFluid meets while simulating (and the renderer's drawing budget) are not checked.
  const advance = () => {
    const cycle = t % effect.frames;
    // The bodies step first, by the fluid as the last frame left it, so a frame draws them where the fluid met them.
    if (crowd && t > 0) stepBodies(run, crowd, (t - 1) % effect.frames, t);
    if (effect.moving) { if (crowd) placeBodies(run, crowd, cycle); moveObstacles(run, cycle); }
    const here = emitFrame(run, t, cycle, boosts.map(b => (b.frames ? b.factor : 1)));
    queue.forEach((input, n) => input(n));
    queue = [];
    solveFrame(run, cycle);
    fieldsOf(run);
    if (run.shine) stepShine(run, width, height);
    sparkFrame(run, here, cycle, true);
    // Every step is drawn, as compileFluid draws every frame it simulates, so the drawing's memory of each pixel's bands
    // (see renderFields) runs on alike however the steps are batched; render and measure read this frame's drawing.
    if (crowd && state.wake) run.view.wakes = { fluid: state.fluid, left: state.wake.left };
    const drawn = new Uint8Array(N), chars = drawFrame(run, width, height, drawn);
    // The bodies are drawn with every step too: their drawn places hold from step to step (see paintBodies), so drawn
    // only when rendered they came out differently with how often a page renders.
    // Measured without them, as a compiled frame's figures are.
    const fluidOnly = crowd ? Uint16Array.from(chars) : chars;
    frame = { chars, drawn, fluidOnly, bodies: crowd ? bodiesOver(crowd.bodies, chars, width, height, own.bodies.symbols) : null };
    overlay = [];
    drawSparks(run, put);
    for (const b of boosts) if (b.frames) b.frames--;
    t++;
  };
  // A push moves the bodies in its disc as it moves the fluid there, waking them.
  const pushBodies = (x, y, radius, vx, vy) => {
    for (const b of crowd.bodies) {
      if (b.fixed || b.gone) continue;
      const share = soft(b.x - x, b.y - y, radius);
      if (!share) continue;
      b.vx += vx * share; b.vy += vy * share; b.asleep = false; b.sleepy = 0;
    }
  };
  const enqueue = input => {
    if (queue.length >= QUEUED) queue.shift();
    queue.push(input);
  };
  const spot = (input, path, keys) => {
    fields(input, keys, path);
    return [clamp(input.x, `${path}.x`, -256, 512), clamp(input.y, `${path}.y`, -256, 512), clamp(input.radius ?? 4, `${path}.radius`, 0.5, 64)];
  };
  // The cells or faces within `radius` of (x, y): columns i0..i1 and rows j0..j1 of an nx × ny lattice.
  const around = (x, y, radius, nx, ny) => [Math.max(0, Math.floor(x - radius)), Math.min(nx - 1, Math.ceil(x + radius)), Math.max(0, Math.floor(y - radius)), Math.min(ny - 1, Math.ceil(y + radius))];

  // A push adds velocity to the gas's faces, or to the liquid's particles, with a soft disc falloff.
  const push = (x, y, radius, vx, vy) => {
    if (liquid) {
      for (let k = 0; k < state.n; k++) { const w = soft(state.x[k] - x, state.y[k] - y, radius); if (w) { state.vx[k] += vx * w; state.vy[k] += vy * w; } }
      return;
    }
    const { W, H, u, v, uFixed, vFixed } = state.g;
    let [i0, i1, j0, j1] = around(x, y, radius, W + 1, H);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * (W + 1) + i, w = soft(i - x, j + 0.5 - y, radius); if (w && !uFixed[k]) u[k] += vx * w; }
    [i0, i1, j0, j1] = around(x, y, radius, W, H + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i, w = soft(i + 0.5 - x, j - y, radius); if (w && !vFixed[k]) v[k] += vy * w; }
  };
  // A gas puff adds density and heat with a soft disc falloff (negative amounts take them away). A liquid puff works as
  // a liquid emitter's disc does: it fills its cells to `density` (the share filled) with still water, or drains that
  // share of the particles there when negative, with a soft one-pixel rim.
  const puff = (x, y, radius, density, temperature, n) => {
    if (state.heat) { state.heat.spawnFrozen = 0; state.heat.spawnEnergy = energyOf(state.heat.heat, state.heat.heat.ambient, false); }
    const { W, H, pixels: solid } = state.g, disc = { radius }, [i0, i1, j0, j1] = around(x, y, liquid ? radius + 1 : radius, W, H);
    if (!liquid) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * W + i, w = soft(i + 0.5 - x, j + 0.5 - y, radius);
        if (!w || solid[c]) continue;
        state.d[c] += density * w; state.T[c] += temperature * w;
        if (state.d[c] < 0) state.d[c] = 0;
        if (state.T[c] < 0) state.T[c] = 0;
      }
    } else if (density < 0) {
      for (let k = state.n - 1; k >= 0; k--) { const w = coverage(disc, state.x[k] - x, state.y[k] - y); if (w && random(seed, LIVE, t, n, SALT.drain, state.id[k]) < -density * w) removeParticle(state, k); }
    } else {
      countCells(state);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * W + i, want = Math.floor(PER_CELL * density * coverage(disc, i + 0.5 - x, j + 0.5 - y) + 0.5);
        if (!solid[c] && want > state.cells[c] && !seedCell(state, i, j, want, state.cells[c], [0, 0], [seed, LIVE, t, n, i, j])) return;
      }
    }
  };

  const live = {
    width, height, kind: effect.kind, palette, frames: effect.frames, warnings: [...effect.warnings],
    // Frames simulated so far, warm-up included; the emitters are at frame `frame % frames` of their cycle.
    get frame() { return t; },
    get particles() { return liquid ? state.n : 0; },
    get sparks() { return run.sparks.length; },
    // Where each body is now: its name (or null), centre, angle in degrees and whether it has left or sleeps.
    get bodies() { return crowd ? crowd.bodies.map(b => ({ name: b.name, x: b.x, y: b.y, angle: atan2Deg(b.s, b.c), gone: b.gone, asleep: !!b.asleep })) : []; },
    step(n = 1) {
      integer(n, 'step', 0, 2048);
      for (let k = 0; k < n; k++) advance();
      return live;
    },
    push(input) {
      const [x, y, radius] = spot(input, 'push', ['x', 'y', 'vx', 'vy', 'radius']);
      const vx = clamp(input.vx ?? 0, 'push.vx', -16, 16), vy = clamp(input.vy ?? 0, 'push.vy', -16, 16);
      enqueue(() => { push(x, y, radius, vx, vy); if (crowd) pushBodies(x, y, radius, vx, vy); });
      return live;
    },
    puff(input) {
      const [x, y, radius] = spot(input, 'puff', ['x', 'y', 'radius', 'density', 'temperature']);
      if (liquid && input.temperature !== undefined) fail('puff.temperature', 'temperature drives gases; a liquid puff adds water');
      const density = clamp(input.density ?? 1, 'puff.density', liquid ? -1 : -16, liquid ? 1 : 16), temperature = clamp(input.temperature ?? 0, 'puff.temperature', -16, 16);
      enqueue(n => puff(x, y, radius, density, temperature, n));
      return live;
    },
    boost(name, strength, frames) {
      const named = emitters.filter(e => e.name !== undefined).map(e => e.name);
      if (!named.includes(name)) fail('boost.name', `no emitter named ${JSON.stringify(name)}; ${named.length ? `this effect's emitters are named ${[...new Set(named)].join(', ')}` : 'give the emitter a name in the source'}`);
      const factor = number(strength, 'boost.strength', 0, 16), count = integer(frames, 'boost.frames', 0, 65536);
      emitters.forEach((e, index) => { if (e.name === name) boosts[index] = { factor, frames: count }; });
      return live;
    },
    // Figures for the current frame, as the metadata's per-frame figures give them for a compiled effect.
    measure() {
      return measureFrame(frame.fluidOnly, run.base, run.view.solid, width, height, liquid ? state.n : null);
    },
    // The current frame: the look layers, cleanup and outline over the fields, sparks and whitewater over them, and the
    // obstacles stamped under or over, as a compiled frame draws them. `keys` names the topmost palette key drawn at each
    // pixel ('.' empty); where a translucent colour blends over another, the pixel is a mix and the key its top layer.
    // `fluid` marks with '#' the pixels the look layers drew the fluid on (under any spark, whitewater or decoration drawn
    // over it), so a page can tell the fluid from an outline, a spark or an obstacle drawn with the same palette key.
    render() {
      if (stamped !== run.layout.key) stampLayers(run.layout);
      const { drawn } = frame, chars = Uint16Array.from(frame.chars);
      for (let k = 0; k < overlay.length; k += 2) chars[overlay[k]] = overlay[k + 1];
      const rgba = under.slice(), codes = underKeys.slice();
      for (let c = 0; c < N; c++) if (chars[c]) { composite(rgba, c * 4, colours.get(chars[c])); codes[c] = chars[c]; }
      for (let k = 0; k < over.length; k += 2) { composite(rgba, over[k] * 4, colours.get(over[k + 1])); codes[over[k]] = over[k + 1]; }
      if (run.shine) {
        let sparks = null;
        for (let k = 0; k < overlay.length; k += 2) (sparks ??= new Uint8Array(N))[overlay[k]] = 1;
        const light = shineCodes(run.effect, run.layout, frameLight(run), chars, sparks, frame.bodies, width, height);
        if (light) for (let c = 0; c < N; c++) if (light[c]) { composite(rgba, c * 4, colours.get(light[c])); codes[c] = light[c]; }
      }
      const keys = [], fluid = [];
      for (let j = 0; j < height; j++) { let row = ''; for (let i = 0; i < width; i++) { const code = codes[j * width + i]; row += code ? String.fromCharCode(code) : '.'; } keys.push(row); }
      for (let j = 0; j < height; j++) { let row = ''; for (let i = 0; i < width; i++) row += drawn[j * width + i] ? '#' : '.'; fluid.push(row); }
      return { rgba, keys, fluid };
    }
  };
  // Unstepped, the runner shows the fields as the fills left them, drawn without memory (the first step draws afresh).
  if (warmup) live.step(warmup);
  else {
    fieldsOf(run);
    const drawn = new Uint8Array(N), chars = drawFrame(run, width, height, drawn), fluidOnly = crowd ? Uint16Array.from(chars) : chars;
    frame = { chars, drawn, fluidOnly, bodies: crowd ? bodiesOver(crowd.bodies, chars, width, height, own.bodies.symbols) : null };
    run.hold.prev = null;
  }
  return live;
}

