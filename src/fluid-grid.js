// Shared constants, staggered grid, smooth-obstacle geometry, pressure projection, advection, viscosity, yield stress,
// granular friction and temperature helpers for pixelforge-fluid. Browser-compatible and deterministic: only + − × ÷ and
// sqrt, fixed sweeps and visiting orders, and craft.js's seeded hashing.
import { random } from './craft.js';

export const FLUID_KINDS = ['gas', 'liquid'];
export const FLUID_FIELDS = ['density', 'temperature', 'speed', 'depth', 'light', 'shadow', 'strand', 'ionization', 'current'];
export const DEPTH = 3, LIGHT = 4, SHADOW = 5, STRAND = 6;
export const FLUID_WALLS = ['left', 'right', 'top', 'bottom'];
export const OBSTACLE_SURFACES = ['pixels', 'smooth'];
export const LIMITS = { effects: 16, emitters: 16, obstacles: 32, fills: 64, looks: 8, whitewater: 4, colors: 16, particles: 32768, sparks: 4096, carriers: 8192, work: 400000000 };
// No flow moves faster than this many pixels per frame; it keeps extreme settings finite without touching normal ones.
export const MAX_SPEED = 32;
// Liquid particles per full cell, and the density at which a cell counts as liquid for depth and bubbles.
export const PER_CELL = 4, LEVEL = 0.5;
// How far along a row the depth bands look for a shallower surface (see renderFields).
export const DEPTH_REACH = 3;
// How far past a threshold a field is clearly past it, as a share of the band's width (for a liquid's edge, of LEVEL):
// the drawing holds each pixel's band until its field has clearly left it (see renderFields). A pixel's memory is a
// byte: its band (HELD bits), WAITING while its field has crossed a threshold for one frame, SETTLED once the field has
// been clearly inside the band. SEAM keys the draws that hand a loop's memory back to the warm-up's (see handBack).
export const HOLD = 0.25, HELD = 63, WAITING = 64, SETTLED = 128, SEAM = 5000;
// Salts keep each random draw independent, so changing one setting does not reshuffle the others.
export const SALT = { flicker: 1, noiseX: 2, noiseY: 3, spawn: 4, jitterX: 5, jitterY: 6, drain: 7, sparks: 8, sparkX: 9, sparkY: 10, angle: 11, speed: 12, life: 13, wobble: 14 };
// Whitewater layers draw from their own streams, keyed apart from the emitters (which are numbered from 0).
export const WHITEWATER = 1000;
// Gas advection schemes and the thickest viscosity a source may ask for, in square pixels per frame.
export const ADVECTION = ['smooth', 'sharp'];
export const MAX_VISCOSITY = 64;
// A yield-stress liquid's elastic stiffness (stress per unit of strain, in square pixels per frame squared): stiff enough
// that a heap holding itself up sags by only a few hundredths, and solved implicitly, so it is stable at any timestep.
// Where it has yielded and flows, the viscosity solve gives it PLASTIC instead, which keeps that flow steady.
export const STIFFNESS = 16, PLASTIC = 1;
// How many frames the cells a moving obstacle leaves stay liquid while liquid closes them in (see transfer).
export const WAKE = 24;
// How far (pixels) liquid a body moves onto may go back into a cell the body has just left.
export const REFILL = 3;

export const smooth = t => t * t * (3 - 2 * t);
export const NONE = -1, ICE = -2, EDGE = -3;

// ---- The grid ---------------------------------------------------------------------------------------------------------
// Cell (i, j) spans [i, i + 1) × [j, j + 1) with y down. Horizontal velocity u lives on the (W + 1) × H vertical faces
// at (i, j + 0.5), vertical velocity v on the W × (H + 1) horizontal faces at (i + 0.5, j), scalars at cell centres.
export function bilinear(a, nx, ny, fx, fy) {
  if (fx < 0) fx = 0; else if (fx > nx - 1) fx = nx - 1;
  if (fy < 0) fy = 0; else if (fy > ny - 1) fy = ny - 1;
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i > nx - 2) i = nx - 2;
  if (j > ny - 2) j = ny - 2;
  const s = fx - i, t = fy - j, k = j * nx + i;
  return (a[k] * (1 - s) + a[k + 1] * s) * (1 - t) + (a[k + nx] * (1 - s) + a[k + nx + 1] * s) * t;
}
// Scalars read zero beyond the grid, so air entering through an open edge is clean.
export function bilinearZero(a, nx, ny, fx, fy) {
  if (fx <= -1 || fy <= -1 || fx >= nx || fy >= ny) return 0;
  const i = Math.floor(fx), j = Math.floor(fy), s = fx - i, t = fy - j, k = j * nx + i;
  if (i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1) return (a[k] * (1 - s) + a[k + 1] * s) * (1 - t) + (a[k + nx] * (1 - s) + a[k + nx + 1] * s) * t;
  const left = i >= 0, right = i + 1 < nx, top = j >= 0, bottom = j + 1 < ny;
  const a00 = left && top ? a[k] : 0, a10 = right && top ? a[k + 1] : 0, a01 = left && bottom ? a[k + nx] : 0, a11 = right && bottom ? a[k + nx + 1] : 0;
  return (a00 * (1 - s) + a10 * s) * (1 - t) + (a01 * (1 - s) + a11 * s) * t;
}

// `solid` is what the solver treats as solid. With smooth obstacles, `geo` (see smoothGeometry) also gives each face the
// share of it that is open, and `pixels` stays the obstacles' own pixels, which emitters, sparks and drawing go by.
// Faces against a solid cell or a closed edge carry no flow.
export function fixFaces(W, H, solid, walls, uFixed, vFixed) {
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    uFixed[j * (W + 1) + i] = i === 0 ? (walls.left || solid[j * W] ? 1 : 0) : i === W ? (walls.right || solid[j * W + W - 1] ? 1 : 0) : (solid[j * W + i - 1] || solid[j * W + i] ? 1 : 0);
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    vFixed[j * W + i] = j === 0 ? (walls.top || solid[i] ? 1 : 0) : j === H ? (walls.bottom || solid[(H - 1) * W + i] ? 1 : 0) : (solid[(j - 1) * W + i] || solid[j * W + i] ? 1 : 0);
  }
}
export function createGrid(width, height, solid, walls, geo = null) {
  const W = width, H = height, N = W * H, U = (W + 1) * H, V = W * (H + 1);
  const uFixed = new Uint8Array(U), vFixed = new Uint8Array(V);
  if (geo) {
    for (let k = 0; k < U; k++) uFixed[k] = geo.uOpen[k] ? 0 : 1;
    for (let k = 0; k < V; k++) vFixed[k] = geo.vOpen[k] ? 0 : 1;
  } else fixFaces(W, H, solid, walls, uFixed, vFixed);
  return {
    W, H, N, solid, walls, uFixed, vFixed, geo, pixels: geo ? geo.pixels : solid,
    u: new Float64Array(U), v: new Float64Array(V), u0: new Float64Array(U), v0: new Float64Array(V),
    p: new Float64Array(N), div: new Float64Array(N), count: new Uint8Array(N), ...(geo && { weights: new Float64Array(N) })
  };
}
export const gridFor = (effect, width, height) => {
  if (!effect.smooth) return createGrid(width, height, effect.solid, effect.walls);
  const geo = smoothGeometry(effect.solid, effect.smooth, width, height, effect.walls);
  return createGrid(width, height, geo.solid, effect.walls, geo);
};

// ---- Smooth obstacles -------------------------------------------------------------------------------------------------
// A smooth obstacle meets the fluid along an outline traced through its pixel steps rather than along the steps
// themselves. Each corner that sticks out loses a triangle with legs of half a pixel, and each corner that turns in (or
// where two pixels touch only at their corners) gains one, so a 1:1 staircase becomes a straight 45° slope through the
// middle of its steps, a 1:2 staircase alternates 45° and upright runs, and straight edges stay where the pixels are. A
// pixel keeps all its corners when cutting them would split it (a line one pixel thick keeps its lower side stepped and
// smooths its upper side), and nothing is smoothed where it meets a pixel obstacle or the canvas edge.
// The solver sees the outline three ways (after Batty, Bertails and Bridson, "A fast variational framework for accurate
// solid-fluid coupling", 2007): each face carries the share of it that is open, so the faces along a slope are half open
// and a flow along the slope needs no pressure to turn at every step; each cell has the share of it that is open, which
// weighs its stresses; and a signed distance to the outline, sampled every half pixel, keeps particles out of it.
const OPEN = 0, ROUNDED = 1, STEPPED = 2;
// A cell's corners, as bits.
export const TL = 1, TR = 2, BL = 4, BR = 8, CORNERS = [TL, TR, BL, BR];
// How far the distance to an outline is measured (pixels), and how far a particle is set off it.
export const BAND = 3, CLEARANCE = 0.02;
// The corner's position in its cell, and the two points half a pixel along the cell's edges from it.
const cornerOf = bit => [bit === TR || bit === BR ? 1 : 0, bit === BL || bit === BR ? 1 : 0];
const legsOf = (bit, i, j) => { const [cx, cy] = cornerOf(bit); return [i + 0.5, j + cy, i + cx, j + 0.5]; };
// Whether (s, t), within a cell, lies in the half-pixel triangle at that corner.
const inCorner = (s, t, bit) => { const [cx, cy] = cornerOf(bit); return (cx ? 1 - s : s) + (cy ? 1 - t : t) < 0.5; };
export function smoothGeometry(pixels, smooth, W, H, walls) {
  const N = W * H, kind = new Uint8Array(N), cut = new Uint8Array(N), fill = new Uint8Array(N), convex = new Uint8Array(N);
  for (let c = 0; c < N; c++) kind[c] = smooth[c] ? ROUNDED : pixels[c] ? STEPPED : OPEN;
  // Beyond the canvas counts as stepped, so nothing is smoothed against its edges.
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? STEPPED : kind[j * W + i]);
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
    const tl = at(i - 1, j - 1), tr = at(i, j - 1), bl = at(i - 1, j), br = at(i, j);
    if (tl === STEPPED || tr === STEPPED || bl === STEPPED || br === STEPPED) continue;
    const n = tl + tr + bl + br;
    if (n === 1) {
      if (tl) convex[(j - 1) * W + i - 1] |= BR; else if (tr) convex[(j - 1) * W + i] |= BL; else if (bl) convex[j * W + i - 1] |= TR; else convex[j * W + i] |= TL;
    } else if (n === 3 || (n === 2 && tl === br)) {
      if (!tl) fill[(j - 1) * W + i - 1] |= BR;
      if (!tr) fill[(j - 1) * W + i] |= BL;
      if (!bl) fill[j * W + i - 1] |= TR;
      if (!br) fill[j * W + i] |= TL;
    }
  }
  // A pixel loses its one corner that sticks out. Of two opposite ones (a line one pixel thick) it loses the upper, which
  // leaves it in one piece; with more, it keeps them all.
  for (let c = 0; c < N; c++) {
    const bits = convex[c];
    if (bits === TL || bits === TR || bits === BL || bits === BR) cut[c] = bits;
    else if (bits === (TL | BR)) cut[c] = TL;
    else if (bits === (TR | BL)) cut[c] = TR;
  }
  const count = bits => (bits & 1) + ((bits >> 1) & 1) + ((bits >> 2) & 1) + ((bits >> 3) & 1);
  const open = new Float64Array(N), solid = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    open[c] = kind[c] === OPEN ? 1 - count(fill[c]) / 8 : kind[c] === ROUNDED && cut[c] ? 1 / 8 : 0;
    solid[c] = open[c] ? 0 : 1;
  }
  // A face between a smooth pixel and an open cell is open along the half beside each corner the pixel lost; a filled
  // corner covers only faces that were closed already. Faces at the canvas edge are as they were.
  const X = W + 1, uOpen = new Float64Array(X * H), vOpen = new Float64Array(W * (H + 1));
  const face = (a, b, aEnds, bEnds) => {
    if (!a && !b) return 1;
    if (a && b) return 0;
    const [k, ends] = a ? [kind[a.c], cut[a.c] & aEnds] : [kind[b.c], cut[b.c] & bEnds];
    return k === ROUNDED && ends ? 0.5 : 0;
  };
  const cell = (i, j) => (kind[j * W + i] === OPEN ? null : { c: j * W + i });
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    uOpen[j * X + i] = i === 0 ? (walls.left || pixels[j * W] ? 0 : 1) : i === W ? (walls.right || pixels[j * W + W - 1] ? 0 : 1) : face(cell(i - 1, j), cell(i, j), TR | BR, TL | BL);
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    vOpen[j * W + i] = j === 0 ? (walls.top || pixels[i] ? 0 : 1) : j === H ? (walls.bottom || pixels[(H - 1) * W + i] ? 0 : 1) : face(cell(i, j - 1), cell(i, j), BL | BR, TL | TR);
  }
  // The outline as segments: the corner triangles' long sides, and the halves of the edges between a smooth pixel and an
  // open cell that neither lost nor gained a corner. Edges against pixel obstacles are not part of it.
  const segments = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const bits = cut[j * W + i] | fill[j * W + i];
    for (const bit of CORNERS) if (bits & bit) segments.push(legsOf(bit, i, j));
  }
  // A shared edge from (x0, y0) to (x1, y1): `s` is the smooth pixel, `e` the open cell, each with its corner bits at the
  // edge's two ends.
  const halves = (s, e, x0, y0, x1, y1, s0, s1, e0, e1) => {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (!(cut[s] & s0) && !(fill[e] & e0)) segments.push([x0, y0, mx, my]);
    if (!(cut[s] & s1) && !(fill[e] & e1)) segments.push([mx, my, x1, y1]);
  };
  for (let j = 0; j < H; j++) for (let i = 1; i < W; i++) {
    const l = j * W + i - 1, r = l + 1;
    if (kind[l] === ROUNDED && kind[r] === OPEN) halves(l, r, i, j, i, j + 1, TR, BR, TL, BL);
    else if (kind[r] === ROUNDED && kind[l] === OPEN) halves(r, l, i, j, i, j + 1, TL, BL, TR, BR);
  }
  for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
    const t = (j - 1) * W + i, b = t + W;
    if (kind[t] === ROUNDED && kind[b] === OPEN) halves(t, b, i, j, i + 1, j, BL, BR, TL, TR);
    else if (kind[b] === ROUNDED && kind[t] === OPEN) halves(b, t, i, j, i + 1, j, TL, TR, BL, BR);
  }
  // Where a smooth pixel meets a pixel obstacle, the edge between them bounds the outline too, so the distance inside a
  // smooth obstacle is measured to its real edges; pixel obstacles themselves are outside the outline.
  for (let j = 0; j < H; j++) for (let i = 1; i < W; i++) {
    const l = kind[j * W + i - 1], r = kind[j * W + i];
    if ((l === ROUNDED && r === STEPPED) || (l === STEPPED && r === ROUNDED)) segments.push([i, j, i, j + 1]);
  }
  for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
    const t = kind[(j - 1) * W + i], b = kind[j * W + i];
    if ((t === ROUNDED && b === STEPPED) || (t === STEPPED && b === ROUNDED)) segments.push([i, j, i + 1, j]);
  }
  // Inside the outline.
  const inside = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const c = j * W + i, s = x - i, t = y - j;
    if (kind[c] === STEPPED) return false;
    if (kind[c] === ROUNDED) return !(cut[c] && inCorner(s, t, cut[c]));
    for (const bit of CORNERS) if ((fill[c] & bit) && inCorner(s, t, bit)) return true;
    return false;
  };
  // The signed distance (negative inside) at the centre of every quarter of a pixel, within BAND of the outline.
  const PW = 2 * W, PH = 2 * H, phi = new Float64Array(PW * PH).fill(BAND);
  for (const [x0, y0, x1, y1] of segments) {
    const dx = x1 - x0, dy = y1 - y0, length = dx * dx + dy * dy;
    const a0 = Math.max(0, Math.floor(2 * (Math.min(x0, x1) - BAND) - 0.5)), a1 = Math.min(PW - 1, Math.ceil(2 * (Math.max(x0, x1) + BAND) - 0.5));
    const b0 = Math.max(0, Math.floor(2 * (Math.min(y0, y1) - BAND) - 0.5)), b1 = Math.min(PH - 1, Math.ceil(2 * (Math.max(y0, y1) + BAND) - 0.5));
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
      const px = (a + 0.5) / 2, py = (b + 0.5) / 2;
      let t = ((px - x0) * dx + (py - y0) * dy) / length;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x0 + t * dx - px, ey = y0 + t * dy - py, d = Math.sqrt(ex * ex + ey * ey);
      if (d < phi[b * PW + a]) phi[b * PW + a] = d;
    }
  }
  for (let b = 0; b < PH; b++) for (let a = 0; a < PW; a++) if (inside((a + 0.5) / 2, (b + 0.5) / 2)) phi[b * PW + a] = -phi[b * PW + a];
  // The diagonal neighbours a cell is cut off from, where the corner they share lies inside the outline (a line one
  // pixel thick running diagonally) or where two obstacle pixels touch only at that corner, so a blur does not carry
  // liquid across.
  const across = new Uint8Array(N), solidAt = (i, j) => i >= 0 && j >= 0 && i < W && j < H && kind[j * W + i] !== OPEN;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    for (const bit of CORNERS) {
      const [cx, cy] = cornerOf(bit), di = cx ? 1 : -1, dj = cy ? 1 : -1;
      const pinched = !solidAt(i + di, j + dj) && solidAt(i + di, j) && solidAt(i, j + dj);
      if (pinched || bilinear(phi, PW, PH, 2 * (i + cx) - 0.5, 2 * (j + cy) - 0.5) < 0) across[j * W + i] |= bit;
    }
  }
  // The cells particles meet pixel by pixel: pixel obstacles, and smooth pixels beside or diagonal to them, where
  // nothing is smoothed and a corner the two share must not let anything through. Then the open cells against a
  // smooth obstacle.
  const stepped = new Uint8Array(N), touching = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    const i = c % W, j = (c - i) / W, near = d => d === ROUNDED;
    let meets = kind[c] === STEPPED;
    if (kind[c] === ROUNDED) for (let dj = -1; dj <= 1 && !meets; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && i + di >= 0 && j + dj >= 0 && i + di < W && j + dj < H && kind[(j + dj) * W + i + di] === STEPPED) { meets = true; break; }
    stepped[c] = meets ? 1 : 0;
    touching[c] = !solid[c] && (kind[c] === ROUNDED || (i > 0 && near(kind[c - 1])) || (i < W - 1 && near(kind[c + 1])) || (j > 0 && near(kind[c - W])) || (j < H - 1 && near(kind[c + W]))) ? 1 : 0;
  }
  return { pixels, solid, stepped, touching, across, open, uOpen, vOpen, phi, PW, PH, normal: new Float64Array(2) };
}
export const outlineAt = (geo, x, y) => bilinear(geo.phi, geo.PW, geo.PH, 2 * x - 0.5, 2 * y - 0.5);
// Moves a particle from (x, y) toward (nx, ny) without entering a smooth obstacle: the path is checked every fifth of a
// pixel, and where it first enters the outline the particle is set just outside it and keeps the part of the rest of the
// move along the outline, so it slides. `velocity` loses the part that heads into the outline. Returns the new position,
// or null when the path stays clear.
const STRIDE = 0.2;
export function slideSmooth(geo, W, H, x, y, nx, ny, velocity, out) {
  const dx = nx - x, dy = ny - y, distance = Math.sqrt(dx * dx + dy * dy), start = outlineAt(geo, x, y);
  if (start >= distance + 0.25) return null;
  const steps = Math.max(1, Math.ceil(distance / STRIDE));
  let lx = x, ly = y, hx = 0, hy = 0, hit = false;
  for (let k = start < 0 ? 0 : 1; k <= steps; k++) {
    const px = x + dx * k / steps, py = y + dy * k / steps;
    if (outlineAt(geo, px, py) < 0) { hx = px; hy = py; hit = true; break; }
    lx = px; ly = py;
  }
  if (!hit) return null;
  const n = geo.normal;
  slope(geo.phi, geo.PW, geo.PH, 2 * hx - 0.5, 2 * hy - 0.5, n);
  const length = Math.sqrt(n[0] * n[0] + n[1] * n[1]);
  out[0] = lx; out[1] = ly;
  if (!(length > 1e-9)) { velocity[0] = 0; velocity[1] = 0; return out; }
  const ux = n[0] / length, uy = n[1] / length, lift = CLEARANCE - outlineAt(geo, hx, hy), qx = hx + lift * ux, qy = hy + lift * uy;
  let rx = nx - hx, ry = ny - hy;
  const along = rx * ux + ry * uy;
  if (along < 0) { rx -= along * ux; ry -= along * uy; }
  const into = velocity[0] * ux + velocity[1] * uy;
  if (into < 0) { velocity[0] -= into * ux; velocity[1] -= into * uy; }
  // Each landing spot must lie outside, be reached without crossing the outline or a pixel obstacle, or it is the next.
  const clear = (fx, fy, tx, ty) => {
    if (crossesSolid(geo.stepped, W, H, x, y, tx, ty)) return false;
    const sx = tx - fx, sy = ty - fy, parts = Math.max(1, Math.ceil(Math.sqrt(sx * sx + sy * sy) / STRIDE));
    for (let k = 1; k <= parts; k++) if (outlineAt(geo, fx + sx * k / parts, fy + sy * k / parts) < 0) return false;
    return true;
  };
  if (outlineAt(geo, qx, qy) >= 0 && !crossesSolid(geo.stepped, W, H, x, y, qx, qy)) {
    if (clear(qx, qy, qx + rx, qy + ry)) { out[0] = qx + rx; out[1] = qy + ry; } else { out[0] = qx; out[1] = qy; }
  }
  return out;
}
export const sampleU = (g, a, x, y) => bilinear(a, g.W + 1, g.H, x, y - 0.5);
export const sampleV = (g, a, x, y) => bilinear(a, g.W, g.H + 1, x - 0.5, y);
// Faces against an obstacle carry none of the flow, or a moving obstacle's own velocity (`uWall`, `vWall`).
export function enforce(g) {
  const { u, v, uFixed, vFixed, uWall, vWall } = g;
  for (let k = 0; k < u.length; k++) if (uFixed[k]) u[k] = uWall ? uWall[k] : 0;
  for (let k = 0; k < v.length; k++) if (vFixed[k]) v[k] = vWall ? vWall[k] : 0;
}

// Makes the flow divergence-free over the active cells (every open cell for a gas, the cells holding particles for a
// liquid) with a fixed number of over-relaxed Gauss-Seidel sweeps. Obstacles and closed edges are walls; open edges
// and air cells hold zero pressure. `target` asks a cell to spread by that much (crowded liquid particles). A liquid
// takes the conjugate-gradient solve below instead, where `coupling` (see couplingOf) moves the bodies in it.
export function project(g, active, iterations, target, coupling = null) {
  if (g.release) return projectLiquid(g, active, iterations, target, coupling);
  if (g.geo) return projectOpen(g, active, iterations, target);
  const { W, H, u, v, p, div, solid, walls, count } = g, omega = 1.6;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (!active[c]) { p[c] = 0; count[c] = 0; continue; }
    div[c] = u[j * (W + 1) + i + 1] - u[j * (W + 1) + i] + v[(j + 1) * W + i] - v[j * W + i] - target[c];
    count[c] = (i > 0 ? (solid[c - 1] ? 0 : 1) : (walls.left ? 0 : 1)) + (i < W - 1 ? (solid[c + 1] ? 0 : 1) : (walls.right ? 0 : 1))
      + (j > 0 ? (solid[c - W] ? 0 : 1) : (walls.top ? 0 : 1)) + (j < H - 1 ? (solid[c + W] ? 0 : 1) : (walls.bottom ? 0 : 1));
  }
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i, n = count[c];
      if (!n) continue;
      let sum = 0;
      if (i > 0 && active[c - 1]) sum += p[c - 1];
      if (i < W - 1 && active[c + 1]) sum += p[c + 1];
      if (j > 0 && active[c - W]) sum += p[c - W];
      if (j < H - 1 && active[c + W]) sum += p[c + W];
      p[c] += omega * ((sum - div[c]) / n - p[c]);
    }
  }
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * (W + 1) + i;
    if (g.uFixed[k]) continue;
    const l = i > 0 && active[j * W + i - 1], r = i < W && active[j * W + i];
    if (l || r) u[k] -= (r ? p[j * W + i] : 0) - (l ? p[j * W + i - 1] : 0);
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (g.vFixed[k]) continue;
    const t = j > 0 && active[(j - 1) * W + i], b = j < H && active[j * W + i];
    if (t || b) v[k] -= (b ? p[j * W + i] : 0) - (t ? p[(j - 1) * W + i] : 0);
  }
}

// The same solve with each face weighted by the share of it that is open (smooth obstacles): flow through a face counts
// by that share, and so does the pressure difference across it. With every face open or closed it is the solve above.
function projectOpen(g, active, iterations, target) {
  const { W, H, u, v, p, div, weights: weight } = g, { uOpen, vOpen } = g.geo, X = W + 1, omega = 1.6;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (!active[c]) { p[c] = 0; weight[c] = 0; continue; }
    const l = uOpen[j * X + i], r = uOpen[j * X + i + 1], t = vOpen[j * W + i], b = vOpen[(j + 1) * W + i];
    div[c] = r * u[j * X + i + 1] - l * u[j * X + i] + b * v[(j + 1) * W + i] - t * v[j * W + i] - target[c];
    if (g.uWall) div[c] += (1 - r) * g.uWall[j * X + i + 1] - (1 - l) * g.uWall[j * X + i] + (1 - b) * g.vWall[(j + 1) * W + i] - (1 - t) * g.vWall[j * W + i];
    weight[c] = l + r + t + b;
  }
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i, n = weight[c];
      if (!n) continue;
      let sum = 0;
      if (i > 0 && active[c - 1]) sum += uOpen[j * X + i] * p[c - 1];
      if (i < W - 1 && active[c + 1]) sum += uOpen[j * X + i + 1] * p[c + 1];
      if (j > 0 && active[c - W]) sum += vOpen[j * W + i] * p[c - W];
      if (j < H - 1 && active[c + W]) sum += vOpen[(j + 1) * W + i] * p[c + W];
      p[c] += omega * ((sum - div[c]) / n - p[c]);
    }
  }
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * X + i;
    if (g.uFixed[k]) continue;
    const l = i > 0 && active[j * W + i - 1], r = i < W && active[j * W + i];
    if (l || r) u[k] -= (r ? p[j * W + i] : 0) - (l ? p[j * W + i - 1] : 0);
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (g.vFixed[k]) continue;
    const t = j > 0 && active[(j - 1) * W + i], b = j < H && active[j * W + i];
    if (t || b) v[k] -= (b ? p[j * W + i] : 0) - (t ? p[(j - 1) * W + i] : 0);
  }
}

// A liquid's pressure solve: conjugate gradients with a modified incomplete Cholesky preconditioner, MIC(0) (Bridson,
// "Fluid Simulation for Computer Graphics", 2nd ed., 5.3), the same system as the sweeps above, with faces weighted by
// their open share beside smooth obstacles. Sweeps carry pressure only a few cells a step against their scan order, so
// in a pipe, a channel or a tall column the push that holds the liquid lagged the flow by several steps, and a lagging
// push pumps a slosh up (jelly left in a 4-wide pipe bobbed for good, and a long U-tube's slosh grew). MIC(0) solves a
// chain one cell wide exactly and a thin channel nearly so, and each step costs about three sweeps, so a liquid spends
// `iterations` / 3 steps, starting from the previous step's pressure. A smooth obstacle pushes on a liquid but never
// pulls it, so the liquid can leave it (adhesion holds it on): a cell beside one that the solve leaves pulling is held
// at zero pressure, as air is, and the solve runs again, up to twice.
// With air pockets (see sealAir) the air cells of a sealed pocket hold its pressure instead of zero. In the flow's solve
// each pocket (`g.pockets`) is one more unknown: its pressure P follows the gas law at the volume the solve leaves it,
// linearised, P = Pn + P'·dt·dV/dt, where dV/dt is the flow out through its faces. With C = −1 / (P'·dt) that is the row
// (C + Σ w)·P − Σ w·p_L = C·Pn − Σ w·u_out over its faces (open share w, liquid cell L, flow u_out away from it): the
// pressure Poisson row of one big cell, plus C on its diagonal, so the system stays symmetric and positive definite, and
// the pocket is as stable as the liquid at any stiffness. (As a pressure fixed from the volume at the start of the step,
// a stiff pocket overshot and rang.) Its preconditioner is its diagonal. Later solves in the step (a thick liquid's) take
// the pocket pressures as fixed (`g.airP`), as does a pocket squeezed past the gas law's range.
const NO_POCKETS = new Float64Array(0);
// A body of liquid sealed in on every side by solids (obstacles, ice) with no air beside it, no open edge and no pocket:
// nothing can take up a change in its volume, so its pressure is known only up to a constant and the solve has an
// answer only when what the body asks for (its crowded cells' spreading, a wall moving in) sums to zero. Asked for more,
// conjugate gradients ran off to huge pressures (water caught between ice and a smooth slope). Each sealed body gives
// up the sum, shared evenly over its cells. A cell of a body with a face to anything off the solve (air, a pocket, an
// open edge) holds the body's pressure, so its row has slack: its open faces outnumber its couplings.
function sealedBodies(g, solve, diag, ax, ay, div) {
  const { W, N } = g, body = g.cg.body ??= new Int32Array(N), order = g.cg.order ??= new Int32Array(N);
  body.fill(-1);
  for (let c0 = 0; c0 < N; c0++) {
    if (!solve[c0] || body[c0] >= 0) continue;
    let end = 0, sealed = true, sum = 0;
    order[end++] = c0; body[c0] = c0;
    for (let at = 0; at < end; at++) {
      const c = order[at], i = c % W, left = i > 0 ? ax[c - 1] : 0, up = c >= W ? ay[c - W] : 0;
      if (diag[c] - ax[c] - ay[c] - left - up > 1e-9) sealed = false;
      sum += div[c];
      if (ax[c] && body[c + 1] < 0) { body[c + 1] = c0; order[end++] = c + 1; }
      if (ay[c] && body[c + W] < 0) { body[c + W] = c0; order[end++] = c + W; }
      if (left && body[c - 1] < 0) { body[c - 1] = c0; order[end++] = c - 1; }
      if (up && body[c - W] < 0) { body[c - W] = c0; order[end++] = c - W; }
    }
    if (!sealed) continue;
    const mean = sum / end;
    for (let at = 0; at < end; at++) div[order[at]] -= mean;
  }
}
function projectLiquid(g, active, iterations, target, coupling) {
  const { W, H, N, u, v, p, div, geo, uFixed, vFixed, airP, pockets } = g, X = W + 1, steps = Math.ceil(iterations / 3), m = pockets ? pockets.Pn.length : 0;
  if (!g.cg) g.cg = { diag: new Float64Array(N), ax: new Float64Array(N), ay: new Float64Array(N), solve: new Uint8Array(N), prec: new Float64Array(N), r: new Float64Array(N), z: new Float64Array(N), s: new Float64Array(N), q: new Float64Array(N) };
  const { diag, ax, ay, solve, prec, r, z, s, q } = g.cg;
  // The bodies the solve moves (see couplingOf).
  const bodies = coupling && coupling.list.length ? coupling.list : null;
  // The open share of each face: pixel faces are open or shut, a smooth obstacle's may be half open.
  const openU = geo ? k => geo.uOpen[k] : k => (uFixed[k] ? 0 : 1), openV = geo ? k => geo.vOpen[k] : k => (vFixed[k] ? 0 : 1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i, l = openU(j * X + i), rr = openU(j * X + i + 1), t = openV(c), b = openV(c + W);
    diag[c] = l + rr + t + b;
    solve[c] = active[c] && diag[c] > 0 ? 1 : 0;
    if (!solve[c]) { p[c] = airP ? airP[c] : 0; div[c] = 0; continue; }
    if (geo) {
      div[c] = rr * u[j * X + i + 1] - l * u[j * X + i] + b * v[c + W] - t * v[c] - target[c];
      if (g.uWall) div[c] += (1 - rr) * g.uWall[j * X + i + 1] - (1 - l) * g.uWall[j * X + i] + (1 - b) * g.vWall[c + W] - (1 - t) * g.vWall[c];
    } else div[c] = u[j * X + i + 1] - u[j * X + i] + v[c + W] - v[c] - target[c];
    // A pocket's pressure beside the cell is known, so it moves to the right side.
    if (airP) div[c] -= (i > 0 && !active[c - 1] ? l * airP[c - 1] : 0) + (i < W - 1 && !active[c + 1] ? rr * airP[c + 1] : 0) + (j > 0 && !active[c - W] ? t * airP[c - W] : 0) + (j < H - 1 && !active[c + W] ? b * airP[c + W] : 0);
  }
  // Each pocket's row: its faces to liquid cells (cell, pocket, open share), its diagonal and its right side.
  const vector = () => (m ? new Float64Array(m) : NO_POCKETS), faces = [], np = vector(), nd = vector(), nb = vector(), nr = vector(), nz = vector(), ns = vector(), nq = vector();
  if (m) {
    const { node, Pn, C } = pockets;
    for (let n = 0; n < m; n++) { np[n] = Pn[n]; nd[n] = C[n]; nb[n] = C[n] * Pn[n]; }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i, n = node[c];
      if (n < 0) continue;
      // Each face that leaves the pocket, with the flow out through it (sign) and the cell beyond.
      for (const [k, sign, d, inside, share, flow, walls] of [[j * X + i, -1, c - 1, i > 0, openU, u, g.uWall], [j * X + i + 1, 1, c + 1, i < W - 1, openU, u, g.uWall], [c, -1, c - W, j > 0, openV, v, g.vWall], [c + W, 1, c + W, j < H - 1, openV, v, g.vWall]]) {
        const w = share(k);
        if (walls) nb[n] -= sign * (1 - w) * walls[k];
        if (!w || !inside || node[d] === n) continue;
        nb[n] -= sign * w * flow[k];
        if (active[d]) { nd[n] += w; faces.push(d, n, w); }
      }
    }
  }
  // The push of a pressure field on a body through its faces against cells being solved, [x, y, turning], and the flow out
  // of each such cell that a change `h` of the body's velocity makes, added to `out`.
  const forceOn = (b, x) => {
    const F = b.faces;
    let fx = 0, fy = 0, ft = 0;
    for (const f of b.on) { const push = x[F[f + 2]] * F[f + 3]; if (F[f]) fy += push; else fx += push; ft += push * F[f + 4]; }
    return [fx, fy, ft];
  };
  const flowOut = (b, h, out) => { const F = b.faces; for (const f of b.on) out[F[f + 2]] += F[f + 3] * ((F[f] ? h[1] : h[0]) + h[2] * F[f + 4]); };
  // Each body's faces against cells being solved, less those an obstacle's face holds still this step (see stepLiquid),
  // which stay still walls. The first solve meets these faces moving with the liquid beside them (`water`, see
  // bodyWater), not with the body: that is the pressure the body doesn't yield to.
  if (bodies) for (const b of bodies) {
    const F = b.faces, on = b.on = [];
    for (let f = 0; f < F.length; f += 5) {
      const c = F[f + 2], k = F[f + 1], wall = (F[f] ? g.vWall : g.uWall)[k];
      if (!solve[c] || (F[f] ? v : u)[k] !== wall) continue;
      on.push(f);
      div[c] -= F[f + 3] * (wall - b.water[f / 5]);
    }
  }
  // The system's product with x (and each pocket's row, with `xn`), and with `moving` each body's yield: a body's velocity
  // changes by the push on its faces over its mass, and the flow out of the cells beside it with it (the term J·M⁻¹·Jᵀ,
  // which keeps the system symmetric and positive definite).
  const times = (x, out, xn, outn, moving = false) => {
    for (let j = 0, c = 0; j < H; j++) for (let i = 0; i < W; i++, c++) {
      if (!solve[c]) { out[c] = 0; continue; }
      let t = diag[c] * x[c];
      if (ax[c]) t -= ax[c] * x[c + 1];
      if (ay[c]) t -= ay[c] * x[c + W];
      if (i > 0 && ax[c - 1]) t -= ax[c - 1] * x[c - 1];
      if (j > 0 && ay[c - W]) t -= ay[c - W] * x[c - W];
      out[c] = t;
    }
    if (moving) for (const b of bodies) { const [fx, fy, ft] = forceOn(b, x); flowOut(b, [b.im * fx, b.im * fy, b.ii * ft], out); }
    if (!m || !xn) return;
    for (let n = 0; n < m; n++) outn[n] = nd[n] * xn[n];
    for (let f = 0; f < faces.length; f += 3) {
      const c = faces[f], n = faces[f + 1], w = faces[f + 2];
      if (!solve[c]) continue;
      out[c] -= w * xn[n]; outn[n] -= w * x[c];
    }
  };
  const precondition = (from, out) => {
    for (let j = 0, c = 0; j < H; j++) for (let i = 0; i < W; i++, c++) {
      if (!solve[c]) { out[c] = 0; continue; }
      let t = from[c];
      if (i > 0 && ax[c - 1]) t += ax[c - 1] * prec[c - 1] * out[c - 1];
      if (j > 0 && ay[c - W]) t += ay[c - W] * prec[c - W] * out[c - W];
      out[c] = t * prec[c];
    }
    for (let c = N - 1; c >= 0; c--) {
      if (!solve[c]) continue;
      let t = out[c];
      if (ax[c]) t += ax[c] * prec[c] * out[c + 1];
      if (ay[c]) t += ay[c] * prec[c] * out[c + W];
      out[c] = t * prec[c];
    }
  };
  const touching = geo ? geo.touching : null;
  for (let pass = 0; pass < (touching ? 3 : 1); pass++) {
    // The couplings to the cell on the right and the one below, between cells being solved.
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i;
      ax[c] = solve[c] && i < W - 1 && solve[c + 1] ? openU(j * X + i + 1) : 0;
      ay[c] = solve[c] && j < H - 1 && solve[c + W] ? openV(c + W) : 0;
    }
    sealedBodies(g, solve, diag, ax, ay, div);
    // MIC(0), tuning 0.97, with the plain diagonal wherever the factor would fall below a quarter of it.
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (!solve[c]) { prec[c] = 0; continue; }
      let e = diag[c];
      if (i > 0) { const a = ax[c - 1] * prec[c - 1]; e -= a * a + 0.97 * ax[c - 1] * ay[c - 1] * prec[c - 1] * prec[c - 1]; }
      if (j > 0) { const a = ay[c - W] * prec[c - W]; e -= a * a + 0.97 * ay[c - W] * ax[c - W] * prec[c - W] * prec[c - W]; }
      if (e < 0.25 * diag[c]) e = diag[c];
      prec[c] = 1 / Math.sqrt(e);
    }
    // Solves diag·p − Σ coupling·p_neighbour = −div from the pressure already in p, and each pocket's row (none
    // without pockets, when every loop over them is empty and the solve is the plain one).
    times(p, q, np, nq);
    let rz = 0;
    for (let c = 0; c < N; c++) r[c] = solve[c] ? -div[c] - q[c] : 0;
    for (let n = 0; n < m; n++) nr[n] = nb[n] - nq[n];
    precondition(r, z);
    for (let n = 0; n < m; n++) nz[n] = nr[n] / nd[n];
    for (let c = 0; c < N; c++) { s[c] = z[c]; rz += r[c] * z[c]; }
    for (let n = 0; n < m; n++) { ns[n] = nz[n]; rz += nr[n] * nz[n]; }
    for (let it = 0; it < steps && rz > 0; it++) {
      times(s, q, ns, nq);
      let sq = 0;
      for (let c = 0; c < N; c++) sq += s[c] * q[c];
      for (let n = 0; n < m; n++) sq += ns[n] * nq[n];
      // A direction the system hardly bends (liquid sealed into one-cell pockets by a crowd of bodies) would take a
      // step tens of orders too long and blow the pressure up to NaN: stop there, as at convergence.
      if (!(sq > 1e-10 * rz)) break;
      const alpha = rz / sq;
      for (let c = 0; c < N; c++) if (solve[c]) { p[c] += alpha * s[c]; r[c] -= alpha * q[c]; }
      for (let n = 0; n < m; n++) { np[n] += alpha * ns[n]; nr[n] -= alpha * nq[n]; }
      precondition(r, z);
      for (let n = 0; n < m; n++) nz[n] = nr[n] / nd[n];
      let next = 0;
      for (let c = 0; c < N; c++) next += r[c] * z[c];
      for (let n = 0; n < m; n++) next += nr[n] * nz[n];
      const beta = next / rz;
      rz = next;
      for (let c = 0; c < N; c++) s[c] = z[c] + beta * s[c];
      for (let n = 0; n < m; n++) ns[n] = nz[n] + beta * ns[n];
    }
    if (!touching) break;
    let pulled = false;
    for (let c = 0; c < N; c++) if (solve[c] && touching[c] && p[c] < 0) { p[c] = 0; solve[c] = 0; pulled = true; }
    if (!pulled) break;
  }
  // The pockets' cells take the pressure solved for them, which later solves in the step keep.
  if (m) for (let c = 0; c < N; c++) if (pockets.node[c] >= 0) { p[c] = np[pockets.node[c]]; airP[c] = p[c]; }
  // Then the pressure the bodies' motion through the liquid beside them makes (`coupling.extra`, from the last step's),
  // with the bodies yielding to it, added to the first: diag·e − Σ coupling·e_neighbour + J·M⁻¹·Jᵀ·e = −Σ(v − water)
  // over each body's faces (pockets hold still for it). Each body moves by that push over its mass, and its faces with it
  // (all of them, for the steps to come; those held still keep still for this one).
  if (bodies) {
    const e = coupling.extra;
    for (let c = 0; c < N; c++) { q[c] = 0; if (!solve[c]) e[c] = 0; }
    for (const b of bodies) {
      const F = b.faces;
      b.on = b.on.filter(f => solve[F[f + 2]]);
      for (const f of b.on) q[F[f + 2]] -= F[f + 3] * ((F[f] ? g.vWall : g.uWall)[F[f + 1]] - b.water[f / 5]);
    }
    sealedBodies(g, solve, diag, ax, ay, q);
    const right = Float64Array.from(q);
    times(e, q, null, null, true);
    let rz = 0;
    for (let c = 0; c < N; c++) r[c] = solve[c] ? right[c] - q[c] : 0;
    precondition(r, z);
    for (let c = 0; c < N; c++) { s[c] = z[c]; rz += r[c] * z[c]; }
    for (let it = 0; it < steps && rz > 0; it++) {
      times(s, q, null, null, true);
      let sq = 0;
      for (let c = 0; c < N; c++) sq += s[c] * q[c];
      if (!(sq > 1e-10 * rz)) break;
      const alpha = rz / sq;
      for (let c = 0; c < N; c++) if (solve[c]) { e[c] += alpha * s[c]; r[c] -= alpha * q[c]; }
      precondition(r, z);
      let next = 0;
      for (let c = 0; c < N; c++) next += r[c] * z[c];
      const beta = next / rz;
      rz = next;
      for (let c = 0; c < N; c++) s[c] = z[c] + beta * s[c];
    }
    for (let c = 0; c < N; c++) if (solve[c]) p[c] += e[c];
    for (const b of bodies) {
      const [fx, fy, ft] = forceOn(b, e), dvx = b.im * fx, dvy = b.im * fy, dw = b.ii * ft;
      if (!Number.isFinite(dvx + dvy + dw)) continue;
      b.vx += dvx; b.vy += dvy; b.w += dw; b.dvx += dvx; b.dvy += dvy; b.dw += dw;
      const F = b.faces;
      for (let f = 0; f < F.length; f += 5) {
        const k = F[f + 1], wall = F[f] ? g.vWall : g.uWall, flow = F[f] ? v : u, now = (F[f] ? b.vy : b.vx) + b.w * F[f + 4];
        if (flow[k] === wall[k]) flow[k] = now;
        wall[k] = now;
      }
    }
  }
  // Every cell off the solve holds its pressure in p (zero, or a pocket's), so with pockets a face reads both sides.
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * X + i;
    if (uFixed[k]) continue;
    const l = i > 0 && active[j * W + i - 1], rr = i < W && active[j * W + i];
    if (airP) { if (l || rr) u[k] -= (i < W ? p[j * W + i] : 0) - (i > 0 ? p[j * W + i - 1] : 0); } else if (l || rr) u[k] -= (rr ? p[j * W + i] : 0) - (l ? p[j * W + i - 1] : 0);
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (vFixed[k]) continue;
    const t = j > 0 && active[(j - 1) * W + i], b = j < H && active[j * W + i];
    if (airP) { if (t || b) v[k] -= (j < H ? p[j * W + i] : 0) - (j > 0 ? p[(j - 1) * W + i] : 0); } else if (t || b) v[k] -= (b ? p[j * W + i] : 0) - (t ? p[(j - 1) * W + i] : 0);
  }
}

// Semi-Lagrangian self-advection with a midpoint back-trace.
export function advectVelocity(g, dt) {
  const { W, H, u, v, u0, v0, uFixed, vFixed } = g;
  u0.set(u); v0.set(v);
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * (W + 1) + i;
    if (uFixed[k]) continue;
    const x = i, y = j + 0.5, ax = u0[k], ay = sampleV(g, v0, x, y), mx = x - 0.5 * dt * ax, my = y - 0.5 * dt * ay;
    u[k] = sampleU(g, u0, x - dt * sampleU(g, u0, mx, my), y - dt * sampleV(g, v0, mx, my));
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (vFixed[k]) continue;
    const x = i + 0.5, y = j, ax = sampleU(g, u0, x, y), ay = v0[k], mx = x - 0.5 * dt * ax, my = y - 0.5 * dt * ay;
    v[k] = sampleV(g, v0, x - dt * sampleU(g, u0, mx, my), y - dt * sampleV(g, v0, mx, my));
  }
}

// Scalars move with the flow; the back-trace (and for sharp advection the forward trace) is shared by every field.
export function advectScalars(g, dt, pairs, sharp) {
  const { W, H, N, u, v, solid } = g, s = sharp ? sharpScratch(g) : null;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (solid[c]) { for (const [, next] of pairs) next[c] = 0; continue; }
    const x = i + 0.5, y = j + 0.5, ax = sampleU(g, u, x, y), ay = sampleV(g, v, x, y), mx = x - 0.5 * dt * ax, my = y - 0.5 * dt * ay;
    const bx = x - dt * sampleU(g, u, mx, my) - 0.5, by = y - dt * sampleV(g, v, mx, my) - 0.5;
    for (const [field, next] of pairs) next[c] = bilinearZero(field, W, H, bx, by);
    if (s) {
      const fx = x + 0.5 * dt * ax, fy = y + 0.5 * dt * ay;
      s.bx[c] = bx; s.by[c] = by; s.fx[c] = x + dt * sampleU(g, u, fx, fy) - 0.5; s.fy[c] = y + dt * sampleV(g, v, fx, fy) - 0.5;
    }
  }
  if (!s) return;
  for (const [field, next] of pairs) {
    for (let c = 0; c < N; c++) if (!solid[c]) s.next[c] = bilinearZero(next, W, H, s.fx[c], s.fy[c]);
    for (let c = 0; c < N; c++) {
      if (solid[c]) continue;
      cornersZero(field, W, H, s.bx[c], s.by[c], s.range);
      const value = next[c] + 0.5 * (field[c] - s.next[c]);
      next[c] = value < s.range[0] ? s.range[0] : value > s.range[1] ? s.range[1] : value;
    }
  }
}

// The lowest and highest of the four lattice values `bilinear` blends at (fx, fy), written to `out`.
function corners(a, nx, ny, fx, fy, out) {
  if (fx < 0) fx = 0; else if (fx > nx - 1) fx = nx - 1;
  if (fy < 0) fy = 0; else if (fy > ny - 1) fy = ny - 1;
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i > nx - 2) i = nx - 2;
  if (j > ny - 2) j = ny - 2;
  const k = j * nx + i, a0 = a[k], a1 = a[k + 1], a2 = a[k + nx], a3 = a[k + nx + 1];
  out[0] = Math.min(a0, a1, a2, a3); out[1] = Math.max(a0, a1, a2, a3);
}
// The same for `bilinearZero`, where lattice points beyond the grid read 0.
function cornersZero(a, nx, ny, fx, fy, out) {
  const i = Math.floor(fx), j = Math.floor(fy), k = j * nx + i, left = i >= 0 && i < nx, right = i + 1 >= 0 && i + 1 < nx, top = j >= 0 && j < ny, bottom = j + 1 >= 0 && j + 1 < ny;
  const a0 = left && top ? a[k] : 0, a1 = right && top ? a[k + 1] : 0, a2 = left && bottom ? a[k + nx] : 0, a3 = right && bottom ? a[k + nx + 1] : 0;
  out[0] = Math.min(a0, a1, a2, a3); out[1] = Math.max(a0, a1, a2, a3);
}
// The slope [d/dx, d/dy] of the interpolation `bilinear` makes at (fx, fy), written to `out`; 0 along an axis where
// the point lies beyond the lattice, since the interpolation is flat there.
export function slope(a, nx, ny, fx, fy, out) {
  let flatX = false, flatY = false;
  if (fx < 0) { fx = 0; flatX = true; } else if (fx > nx - 1) { fx = nx - 1; flatX = true; }
  if (fy < 0) { fy = 0; flatY = true; } else if (fy > ny - 1) { fy = ny - 1; flatY = true; }
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i > nx - 2) i = nx - 2;
  if (j > ny - 2) j = ny - 2;
  const s = fx - i, t = fy - j, k = j * nx + i;
  out[0] = flatX ? 0 : (a[k + 1] - a[k]) * (1 - t) + (a[k + nx + 1] - a[k + nx]) * t;
  out[1] = flatY ? 0 : (a[k + nx] - a[k]) * (1 - s) + (a[k + nx + 1] - a[k + 1]) * s;
}

// Sharp advection (MacCormack, with the limiter of Selle et al., "An unconditionally stable MacCormack method", 2008):
// after the plain back-trace, the result is traced forward again and half the round trip's error is taken off, then
// clamped to the values the back-trace blended, so edges and small swirls stay crisp without new peaks or ripples.
function sharpScratch(g) {
  if (!g.sharp) {
    const f = n => new Float64Array(n), U = g.u.length, V = g.v.length, N = g.N;
    g.sharp = { u1: f(U), v1: f(V), uLo: f(U), uHi: f(U), vLo: f(V), vHi: f(V), bx: f(N), by: f(N), fx: f(N), fy: f(N), next: f(N), range: f(2) };
  }
  return g.sharp;
}
export function sharpenVelocity(g, dt) {
  const { W, H, u, v, u0, v0, uFixed, vFixed } = g, { u1, v1, uLo, uHi, vLo, vHi, range } = sharpScratch(g);
  // The limits come from the old velocities around each back-traced point.
  const trace = (x, y, ax, ay, direction) => { const mx = x + direction * 0.5 * dt * ax, my = y + direction * 0.5 * dt * ay; return [x + direction * dt * sampleU(g, u0, mx, my), y + direction * dt * sampleV(g, v0, mx, my)]; };
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * (W + 1) + i;
    if (uFixed[k]) continue;
    const x = i, y = j + 0.5, ax = u0[k], ay = sampleV(g, v0, x, y), [bx, by] = trace(x, y, ax, ay, -1), [fx, fy] = trace(x, y, ax, ay, 1);
    corners(u0, W + 1, H, bx, by - 0.5, range); uLo[k] = range[0]; uHi[k] = range[1];
    u1[k] = sampleU(g, u, fx, fy);
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (vFixed[k]) continue;
    const x = i + 0.5, y = j, ax = sampleU(g, u0, x, y), ay = v0[k], [bx, by] = trace(x, y, ax, ay, -1), [fx, fy] = trace(x, y, ax, ay, 1);
    corners(v0, W, H + 1, bx - 0.5, by, range); vLo[k] = range[0]; vHi[k] = range[1];
    v1[k] = sampleV(g, v, fx, fy);
  }
  const correct = (a, a0, a1, lo, hi, fixed) => { for (let k = 0; k < a.length; k++) if (!fixed[k]) { const value = a[k] + 0.5 * (a0[k] - a1[k]); a[k] = value < lo[k] ? lo[k] : value > hi[k] ? hi[k] : value; } };
  correct(u, u0, u1, uLo, uHi, uFixed); correct(v, v0, v1, vLo, vHi, vFixed);
}

// ---- Viscosity --------------------------------------------------------------------------------------------------------
// Implicit viscosity in stress form, after Batty and Bridson ("Accurate viscous free surfaces for buckling, coiling and
// rotating liquids", 2008): the faces beside the fluid solve u − dt ∇·(μ (∇u + ∇uᵀ)) = u₀ with a fixed number of
// Jacobi-preconditioned conjugate-gradient steps. On the staggered grid, stretching stress lives at cell centres and
// shear at cell corners. μ is the fluid's viscosity in its cells and 0 in air, and a corner that touches air carries no
// shear, so the surface is free of stress: a thick drop falls as fast as water, and only shearing and stretching are
// slowed, never motion as a whole, sliding or turning. Walls and obstacles hold the fluid (faces in them, and anything
// beyond a closed edge, read 0); with `slip`, corners touching them carry no shear, so it slides along them instead.
const AIR = 0, FLUID = 1, SOLID = 2;
function viscosityScratch(g) {
  if (!g.visc) {
    const { N, W, H } = g, U = g.u.length, V = g.v.length, M = (W + 1) * (H + 1), f = n => new Float64Array(n);
    g.visc = { mu: f(N), node: f(M), kind: new Uint8Array(N), uLive: new Uint8Array(U), vLive: new Uint8Array(V), du: f(U), dv: f(V), ru: f(U), rv: f(V), zu: f(U), zv: f(V), pu: f(U), pv: f(V), qu: f(U), qv: f(V), sxx: f(N), syy: f(N), sxy: f(M) };
  }
  return g.visc;
}
// q = p − dt ∇·(μ (∇p + ∇pᵀ)) on the faces taking part; p must be 0 on the others, or on fixed faces at least.
function applyViscosity(g, dt, pu, pv, qu, qv) {
  const { W, H } = g, { mu, node, uLive, vLive, sxx, syy, sxy, uDrag, vDrag } = g.visc, X = W + 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i, m = mu[c];
    if (m) { sxx[c] = 2 * m * (pu[j * X + i + 1] - pu[j * X + i]); syy[c] = 2 * m * (pv[(j + 1) * W + i] - pv[j * W + i]); } else { sxx[c] = 0; syy[c] = 0; }
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
    const n = j * X + i, m = node[n];
    if (!m) { sxy[n] = 0; continue; }
    const above = j > 0 ? pu[(j - 1) * X + i] : 0, below = j < H ? pu[j * X + i] : 0, left = i > 0 ? pv[j * W + i - 1] : 0, right = i < W ? pv[j * W + i] : 0;
    sxy[n] = m * (below - above + right - left);
  }
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * X + i;
    qu[k] = uLive[k] ? pu[k] - dt * ((i < W ? sxx[j * W + i] : 0) - (i > 0 ? sxx[j * W + i - 1] : 0) + sxy[(j + 1) * X + i] - sxy[j * X + i]) : 0;
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    qv[k] = vLive[k] ? pv[k] - dt * ((j < H ? syy[k] : 0) - (j > 0 ? syy[k - W] : 0) + sxy[j * X + i + 1] - sxy[j * X + i]) : 0;
  }
  // A face partly inside a smooth obstacle is held by its closed part, unless the fluid slips.
  if (uDrag) {
    for (let k = 0; k < qu.length; k++) if (uDrag[k]) qu[k] += dt * uDrag[k] * pu[k];
    for (let k = 0; k < qv.length; k++) if (vDrag[k]) qv[k] += dt * vDrag[k] * pv[k];
  }
}
// Each cell as air, fluid (one of `active`) or solid, and what lies beyond each edge: a closed edge is a wall.
function classify(g, active) {
  const { N, solid } = g, { kind } = g.visc;
  for (let c = 0; c < N; c++) kind[c] = solid[c] ? SOLID : active[c] ? FLUID : AIR;
}
// A value at each cell corner: the mean of `values` over the fluid cells around it, or 0 where it touches air (the free
// surface carries no shear) or, with `slip`, a wall.
function cornerMean(g, values, slip, out) {
  const { W, H, walls } = g, { kind } = g.visc, X = W + 1;
  const at = (i, j) => (i < 0 ? (walls.left ? SOLID : AIR) : i >= W ? (walls.right ? SOLID : AIR) : j < 0 ? (walls.top ? SOLID : AIR) : j >= H ? (walls.bottom ? SOLID : AIR) : kind[j * W + i]);
  let sum = 0, count = 0, air = false, wall = false;
  const look = (i, j) => { const k = at(i, j); if (k === AIR) air = true; else if (k === SOLID) wall = true; else { sum += values[j * W + i]; count++; } };
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
    sum = 0; count = 0; air = false; wall = false;
    look(i - 1, j - 1); look(i, j - 1); look(i - 1, j); look(i, j);
    out[j * X + i] = air || !count || (slip && wall) ? 0 : sum / count;
  }
}
// One viscosity step over the cells in `active` (the open cells of a gas, the wet cells of a liquid), each with the
// effect's viscosity plus `extra` (a yield-stress liquid's stiffness where it has not yielded).
export function viscous(g, active, effect, dt, extra = null) {
  const { W, H, N, u, v, uFixed, vFixed } = g, w = viscosityScratch(g), { mu, node, kind, uLive, vLive, du, dv } = w, X = W + 1;
  classify(g, active);
  for (let c = 0; c < N; c++) mu[c] = kind[c] === FLUID ? effect.viscosity + (extra ? extra[c] : 0) : 0;
  // Beside smooth obstacles, a cell's stresses count by the share of it that is open, so a pixel step that the outline
  // cuts through barely resists a flow sliding past it; a face partly closed is dragged toward rest by its closed part.
  const { geo } = g, held = geo && !effect.slip;
  if (held && !w.uDrag) { w.uDrag = new Float64Array(u.length); w.vDrag = new Float64Array(v.length); }
  if (!held) w.uDrag = w.vDrag = null;
  const thick = (a, b) => { const n = (a >= 0 && kind[a] === FLUID ? 1 : 0) + (b >= 0 && kind[b] === FLUID ? 1 : 0); return n ? ((a >= 0 && kind[a] === FLUID ? mu[a] : 0) + (b >= 0 && kind[b] === FLUID ? mu[b] : 0)) / n : 0; };
  if (held) {
    for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) { const k = j * X + i, open = geo.uOpen[k]; w.uDrag[k] = open > 0 && open < 1 ? 2 * (1 - open) * thick(i > 0 ? j * W + i - 1 : -1, i < W ? j * W + i : -1) : 0; }
    for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, open = geo.vOpen[k]; w.vDrag[k] = open > 0 && open < 1 ? 2 * (1 - open) * thick(j > 0 ? k - W : -1, j < H ? k : -1) : 0; }
  }
  if (geo) for (let c = 0; c < N; c++) mu[c] *= geo.open[c];
  cornerMean(g, mu, effect.slip, node);
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * X + i, l = i > 0 ? mu[j * W + i - 1] : 0, r = i < W ? mu[j * W + i] : 0;
    uLive[k] = !uFixed[k] && ((i > 0 && kind[j * W + i - 1] === FLUID) || (i < W && kind[j * W + i] === FLUID)) ? 1 : 0;
    if (uLive[k]) du[k] = 1 + dt * (2 * l + 2 * r + node[k] + node[k + X] + (held ? w.uDrag[k] : 0));
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, t = j > 0 ? mu[k - W] : 0, b = j < H ? mu[k] : 0;
    vLive[k] = !vFixed[k] && ((j > 0 && kind[k - W] === FLUID) || (j < H && kind[k] === FLUID)) ? 1 : 0;
    if (vLive[k]) dv[k] = 1 + dt * (2 * t + 2 * b + node[j * X + i] + node[j * X + i + 1] + (held ? w.vDrag[k] : 0));
  }
  // Conjugate gradients from the current velocities, so b = x and the first residual is x − A x.
  const { ru, rv, zu, zv, pu, pv, qu, qv } = w;
  applyViscosity(g, dt, u, v, qu, qv);
  let rz = 0;
  // A part-open face beside a moving smooth obstacle is dragged toward the obstacle's velocity, not toward rest.
  const towardU = held && g.uWall ? g.uWall : null, towardV = held && g.vWall ? g.vWall : null;
  for (let k = 0; k < u.length; k++) { if (uLive[k]) { ru[k] = u[k] - qu[k]; if (towardU && w.uDrag[k] && towardU[k]) ru[k] += dt * w.uDrag[k] * towardU[k]; zu[k] = ru[k] / du[k]; pu[k] = zu[k]; rz += ru[k] * zu[k]; } else pu[k] = 0; }
  for (let k = 0; k < v.length; k++) { if (vLive[k]) { rv[k] = v[k] - qv[k]; if (towardV && w.vDrag[k] && towardV[k]) rv[k] += dt * w.vDrag[k] * towardV[k]; zv[k] = rv[k] / dv[k]; pv[k] = zv[k]; rz += rv[k] * zv[k]; } else pv[k] = 0; }
  for (let it = 0; it < effect.iterations && rz > 0; it++) {
    applyViscosity(g, dt, pu, pv, qu, qv);
    let pq = 0;
    for (let k = 0; k < u.length; k++) if (uLive[k]) pq += pu[k] * qu[k];
    for (let k = 0; k < v.length; k++) if (vLive[k]) pq += pv[k] * qv[k];
    if (!(pq > 0)) break;
    const alpha = rz / pq;
    let next = 0;
    for (let k = 0; k < u.length; k++) if (uLive[k]) { u[k] += alpha * pu[k]; ru[k] -= alpha * qu[k]; zu[k] = ru[k] / du[k]; next += ru[k] * zu[k]; }
    for (let k = 0; k < v.length; k++) if (vLive[k]) { v[k] += alpha * pv[k]; rv[k] -= alpha * qv[k]; zv[k] = rv[k] / dv[k]; next += rv[k] * zv[k]; }
    const beta = next / rz;
    rz = next;
    for (let k = 0; k < u.length; k++) if (uLive[k]) pu[k] = zu[k] + beta * pu[k];
    for (let k = 0; k < v.length; k++) if (vLive[k]) pv[k] = zv[k] + beta * pv[k];
  }
}

// ---- Yield stress -----------------------------------------------------------------------------------------------------
// A yield-stress liquid (mud, slime, toothpaste) is elastic until it is pushed past its yield, and then flows: after
// Goktekin, Bargteil and O'Brien, "A method for animating viscoelastic fluids" (2004). Each particle carries how far it
// has been strained out of shape (the deviatoric strain: a stretch a and a shear b), turned with the flow and capped at
// the yield strain, where any further strain is plastic flow. The elastic stress, 2 × STIFFNESS × strain, pushes the
// liquid back toward its shape. It is split as implicit elasticity is: the stress of the strain so far is a force here,
// and the strain this step adds acts as viscosity STIFFNESS × dt in the viscosity solve, in the cells below the yield.
// A heap of height h holds itself up when the yield is more than about gravity × h / 2.
export function strainForce(state, effect, dt) {
  const { g, fluid, strain } = state, { W, H, N, u, v, uFixed, vFixed } = g, { a, b, count, stiff, shear } = strain, X = W + 1;
  const limit = effect.yield / (2 * STIFFNESS), k2 = 2 * STIFFNESS;
  a.fill(0); b.fill(0); count.fill(0);
  for (let k = 0; k < state.n; k++) { const c = Math.floor(state.y[k]) * W + Math.floor(state.x[k]); a[c] += state.ea[k]; b[c] += state.eb[k]; count[c]++; }
  for (let c = 0; c < N; c++) {
    if (count[c]) { a[c] /= count[c]; b[c] /= count[c]; }
    stiff[c] = !fluid[c] ? 0 : a[c] * a[c] + b[c] * b[c] < 0.98 * limit * limit ? STIFFNESS * dt : Math.min(STIFFNESS * dt, PLASTIC);
  }
  // Beside smooth obstacles the stress counts by the share of each cell that is open, as viscous stress does.
  if (g.geo) for (let c = 0; c < N; c++) { a[c] *= g.geo.open[c]; b[c] *= g.geo.open[c]; }
  viscosityScratch(g); classify(g, fluid);
  cornerMean(g, b, effect.slip, shear);
  // u gains dt (∂σxx/∂x + ∂σxy/∂y) and v gains dt (∂σxy/∂x + ∂σyy/∂y), with σxx = 2k a = −σyy and σxy = 2k b.
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) {
    const k = j * X + i, l = i > 0 && fluid[j * W + i - 1], r = i < W && fluid[j * W + i];
    if (uFixed[k] || (!l && !r)) continue;
    u[k] += dt * k2 * ((r ? a[j * W + i] : 0) - (l ? a[j * W + i - 1] : 0) + shear[(j + 1) * X + i] - shear[j * X + i]);
  }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, t = j > 0 && fluid[k - W], d = j < H && fluid[k];
    if (vFixed[k] || (!t && !d)) continue;
    v[k] += dt * k2 * ((t ? a[k - W] : 0) - (d ? a[k] : 0) + shear[j * X + i + 1] - shear[j * X + i]);
  }
}

// The rate of strain (stretch, shear) and the spin of each wet cell, from the same differences the stress uses: stretch
// across the cell, shear and spin at its corners (walls, and anything beyond a closed edge, still), averaged.
export function strainRates(state, u, v) {
  const { g, fluid, strain } = state, { W, H } = g, { ra, rb, spin } = strain, X = W + 1;
  const uAt = (i, j) => (j >= 0 && j < H ? u[j * X + i] : 0), vAt = (i, j) => (i >= 0 && i < W ? v[j * W + i] : 0);
  const dudy = (i, j) => uAt(i, j) - uAt(i, j - 1), dvdx = (i, j) => vAt(i, j) - vAt(i - 1, j);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (!fluid[c]) continue;
    const uy = 0.25 * (dudy(i, j) + dudy(i + 1, j) + dudy(i, j + 1) + dudy(i + 1, j + 1)), vx = 0.25 * (dvdx(i, j) + dvdx(i + 1, j) + dvdx(i, j + 1) + dvdx(i + 1, j + 1));
    ra[c] = 0.5 * (u[j * X + i + 1] - u[j * X + i] - v[(j + 1) * W + i] + v[j * W + i]); rb[c] = 0.5 * (uy + vx); spin[c] = vx - uy;
  }
}

// ---- Grains --------------------------------------------------------------------------------------------------------------
// Sand, salt, gravel and dry snow (`granular`): friction that grows with pressure, after Zhu and Bridson, "Animating sand
// as a fluid" (2005), simplified (docs/physics-model.md, section 10a). After the pressure solve, a wet cell whose rate of
// shear this step is at most `friction` × its pressure (in the solver's units, plus the cohesion's share) holds: the
// friction there can stop the deformation within the step. Elsewhere the grains slide under a friction stress of that
// size, given to the viscosity solve as a viscosity of friction × pressure ÷ (2 × rate of shear × dt), capped at
// GRAIN_THICK. Cells that hold are kept in `rigid` for grainPieces and the particles. Before that, landing: the motion
// across gravity loses what Coulomb friction takes for the fall the pressure solve stopped, so grains land dead.
const GRAIN_THICK = 16;
// Below this speed (pixels per frame), a grain on grains that hold or on a solid sleeps (stepLiquid).
export const GRAIN_SLEEP = 0.1;
// Whether the cell beyond `c` along gravity holds still: a solid or closed edge, or grains that hold.
export function grainRests(g, grains, c, [gx, gy]) {
  const { W, H, solid, walls } = g, i = c % W, j = (c - i) / W;
  const along = Math.abs(gy) >= Math.abs(gx), di = along ? 0 : gx > 0 ? 1 : -1, dj = along ? (gy > 0 ? 1 : gy < 0 ? -1 : 0) : 0;
  if (!di && !dj) return false;
  const ni = i + di, nj = j + dj;
  if (ni < 0) return walls.left; if (ni >= W) return walls.right; if (nj < 0) return walls.top; if (nj >= H) return walls.bottom;
  const d = nj * W + ni;
  return !!solid[d] || !!grains.rigid[d];
}
export function grainFriction(state, effect, dt) {
  const { g, fluid, grains } = state, { W, H, N, u, v, p } = g, { flowU, flowV, ra, rb, eta, rigid, preU, preV, impact } = grains, X = W + 1;
  const { cohesion, friction } = effect.granular, [gx, gy] = effect.gravity, pull = Math.sqrt(gx * gx + gy * gy);
  // What a cell weighs in the solver's units: the pressure one cell of grains puts on the cell under it.
  const weight = dt * pull;
  // Landing: the pressure solve stopped each cell's fall by some amount this step (the impulse it took along gravity).
  // Up to its weight, that is the support every resting grain gets, and friction takes friction × it off the motion
  // across gravity (Coulomb), so a grain on a slope keeps sliding only on a slope steeper than its repose. What a landing
  // adds on top of the weight is lost outright: grains, unlike drops, neither bounce nor splash, so a grain that lands
  // hard stops where it lands instead of squirting out sideways as water does.
  if (pull > 0) {
    const nx = gx / pull, ny = gy / pull, across = Math.abs(ny) >= Math.abs(nx) ? 'u' : 'v';
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (!fluid[c]) { impact[c] = 0; continue; }
      const du = 0.5 * (preU[j * X + i] + preU[j * X + i + 1] - u[j * X + i] - u[j * X + i + 1]), dv = 0.5 * (preV[c] + preV[c + W] - v[c] - v[c + W]);
      const stop = du * nx + dv * ny;
      const steady = Math.min(stop, weight), hard = stop - steady;
      impact[c] = stop > 0 ? friction * steady + hard : 0;
    }
    const ease = (value, take) => (value > take ? value - take : value < -take ? value + take : 0);
    // The push across gravity the pressure solve gave each face is held to about the grains' weight a step: enough for any
    // avalanche, but a stream landing on a heap no longer shoves its top aside into a crater. (Cheat: a liquid's impact
    // pressure spreads it; grains take the blow by friction.)
    const shove = weight, held = (now, before) => (now - before > shove ? before + shove : now - before < -shove ? before - shove : now);
    if (across === 'u') {
      for (let j = 0; j < H; j++) for (let i = 1; i < W; i++) {
        const k = j * X + i;
        if (!g.uFixed[k] && (fluid[j * W + i - 1] || fluid[j * W + i])) u[k] = ease(held(u[k], preU[k]), Math.max(impact[j * W + i - 1], impact[j * W + i]));
      }
    } else {
      for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (!g.vFixed[k] && (fluid[k - W] || fluid[k])) v[k] = ease(held(v[k], preV[k]), Math.max(impact[k - W], impact[k]));
      }
    }
  }
  // The flow's rates of strain, with the faces at the free surface reading the flow beside them, as the yield path does.
  const uValid = new Uint8Array(u.length), vValid = new Uint8Array(v.length);
  for (let j = 0; j < H; j++) for (let i = 0; i <= W; i++) { const k = j * X + i; uValid[k] = g.uFixed[k] || (i > 0 && fluid[j * W + i - 1]) || (i < W && fluid[j * W + i]) ? 1 : 0; }
  for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; vValid[k] = g.vFixed[k] || (j > 0 && fluid[k - W]) || (j < H && fluid[k]) ? 1 : 0; }
  flowU.set(u); flowV.set(v);
  extrapolate(flowU, uValid, W + 1, H, 2); extrapolate(flowV, vValid, W, H + 1, 2);
  strainRates({ g, fluid, strain: grains }, flowU, flowV);
  // Cohesion is pressure the grains have without being pressed: damp sand at the surface holds as dry sand does
  // `cohesion` pixels down.
  const bond = cohesion * weight;
  // Only grains pressed together hold: a falling stream or clump, pressed by nothing, is no part of the heap it falls
  // onto (holding, it joined the heap's piece and stood frozen in the air).
  const pressed = 0.25 * weight;
  for (let c = 0; c < N; c++) {
    if (!fluid[c]) { eta[c] = 0; rigid[c] = 0; continue; }
    const hold = friction * ((p[c] > 0 ? p[c] : 0) + bond), rate = 2 * Math.sqrt(ra[c] * ra[c] + rb[c] * rb[c]);
    rigid[c] = p[c] > pressed && rate <= hold ? 1 : 0;
    eta[c] = rate > 0 ? Math.min(GRAIN_THICK, hold / (rate * dt)) : GRAIN_THICK;
  }
  return eta;
}
// The cells that hold, joined side to side, are pieces that move as rigid bodies: each piece's velocity becomes its mean
// motion and spin, so nothing inside it shears. A piece that presses on a solid (a solid beside it along gravity) moves
// with that solid instead, as static friction holds it: a heap on the ground stops dead, and sand on a moving plate rides
// with it.
export function grainPieces(state, effect) {
  const { g, grains, solids } = state, { W, H, N, u, v, uFixed, vFixed, solid, walls } = g, { rigid, piece, stack } = grains, X = W + 1;
  const [gx, gy] = effect.gravity;
  piece.fill(-1);
  const inside = (i, j) => i >= 0 && i < W && j >= 0 && j < H;
  const closed = (i, j) => (i < 0 ? walls.left : i >= W ? walls.right : j < 0 ? walls.top : j >= H ? walls.bottom : solid[j * W + i]);
  let pieces = 0;
  for (let start = 0; start < N; start++) {
    if (!rigid[start] || piece[start] >= 0) continue;
    // The piece: a flood fill in a fixed order, so the same source gives the same pieces.
    let top = 0, n = 0, sx = 0, sy = 0, su = 0, sv = 0, rests = 0, ru = 0, rv = 0;
    stack[top++] = start; piece[start] = pieces;
    const cells = [];
    // Pressing on a solid: the cell beyond along gravity is shut. It moves as that solid does (a closed edge is still).
    const press = (i, j) => {
      if (!closed(i, j)) return;
      rests++;
      const w = inside(i, j) ? solids.velocity(j * W + i) : null;
      if (w) { ru += w[0]; rv += w[1]; }
    };
    while (top) {
      const c = stack[--top], i = c % W, j = (c - i) / W;
      cells.push(c);
      n++; sx += i + 0.5; sy += j + 0.5;
      su += 0.5 * (u[j * X + i] + u[j * X + i + 1]); sv += 0.5 * (v[c] + v[c + W]);
      if (gx > 0) press(i + 1, j); else if (gx < 0) press(i - 1, j);
      if (gy > 0) press(i, j + 1); else if (gy < 0) press(i, j - 1);
      for (const [d, ok] of [[c - 1, i > 0], [c + 1, i < W - 1], [c - W, j > 0], [c + W, j < H - 1]]) {
        if (ok && rigid[d] && piece[d] < 0) { piece[d] = pieces; stack[top++] = d; }
      }
    }
    const cx = sx / n, cy = sy / n;
    let vx = su / n, vy = sv / n, spin = 0;
    if (rests) {
      // Held by what it presses on: it moves as that solid moves.
      vx = ru / rests; vy = rv / rests;
    } else {
      let L = 0, I = 0;
      for (const c of cells) {
        const i = c % W, j = (c - i) / W, rx = i + 0.5 - cx, ry = j + 0.5 - cy;
        const cu = 0.5 * (u[j * X + i] + u[j * X + i + 1]), cv = 0.5 * (v[c] + v[c + W]);
        L += rx * (cv - vy) - ry * (cu - vx); I += rx * rx + ry * ry + 1 / 6;
      }
      spin = I > 0 ? L / I : 0;
    }
    // The faces inside the piece and those open to the air move with it; a solid fixes its own, and a face shared with
    // grains that slide stays as solved, so they slide off the piece's edge (pinned there, a heap kept steep walls).
    const own = (d, ok) => !ok || piece[d] === pieces || !state.fluid[d];
    for (const c of cells) {
      const i = c % W, j = (c - i) / W;
      if (!uFixed[j * X + i] && own(c - 1, i > 0)) u[j * X + i] = vx - spin * (j + 0.5 - cy);
      if (!uFixed[j * X + i + 1] && own(c + 1, i < W - 1)) u[j * X + i + 1] = vx - spin * (j + 0.5 - cy);
      if (!vFixed[c] && own(c - W, j > 0)) v[c] = vy + spin * (i + 0.5 - cx);
      if (!vFixed[c + W] && own(c + W, j < H - 1)) v[c + W] = vy + spin * (i + 0.5 - cx);
    }
    pieces++;
  }
  return pieces;
}

// Vorticity confinement: puts back the small swirls that advection smooths away, so smoke curls instead of blurring.
export function confine(g, strength, dt, curl, magnitude) {
  const { W, H, u, v, solid } = g;
  const uc = (i, j) => (u[j * (W + 1) + i] + u[j * (W + 1) + i + 1]) * 0.5, vc = (i, j) => (v[j * W + i] + v[(j + 1) * W + i]) * 0.5;
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const w = (vc(i + 1, j) - vc(i - 1, j)) * 0.5 - (uc(i, j + 1) - uc(i, j - 1)) * 0.5;
    curl[j * W + i] = w; magnitude[j * W + i] = w < 0 ? -w : w;
  }
  for (let j = 2; j < H - 2; j++) for (let i = 2; i < W - 2; i++) {
    const c = j * W + i;
    if (solid[c]) continue;
    const nx = (magnitude[c + 1] - magnitude[c - 1]) * 0.5, ny = (magnitude[c + W] - magnitude[c - W]) * 0.5, length = Math.sqrt(nx * nx + ny * ny) + 1e-6;
    const fx = strength * (ny / length) * curl[c] * dt, fy = -strength * (nx / length) * curl[c] * dt;
    u[j * (W + 1) + i] += fx * 0.5; u[j * (W + 1) + i + 1] += fx * 0.5;
    v[j * W + i] += fy * 0.5; v[(j + 1) * W + i] += fy * 0.5;
  }
}

// Whether the straight path from (x0, y0) to (x1, y1) enters a solid cell after the one it starts in. It visits every
// cell the path passes through, in order (Amanatides and Woo's grid walk), so nothing that moves several pixels in a step
// can skip over a wall one pixel thick, or slip between two pixels that touch only at their corners. Cells beyond the
// grid are open.
export function crossesSolid(solid, W, H, x0, y0, x1, y1) {
  let i = Math.floor(x0), j = Math.floor(y0);
  const dx = x1 - x0, dy = y1 - y0, si = dx > 0 ? 1 : dx < 0 ? -1 : 0, sj = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  // How far along the path (0 to 1) the next vertical and horizontal cell edges are, and how far apart they lie.
  let tx = si ? ((si > 0 ? i + 1 : i) - x0) / dx : 2, ty = sj ? ((sj > 0 ? j + 1 : j) - y0) / dy : 2;
  const stepX = si ? si / dx : 0, stepY = sj ? sj / dy : 0;
  for (let n = Math.abs(Math.floor(x1) - i) + Math.abs(Math.floor(y1) - j); n > 0; n--) {
    if (tx < ty) { i += si; tx += stepX; } else { j += sj; ty += stepY; }
    if (i >= 0 && j >= 0 && i < W && j < H && solid[j * W + i]) return true;
  }
  return false;
}

// Spreads valid face velocities into the faces around them, so particles near the surface read a sensible flow.
export function extrapolate(a, valid, nx, ny, layers) {
  for (let layer = 0; layer < layers; layer++) {
    const known = Uint8Array.from(valid);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (known[k]) continue;
      let sum = 0, n = 0;
      if (i > 0 && known[k - 1]) { sum += a[k - 1]; n++; }
      if (i < nx - 1 && known[k + 1]) { sum += a[k + 1]; n++; }
      if (j > 0 && known[k - nx]) { sum += a[k - nx]; n++; }
      if (j < ny - 1 && known[k + nx]) { sum += a[k + nx]; n++; }
      if (n) { a[k] = sum / n; valid[k] = 1; }
    }
  }
}
// How far below freezing water freezes with no ice or cold solid to start it.
export const SUPERCOOL = 0.5;
// How fast an obstacle's temperature warms or chills the air touching it, per frame (a gas effect's, or a liquid's air).
export const SURFACE_HEAT = 0.15;
export const tempOf = (h, e, ice) => (ice ? (e < h.freeze ? e : h.freeze) : e >= h.freeze + h.latent ? (e - h.latent < h.boil ? e - h.latent : h.boil) : e < h.freeze ? e : h.freeze);
// The energy of water (or ice) at temperature t.
export const energyOf = (h, t, ice) => (ice ? (t < h.freeze ? t : h.freeze) : t < h.freeze ? t : (t < h.boil ? t : h.boil) + h.latent);
// Each cell's obstacle temperature from the solid layer's surface properties: NaN where there is none (an open cell, ice,
// or an obstacle with no temperature, which takes no part in the heat's flow).
export function surfaceTemperatures(solids, out) {
  for (let c = 0; c < solids.N; c++) { const t = solids.solid[c] && solids.owner[c] >= 0 ? solids.props(solids.owner[c]).temperature : null; out[c] = t === null ? NaN : t; }
  return out;
}
// Air touching a hot or cold obstacle takes `rate` of the difference to its temperature (open cells only).
export function warmAir(T, open, hot, W, H, rate) {
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (!open[c]) continue;
    let t = T[c];
    if (i > 0 && hot[c - 1] === hot[c - 1]) t += rate * (hot[c - 1] - t);
    if (i < W - 1 && hot[c + 1] === hot[c + 1]) t += rate * (hot[c + 1] - t);
    if (j > 0 && hot[c - W] === hot[c - W]) t += rate * (hot[c - W] - t);
    if (j < H - 1 && hot[c + W] === hot[c + W]) t += rate * (hot[c + W] - t);
    T[c] = t;
  }
}
// The heat of a liquid on grid `g`. `layout`, `base` (its obstacle pixels) and `places` follow the obstacles as they move
// (see moveObstacles); `mask` is the obstacles' pixels and the ice's, the solver's solid cells (or, beside smooth
// obstacles, the pixels its geometry is traced from).
