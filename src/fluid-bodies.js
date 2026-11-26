// Two-way coupling between rigid bodies (bodies.js) and pixelforge-fluid gases, liquids and sand: face coupling in the
// liquid's pressure solve, buoyancy and drag forces, resting-sand/ice ground retracing, loop closing-pose blends and
// per-body metadata figures. Browser-compatible and deterministic.
import { random } from './craft.js';
import { bodyCells, heldCells, poseCells, areaBeyond } from './bodies.js';
import { LEVEL, SEAM, ICE } from './fluid-grid.js';
import { placementsAt, layoutKey, bodyPlace, buildLayout } from './fluid-source.js';

// ---- Bodies in a liquid ----------------------------------------------------------------------------------------------
// A free body in a liquid is three more unknowns of the liquid's pressure solve, its velocity and its turning
// (docs/physics-model.md, section 13): the pressure on its faces moves it as its faces move the liquid, so the two share
// each push in one solve (Batty, Bertails and Bridson, "A fast variational framework for accurate solid-fluid coupling",
// 2007). Moved by its own velocity alone, a body was a piston of endless mass: a light plank dropped flat onto a pool drove
// the water out from under it as fast as it fell and threw a third of the pool out of the canvas, where the water it met
// should have stopped it. A body yields only to the pressure its motion through the liquid beside it makes: the pressure
// the liquid has with each face moving as the liquid beside it does (`water`, from the liquid's particles) is left out,
// so the liquid at rest, or flowing along with the body, pushes it no more than it did. Its float holds it up against the
// liquid's weight already (fluidForces), by its exact shape, where the grid's whole cells would float a plank on a pixel's
// more head, and its drag drags it along with a stream. (Leaving out the pressure solved for the liquid with the body held
// still made the liquid flowing along with a sinking body stop it every step, and leaving out a still pool's head left a
// crate floating high by a sixth of its weight, the head that the churn of a pool's sparse top cells adds. A mean of each
// cell's pressure over time, left out instead, lagged the push of the liquid a bobbing body sets moving, and fed it.)
// Each face of a body against an open cell is five numbers: its axis (0 across x, 1 along y), the face, the open cell,
// which way the body lies from that cell along the axis (±1) and the turning's lever there (the face moves at v + lever·ω
// along its axis). `extra` keeps the pressure of the bodies' motion from step to step, to start the next solve from.
export function couplingOf(effect, layout, places, W, H, mask, last) {
  const { owner } = layout, X = W + 1, list = [], slot = new Map();
  effect.obstacles.forEach((o, i) => {
    const at = places[i];
    if (o.body === undefined || !at.show || !at.mass) return;
    slot.set(i, list.length);
    list.push({ obstacle: i, im: at.mass.im, ii: at.mass.ii, vx: at.vx, vy: at.vy, w: at.w, dvx: 0, dvy: 0, dw: 0, faces: [], on: [], water: null });
  });
  for (let c = 0; c < W * H && list.length; c++) {
    const n = owner[c] >= 0 && mask[c] ? slot.get(owner[c]) : undefined;
    if (n === undefined) continue;
    const i = c % W, j = (c - i) / W, at = places[list[n].obstacle], f = list[n].faces, ry = j + 0.5 - at.cy, rx = i + 0.5 - at.cx;
    if (i > 0 && !mask[c - 1]) f.push(0, j * X + i, c - 1, 1, -ry);
    if (i < W - 1 && !mask[c + 1]) f.push(0, j * X + i + 1, c + 1, -1, -ry);
    if (j > 0 && !mask[c - W]) f.push(1, c, c - W, 1, rx);
    if (j < H - 1 && !mask[c + W]) f.push(1, c + W, c + W, -1, rx);
  }
  for (const b of list) b.water = new Float64Array(b.faces.length / 5);
  return { list, extra: last ? last.extra : new Float64Array(W * H) };
}
// How fast the liquid beside each face of each body moves across it, as its particles have just handed it to the grid.
export function bodyWater(g, coupling) {
  for (const b of coupling.list) { const F = b.faces; for (let f = 0; f < F.length; f += 5) b.water[f / 5] = (F[f] ? g.v : g.u)[F[f + 1]]; }
}
// A step's walls: each coupled body's faces move at its velocity as the solves so far this frame have left it.
export function bodyWalls(g, coupling) {
  if (!g.uWall) { g.uWall = new Float64Array(g.u.length); g.vWall = new Float64Array(g.v.length); }
  for (const b of coupling.list) {
    const F = b.faces;
    for (let f = 0; f < F.length; f += 5) {
      const now = (F[f] ? b.vy : b.vx) + b.w * F[f + 4];
      (F[f] ? g.vWall : g.uWall)[F[f + 1]] = now;
      if (now) g.moved = true;
    }
  }
}
// The liquid's pull on each body after a frame's steps (docs/physics-model.md, section 13). Submerged: the rows of a body
// (across gravity) with liquid beside them; their weight in liquid lifts it, at their centre, so a light body floats and
// a boat rights itself. Every face against liquid drags it toward that liquid's velocity, solved implicitly so any drag is
// stable, and half its submerged liquid joins its mass. Drag changes a body's velocity before its frame; buoyancy is a
// force through the frame (the bodies' `push`), as their gravity is, so a floating body balances exactly and one resting
// on the bottom or on sand doesn't hop. Grains don't float a body: resting sand holds it up as ground (groundBodies), and
// moving sand drags it hard along with it.
// Water drag grows with the speed between the body and the water (QUADRATIC per pixel a frame), as real drag does, so a
// body slows hard as it hits the water and a light one rises out of it without leaping.
const WATER_DRAG = 0.3, QUADRATIC = 1.5, VISCOUS_DRAG = 0.6, GRAIN_DRAG = 8, ADDED_MASS = 0.5, BODY_WAKE = 0.06;
// Within NEAR_BODY cells of a body the liquid's particles keep at most NEAR_BODY_FLIP of their own motion (FLIP), the rest
// the grid's (PIC): the noise FLIP keeps at a moving body's faces fed a floating body energy every frame. (Over eight
// light planks on still water at the default share, four never settled; with a share of 0.2 two cells out, three still
// rocked; pure PIC three cells out, none.)
export const NEAR_BODY = 3, NEAR_BODY_FLIP = 0;
// Air drags a body a little, growing with the speed between them as water's does, so a blast throws crates.
const AIR_DRAG = 0.1;
// Sand slower than this (pixels a frame) is at rest, and bodies stand on it.
const SAND_REST = 0.2;
function fluidForces(run, crowd) {
  const { effect, state, base } = run, { g } = state, { W, H } = g, X = W + 1, solid = run.view.solid, density = base[0], { liquid, granular } = effect;
  const [gx, gy] = effect.gravity, across = Math.abs(gy) >= Math.abs(gx), sign = (across ? gy : gx) >= 0 ? 1 : -1, heavy = liquid && !granular ? 1 : 0;
  const drag = liquid ? WATER_DRAG * (1 + VISCOUS_DRAG * effect.viscosity) : AIR_DRAG;
  // What a body meets: a liquid's wet cells, or in a gas every open cell (the air).
  const open = n => !solid[n] && (!liquid || density[n] >= LEVEL);
  // What the liquid's pressure solves did to each body through the frame (see couplingOf).
  const yielded = new Map((state.coupling ? state.coupling.list : []).map(y => [y.obstacle, y]));
  crowd.bodies.forEach((b, k) => {
    const o = effect.obstacles[effect.bodies.first + k], at = o.live, y = yielded.get(effect.bodies.first + k);
    if (b.fixed || b.gone || !at.show) return;
    if (y) { b.vx += y.dvx; b.vy += y.dvy; b.w += y.dw; }
    const inside = new Set();
    o.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') { const x = at.x + i, y = at.y + j; if (x >= 0 && y >= 0 && x < W && y < H) inside.add(y * W + x); } });
    const lanes = new Map();
    let K = 0, Kx = 0, Ky = 0, Ku = 0, Kv = 0, Kr = 0, T = 0, faces = 0, held = 0, px = 0, py = 0, pt = 0;
    for (const c of inside) {
      const i = c % W, j = (c - i) / W, key = across ? j : i;
      if (!lanes.has(key)) lanes.set(key, { wet: false, n: 0 });
      const lane = lanes.get(key);
      lane.n++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (inside.has(n)) continue;
        faces++;
        if (!open(n)) continue;
        if ((across ? dj : di) === 0) lane.wet = true;
        // A gas presses on the body's faces with its pressure (a blast's shoves what is beside it); a liquid's weight is in
        // the buoyancy and the load instead.
        if (!liquid) { const q = g.p[n] * effect.substeps, fx = -di * q, fy = -dj * q, rx = (i + ni + 1) / 2 - b.x, ry = (j + nj + 1) / 2 - b.y; px += fx; py += fy; pt += rx * fy - ry * fx; }
        // Sand resting on a body only weighs on it (below): gripped by it as well, a loaded plank could never tip.
        if (granular && (across ? dj : di) === -sign) continue;
        held++;
        // The fluid a body drags toward is a cell past the one it touches: that one moves with the body (its faces are the
        // body's walls), and dragged toward its own wake a body pumps itself up and down. No fluid there is still fluid.
        const fi = ni + di, fj = nj + dj, far = fi >= 0 && fj >= 0 && fi < W && fj < H && open(fj * W + fi);
        let ux = far ? (g.u[fj * X + fi] + g.u[fj * X + fi + 1]) / 2 : 0, uy = far ? (g.v[fj * W + fi] + g.v[(fj + 1) * W + fi]) / 2 : 0;
        // Sand slower than SAND_REST is at rest: a body sinking into it stirs it that fast, and dragged along with what it
        // stirs, the body would sink for ever. Only sand that really moves (an avalanche, a pour) carries a body.
        if (granular && ux * ux + uy * uy < SAND_REST * SAND_REST) { ux = 0; uy = 0; }
        const rx = (i + ni + 1) / 2 - b.x, ry = (j + nj + 1) / 2 - b.y, ex = ux - (b.vx - b.w * ry), ey = uy - (b.vy + b.w * rx);
        // A body the liquid's pressure moves (see couplingOf) meets the liquid's push across each face in that solve, so its
        // drag is the rub along each face alone, toward the liquid's flow along it. (Dragged across its faces as well, it met
        // the liquid twice over: a light crate righting itself on the water crept so slowly that it fell asleep tilted.)
        if (y) {
          const grip = drag * (1 + QUADRATIC * Math.abs(di ? ey : ex));
          if (di) { Ky += grip; Kv += grip * uy; Kr += grip * rx * rx; T += grip * rx * (uy - b.vy); }
          else { Kx += grip; Ku += grip * ux; Kr += grip * ry * ry; T -= grip * ry * (ux - b.vx); }
          continue;
        }
        const grip = granular ? GRAIN_DRAG : drag * (1 + QUADRATIC * Math.sqrt(ex * ex + ey * ey));
        K += grip; Kx += grip; Ky += grip; Ku += grip * ux; Kv += grip * uy; Kr += grip * (rx * rx + ry * ry);
        T += grip * (rx * (uy - b.vy) - ry * (ux - b.vx));
      }
    }
    let sub = 0, sx = 0, sy = 0, level = sign * Infinity;
    if (heavy) [sub, sx, sy, level] = submerged(b, inside, lanes, run, across, sign);
    // What rests on the body (docs/physics-model.md, section 13): over each upper face, the column of liquid or sand above
    // it, less what lies below the level of the liquid around the body (its weight is in the buoyancy already).
    let load = 0, loadX = 0, loadY = 0;
    if (liquid) for (const c of inside) {
      const i = c % W, j = (c - i) / W, ui = across ? i : i - sign, uj = across ? j - sign : j;
      if (ui < 0 || uj < 0 || ui >= W || uj >= H || inside.has(uj * W + ui)) continue;
      let column = 0;
      for (let pi = ui, pj = uj, n = 0; n < 128 && pi >= 0 && pj >= 0 && pi < W && pj < H; n++) {
        const q = pj * W + pi;
        if (!open(q)) break;
        if (sign * ((across ? pj : pi) + 0.5 - level) < 0) column += Math.min(1, density[q]);
        if (across) pj -= sign; else pi -= sign;
      }
      if (!column) continue;
      const rx = i + 0.5 - b.x - (across ? 0 : sign * 0.5), ry = j + 0.5 - b.y - (across ? sign * 0.5 : 0);
      load += column; loadX += column * rx; loadY += column * ry;
    }
    if (!Kx && !Ky && !sub && !load && !px && !py) {
      // A body that slept held up by the fluid, or under a load of it, wakes when none of it is left: asleep, a crate
      // afloat on a pool that drained away stayed where the water had held it.
      if (b.asleep && (b.restSub > 0 || b.restLoad > 0)) { b.asleep = false; b.sleepy = 0; }
      b.restSub = undefined; b.restLoad = undefined; b.restLevel = undefined; b.push = null; b.float = null; b.heft = undefined;
      return;
    }
    const m = 1 / b.invMass, added = ADDED_MASS * heavy * sub, fall = b.weightless ? 0 : 1, lift = heavy * sub;
    const tau = (sub ? (sx - b.x) * -lift * gy - (sy - b.y) * -lift * gx : 0) + loadX * gy - loadY * gx, inertia = b.invInertia ? 1 / b.invInertia : 0;
    // In a gas, the body's own motion sets much of the pressure on its faces that pushes it back: met a frame at a time, a
    // light crate overshot each frame, back and forth, faster each time, and stirred the air up after a blast had died.
    // Half the air it fills joins its mass against those pushes, as half the water a body is under does in a liquid (the
    // solve takes air, as water, to weigh a unit a cell); its weight is left alone, as nothing floats in air.
    const yielding = liquid ? added : ADDED_MASS * inside.size, spun = inertia && yielding ? inertia * yielding / m : 0;
    const vx = ((m + yielding) * b.vx + Ku + px) / (m + yielding + Kx), vy = ((m + yielding) * b.vy + Kv + py) / (m + yielding + Ky);
    const w = inertia ? ((inertia + spun) * b.w + T + pt) / (inertia + spun + Kr) : b.w;
    // Buoyancy and the load, less what the added mass takes of the body's own weight, over its mass and the added mass.
    // Sand grips what it is in: its drag holds against the body's own weight too, by the share of the body's faces in
    // sand, so a body that has landed in sand, or stands on a slope of it, stays where it is until the sand itself moves,
    // while a plank whose tip touches sand still falls.
    const grip = granular && faces ? K / (m + K) * held / faces : 0;
    const push = [(-lift * gx + load * gx - added * gx * fall) / (m + added) - grip * gx * fall, (-lift * gy + load * gy - added * gy * fall) / (m + added) - grip * gy * fall, inertia ? tau / inertia : 0];
    // The lift follows the body through its substeps: the level it floats at is held for the frame, and bodies.js takes
    // the shape's area under it, and that part's centre, afresh at each substep (`float`), in place of this frame's lift
    // in the push. (Held as one push for the frame, the lift was a spring stepped a frame at a time, which gained a little
    // every frame: a light plank on still water rocked on and on, and with the liquid's own jostling tipped over.)
    let float = null;
    if (lift && Number.isFinite(level)) {
      float = { axis: across ? 1 : 0, level, sign, gx, gy, mass: m + added, inertia };
      push[0] += lift * gx / (m + added); push[1] += lift * gy / (m + added);
      if (inertia) push[2] -= ((sx - b.x) * -lift * gy - (sy - b.y) * -lift * gx) / inertia;
    }
    // A sleeping body stays asleep in still fluid: what holds it (its buoyancy, the ground or the bottom under it) holds
    // it as before. Fluid flowing past it faster than BODY_WAKE, or rising, falling or piling a row against it, wakes it.
    // So does the level it floats at moving a pixel: a light body has less of itself under the liquid than a row of its
    // cells, and all of that could drain away without the row's worth of change that wakes a heavier one.
    if (b.asleep) {
      const flow = K ? Math.sqrt(Ku * Ku + Kv * Kv) / K : 0, row = Math.max(2, inside.size / 6);
      b.restSub ??= sub; b.restLoad ??= load; b.restLevel ??= float ? level : null;
      const shifted = b.restLevel !== null && !(float && Math.abs(level - b.restLevel) < 1);
      if (flow < BODY_WAKE && Math.abs(sub - b.restSub) < row && Math.abs(load - b.restLoad) < row && !shifted) return;
      b.asleep = false; b.sleepy = 0;
    }
    b.restSub = undefined; b.restLoad = undefined; b.restLevel = undefined;
    // Never hand the bodies a number that isn't one: a body keeps its own motion rather than vanish.
    if (![vx, vy, w, ...push].every(Number.isFinite)) { b.push = null; b.float = null; b.heft = undefined; return; }
    // The liquid that moves with the body is in its mass where it meets other bodies too (bodies.js solves a contact
    // with it). Its lift and weight above are shared over both, so met with its own mass alone a raft held up a load
    // with only that share of its lift: a raft 0.4 as dense as water, under it, with 0.44 of it, and a crate that a
    // raft should carry pushed it under.
    b.vx = vx; b.vy = vy; b.w = w; b.push = push; b.float = float; b.heft = (m + added) / m;
  });
}
// How much of a body is under the liquid, and the centre of that part: [area, x, y]. The level is read in the columns
// just beside the body (rows, for gravity along x): the top of the liquid that reaches its lowest row, to a fraction of a
// pixel by how much the cells at the top hold, averaged over the sides that have liquid. That counts the cells over the
// top wet one that hold a little (the sparse top of a surface, which looks dry), so the level is where the liquid there
// would stand: read from the wet cells alone it stood half a pixel low, and a plank a pixel thick floated a row too deep,
// in the pool's full top row, where it pushed a whole row of water out from under it. It is read from the row of the
// body's lowest point, not its lowest cell's, so a plank landing flat is held up as soon as it dips in. Where the column beside the body is
// dry at its lowest row (the liquid it has just pushed aside, or not yet run back), the level is read up to SIDE columns
// further out. The body's exact shape past that level is what is under, so the lift grows smoothly as it sinks; counted
// in whole rows it jumped a row at a time and a light crate bobbed for ever. Liquid over a body with none beside it (in a
// well) covers it all; none at all, none of it.
// The liquid's top is looked for through any solid in that column (a crate lying over a sunken raft, a ledge): the
// liquid goes on round it, and read as ending under it, the water over the body was a load that held a light raft on the
// bottom after the crate that pushed it under had rolled off beside it. Where the liquid does end under a solid (a body
// afloat beside this one, a lid), the other side's level is the one to go by, if it has one. And where a solid is beside
// the body's lowest row (it stands on a raft wider than itself, or on the bottom), the level is read from the first
// row up that is open: a crate on a raft read no level at all, so it was all under until its top came out and then not
// in the water at all, and the pair bobbed under the surface for good.
const SIDE = 3;
function submerged(b, inside, lanes, run, across, sign) {
  const { base, state } = run, { W, H } = state.g, solid = run.view.solid, density = base[0];
  let low = Infinity, high = -Infinity, near = Infinity, far = -Infinity;
  for (const c of inside) { const i = c % W, j = (c - i) / W, a = across ? j : i, o = across ? i : j; if (a < low) low = a; if (a > high) high = a; if (o < near) near = o; if (o > far) far = o; }
  // What a cell holds, as a share of a full one: null off the canvas or in a solid.
  const held = (o, a) => { const i = across ? o : a, j = across ? a : o; if (i < 0 || j < 0 || i >= W || j >= H) return null; const c = j * W + i; return solid[c] ? null : density[c]; };
  const blocked = (o, a) => { const i = across ? o : a, j = across ? a : o; return i >= 0 && j >= 0 && i < W && j < H && !!solid[j * W + i]; };
  // The row (column) of the body's lowest point, which may lie below its lowest cell: a plank whose cells are all over the
  // water can dip a third of a pixel into it.
  const edge = across ? (sign > 0 ? b.box[3] : b.box[1]) : (sign > 0 ? b.box[2] : b.box[0]);
  const deepest = sign > 0 ? Math.max(high, Math.ceil(edge) - 1) : Math.min(low, Math.floor(edge)), wet = (o, a) => { const d = held(o, a); return d !== null && d >= LEVEL ? d : 0; };
  const shallowest = sign > 0 ? low : high;
  let levels = 0, count = 0, capped = 0, caps = 0;
  for (const [from, step] of [[near - 1, -1], [far + 1, 1]]) {
    let o = from, start = deepest;
    while (start !== shallowest && blocked(o, start)) start -= sign;
    for (let n = 1; n < SIDE && !wet(o, start) && held(o, start) !== null; n++) o += step;
    if (!wet(o, start)) continue;
    let top = start, end = start - sign;
    for (; wet(o, end) || blocked(o, end); end -= sign) if (wet(o, end)) top = end;
    let full = Math.min(1, wet(o, top));
    for (let a = top - sign, n = 0; n < 2; a -= sign, n++) { const d = held(o, a); if (!(d > 0)) break; full += d; }
    const level = sign > 0 ? top + 1 - full : top + full;
    if (top === end + sign) { levels += level; count++; } else { capped += level; caps++; }
  }
  if (!count) { levels = capped; count = caps; }
  if (!count) {
    let covered = 0, cells = 0;
    for (const lane of lanes.values()) if (lane.wet) { covered += lane.n; }
    for (const lane of lanes.values()) cells += lane.n;
    return covered >= cells && cells ? [...areaBeyond(b, across ? 1 : 0, -sign * Infinity, sign), -sign * Infinity] : [0, b.x, b.y, sign * Infinity];
  }
  return [...areaBeyond(b, across ? 1 : 0, levels / count, sign), levels / count];
}
// The obstacles the bodies meet, where they are on frame `cycle`, each moving at its velocity on to its next frame's
// place (its smooth motion, as the liquid's walls move) while the bodies step: bodies.js gives a face that velocity, so
// a box rides a moving shelf.
const staticsAt = (statics, cycle) => statics.map(o => {
  const at = o.track ? o.track[cycle] : { x: o.x, y: o.y, show: true }, then = o.track && cycle + 1 < o.track.length ? o.track[cycle + 1] : null;
  const velocity = then && at.show && then.show && !then.jump && (then.vx || then.vy) ? [then.vx, then.vy] : null;
  return { ...o, x: at.x, y: at.y, solid: o.solid && at.show, ...(velocity && { velocity }) };
});
// Each body's place this frame, as its obstacle; keyed obstacles the bodies meet are retraced when they move.
// A free body in a liquid holds its cells (heldCells, by HOLD_CELLS of a pixel): the liquid's pressure moves it, and
// bobbing about a row it took and gave back a row of the liquid each frame, which kept it bobbing. Sand and fixed bodies
// take the cells their shapes cover.
const HOLD_CELLS = 0.25;
export function placeBodies(run, crowd, cycle) {
  const { effect } = run, { first, statics } = effect.bodies, hold = effect.liquid && !effect.granular;
  const held = run.heldCells ??= [];
  crowd.bodies.forEach((b, k) => {
    const cells = hold && !b.fixed ? heldCells(b, held[k], HOLD_CELLS) : bodyCells(b);
    if (hold && !b.fixed) held[k] = cells;
    Object.assign(effect.obstacles[first + k], bodyPlace(cells, b, !effect.granular));
  });
  if (!effect.granular && statics.some(o => o.track)) {
    const placed = staticsAt(statics, cycle), key = `${layoutKey(placed.map(o => ({ ...o, show: o.solid })))}|${placed.map(o => o.velocity ?? '').join(';')}`;
    if (key !== run.staticsKey) { run.staticsKey = key; crowd.retrace(placed); }
  }
}

// Sand at rest is ground to the bodies (docs/physics-model.md, section 13): each frame the cells of it slower than
// SAND_REST are traced, with the obstacles, as what they stand on. A cell stays ground until its sand moves twice that
// fast or leaves it, so the ground under a body doesn't come and go with the sand's smallest stirrings. Ice is ground too.
function groundBodies(run, crowd, cycle) {
  const { effect, state, base } = run, { g } = state, { W, H } = g, X = W + 1, solid = run.view.solid, density = base[0], rows = [];
  const ground = run.ground ??= new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    let row = '';
    for (let i = 0; i < W; i++) {
      const c = j * W + i, ux = (g.u[j * X + i] + g.u[j * X + i + 1]) / 2, uy = (g.v[c] + g.v[c + W]) / 2, speed = ux * ux + uy * uy;
      ground[c] = state.heat && state.heat.owner[c] === ICE ? 1 : !effect.granular || solid[c] || density[c] < LEVEL ? 0 : speed < SAND_REST * SAND_REST ? 1 : speed < 4 * SAND_REST * SAND_REST ? ground[c] : 0;
      row += ground[c] ? 'x' : '.';
    }
    rows.push(row);
  }
  // Soft: sand that has run in under a body holds it where it is, without shoving it out (a plank jacked upright).
  crowd.retrace([...staticsAt(effect.bodies.statics, cycle), { rows, x: 0, y: 0, solid: true, bounce: 0, friction: 0.8, soft: true }]);
}
// A frame of the bodies after the fluid's: its pull on them, the ground of resting sand and ice, then their own step.
export function stepBodies(run, crowd, cycle, next) {
  fluidForces(run, crowd);
  if (run.effect.granular || run.state.heat) groundBodies(run, crowd, cycle);
  crowd.advance(next);
}
// Where each body is, to draw a loop's closing frames blended toward (the poses of the warm-up's closing frames), with
// the cells a free body in a liquid held there (see placeBodies), which the last closing frame draws it against.
export const posesOf = (crowd, held) => crowd.bodies.map((b, k) => ({ x: b.x, y: b.y, c: b.c, s: b.s, liquidCells: held && held[k] ? held[k].map(([x, y]) => [x, y]) : null }));
// What a warm-up's closing frame drew its fluid against: its solid cells and its bodies' wakes.
export const sceneOf = (run, state) => ({ solid: Uint8Array.from(run.view.solid), wakes: state.wake ? { fluid: Uint8Array.from(state.fluid), left: Uint8Array.from(state.wake.left) } : null });
// The bodies as drawn on a loop's closing frame: each moved toward its pose then by `w` (0 to 1), its turn along the
// shorter way. At the last (w = 1) each is exactly where the warm-up's was, in the cells it held there.
export function blendPoses(crowd, poses, w) {
  return crowd.bodies.map((b, k) => {
    const p = poses[k];
    if (w >= 1) return { ...b, x: p.x, y: p.y, c: p.c, s: p.s, history: [], liquidCells: p.liquidCells };
    const c = b.c * (1 - w) + p.c * w, s = b.s * (1 - w) + p.s * w, m = Math.sqrt(c * c + s * s);
    return { ...b, x: b.x * (1 - w) + p.x * w, y: b.y * (1 - w) + p.y * w, c: m > 1e-9 ? c / m : p.c, s: m > 1e-9 ? s / m : p.s, history: [] };
  });
}
// A loop's closing frame with bodies draws its fluid against them where they are drawn, not where they really are:
// against `shown`'s cells (the bodies blended toward the warm-up's poses), with the wakes handed to the warm-up's cell
// by cell as the drawing's memory is (handBack). Drawn against the bodies where the cycle left them, the last frame
// showed the liquid round a duck and a crate the warm-up's last frame had elsewhere, and the loop jumped there.
export function closingView(run, shown, cycle, then, w, seed) {
  const { effect, state } = run, { first } = effect.bodies, { W, H } = state.g;
  const obstacles = effect.obstacles.map((o, i) => (i < first || i >= first + shown.length ? o : { ...o, ...bodyPlace(shown[i - first].liquidCells ?? poseCells(shown[i - first]), shown[i - first], !effect.granular) }));
  const layout = buildLayout(obstacles, W, H, placementsAt(obstacles, cycle));
  let wakes = run.view.wakes;
  if (then.wakes && state.wake) {
    const fluid = Uint8Array.from(state.fluid), left = Uint8Array.from(state.wake.left);
    for (let c = 0; c < fluid.length; c++) if (random(seed, SEAM, c) < w) { fluid[c] = then.wakes.fluid[c]; left[c] = then.wakes.left[c]; }
    wakes = { fluid, left };
  }
  return { ...run.view, solid: layout.solid, front: layout.front, smooth: layout.smooth, see: layout.see, wakes };
}
// The bodies' figures for the metadata. A loop's are its cycle's, in its frames: the hits from the warm-up's last frame
// on, the bodies that leave in it (at their frame of the loop) and each named body's path through it (null where it is
// gone). A body that leaves before the cycle ends is warned about: the loop never shows one gone in the warm-up, and
// brings one gone in the cycle back at frame 0. (Counted from the start, a loop's hits and escapes took in its warm-up,
// and a body gone in the warm-up had an empty path.)
export function bodiesFigures(crowd, hitsAt, effect, begin) {
  const { stats } = crowd, { frames, loop } = effect, paths = Object.keys(stats.paths).length ? stats.paths : null;
  if (!loop) return { bodies: { hits: stats.hits, escaped: stats.escaped, rest: stats.rest, ...(paths && { paths }) } };
  const last = begin + frames - 1, notes = [];
  for (const { body, frame } of stats.escaped) {
    if (frame > last) continue;
    const b = crowd.bodies.find(other => (other.name ?? other.path) === body), who = !b ? body : b.name === null ? b.path : `${b.path} (${b.name})`;
    notes.push(frame < begin ? `${who} leaves the canvas in the warm-up (its frame ${frame} of ${begin}), so the loop never shows it: keep it on the canvas (a wall on that side, a slower start)`
      : `${who} leaves the canvas on frame ${frame - begin} of the loop and is back on frame 0, so the loop jumps there: keep it on the canvas (a wall on that side, a slower start)`);
  }
  return {
    bodies: { hits: hitsAt[last] - (begin ? hitsAt[begin - 1] : 0), escaped: stats.escaped.filter(e => e.frame >= begin && e.frame <= last).map(e => ({ ...e, frame: e.frame - begin })), rest: null, ...(paths && { paths: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, path.slice(begin, begin + frames)])) }) },
    ...(notes.length && { notes })
  };
}
