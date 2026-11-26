// Field-to-pixel palette rendering, liquid outline and dent cleanup, effect light compositing, spark drawing, loop
// band-memory hand-back and per-frame measurements for pixelforge-fluid. Browser-compatible and deterministic.
import { feathersOf, cleanupIds, traceLine, random } from './craft.js';
import { paintBodies } from './bodies.js';
import { spreadLight, meanOfFive, lightCodes, codeGrid, EMPTY, DRAWN, SURFACE, SHINING } from './light.js';
import { DEPTH, LIGHT, SHADOW, STRAND, LEVEL, DEPTH_REACH, HOLD, HELD, WAITING, SETTLED, SEAM, bilinearZero } from './fluid-grid.js';

// ---- Fields to pixels -------------------------------------------------------------------------------------------------
// A liquid's outline, read in one pass from the cells it covers: a gap one pixel wide with liquid on two sides and liquid
// or an obstacle on a third is filled, and a lone pixel standing on a straight edge (liquid on one side, open air on the
// other three, and liquid either side of its foot) is trimmed. Particles jostling at a resting surface otherwise draw
// it with dents and pimples that come and go every frame. A lone drop, a stream's tip and a two-pixel step stay. A
// walled canvas edge counts as an obstacle.
export const SIDES = [[0, -1], [-1, 0], [1, 0], [0, 1]];
function liquidOutline(wet, solid, walls, width, height) {
  const out = Uint8Array.from(wet);
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const liquid = (x, y) => inside(x, y) && wet[y * width + x] === 1;
  const wall = (x, y) => (inside(x, y) ? solid[y * width + x] === 1 : x < 0 ? walls.left : x >= width ? walls.right : y < 0 ? walls.top : walls.bottom);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const c = j * width + i;
    if (solid[c]) continue;
    let wets = 0, walled = 0, foot = null;
    for (const side of SIDES) {
      if (liquid(i + side[0], j + side[1])) { wets++; foot = side; } else if (wall(i + side[0], j + side[1])) walled++;
    }
    if (!wet[c]) { if (wets >= 2 && wets + walled >= 3) out[c] = 1; continue; }
    if (wets !== 1 || walled) continue;
    const [dx, dy] = foot, x = i + dx, y = j + dy;
    if (liquid(x - dy, y + dx) && liquid(x + dy, y - dx)) out[c] = 0;
  }
  return out;
}

// A body's cells under the liquid are drawn as the liquid beside them, under the body's own drawing (docs/physics-model.md,
// section 13). A body is solid where its exact shape covers a pixel's centre, but drawn where it is (finer than these
// pixels, or held at a whole pixel), so its drawing leaves a sliver of some of its cells uncovered; drawn empty, those
// slivers were holes in the water under a floating ball, coming and going as it bobbed. A run of body cells along a row
// is under the liquid when liquid closes it in, on both sides or on one side with a wall or an obstacle on the other;
// each cell of it takes the colour of the liquid on its nearer side (the left, halfway). Above the surface the runs meet
// air and stay empty.
function underBodies(chars, solid, see, walls, width, height) {
  for (let j = 0; j < height; j++) for (let i = 0; i < width;) {
    if (!see[j * width + i]) { i++; continue; }
    let k = i;
    while (k < width && see[j * width + k]) k++;
    const left = j * width + i - 1, right = j * width + k;
    const wetLeft = i > 0 && !solid[left] && chars[left] > 0, wetRight = k < width && !solid[right] && chars[right] > 0;
    const shutLeft = wetLeft || (i > 0 ? solid[left] === 1 : walls.left), shutRight = wetRight || (k < width ? solid[right] === 1 : walls.right);
    if ((wetLeft || wetRight) && shutLeft && shutRight) {
      for (let x = i; x < k; x++) chars[j * width + x] = wetLeft && (!wetRight || x - i < k - x) ? chars[left] : chars[right];
    }
    i = k;
  }
}

// The dents in a liquid's surface that bodies stir, filled in `wet` (which cells it fills is returned): a run of up to
// DENTS empty cells along a row (across gravity), with liquid at both ends and liquid or a solid under every cell of it.
// Rows are taken from the bottom up, so a V-shaped notch fills from its tip and flattens into the shallow trough around it,
// while a wider trough, a crater or a gap beside a body stays. A paddle turning under the surface stirs ripples a pixel
// deep and a few across, which the grid cut into notches opening and closing above it; the depth bands follow the surface
// as drawn, so they stay level under a filled dent.
const DENTS = 3;
function smoothDents(wet, solid, gravity, width, height) {
  const across = Math.abs(gravity[1]) >= Math.abs(gravity[0]), sign = (across ? gravity[1] : gravity[0]) >= 0 ? 1 : -1;
  const lines = across ? height : width, length = across ? width : height, cell = (a, b) => (across ? a * width + b : b * width + a), out = [];
  for (let k = 0; k < lines; k++) {
    const a = sign > 0 ? lines - 1 - k : k, under = a + sign;
    if (under < 0 || under >= lines) continue;
    for (let b = 0; b < length;) {
      if (wet[cell(a, b)] || solid[cell(a, b)]) { b++; continue; }
      let e = b;
      while (e < length && !wet[cell(a, e)] && !solid[cell(a, e)]) e++;
      if (e - b <= DENTS && b > 0 && e < length && wet[cell(a, b - 1)] && wet[cell(a, e)]) {
        let floor = true;
        for (let x = b; x < e && floor; x++) { const u = cell(under, x); if (!wet[u] && !solid[u]) floor = false; }
        if (floor) for (let x = b; x < e; x++) { wet[cell(a, x)] = 1; out.push(cell(a, x)); }
      }
      b = e;
    }
  }
  return out;
}

// A bilinear sample over the open cells only: obstacle cells drop out and the rest are weighted up to make up for them
// (off the canvas counts as empty). With no open cell in reach it returns `fallback`.
function openSample(a, solid, nx, ny, fx, fy, fallback) {
  const i = Math.floor(fx), j = Math.floor(fy), s = fx - i, t = fy - j;
  let sum = 0, weight = 0;
  for (const [di, dj, w] of [[0, 0, (1 - s) * (1 - t)], [1, 0, s * (1 - t)], [0, 1, (1 - s) * t], [1, 1, s * t]]) {
    const x = i + di, y = j + dj;
    if (x < 0 || y < 0 || x >= nx || y >= ny) { weight += w; continue; }
    if (solid[y * nx + x]) continue;
    sum += a[y * nx + x] * w; weight += w;
  }
  return weight > 1e-9 ? sum / weight : fallback;
}

// Each look layer maps one field to palette colours: a colour is fully on from its threshold up, and `dither` feathers
// it in below, through the pattern, over that share of the gap to the previous threshold. Later layers draw over
// earlier ones; obstacles never hold fluid. Then optional cleanup and a one-pixel outline.
// With `hold`, the drawing remembers the band it drew each pixel in last frame (`hold.prev[role]`, null on the first
// frame) and notes this frame's in `hold.now[role]`, SETTLED once the field has been clearly inside the band (HOLD of
// its width from the thresholds; for a liquid's edge, HOLD of LEVEL) since the pixel last changed. A settled pixel
// changes band once its field has stayed across a threshold for a second frame (WAITING), or at once if it is clearly
// past, so a steady rise or fade is drawn at most a frame late and a one-frame dip or flare is not drawn; one that has
// just changed goes back only once its field is clearly past the threshold, so a field hovering there no longer flips
// it every frame, as a body holds its drawn place. A settled gas pixel whose field falls below the lowest threshold
// goes at once, so smoke thins away on time and a one-shot ends empty. Depth and strands are whole numbers and never
// hover, so their bands follow the liquid's held edge.
export function renderFields(effect, base, width, height, drawn = null, hold = null, role = 'fluid') {
  // Colour codes are 16-bit: a palette key may be any single character, such as an accented letter.
  const N = width * height, { solid, front, liquid, see } = effect, runs = new Float64Array(N), depth = new Float64Array(N), chars = new Uint16Array(N);
  const before = hold && hold.prev ? hold.prev[role] ?? null : null, after = hold ? { wet: new Uint8Array(N), levels: effect.look.map(() => new Uint8Array(N)) } : null;
  if (after) hold.now[role] = after;
  let [density] = base, wet = new Uint8Array(N), filled = null;
  if (!liquid) for (let c = 0; c < N; c++) wet[c] = !solid[c] && density[c] >= LEVEL ? 1 : 0;
  else {
    // A liquid covers every cell its density reaches LEVEL in, and every cell a layer of its own draws (density,
    // temperature or speed: a thin, fast stream is drawn by its speed), so a stream's depth runs on through it instead of
    // starting a new surface under each thin pixel. Each cell notes whether it is wet as drawn (1), clearly wet, HOLD past
    // a threshold (2), and possibly wet, within HOLD of one (4).
    const [high, low] = [LEVEL * (1 + HOLD), LEVEL * (1 - HOLD)];
    for (let c = 0; c < N; c++) if (!solid[c]) { const d = density[c]; wet[c] = (d >= LEVEL ? 1 : 0) | (d >= high ? 2 : 0) | (d >= low ? 4 : 0); }
    for (const layer of effect.look) {
      if (layer.field > 2) continue;
      const field = base[layer.field], { thresholds, gaps } = layer, feathers = feathersOf(layer, width, height);
      for (let c = 0; c < N; c++) {
        if (solid[c] || wet[c] === 7) continue;
        const value = field[c], cut = thresholds[0] - feathers[c] * gaps[0], margin = HOLD * (1 - feathers[c]) * gaps[0];
        wet[c] |= (value >= cut ? 1 : 0) | (value >= cut + margin ? 2 : 0) | (value >= cut - margin ? 4 : 0);
      }
    }
    for (let c = 0; c < N; c++) {
      const flags = wet[c], plain = flags & 1;
      let now = plain;
      if (before) {
        const was = before.wet[c] & 1, settled = before.wet[c] & SETTLED, clear = was ? (flags & 4 ? 1 : 0) : (flags & 2 ? 1 : 0);
        let waiting = 0;
        if (now !== was) { if (clear !== was) { if (!settled) now = clear; } else if (!settled || !(before.wet[c] & WAITING)) { now = was; waiting = settled ? WAITING : 0; } }
        if (after) after.wet[c] = now | waiting | ((now === was && settled) || (now ? flags & 2 : !(flags & 4)) ? SETTLED : 0);
      } else if (after) after.wet[c] = now | ((now ? flags & 2 : !(flags & 4)) ? SETTLED : 0);
      wet[c] = now;
    }
    // The wake a body leaves, while the liquid still closes it in, is drawn as liquid: the solve already counts it so, and
    // drawn empty it showed a fresh surface in the deep behind each arm of a turning paddle until the water drifted in.
    if (effect.wakes) {
      const { fluid, left } = effect.wakes;
      for (let c = 0; c < N; c++) if (left[c] && fluid[c] && !wet[c] && !solid[c]) {
        wet[c] = 1;
        if (!filled) { filled = []; density = Float64Array.from(density); }
        filled.push(c);
        if (density[c] < LEVEL) density[c] = LEVEL;
      }
    }
    const outline = liquidOutline(wet, solid, effect.walls, width, height);
    // A filled gap is drawn as liquid at the surface level, so the layers colour it like the cells around it.
    for (let c = 0; c < N; c++) if (outline[c] && !wet[c]) {
      if (!filled) { filled = []; density = Float64Array.from(density); }
      filled.push(c);
      if (density[c] < LEVEL) density[c] = LEVEL;
    }
    wet = outline;
    // A surface that bodies stir is drawn without its narrow dents (see smoothDents); sand keeps its grain and a boil its
    // rough surface.
    if (see && !effect.granular && !effect.heat) for (const c of smoothDents(wet, solid, effect.gravity, width, height)) {
      if (!filled) { filled = []; density = Float64Array.from(density); }
      filled.push(c);
      if (density[c] < LEVEL) density[c] = LEVEL;
    }
    // A little pocket a body leaves in the deep, sealed off by the liquid and the bodies (no way to the open air), is drawn
    // as liquid too: the liquid closes it within a frame or two, and drawn empty it started a fresh surface, a pale block
    // in the deep, under a turning paddle. Only pockets that touch a body: sealed air of its own (a bottle glugging) shows.
    if (see) {
      const POCKET = 24, reached = new Uint8Array(N), stack = [];
      const free = c => !wet[c] && !solid[c] && !see[c];
      const reach = c => { if (!reached[c] && free(c)) { reached[c] = 1; stack.push(c); } };
      for (let i = 0; i < width; i++) { if (!effect.walls.top) reach(i); if (!effect.walls.bottom) reach((height - 1) * width + i); }
      for (let j = 0; j < height; j++) { if (!effect.walls.left) reach(j * width); if (!effect.walls.right) reach(j * width + width - 1); }
      while (stack.length) {
        const c = stack.pop(), i = c % width, j = (c - i) / width;
        if (i > 0) reach(c - 1); if (i < width - 1) reach(c + 1); if (j > 0) reach(c - width); if (j < height - 1) reach(c + width);
      }
      for (let start = 0; start < N; start++) {
        if (reached[start] || !free(start)) continue;
        // One sealed pocket: its cells, and whether a body's cell borders it.
        const pocket = [start];
        let near = false;
        reached[start] = 1;
        for (let k = 0; k < pocket.length; k++) {
          const c = pocket[k], i = c % width, j = (c - i) / width;
          for (const [ok, d] of [[i > 0, -1], [i < width - 1, 1], [j > 0, -width], [j < height - 1, width]]) {
            if (!ok) continue;
            if (see[c + d]) near = true;
            if (!reached[c + d] && free(c + d)) { reached[c + d] = 1; pocket.push(c + d); }
          }
        }
        if (!near || pocket.length > POCKET) continue;
        for (const c of pocket) {
          wet[c] = 1;
          if (!filled) { filled = []; density = Float64Array.from(density); }
          filled.push(c);
          if (density[c] < LEVEL) density[c] = LEVEL;
        }
      }
    }
  }
  const covered = new Uint8Array(N);
  for (let i = 0; i < width; i++) {
    let run = 0, under = 0;
    for (let j = 0; j < height; j++) {
      const c = j * width + i;
      // A body under the liquid carries its column's depth on through it (it starts none of its own).
      if (wet[c]) { if (!run) under = j > 0 && solid[c - width] ? 1 : 0; run++; } else if (see && see[c] && run) run++; else run = 0;
      runs[c] = run; covered[c] = run ? under : 0;
    }
  }
  // Liquid whose column starts right under a wall or obstacle has no surface above it. It takes the depth of the nearest
  // liquid along the row whose column does reach a surface, so water under an overhang is as deep as the pool beside it
  // instead of showing a surface highlight in the deep; where there is none (a drop hanging under a rock), it keeps its own.
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const c = j * width + i;
    if (!covered[c]) continue;
    let left = i - 1, right = i + 1;
    // The search passes through bodies, as water does round them.
    for (;;) {
      const lc = j * width + left, rc = j * width + right;
      const l = left >= 0 && (runs[lc] || (see && see[lc])), r = right < width && (runs[rc] || (see && see[rc]));
      if (!l && !r) break;
      if (l && runs[lc] && !covered[lc] && !(see && see[lc])) { runs[c] = runs[lc]; break; }
      if (r && runs[rc] && !covered[rc] && !(see && see[rc])) { runs[c] = runs[rc]; break; }
      left = l ? left - 1 : -1; right = r ? right + 1 : width;
    }
  }
  // Below its first two rows, depth follows the shallowest surface within DEPTH_REACH pixels along the row through the
  // liquid, so the deeper bands stay level under a drop that lands or a crest that rises instead of sinking beneath it.
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const c = j * width + i;
    let d = runs[c];
    if (d > 2) {
      for (const step of [-1, 1]) for (let k = 1, x = i + step; k <= DEPTH_REACH && x >= 0 && x < width && runs[j * width + x]; k++, x += step) if (runs[j * width + x] < d) d = runs[j * width + x];
      if (d < 3) d = 3;
    }
    depth[c] = d;
  }
  // Light and shadow are the share by which density falls two pixels toward the light and two pixels away from it:
  // 1 on a rim that faces the light (or faces away), 0 inside, whatever the density, so a thinning puff keeps its form.
  // A liquid against an obstacle is lit (or shaded) in full where it touches it on the side toward the light (or away
  // from it), and obstacles further off take no part in the sample: a pool in a stepped bowl gets an even rim along the
  // bowl instead of light and dark pixels by turns as the sample lands on the bowl or on liquid.
  // A gas cut by an open canvas edge goes on past it: a sample that lands outside reads the edge instead of nothing, so
  // smoke leaving the picture gets no bright line along the edge. A closed edge is a wall, and lights as an obstacle does.
  const walls = effect.walls, inside = (fx, fy) => bilinearZero(density, width, height,
    fx < 0 && !walls.left ? 0 : fx > width - 1 && !walls.right ? width - 1 : fx, fy < 0 && !walls.top ? 0 : fy > height - 1 && !walls.bottom ? height - 1 : fy);
  const lit = new Float64Array(N), shade = new Float64Array(N), [lx, ly] = effect.light;
  const sx = lx >= 0.38 ? 1 : lx <= -0.38 ? -1 : 0, sy = ly >= 0.38 ? 1 : ly <= -0.38 ? -1 : 0;
  if (effect.look.some(layer => layer.field === LIGHT || layer.field === SHADOW)) for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const c = j * width + i, here = density[c], x = i + 0.5, y = j + 0.5;
    if (here <= 0) continue;
    if (liquid) {
      const touches = (dx, dy) => (dx && i + dx >= 0 && i + dx < width && solid[c + dx]) || (dy && j + dy >= 0 && j + dy < height && solid[c + dy * width]);
      lit[c] = touches(sx, sy) ? 1 : Math.max(0, 1 - openSample(density, solid, width, height, x + 2 * lx - 0.5, y + 2 * ly - 0.5, here) / here);
      shade[c] = touches(-sx, -sy) ? 1 : Math.max(0, 1 - openSample(density, solid, width, height, x - 2 * lx - 0.5, y - 2 * ly - 0.5, here) / here);
      continue;
    }
    lit[c] = Math.max(0, 1 - inside(x + 2 * lx - 0.5, y + 2 * ly - 0.5) / here);
    shade[c] = Math.max(0, 1 - inside(x - 2 * lx - 0.5, y - 2 * ly - 0.5) / here);
  }
  const sources = [density, base[1], base[2], depth, lit, shade, base[3], base[4], base[5]];
  // A filled gap that no layer coloured (a look whose first colour starts above the surface level) takes the colour of
  // a neighbour, along the edge first.
  const patch = () => {
    if (filled) for (const c of filled) if (!chars[c]) for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      const x = c % width + dx, y = Math.floor(c / width) + dy, n = y * width + x;
      if (x >= 0 && y >= 0 && x < width && y < height && wet[n] && chars[n]) { chars[c] = chars[n]; break; }
    }
    filled = null;
  };
  // Light and shadow only recolour pixels that earlier layers drew. A liquid draws only inside its outline, but for its
  // strands, which are thinner than any outline. `by` notes which layer drew each pixel last, for halos.
  const by = effect.look.some(layer => layer.halo) ? new Uint8Array(N) : null;
  for (const [index, layer] of effect.look.entries()) {
    const field = sources[layer.field];
    if (!field) continue;
    const { thresholds, gaps, colors, dither } = layer, shading = layer.field === LIGHT || layer.field === SHADOW, strands = layer.field === STRAND;
    const n = thresholds.length, held = before && layer.field !== DEPTH && !strands ? before.levels[index] : null, keep = after ? after.levels[index] : null;
    // Where a pixel's threshold k sits (its feather f below the layer's), and how far past it a field must go to be clear
    // of it: HOLD of the band below it, as wide as it is at this pixel (so a low, dithered threshold is held by as little).
    const cut = (k, f) => thresholds[k] - f * gaps[k], margin = (k, f) => HOLD * ((1 - f) * gaps[k] + (k ? f * gaps[k - 1] : 0));
    // Below this a pixel is in no band however it is held, and settled there.
    const none = keep ? cut(0, dither) - margin(0, dither) : cut(0, dither), feathers = feathersOf(layer, width, height);
    if (shading) patch();
    for (let c = 0; c < N; c++) {
      const value = field[c];
      if (value < none) { if (keep) keep[c] = SETTLED; continue; }
      const hidden = solid[c] || (liquid && !wet[c] && !strands) || (shading && !chars[c]);
      // The bands are noted under hidden pixels too: what the field did there decides how a pixel shown later is held.
      if (!keep && hidden) continue;
      const feather = feathers[c];
      let level = 0;
      while (level < n && value >= thresholds[level] - feather * gaps[level]) level++;
      if (keep) {
        const was = held ? held[c] & HELD : level, settled = held ? held[c] & SETTLED : 0;
        let waiting = 0;
        // A gas that was settled in its band fades out as soon as its field falls below the lowest threshold, so smoke
        // thins away on time and a one-shot ends empty; anything else changes band as held.
        if (level !== was && (liquid || level || !settled)) {
          // The band the field has gone HOLD past the thresholds toward, from last frame's.
          let up = 0, down = 0;
          while (up < n && value >= cut(up, feather) + margin(up, feather)) up++;
          while (down < n && value >= cut(down, feather) - margin(down, feather)) down++;
          const clear = was < up ? up : was > down ? down : was;
          if (clear !== was) { if (!settled) level = clear; } else if (!settled || !(held[c] & WAITING)) { level = was; waiting = settled ? WAITING : 0; }
        }
        const inside = (!level || value >= cut(level - 1, feather) + margin(level - 1, feather)) && (level === n || value < cut(level, feather) - margin(level, feather));
        keep[c] = level | waiting | ((level === was && settled) || inside ? SETTLED : 0);
      }
      if (!hidden && level) { chars[c] = colors[level - 1]; if (by) by[c] = index + 1; }
    }
  }
  patch();
  if (effect.cleanup.strays || effect.cleanup.corners) {
    // An obstacle is neither fluid nor air: a corner pixel tucked against one is not a step in the fluid's edge, so
    // cleanup never opens a hole between the fluid and a wall.
    for (const change of cleanupIds(chars, width, height, { ...effect.cleanup, allowed: c => !solid[c], walls: c => solid[c] })) {
      // A liquid's lone pixel is a drop whose particles are there: De-Stray may recolour it but never erase it, so a
      // small drop doesn't vanish for a frame (a gas's lone speck is noise, and goes).
      if (effect.liquid && change.kind === 'stray' && !change.id && chars[change.index]) continue;
      chars[change.index] = change.id;
    }
  }
  // `drawn`, when given, marks the cells the look layers drew the fluid on (after cleanup, before the outline).
  if (drawn) for (let c = 0; c < N; c++) drawn[c] = chars[c] ? 1 : 0;
  if (liquid && see) underBodies(chars, solid, see, effect.walls, width, height);
  // Halos, in look order: the empty pixels within a round reach of a layer's pixels (an offset (dx, dy) reaches when
  // dx² + dy² ≤ (width + 0.5)² − 1, so one pixel wide is the four neighbours) take its glow colour.
  if (by) effect.look.forEach((layer, index) => {
    if (!layer.halo) return;
    const { color, width: reach } = layer.halo, limit = (reach + 0.5) * (reach + 0.5) - 1, glow = [];
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const c = j * width + i;
      if (chars[c] || solid[c]) continue;
      search: for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const x = i + dx, y = j + dy, n = y * width + x;
        if (dx * dx + dy * dy > limit || x < 0 || y < 0 || x >= width || y >= height || by[n] !== index + 1 || !chars[n]) continue;
        glow.push(c);
        break search;
      }
    }
    for (const c of glow) chars[c] = color;
  });
  if (effect.outline) {
    // The outline may cover an obstacle drawn under the fluid, never one drawn over it.
    const filled = Uint16Array.from(chars);
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const c = j * width + i;
      if (filled[c] || front[c]) continue;
      if ((i > 0 && filled[c - 1]) || (i < width - 1 && filled[c + 1]) || (j > 0 && filled[c - width]) || (j < height - 1 && filled[c + width])) chars[c] = effect.outline;
    }
  }
  return chars;
}

// ---- Light ------------------------------------------------------------------------------------------------------------
// What an effect's `shine` lights (readShine; the flood is light.js). On each frame the shining field becomes each
// cell's power: how far it is from `from` to `full`, averaged over the five by five cells about it, so the body of a
// flame lights and a lone speck of heat barely does. The flood spreads that through the open cells, and what is solid
// drinks it: a solid is lit on the side the light comes from and darker further in, and shadows what is behind it. A
// decoration (solid: false) is a flat thing the light lies on: light crosses it as it crosses open air. The picture is
// one plane to the flood, so things drawn one before another (stones behind a fire, logs before it) are best all
// decorations, lit by how far they are from it. Then each cell's light moves `ease` of the way to what reached it:
// the light follows the fire a little late, steadier than the flame's own edge, and a loop's closing frames take it
// back to the warm-up's (see simulate). Nothing here is a shape laid over the picture: where there is light is where
// the flood got to. A frame's count of pixels is the fluid's own; its light is not counted.
// A body is two things to the light. It drinks light in its solid cells, where the gas meets it. It is a surface on the
// pixels it is drawn on (its trail and smear with it), which only the frame's own drawing of it tells: its picture is
// turned as a sprite is, its drawn place holds as it passes a pixel's edge, a loop's closing frames draw it on its way
// back to the warm-up's place, and with subpixels it is drawn finer than the cells (see bodiesOver and fineLight).
const SHINE_MASKS = new WeakMap();
// For a layout: the cells that are a surface the light shows on (the pixels of every obstacle that is drawn). The cells
// that drink light are the layout's solid ones.
function shineMasks(effect, layout, width, height) {
  let masks = SHINE_MASKS.get(layout);
  if (!masks) {
    const surface = new Uint8Array(width * height);
    effect.obstacles.forEach((o, i) => {
      const at = layout.places[i];
      if (!at.show || o.draw === 'none') return;
      o.rows.forEach((row, j) => {
        if (at.y + j < 0 || at.y + j >= height) return;
        for (let k = Math.max(0, -at.x); k < Math.min(row.length, width - at.x); k++) if (row[k] !== '.' && row[k] !== ' ') surface[(at.y + j) * width + at.x + k] = 1;
      });
    });
    SHINE_MASKS.set(layout, masks = { drinks: layout.solid, surface });
  }
  return masks;
}
// One frame of a run's light, from the fields as they are now: `run.shine.lit` is each cell's light after it.
export function stepShine(run, width, height) {
  const { source, from, full, reach, depth, ease } = run.effect.shine, N = width * height, values = run.base[source], span = full - from;
  const { drinks } = shineMasks(run.effect, run.layout, width, height), { memory, level, across, power, lit } = run.shine;
  let any = false;
  for (let c = 0; c < N; c++) { const share = drinks[c] ? 0 : (values[c] - from) / span; level[c] = share <= 0 ? 0 : share >= 1 ? 1 : share; if (share > 0) any = true; }
  if (!any) { for (let c = 0; c < N; c++) lit[c] -= lit[c] * ease; return; }
  // The mean over five by five cells; nothing inside a solid shines.
  meanOfFive(level, across, power, width, height);
  for (let c = 0; c < N; c++) if (drinks[c]) power[c] = 0;
  const light = spreadLight(memory, power, drinks, reach, depth);
  for (let c = 0; c < N; c++) lit[c] += (light[c] - lit[c]) * ease;
}
// The light a frame is drawn with: the run's, in single precision, which is what a compile keeps of each frame until it
// draws them. The live runner draws with the same numbers, so its bands are cut where a compiled frame's are. (It cut
// them from the doubles: eight pixels along a row from a full light with a reach of 20 the light is 0.5999999999999996,
// under a threshold of 0.6 as a double and at it as a single, and a whole band's edge was a pixel off the compiled one.)
export const frameLight = run => Float32Array.from(run.shine.lit);
// A frame's light as palette codes (0 where none shows), or null if none shows anywhere. Every drawn obstacle's pixels
// take `colors` by their light, or `dark` below the first of them, and so do the pixels the bodies are drawn on; what
// the fluid drew in any colour but the shining field's own takes `smoke`; the empty pixels take `wall`. Sparks and the
// shining gas itself take nothing, unless an obstacle or a body is drawn over them. `grid` is the frame as drawn,
// `sparks` marks its spark pixels (or null) and `bodies` the pixels its bodies drew (from bodiesOver; or null).
export function shineCodes(effect, layout, lit, grid, sparks, bodies, width, height) {
  const { own } = effect.shine, N = width * height, { surface } = shineMasks(effect, layout, width, height), { front } = layout, kinds = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    const ch = grid[c], body = bodies !== null && bodies[c] !== 0;
    kinds[c] = (sparks && sparks[c]) || (own.has(ch) && !front[c] && !body) ? SHINING : surface[c] || body ? SURFACE : ch ? DRAWN : EMPTY;
  }
  return lightCodes(effect.shine, lit, kinds, width, height);
}
// The bodies painted over a frame's pixels (`chars`), at whole pixels. Returns the grid they were painted on, 0 wherever
// they drew nothing: the pixels the bodies are drawn on, for the frame's light. Painted on a grid of their own and laid
// over the frame's, they draw what painting them straight onto it does. (The light took a body's solid cells for the
// pixels it is drawn on: `colors` and `dark` lay on empty pixels beside a turned crate and missed part of it.)
export function bodiesOver(bodies, chars, width, height, symbols) {
  const own = new Uint16Array(chars.length);
  paintBodies(bodies, own, width, height, symbols);
  for (let c = 0; c < own.length; c++) if (own[c]) chars[c] = own[c];
  return own;
}
// The light of a frame whose bodies are drawn finer than its cells (subpixels: `n` fine pixels to a cell's side), in the
// cells the bodies are drawn in. There each fine pixel of a body takes what a surface takes by its cell's light, and the
// cell's other fine pixels what the cell took (`codes`: the frame's light without its bodies, or null). `bodies` is the
// grid operation the frame draws them with, so where it draws is where they are. Returns those cells, which the frame's
// own light then leaves out, and their light as a grid operation at the fine pixels, or null if it draws nothing there.
export function fineLight(shine, lit, codes, bodies, width, height, n) {
  const N = width * height, W = width * n, cells = new Uint8Array(N), on = new Uint8Array(W * height * n), fine = new Uint16Array(on.length);
  bodies.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] !== '.') { const x = bodies.x + i, y = bodies.y + j; on[y * W + x] = 1; cells[Math.floor(y / n) * width + Math.floor(x / n)] = 1; }
  });
  const surface = lightCodes(shine, lit, cells.map(cell => (cell ? SURFACE : SHINING)), width, height);
  for (let c = 0; c < N; c++) {
    if (!cells[c]) continue;
    const x0 = c % width * n, y0 = Math.floor(c / width) * n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const f = (y0 + j) * W + x0 + i; fine[f] = on[f] ? (surface ? surface[c] : 0) : codes ? codes[c] : 0; }
  }
  return { cells, op: codeGrid(fine, W, height * n) };
}
// A loop's closing frames hand the drawing's memory back to the warm-up's (`to`, the bands drawn in the frame before the
// one these fields blend toward): each pixel, by its own seeded draw, takes the warm-up's bands once the blend weight `w`
// passes its draw, and keeps them on. At the last frame every pixel has, so it is drawn as the warm-up's last frame was,
// and frame 0 follows it as it followed that frame (see simulate).
export function handBack(hold, to, w, seed) {
  for (const [role, own] of Object.entries(hold.prev)) {
    const theirs = to[role], wet = Uint8Array.from(own.wet), levels = own.levels.map(level => Uint8Array.from(level));
    for (let c = 0; c < wet.length; c++) {
      if (random(seed, SEAM, c) >= w) continue;
      wet[c] = theirs.wet[c];
      for (let k = 0; k < levels.length; k++) levels[k][c] = theirs.levels[k][c];
    }
    hold.prev[role] = { wet, levels };
  }
}
// Draws the sparks through `put(x, y, code)`: a spark is a size × size block in the colour for its age, and a trail
// streaks back to where it was a frame ago in the next colour of its list. Popped bubbles follow and age a frame.
// A spark is held to its drawn pixel along each axis as the fluid's bands are (see renderFields): `drawn` is where it was
// drawn last frame and `settled` whether it has since been HOLD of a pixel inside that pixel. A settled spark steps on as
// soon as it crosses into the next pixel; one that has just stepped steps back only once it is HOLD past the edge, so a
// bubble swaying under a ledge or foam riding a ripple at a pixel's edge no longer steps back and forth every frame.
// Returns the pixel and whether it is settled there.
function heldPixel(drawn, settled, at) {
  let pixel = Math.floor(at);
  if (drawn !== undefined && pixel !== drawn && !settled && at >= drawn - HOLD && at < drawn + 1 + HOLD) pixel = drawn;
  return [pixel, (pixel === drawn && settled) || (at >= pixel + HOLD && at < pixel + 1 - HOLD)];
}
export function drawSparks(run, put, shown = null) {
  const { W, H, pixels: solid } = run.state.g;
  // Whether a size × size block at (x0, y0) would cover an obstacle (or ice) pixel.
  const blocked = (x0, y0, size) => { for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const x = x0 + i, y = y0 + j; if (x >= 0 && y >= 0 && x < W && y < H && solid[y * W + x]) return true; } return false; };
  for (const p of run.sparks) {
    // Spray is drawn once it has left the water, and streaks back only from where it was already drawn.
    if ((p.hide && !p.out) || (shown && !shown(p))) continue;
    const s = p.s, step = Math.min(s.colors.length - 1, Math.floor(p.age * s.colors.length / p.life)), seen = !p.hide || p.seen;
    p.seen = true;
    // A bubble is as large as the air it holds. Held over an obstacle it has slid past, it is drawn where it is.
    const size = p.size ?? s.size, head = s.colors[step].charCodeAt(0), cx = p.x - (size - 1) / 2, cy = p.y - (size - 1) / 2;
    let [x0, sx] = heldPixel(p.hx, p.sx, cx), [y0, sy] = heldPixel(p.hy, p.sy, cy);
    if ((x0 !== Math.floor(cx) || y0 !== Math.floor(cy)) && blocked(x0, y0, size)) { [x0, sx] = heldPixel(undefined, false, cx); [y0, sy] = heldPixel(undefined, false, cy); }
    // The streak runs from where the head was drawn last frame (or, on its first, from where it was) to where it is now.
    if (s.trail && p.px !== undefined && seen) {
      const tail = s.colors[Math.min(s.colors.length - 1, step + 1)].charCodeAt(0);
      traceLine(p.hx ?? Math.floor(p.px), p.hy ?? Math.floor(p.py), x0, y0, (x, y) => put(x, y, tail));
    }
    p.hx = x0; p.hy = y0; p.sx = sx; p.sy = sy;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) put(x0 + i, y0 + j, head);
  }
  // A popped bubble: the ring around its block, then a droplet off each upper corner.
  const { pops } = run;
  for (let k = pops.length - 1; k >= 0; k--) {
    const b = pops[k], x0 = Math.floor(b.x - (b.size - 1) / 2), y0 = Math.floor(b.y - (b.size - 1) / 2);
    if (shown && !shown(b)) { if (++b.age > 1) pops.splice(k, 1); continue; }
    if (b.age === 0) for (let i = 0; i < b.size; i++) { put(x0 + i, y0 - 1, b.code); put(x0 + i, y0 + b.size, b.code); put(x0 - 1, y0 + i, b.code); put(x0 + b.size, y0 + i, b.code); }
    else { put(x0 - 1, y0 - 1, b.code); put(x0 + b.size, y0 - 1, b.code); }
    if (++b.age > 1) pops.splice(k, 1);
  }
}
// Figures for one frame, so an agent can tune by numbers: the box round the fluid's drawn pixels ([left, top, right,
// bottom], sparks left out), the middle of its density, its amount (smoke, or cells' worth of water), how many separate
// pieces it is drawn in (pixels touching side to side), its top speed where it is drawn (pixels per frame), and for a
// liquid its particles. An empty frame has no box or middle.
export const tenth = value => Math.floor(value * 10 + 0.5) / 10, hundredth = value => Math.floor(value * 100 + 0.5) / 100;
export function measureFrame(chars, base, solid, width, height, particles) {
  const [density, , speed] = base, N = width * height, seen = new Uint8Array(N), stack = [];
  let left = width, top = height, right = -1, bottom = -1, amount = 0, sx = 0, sy = 0, fastest = 0, pieces = 0;
  for (let c = 0; c < N; c++) {
    const x = c % width, y = (c - x) / width;
    if (!solid[c] && density[c] > 0) { amount += density[c]; sx += density[c] * (x + 0.5); sy += density[c] * (y + 0.5); }
    if (!chars[c]) continue;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
    if (speed[c] > fastest) fastest = speed[c];
    if (seen[c]) continue;
    pieces++; seen[c] = 1; stack.push(c);
    while (stack.length) {
      const d = stack.pop(), dx = d % width;
      for (const e of [dx > 0 ? d - 1 : -1, dx < width - 1 ? d + 1 : -1, d - width, d + width]) if (e >= 0 && e < N && chars[e] && !seen[e]) { seen[e] = 1; stack.push(e); }
    }
  }
  return {
    box: right < 0 ? null : [left, top, right, bottom], middle: amount > 0 ? [tenth(sx / amount), tenth(sy / amount)] : null,
    amount: hundredth(amount), pieces, speed: hundredth(fastest), ...(particles !== null && { particles })
  };
}
// The per-frame figures as one list per figure, which keeps the metadata compact.
export const columns = list => Object.fromEntries(Object.keys(list[0]).map(key => [key, list.map(figure => figure[key])]));

