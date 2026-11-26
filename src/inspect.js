// Browser-compatible contact sheets, palette-key grids, playback review, advisory diagnostics and revision comparison.
// Built on src/recipe.js and re-exported by src/core.js; produces in-memory images and reports with no I/O.
import { idsOf, cleanupIds } from './craft.js';
import { layoutText, FONT_HEIGHT, FONT_CHARACTERS } from './font.js';
import {
  PixelError, fail, own, object, integer, boolean, list, name,
  parseColor, blend, BlendOrigins, frameColours, grouped, PNG_PIXELS,
  stillsHaveNoAnimation, scalePixels, readGuides, drawGuides, toHex
} from './recipe.js';

// Inspection and comparison build in-memory contact sheets and palette-key text. Nothing is written.
const gutterColor = [23, 25, 29, 255], checkerColors = [[143, 145, 151, 255], [131, 133, 139, 255]];
const legendSymbols = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&*+-/:;<=>@^_~';
const colorId = (data, at) => ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;

// Names exact RGBA colors with single-character palette keys where possible. Other colors get legend symbols in a
// stable order (multi-character palette names, then first use by frame), so every readback of a revision agrees.
function colorNamer(project, others = []) {
  const keys = new Map(), names = new Map(), entries = new Map(), used = new Set(), unnamed = new Set();
  const symbols = [...legendSymbols].filter(symbol => !own(project.palette, symbol));
  for (const [key, value] of Object.entries(project.palette)) {
    const id = colorId(parseColor(value), 0);
    if (key.length === 1 && !keys.has(id)) keys.set(id, key);
    if (!names.has(id)) names.set(id, key);
  }
  const assign = (data, at) => {
    const id = colorId(data, at);
    if (!data[at + 3] || keys.has(id) || !symbols.length) return;
    const symbol = symbols.shift();
    keys.set(id, symbol);
    entries.set(symbol, { color: toHex(data.slice(at, at + 4)), ...(names.has(id) ? { palette: names.get(id) } : {}) });
  };
  for (const value of Object.values(project.palette)) assign(parseColor(value), 0);
  for (const source of [project, ...others]) for (const frame of source.frames) for (let at = 0; at < frame.data.length; at += 4) assign(frame.data, at);
  return {
    char(data, at) {
      if (!data[at + 3]) return '.';
      const id = colorId(data, at), char = keys.get(id);
      if (char === undefined) { unnamed.add(id); return '?'; }
      if (entries.has(char)) used.add(char);
      return char;
    },
    legend() {
      const legend = Object.fromEntries([...entries].filter(([symbol]) => used.has(symbol)));
      if (unnamed.size) legend['?'] = { colors: unnamed.size };
      return legend;
    }
  };
}
const readRegion = (data, width, region, namer) => Array.from({ length: region.h }, (_, y) =>
  Array.from({ length: region.w }, (_, x) => namer.char(data, ((region.y + y) * width + region.x + x) * 4)).join(''));

// Cells run left to right, top to bottom. The largest scale that keeps cells within 256px and the sheet within 1024px
// wins, then fewer rows, then less area. Checker squares span whole source pixels so transparency never reads as dithering.
// A sheet holds at most 4096 pixels of cells a side; their 2-pixel gutters may take it past that, so a still 4096
// pixels wide shows whole. Wider gutters (above scale 2) count against the limit. In all it is one PNG, at most
// 16,777,216 pixels (png.js), which 64 cells of 512x512 with their gutters would pass. `room` is what the image adds
// round the cells, which the same PNG must hold: a parts legend to the right (`legend`, its size beside a layout), a
// label band over each sheet stacked beside others (`height`), the pixels (`pixels`), the height (`maxHeight`, band
// included) and the width (`maxWidth`, legend included) one sheet may take, and for a sheet stacked with others
// (`sheets` of them) how tall the stack may be (`stack`, said in a refusal as `why`) and the least each other sheet
// takes (`others`), so stackViews can keep the image within STACK_SIDE.
const SHEET_SIDE = 4096, NO_ROOM = { pixels: PNG_PIXELS, height: 0, maxHeight: Infinity, maxWidth: Infinity, legend: null };
// The tallest image the views stacked beside one another make: about the longest side a model reads an image at
// (8,000 pixels), so the agent comparing them sees every one. The tallest label band stackViews writes over a sheet.
const STACK_SIDE = 8000, STACK_BAND = 2 * (FONT_HEIGHT + 4);
const withinSheet = (layout, room = NO_ROOM) => {
  if (layout.width > SHEET_SIDE + 2 * (layout.columns + 1) || layout.height > SHEET_SIDE + 2 * (layout.rows + 1)) return false;
  const legend = room.legend ? room.legend(layout) : { width: 0, height: 0 }, tall = Math.max(layout.height, legend.height) + room.height;
  return tall <= room.maxHeight && layout.width + legend.width <= room.maxWidth && (layout.width + legend.width) * tall <= room.pixels;
};
// The most of `count` cells of w×h one sheet holds at `scale` in some number of columns (fewer cells always fit).
function cellsThatFit(count, w, h, scale, room = NO_ROOM) {
  const gap = Math.max(2, scale), fits = n => {
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c);
      if (withinSheet({ columns: c, rows, scale, width: c * w * scale + (c + 1) * gap, height: rows * h * scale + (rows + 1) * gap }, room)) return true;
    }
    return false;
  };
  let low = 0, high = count;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (fits(mid)) low = mid; else high = mid - 1; }
  return low;
}
// `layoutOnly`: the layout with no pixels (data null), for stackEvery's search.
function drawSheet(sources, width, region, { scale, background = null, columns, where = 'inspect', room = NO_ROOM, layoutOnly = false }) {
  const measure = (c, s) => {
    const rows = Math.ceil(sources.length / c), gap = Math.max(2, s);
    return { columns: c, rows, scale: s, gap, width: c * region.w * s + (c + 1) * gap, height: rows * region.h * s + (rows + 1) * gap };
  };
  const choices = columns ? [columns] : Array.from(sources, (_, i) => i + 1);
  let layout = null;
  for (let s = scale ?? Math.min(16, Math.max(1, Math.floor(256 / Math.max(region.w, region.h)))); s >= (scale ?? 1) && !layout; s--) {
    for (const c of choices) {
      const m = measure(c, s);
      if (m.width <= 1024 && m.height <= 1024 && withinSheet(m, room) && (!layout || m.rows < layout.rows || (m.rows === layout.rows && m.width * m.height < layout.width * layout.height))) layout = m;
    }
  }
  // Otherwise the squarest layout within the limit, if any is.
  if (!layout) for (const c of choices) {
    const m = measure(c, scale ?? 1), better = !layout || (withinSheet(m, room) === withinSheet(layout, room) ? Math.max(m.width, m.height) < Math.max(layout.width, layout.height) : withinSheet(m, room));
    if (better) layout = m;
  }
  // A sheet that one PNG would hold alone but not as one of `sheets` stacked passes the height left to it in the
  // stack: said with how many recipes the one image holds. Cells are fitted first, so this is one row of one cell.
  // The others are counted by the least each can take (`room.others`, from stackViews), the shortest first, so a
  // taller neighbour is not counted as fitting; without them, as if each were as tall as this one.
  const alone = { ...room, pixels: PNG_PIXELS, maxHeight: Infinity, maxWidth: Infinity };
  if (room.sheets > 1 && !withinSheet(layout, room) && withinSheet(layout, alone)) {
    const legend = room.legend ? room.legend(layout) : { width: 0, height: 0 }, tall = Math.max(layout.height, legend.height) + room.height;
    let fit = Math.floor(room.stack / tall) - 1;
    if (room.others) {
      let left = room.stack - tall; fit = 0;
      for (const low of [...room.others].sort((a, b) => a - b)) { if (low > left) break; left -= low; fit++; }
    }
    const others = fit > 0 ? `at most ${fit} other recipe${fit === 1 ? '' : 's'}` : 'one recipe at a time';
    fail('beside', `one row of ${region.w}×${region.h} cells is ${tall} pixels tall with its gutters and label, past the ${room.maxHeight} left to it in an image of ${room.sheets} sheets stacked (${room.why}); compare ${others}, or show a smaller region`);
  }
  // Each side holds 4096 pixels of cells and 2 pixels a gutter; the gutters are as wide as the scale, so above scale 2
  // the rest of each counts against the 4096.
  if (!withinSheet(layout, room)) {
    const { width: w, height: h, columns, rows, gap } = layout, sides = w <= SHEET_SIDE + 2 * (columns + 1) && h <= SHEET_SIDE + 2 * (rows + 1);
    fail(where, `the contact sheet would be ${w}×${h} pixels, ${sides ? `past the ${grouped(PNG_PIXELS)} one PNG holds${room.legend ? ' with the parts legend' : ''}`
      : `above the 4096-pixel limit (4096 pixels of frames and 2-pixel gutters${gap > 2 ? `; the ${gap}-pixel gutters at scale ${layout.scale} count their other ${gap - 2} pixel${gap === 3 ? '' : 's'} against the 4096` : ''})`}; select fewer frames, a smaller region or a lower scale`);
  }
  if (layoutOnly) return { ...layout, data: null };
  const data = new Uint8ClampedArray(layout.width * layout.height * 4), square = Math.max(2, Math.ceil(8 / layout.scale)), composed = new Map();
  // The gutter colour is written once and doubled with copyWithin; each cell pixel's source colour is read into one
  // reused buffer for blend, rather than a new view of the frame a pixel.
  data.set(gutterColor, 0);
  for (let filled = 4; filled < data.length; filled *= 2) data.copyWithin(filled, 0, Math.min(filled, data.length - filled));
  const color = new Uint8ClampedArray(4);
  sources.forEach((source, n) => {
    if (!composed.has(source)) {
      const pixels = new Uint8ClampedArray(region.w * region.h * 4);
      for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) {
        const at = (y * region.w + x) * 4, from = ((region.y + y) * width + region.x + x) * 4, under = background ?? checkerColors[(Math.floor(x / square) + Math.floor(y / square)) % 2];
        pixels[at] = under[0]; pixels[at + 1] = under[1]; pixels[at + 2] = under[2]; pixels[at + 3] = under[3];
        if (source) { color[0] = source[from]; color[1] = source[from + 1]; color[2] = source[from + 2]; color[3] = source[from + 3]; blend(pixels, at, color); }
      }
      composed.set(source, scalePixels(pixels, region.w, region.h, layout.scale));
    }
    const pixels = composed.get(source), w = region.w * layout.scale, h = region.h * layout.scale;
    const left = layout.gap + (n % layout.columns) * (w + layout.gap), top = layout.gap + Math.floor(n / layout.columns) * (h + layout.gap);
    for (let row = 0; row < h; row++) data.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((top + row) * layout.width + left) * 4);
  });
  return { ...layout, data };
}

// A frame repeated 3x3, for judging how a tile reads when it tiles.
export function tileRepeat(data, width, height) {
  const out = new Uint8ClampedArray(width * height * 9 * 4), w = width * 3;
  for (let y = 0; y < height * 3; y++) for (let x = 0; x < w; x++) {
    const from = ((y % height) * width + x % width) * 4;
    out.set(data.subarray(from, from + 4), (y * w + x) * 4);
  }
  return out;
}
// Advisory seam evidence. Opposite edges do not need to match to tile well; what reads as a seam is (a) a line that
// doubles because both edges carry it, or (b) more large value steps across the wrap than across any interior
// boundary (a gradient or texture that does not continue). A stroke that merely touches one edge is not flagged.
export function tileReport(data, width, height) {
  const luma = at => (0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) * data[at + 3] / 255;
  const same = (a, b) => colorId(data, a) === colorId(data, b);
  const large = (a, b) => Math.abs(luma(a) - luma(b)) >= 24 || Math.abs(data[a + 3] - data[b + 3]) >= 128;
  const axis = (length, across, at) => {
    // `at(i, j)` addresses position i along the wrap axis and j across it.
    let wrapSteps = 0, interiorMax = 0;
    const doubled = [];
    for (let j = 0; j < across; j++) {
      if (large(at(length - 1, j), at(0, j))) wrapSteps++;
      if (length >= 3 && data[at(0, j) + 3] && same(at(0, j), at(length - 1, j)) && !same(at(0, j), at(1, j)) && !same(at(length - 1, j), at(length - 2, j))) doubled.push(j);
    }
    for (let i = 0; i < length - 1; i++) {
      let steps = 0;
      for (let j = 0; j < across; j++) if (large(at(i, j), at(i + 1, j))) steps++;
      interiorMax = Math.max(interiorMax, steps);
    }
    const threshold = Math.max(2, Math.ceil(across / 4));
    return { wrapSteps, interiorMaxSteps: interiorMax, doubled, suspicious: (wrapSteps > interiorMax && wrapSteps >= threshold) || doubled.length >= threshold };
  };
  const leftRight = axis(width, height, (i, j) => (j * width + i) * 4), topBottom = axis(height, width, (i, j) => (i * width + j) * 4);
  return {
    leftRight: { wrapSteps: leftRight.wrapSteps, interiorMaxSteps: leftRight.interiorMaxSteps, doubledRows: leftRight.doubled, suspicious: leftRight.suspicious },
    topBottom: { wrapSteps: topBottom.wrapSteps, interiorMaxSteps: topBottom.interiorMaxSteps, doubledColumns: topBottom.doubled, suspicious: topBottom.suspicious }
  };
}

// Frame-name patterns: `*` matches any run of characters and `?` exactly one. On a mismatch only the last `*` is
// retried, one character further on, so a match takes at most pattern × name steps; the regular expression this
// replaces backtracked through every `*` and a 14-character pattern could take seconds.
export function wildcard(pattern, text) {
  let p = 0, t = 0, star = -1, resume = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) { p++; t++; }
    else if (p < pattern.length && pattern[p] === '*') { star = p++; resume = t; }
    else if (star !== -1) { p = star + 1; t = ++resume; }
    else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

// The parts view: every pixel in one flat colour for what drew it last, so a stray pixel or a tangle where limbs cross
// names its part. Colours go to the parts in the shown cells in drawing order, well apart in hue and lightness;
// past twenty they repeat darker. A background shows in one dark grey. The studio's Parts view colours the same way.
const PART_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#ffe119', '#911eb4', '#f58231', '#42d4f4', '#f032e6', '#bfef45', '#9a6324',
  '#469990', '#fabed4', '#000075', '#aaffc3', '#800000', '#dcbeff', '#808000', '#ffd8b1', '#ffffff', '#fffac8'].map(hex => parseColor(hex));
export function partColors(project, indices, region = { x: 0, y: 0, w: project.width, h: project.height }) {
  const { width, frames, ownerNames } = project, counts = new Map();
  for (const index of indices) {
    const owners = frames[index].owners;
    for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x; x < region.x + region.w; x++) {
      const id = owners[y * width + x];
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let next = 0;
  const legend = [...counts.keys()].sort((a, b) => a - b).map(id => {
    const name = ownerNames[id - 1], round = Math.floor(next / PART_COLORS.length), base = PART_COLORS[next % PART_COLORS.length];
    const color = name === 'background' ? [43, 48, 54, 255] : base.map((v, c) => c === 3 ? 255 : v >> round);
    if (name !== 'background') next++;
    return { id, name, color, pixels: counts.get(id) };
  });
  const colors = new Map(legend.map(entry => [entry.id, entry.color])), pixels = new Map();
  for (const index of indices) {
    const owners = frames[index].owners, data = new Uint8ClampedArray(owners.length * 4);
    for (let at = 0; at < owners.length; at++) if (owners[at]) data.set(colors.get(owners[at]) ?? [128, 128, 128, 255], at * 4);
    pixels.set(index, data);
  }
  return { legend, pixels };
}
// A legend to the right of a contact sheet: a swatch and the part's name in the built-in font, in columns of at most
// as many rows as the sheet is tall (twelve at least). The cells keep their places. Its text is drawn at `t` times,
// twice on a sheet of scale 4 or more.
const legendScale = scale => Math.max(1, Math.min(2, Math.floor(scale / 2)));
const legendPerColumn = (count, height, t) => Math.max(1, Math.min(count, Math.max(12, Math.floor((height - 6 * t) / ((FONT_HEIGHT + 4) * t)))));
// The width each column takes and the legend's size, for names `widths` font pixels wide in columns of perColumn.
function legendSize(widths, t, perColumn) {
  const columns = [];
  for (let i = 0; i < widths.length; i += perColumn) columns.push(Math.max(...widths.slice(i, i + perColumn)) * t + 13 * t);
  return { columns, width: 3 * t + columns.reduce((sum, w) => sum + w, 0), height: perColumn * (FONT_HEIGHT + 4) * t + 6 * t };
}
// What a legend of any of these parts adds beside a layout (its height and scale), reserved when the cells are fitted:
// every name (a real legend has no more), in the columns drawPartLegend uses beside a sheet that tall.
function legendRoom(names) {
  const widths = names.map(name => layoutText(name).width);
  return layout => { const t = legendScale(layout.scale ?? 1); return legendSize(widths, t, legendPerColumn(widths.length, layout.height, t)); };
}
function drawPartLegend(sheet, legend) {
  const t = legendScale(sheet.scale), pad = 3 * t, row = (FONT_HEIGHT + 4) * t, swatch = 7 * t;
  const texts = legend.map(entry => layoutText(entry.name)), perColumn = legendPerColumn(legend.length, sheet.height, t);
  const { columns, width: added, height: tall } = legendSize(texts.map(text => text.width), t, perColumn);
  const width = sheet.width + added, height = Math.max(sheet.height, tall);
  if (width > SHEET_SIDE * 2 || height > SHEET_SIDE * 2 || width * height > PNG_PIXELS) fail('inspect.view', `the parts legend would make the sheet ${width}×${height} pixels, past the ${grouped(PNG_PIXELS)} one PNG holds; select fewer frames, a smaller region or a lower scale`);
  if (!sheet.data) return { ...sheet, width, height };
  const data = new Uint8ClampedArray(width * height * 4);
  data.set(gutterColor, 0);
  for (let filled = 4; filled < data.length; filled *= 2) data.copyWithin(filled, 0, Math.min(filled, data.length - filled));
  for (let y = 0; y < sheet.height; y++) data.set(sheet.data.subarray(y * sheet.width * 4, (y + 1) * sheet.width * 4), y * width * 4);
  const fill = (x0, y0, w, h, color) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set(color, (y * width + x) * 4); };
  let left = sheet.width + pad;
  legend.forEach((entry, i) => {
    const column = Math.floor(i / perColumn), top = pad + (i % perColumn) * row;
    if (i % perColumn === 0 && column) left += columns[column - 1];
    fill(left, top, swatch, swatch, [0, 0, 0, 255]); fill(left + t, top + t, swatch - 2 * t, swatch - 2 * t, entry.color);
    const text = texts[i], x0 = left + swatch + 3 * t, y0 = top + text.top * t;
    text.rows.forEach((cells, y) => { for (let x = 0; x < cells.length; x++) if (cells[x] === '#') fill(x0 + x * t, y0 + y * t, t, t, [230, 234, 238, 255]); });
  });
  return { ...sheet, width, height, data };
}

// Small palette pictures side by side for review, such as a part drawn flat, turned today and drafted: a heading over
// each column and a label left of each row, in the built-in font. Every picture is enlarged `scale` times (at most 16;
// lowered so a cell stays within 256 pixels) and placed so its anchor pixel sits at one spot in its column and on one
// row across its row, so pictures compare pixel for pixel. The anchor pixel is outlined in magenta and named points in
// cyan, around the pixel, never over it; a cell is wide enough for every picture's pixels, anchor and points. A
// character of a label or heading that the font cannot draw is drawn as ?.
// `rows` are [{ label, cells: [{ rows, anchor, points } | null] }].
const ANCHOR_MARK = [255, 64, 224, 255], POINT_MARK = [64, 224, 255, 255], LABEL_INK = [230, 234, 238, 255];
const FONT_GLYPHS = new Set(FONT_CHARACTERS), inFont = text => [...String(text).normalize('NFC')].map(c => FONT_GLYPHS.has(c) ? c : '?').join('');
export function pictureSheet({ palette = {}, headings = [], rows: lines, scale = 6, background = null, exactScale = false }) {
  // How far a picture reaches from its anchor pixel, in its own pixels: left and up before it, right and down from it.
  const reach = c => {
    const marks = Object.values(c.points ?? {}), xs = [0, (c.width ?? c.rows[0].length) - 1, ...marks.map(p => p[0])], ys = [0, (c.height ?? c.rows.length) - 1, ...marks.map(p => p[1])];
    return { left: c.anchor[0] - Math.min(...xs), right: Math.max(...xs) + 1 - c.anchor[0], up: c.anchor[1] - Math.min(...ys), down: Math.max(...ys) + 1 - c.anchor[1] };
  };
  const cells = lines.flatMap(line => line.cells.filter(Boolean).map(reach));
  const left = Math.max(0, ...cells.map(c => c.left)), right = Math.max(1, ...cells.map(c => c.right));
  const across = left + right + 2, heights = lines.map(line => {
    const shown = line.cells.filter(Boolean).map(reach);
    return { up: Math.max(0, ...shown.map(c => c.up)) + 1, down: Math.max(1, ...shown.map(c => c.down)) + 1 };
  });
  const requested = integer(scale, 'scale', 1, 16);
  const s = exactScale ? requested : Math.max(1, Math.min(requested, Math.floor(256 / Math.max(across, ...heights.map(h => h.up + h.down))))), t = Math.max(1, Math.min(2, Math.floor(s / 3)));
  const pad = 3 * t, gap = Math.max(2, s), labels = lines.map(line => layoutText(inFont(line.label))), heads = headings.map(text => layoutText(inFont(text)));
  const labelWidth = Math.max(0, ...labels.map(text => text.width)) * t + 2 * pad, headHeight = heads.length ? (FONT_HEIGHT + 2) * t + 2 * pad : gap;
  const columns = Math.max(heads.length, ...lines.map(line => line.cells.length)), cellWidth = Math.max(across * s, Math.max(0, ...heads.map(text => text.width)) * t + 2 * pad);
  const width = labelWidth + columns * (cellWidth + gap) + gap, rowHeights = heights.map(h => Math.max((h.up + h.down) * s, (FONT_HEIGHT + 2) * t + 2 * pad));
  const height = headHeight + rowHeights.reduce((sum, h) => sum + h + gap, 0);
  if (width > SHEET_SIDE || height > SHEET_SIDE) fail('sheet', `the picture sheet would be ${width}×${height} pixels, above the 4096-pixel limit; show fewer or smaller pictures (every cell spans each picture's pixels, anchor and points, so an anchor or point far from its pixels widens them all)`);
  const data = new Uint8ClampedArray(width * height * 4);
  data.set(gutterColor, 0);
  for (let filled = 4; filled < data.length; filled *= 2) data.copyWithin(filled, 0, Math.min(filled, data.length - filled));
  const fill = (x0, y0, w, h, color) => { for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) data.set(color, (y * width + x) * 4); };
  const write = (text, x0, y0) => text.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') fill(x0 + x * t, y0 + (y + text.top) * t, t, t, LABEL_INK); });
  const ring = (x0, y0, color) => { fill(x0 - 1, y0 - 1, s + 2, 1, color); fill(x0 - 1, y0 + s, s + 2, 1, color); fill(x0 - 1, y0, 1, s, color); fill(x0 + s, y0, 1, s, color); };
  const colours = new Map(), colourOf = key => { if (!colours.has(key)) colours.set(key, parseColor(key, palette, `palette.${key}`)); return colours.get(key); };
  heads.forEach((text, c) => write(text, labelWidth + gap + c * (cellWidth + gap) + Math.floor((cellWidth - text.width * t) / 2), pad + 2 * t));
  let top = headHeight;
  lines.forEach((line, r) => {
    const rowHeight = rowHeights[r], { up } = heights[r], text = labels[r];
    write(text, pad, top + Math.floor((rowHeight - FONT_HEIGHT * t) / 2));
    line.cells.forEach((cell, c) => {
      const x0 = labelWidth + gap + c * (cellWidth + gap), square = Math.max(2, Math.ceil(8 / s)) * s;
      if (!cell) return;
      for (let y = 0; y < rowHeight; y++) for (let x = 0; x < cellWidth; x++) data.set(background ?? checkerColors[(Math.floor(x / square) + Math.floor(y / square)) % 2], ((top + y) * width + x0 + x) * 4);
      // The anchor's top-left corner in the cell, in sheet pixels.
      const ax = x0 + Math.floor((cellWidth - across * s) / 2) + (left + 1) * s, ay = top + Math.floor((rowHeight - (heights[r].up + heights[r].down) * s) / 2) + up * s;
      const cellWidthPx = cell.width ?? cell.rows[0].length, cellHeightPx = cell.height ?? cell.rows.length;
      for (let y = 0; y < cellHeightPx; y++) for (let x = 0; x < cellWidthPx; x++) {
        const at = (y * cellWidthPx + x) * 4, key = cell.rows?.[y][x];
        if (cell.data ? cell.data[at+3] === 0 : key === '.' || key === ' ') continue;
        const color = cell.data ? cell.data.subarray(at, at+4) : colourOf(key), px = ax + (x - cell.anchor[0]) * s, py = ay + (y - cell.anchor[1]) * s;
        if (color[3]) for (let yy = py; yy < py + s; yy++) for (let xx = px; xx < px + s; xx++) if (xx >= 0 && yy >= 0 && xx < width && yy < height) blend(data, (yy * width + xx) * 4, color);
      }
      if (cell.data) return;
      for (const p of Object.values(cell.points ?? {})) ring(ax + (p[0] - cell.anchor[0]) * s, ay + (p[1] - cell.anchor[1]) * s, POINT_MARK);
      ring(ax, ay, ANCHOR_MARK);
    });
    top += rowHeight + gap;
  });
  return { width, height, scale: s, data };
}

// Which palette keys colour what, over every frame: a line a key with its colour, its pixels and the layers (a rig's
// parts) it colours most, so "the fur" or "the jacket" is a set of keys to change together. Keys of one ramp are
// listed together, dark to light, then the rest by pixels; `unused` names keys that draw nothing and `blended` counts
// pixels whose colour is no key's (two translucent colours over each other). Pixels are told apart by colour, so keys
// that share a colour are counted under the first of them, and `same` says which. `layers` names every layer that
// draws, in drawing order: what frames[*].layers[<name>].palette recolours alone. The project is rendered with owners.
export function paletteUse(project) {
  if (!project.ownerNames) fail('inspect.palette', 'palette needs the project rendered with { owners: true }, which records the layer that drew each pixel');
  const pack = (r, g, b, a) => ((r * 256 + g) * 256 + b) * 256 + a, keyOf = new Map(), use = new Map();
  const same = [], twins = new Set();
  for (const [key, value] of Object.entries(project.palette)) {
    const color = parseColor(value), id = pack(...color);
    if (!color[3]) continue;
    if (keyOf.has(id)) { twins.add(key); same.push(`${key} is the colour of ${keyOf.get(id)}, and counted there`); } else keyOf.set(id, key);
  }
  let blended = 0;
  for (const { data, owners } of project.frames) for (let i = 0; i < owners.length; i++) {
    if (!data[i * 4 + 3]) continue;
    const key = keyOf.get(pack(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]));
    if (key === undefined) { blended++; continue; }
    if (!use.has(key)) use.set(key, { pixels: 0, by: new Map() });
    const entry = use.get(key);
    entry.pixels++; entry.by.set(owners[i], (entry.by.get(owners[i]) ?? 0) + 1);
  }
  const line = key => {
    const { pixels, by } = use.get(key), parts = [...by].filter(([id]) => id).sort((a, b) => b[1] - a[1]).map(([id]) => project.ownerNames[id - 1]);
    return `${key} ${project.palette[key]}: ${pixels} px${parts.length ? ` on ${parts.slice(0, 4).join(', ')}${parts.length > 4 ? ` and ${parts.length - 4} more` : ''}` : ''}`;
  };
  const ramps = (project.ramps ?? []).map(ramp => ramp.filter(key => use.has(key))).filter(ramp => ramp.length), ramped = new Set(ramps.flat());
  const others = [...use.keys()].filter(key => !ramped.has(key)).sort((a, b) => use.get(b).pixels - use.get(a).pixels), unused = Object.keys(project.palette).filter(key => !use.has(key) && !twins.has(key));
  return { ...(ramps.length && { ramps: ramps.map(ramp => ramp.map(line)) }), ...(others.length && { [ramps.length ? 'others' : 'keys']: others.map(line) }), ...(same.length && { same }), ...(unused.length && { unused }), ...(blended && { blended }), layers: project.ownerNames.join(', '), counted: `every pixel of ${project.frames.length === 1 ? 'the one frame' : `all ${project.frames.length} frames`}, whatever the view shows` };
}

// The same view of several recipes as one image, each sheet under the one before and left-aligned, with its name
// written above it: a hero in three team colours, or a sprite before and after, compared with one look. `views` are
// inspectProject results with a `name` each. Returns the first view with the taller sheet and `stack`: where each
// recipe's sheet starts, under its label. Views inspected with `sheets` (the number stacked) and the automatic scale
// are measured as one stack: while it passes STACK_SIDE in height, or the one PNG, the tallest sheets are refitted
// to a common cap (a lower scale, then fewer cells), and a stack within both is left exactly as drawn. A refitted
// stack is kept to the width at which STACK_SIDE tall is one PNG, or to the narrowest its widest sheet can be (one
// cell). A scale asked for is drawn as asked, so only the one PNG bounds the stack.
const REFIT = Symbol('refit');
const measureStack = views => {
  const sheets = views.map(view => view.sheet), t = Math.max(1, Math.min(2, Math.floor(sheets[0].scale / 2))), pad = 3 * t, band = (FONT_HEIGHT + 4) * t;
  const labels = views.map(view => layoutText(String(view.name).replace(/[^\x20-\x7e]/g, '?'))), labelWidth = Math.max(...labels.map(text => text.width * t + 2 * pad));
  return { sheets, t, pad, band, labels, labelWidth, width: Math.max(labelWidth, ...sheets.map(sheet => sheet.width)), height: sheets.reduce((sum, sheet) => sum + band + sheet.height, 0) };
};
const stackFits = ({ width, height }) => height <= Math.min(STACK_SIDE, Math.floor(PNG_PIXELS / width));
// The views refitted within `wide` pixels: the tallest cut to a common cap until the stack fits (a refitted sheet may
// grow taller as it narrows, so it takes a few passes). Each refit is told the least the other sheets take (one cell at
// scale 1 and a label band). Every sheet that cannot hold the cells `every` makes is tried before the one refusal,
// which is the sheet needing the largest every.
const bySheet = (error, name) => {
  if (error instanceof PixelError && error.sheet !== name) Object.assign(error, { message: `${error.path}: ${name}: ${error.message.slice(error.path.length + 2)}`, sheet: name });
  return error;
};
function refitStack(views, wide) {
  const most = Math.min(STACK_SIDE, Math.floor(PNG_PIXELS / wide));
  const why = most < STACK_SIDE ? `${grouped(most)} pixels tall at most at ${wide} wide, ${grouped(PNG_PIXELS)} in all` : `${grouped(STACK_SIDE)} pixels tall at most`;
  for (let pass = 0; pass < 4 && !stackFits(measureStack(views)); pass++) {
    const { sheets, band } = measureStack(views), room = most - views.length * band, heights = sheets.map(sheet => sheet.height).sort((a, b) => b - a);
    const lows = views.map(view => view[REFIT].low + band);
    let cap = 1, short = null;
    for (let k = 1; k <= heights.length; k++) {
      const even = Math.floor((room - heights.slice(k).reduce((sum, h) => sum + h, 0)) / k);
      if (k === heights.length || even >= heights[k]) { cap = Math.max(1, even); break; }
    }
    // A sheet whose one cell is taller than the cap cannot be cut to it. It keeps the least it can take, and the cap
    // comes down until the others leave room for that, so a stack whose least heights fit is never refused: a
    // 100×4096 still beside four sheets of 16 cells was, told to "compare at most 4 other recipes". Where even the
    // least heights pass the image, the cap stands and the tall sheet's refusal says how many recipes it holds.
    const least = views.map(view => Math.min(view.sheet.height, view[REFIT].low));
    const taken = at => views.reduce((sum, view, i) => sum + Math.max(least[i], Math.min(view.sheet.height, at)), 0);
    const held = taken(1) <= room;
    if (held && taken(cap) > room) {
      let low = 1, high = cap;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (taken(mid) <= room) low = mid; else high = mid - 1; }
      cap = low;
    }
    views = views.map((view, i) => {
      const to = held ? Math.max(cap, least[i]) : cap;
      if (view.sheet.height <= to && view.sheet.width <= wide) return view;
      try { return { ...view[REFIT]({ maxHeight: to + STACK_BAND, maxWidth: wide, stack: most, why, others: lows.filter((_, j) => j !== i) }), name: view.name }; }
      catch (error) {
        if (error.every === undefined) throw bySheet(error, view.name);
        if (!short || error.every > short.every) short = bySheet(error, view.name);
        return view;
      }
    });
    if (short) throw short;
  }
  return views;
}
// A stack within STACK_SIDE and the one PNG is kept as drawn. Otherwise it is refitted at four widths, from its own
// (the height the PNG leaves at that width) to the width where STACK_SIDE tall is one PNG (narrower sheets, more
// height), and the one that shows the most cells wins, the wider on a tie. Where no width holds the cells `every`
// makes, the refusal is the width's needing the least every.
function refitted(views) {
  const measured = measureStack(views);
  if (stackFits(measured)) return views;
  const narrow = Math.max(Math.floor(PNG_PIXELS / STACK_SIDE), measured.labelWidth, ...views.map(view => view[REFIT].narrow));
  const widths = measured.width > narrow ? [...new Set([3, 2, 1, 0].map(k => narrow + Math.floor((measured.width - narrow) * k / 3)))] : [narrow];
  const tries = widths.map(wide => { try { return { views: refitStack(views, wide) }; } catch (error) { return { error }; } });
  const shown = ({ views }) => views.reduce((sum, view) => sum + view.cells.length, 0), fitted = tries.filter(entry => entry.views && stackFits(measureStack(entry.views)));
  if (!fitted.length) {
    if (tries.some(entry => entry.views)) return tries.find(entry => entry.views).views;
    const short = tries.filter(entry => entry.error.every !== undefined).sort((a, b) => a.error.every - b.error.every);
    throw (short[0] ?? tries.at(-1)).error;
  }
  return fitted.reduce((best, entry) => shown(entry) > shown(best) ? entry : best).views;
}
// The sheets alone that cannot hold the cells `every` makes (inspectProject leaves their refusal to the stack), as
// the one asking the largest every.
const shortest = views => views.filter(view => view[REFIT].short).map(view => bySheet(view[REFIT].short, view.name)).reduce((most, next) => (!most || next.every > most.every ? next : most), null);
// An `every` that a sheet, alone or refitted into the stack, cannot hold is refused once for the whole stack, naming
// the smallest every above it that holds every cell of every sheet. Each try inspects the views again (laid out, not
// drawn) at one every and refits the stack. Only a sheet's own bound (`alone`: 256 cells, or one 4096-pixel sheet)
// holds at every every past it, so only it is a lower bound: the stack is not monotone, since fewer cells can let a
// small sheet keep a larger scale and crowd the rest. So the search climbs from the every after the one asked (or the
// alone bound) by 1, 2, 4 … past it, and halves only the last gap. The refusal names the sheet refused at the every
// asked and what it holds there: in the stack, beside the other sheets' cells at that every; alone, its own bound,
// with the advice said as the stack's when it is past that bound. It says no "or more".
function stackEvery(views, first) {
  const asked = views[0].sampling.every;
  const check = every => {
    const again = views.map(view => ({ ...view[REFIT].every(every), name: view.name }));
    try {
      const short = shortest(again);
      if (short) throw short;
      return { every, views: refitted(again) };
    } catch (error) {
      if (error.every === undefined) throw error;
      return { every: error.alone ? Math.max(every, error.every - 1) : every, error };
    }
  };
  let low = { every: first.alone ? Math.max(asked, first.every - 1) : asked }, base = low.every + 1, rise = 0, high = null;
  while (!high) {
    const next = Math.min(60000, base + rise);
    if (next <= low.every) return first;
    const tried = check(next);
    if (tried.views) high = tried;
    // A sheet's own bound past the try starts the climb again from it.
    else if (tried.every > next) { low = tried; base = tried.every + 1; rise = 0; }
    else { low = tried; rise = Math.max(1, rise * 2); }
  }
  while (high.every - low.every > 1) {
    const tried = check(Math.floor((low.every + high.every) / 2));
    if (tried.views) high = tried; else low = tried;
  }
  // A sheet's own bound the stack does not move is said as it is; one past it is the stack's.
  const { sheet, duration, held, why, alone } = first, stacked = alone ? (high.every > first.every ? 'stacked with the others, ' : '') : null;
  return new PixelError('inspect.every', `${sheet}: ${duration} ms at one cell per ${asked} ms is ${Math.ceil(duration / asked)} cells, and ${why} ${held}${alone ? '' : " beside the other sheets' cells at that every"}; ${stacked ?? ''}choose every ${high.every}`);
}
function fitStack(views) {
  if (!views.every(view => view[REFIT])) {
    const short = views.find(view => view[REFIT]?.short);
    if (short) throw bySheet(short[REFIT].short, short.name);
    return views;
  }
  try {
    const short = shortest(views);
    if (short) throw short;
    return refitted(views);
  } catch (error) {
    throw error.every === undefined ? error : stackEvery(views, error);
  }
}
export function stackViews(views) {
  views = fitStack(views);
  const { sheets, t, pad, band, labels, width, height } = measureStack(views), stack = [];
  if (width * height > PNG_PIXELS) fail('beside', `the ${views.length} sheets stacked would be ${width}×${height} pixels, past the ${grouped(PNG_PIXELS)} one PNG holds; compare fewer recipes, or show fewer cells (maxCells), a smaller region or a lower scale`);
  const data = new Uint8ClampedArray(width * height * 4);
  // The gutter colour is written once and doubled with copyWithin, as drawSheet does, not set pixel by pixel.
  data.set(gutterColor, 0);
  for (let filled = 4; filled < data.length; filled *= 2) data.copyWithin(filled, 0, Math.min(filled, data.length - filled));
  let y = 0;
  sheets.forEach((sheet, index) => {
    const text = labels[index], top = y + 2 * t + text.top * t;
    text.rows.forEach((cells, row) => { for (let x = 0; x < cells.length; x++) if (cells[x] === '#') for (let dy = 0; dy < t; dy++) for (let dx = 0; dx < t; dx++) data.set([230, 234, 238, 255], ((top + row * t + dy) * width + pad + x * t + dx) * 4); });
    y += band;
    for (let row = 0; row < sheet.height; row++) data.set(sheet.data.subarray(row * sheet.width * 4, (row + 1) * sheet.width * 4), (y + row) * width * 4);
    stack.push({ name: views[index].name, y, height: sheet.height });
    y += sheet.height;
  });
  const { name, ...first } = views[0];
  return { ...first, sheet: { ...sheets[0], data, width, height }, stack };
}

// One picture laid over another, pixel for pixel (`top` over `bottom`, both RGBA of one size): what a game draws when
// it stacks frames.
function laidOver(bottom, top, origins, topMask) {
  const out = new Uint8ClampedArray(bottom);
  for (let i = 0; i < top.length; i += 4) {
    const a = top[i + 3];
    if (a && origins) origins.set(i / 4, topMask?.[i / 4] || (a < 255 && out[i + 3] > 0));
    if (a === 255 || !out[i + 3]) { if (a) out.set(top.subarray(i, i + 4), i); continue; }
    if (!a) continue;
    const under = out[i + 3] * (255 - a) / 255, all = a + under;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((top[i + c] * a + out[i + c] * under) / all);
    out[i + 3] = Math.round(all);
  }
  return out;
}
// `stack` and `under` are for art that is only judged laid over other art. stack: a list of cells, each a list of
// frame names drawn in order, the first at the bottom (a body, then the plate and the fin a game draws over it): the
// sheet has one cell a group, named "body+plate+fin", and everything else (region, scale, view, grid) reads those
// cells as frames. under: { width, height, data } (RGBA), a picture from elsewhere (a ground tile of another recipe)
// repeated from the top left under every cell, so a sprite is seen on what it will lie on.
// The third argument is never a caller's option (MCP and the CLI pass the user's options as the second): `sheets` is
// beside's, how many sheets it draws in one image (1 to 9; stackViews refits the tallest when they pass it). `share`
// is stackViews' own: the room a sheet stacked beside others is refitted to ({ maxHeight, maxWidth, stack, why }, and
// `others`, the least each other sheet takes). `measure` is stackEvery's: the sheet laid out with no pixels drawn.
export function inspectProject(project, options = {}, { sheets = 1, share, measure = false } = {}) {
  object(options, 'inspect', ['frames', 'animation', 'region', 'grid', 'scale', 'background', 'view', 'native', 'diagnostics', 'maxCells', 'step', 'offset', 'every', 'guides', 'stack', 'under']);
  // The project as given: stack and under replace `project` with their composites, and a refit starts again from this.
  const source = project, { width, height } = project;
  if (options.stack !== undefined) {
    if (options.frames !== undefined || options.animation !== undefined) fail('inspect.stack', 'stack names the frames of each cell itself; omit frames and animation');
    if (options.view === 'parts') fail('inspect.view', 'parts colours one frame by its layers; a stack is several frames, so omit view or stack');
    list(options.stack, 'inspect.stack', 256);
    if (!options.stack.length) fail('inspect.stack', 'list at least one cell: [["body", "plate"]]');
    const stacked = options.stack.map((group, g) => {
      const p = `inspect.stack[${g}]`;
      list(group, p, 16);
      if (!group.length) fail(p, 'a cell lists one to sixteen frame names, the bottom one first');
      const layers = group.map((ref, n) => project.frames.find(f => f.name === ref) ?? fail(`${p}[${n}]`, `unknown frame ${JSON.stringify(ref)}`));
      const origins = options.diagnostics && new BlendOrigins(width * height, layers[0].blendMask);
      const data = layers.slice(1).reduce((bottom, frame) => laidOver(bottom, frame.data, origins, frame.blendMask), layers[0].data);
      return { name: group.join('+'), duration: layers[0].duration, data, ...(origins && { blendMask: origins.mask, inherited: layers.flatMap(frameColours) }) };
    });
    project = { ...project, frames: stacked, animations: {}, ownerNames: undefined };
  }
  if (options.under !== undefined) {
    const under = object(options.under, 'inspect.under', ['width', 'height', 'data']), uw = integer(under.width, 'inspect.under.width', 1, 4096), uh = integer(under.height, 'inspect.under.height', 1, 4096);
    if (!(under.data instanceof Uint8ClampedArray || under.data instanceof Uint8Array) || under.data.length !== uw * uh * 4) fail('inspect.under.data', `expected the ${uw}×${uh} picture as RGBA bytes`);
    if (options.grid || options.diagnostics) fail('inspect.under', 'grid and diagnostics read the recipe\'s own pixels; omit under for them');
    if (options.view !== undefined && options.view !== 'color') fail('inspect.under', 'under shows a frame on another picture, in colour; omit view');
    const ground = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) ground.set(under.data.subarray(((y % uh) * uw + x % uw) * 4, ((y % uh) * uw + x % uw) * 4 + 4), (y * width + x) * 4);
    project = { ...project, frames: project.frames.map(frame => ({ ...frame, data: laidOver(ground, frame.data) })), ownerNames: undefined };
  }
  const { frames } = project;
  if (options.frames !== undefined && options.animation !== undefined) fail('inspect', 'choose frames or animation, not both: frames picks the named frames in the order named, animation one animation\'s frames in play order');
  let cells = frames.map((_, i) => i);
  if (options.animation !== undefined) {
    // Stills keep their flipbook to step through, but it is no animation to choose.
    if (project.stills) fail('inspect.animation', stillsHaveNoAnimation('choose'));
    if (typeof options.animation !== 'string' || !own(project.animations, options.animation)) fail('inspect.animation', `unknown animation ${JSON.stringify(options.animation)}`);
    cells = project.animations[options.animation].frames;
  } else if (options.frames !== undefined) {
    list(options.frames, 'inspect.frames', 1024);
    if (!options.frames.length) fail('inspect.frames', 'select at least one frame');
    // A name with * (any run of characters) or ? (one character) selects every matching frame in project order.
    cells = options.frames.flatMap((ref, i) => {
      if (typeof ref === 'string' && /^[a-zA-Z0-9_*?-]+$/.test(ref) && /[*?]/.test(ref)) {
        const matches = frames.flatMap((f, index) => (wildcard(ref, f.name) ? [index] : []));
        if (!matches.length) fail(`inspect.frames[${i}]`, `no frame matches ${JSON.stringify(ref)}`);
        return matches;
      }
      const index = frames.findIndex(f => f.name === ref);
      if (index < 0) fail(`inspect.frames[${i}]`, `unknown frame ${JSON.stringify(ref)}`);
      return [index];
    });
    if (cells.length > 1024) fail('inspect.frames', `the names and patterns select ${cells.length} frames; at most 1,024 cells`);
  }
  const mode = options.view ?? 'color';
  if (!['color', 'silhouette', 'grayscale', 'onion', 'tile', 'parts'].includes(mode)) fail('inspect.view', 'expected color, silhouette, grayscale, onion, tile or parts');
  if (mode === 'parts' && !project.ownerNames) fail('inspect.view', 'parts needs the project rendered with { owners: true }, which records the layer that drew each pixel');
  if (mode === 'onion' && options.animation === undefined) fail('inspect.view', 'onion requires an animation so neighbors have an unambiguous playback position');
  if (mode === 'tile' && options.region !== undefined) fail('inspect.region', 'tile view repeats whole frames; omit region');
  if (mode === 'tile' && options.guides !== undefined) fail('inspect.guides', 'guides draw over one canvas; tile view repeats it, so omit guides');
  // A frame whose 3×3 repeat no sheet holds even as one cell at scale 1 (a side over 1365) is past any sheet, whatever
  // the frames, scale or region: said as that, not with what to lower.
  if (mode === 'tile' && !withinSheet({ columns: 1, rows: 1, width: width * 3 + 4, height: height * 3 + 4 })) fail('inspect.view', `a ${width}×${height} frame repeated 3×3 makes a sheet of ${width * 3 + 4}×${height * 3 + 4} pixels with its gutters at scale 1, more than one holds (4096 pixels of frames a side, ${grouped(PNG_PIXELS)} pixels in all), so tile view cannot show it`);
  const guides = options.guides === undefined ? null : readGuides(options.guides, 'inspect.guides');
  let region = { x: 0, y: 0, w: width, h: height };
  if (options.region !== undefined) {
    const r = object(options.region, 'inspect.region', ['x', 'y', 'w', 'h']);
    const x = integer(r.x, 'inspect.region.x', 0, width - 1), y = integer(r.y, 'inspect.region.y', 0, height - 1);
    region = { x, y, w: integer(r.w, 'inspect.region.w', 1, width - x), h: integer(r.h, 'inspect.region.h', 1, height - y) };
  }
  const grid = boolean(options.grid ?? false, 'inspect.grid');
  const scale = options.scale === undefined ? undefined : integer(options.scale, 'inspect.scale', 1, 16);
  const background = (options.background ?? 'checker') === 'checker' ? null : parseColor(options.background, project.palette, 'inspect.background');
  const native = boolean(options.native ?? false, 'inspect.native'), diagnostics = boolean(options.diagnostics ?? false, 'inspect.diagnostics');
  const total = cells.length, methods = [];
  let positions = cells.map((_, i) => i);
  // A stride picks every step-th position from offset, so a strobe that alternates A and B frames can be read as all
  // A frames (offset 0, step 2) or all B frames (offset 1); evenly spaced samples would alias between them.
  const step = options.step === undefined ? 1 : integer(options.step, 'inspect.step', 1, 1024);
  const offset = options.offset === undefined ? 0 : integer(options.offset, 'inspect.offset', 0, 2047);
  if (offset >= total) fail('inspect.offset', `the selection has ${total} position${total === 1 ? '' : 's'}, numbered from 0; choose an offset below ${total}`);
  // A cell per `every` milliseconds of playback: a frame fills as many cells as it is held, so the sheet reads as
  // the animation plays, holds and fast steps included.
  const every = options.every === undefined ? undefined : integer(options.every, 'inspect.every', 10, 60000);
  // A sheet stacked beside others that cannot hold the cells `every` makes (past 256, or past what one sheet holds) is
  // refused by stackViews, which knows the whole stack: the every this sheet alone needs could be refused again by
  // another sheet or when the stack is refitted. Such a sheet is drawn with one cell, only to be measured.
  let short;
  const defer = error => { if (sheets === 1 || share || options.scale !== undefined) throw error; short = error; };
  if (every !== undefined) {
    if (options.animation === undefined) fail('inspect.every', 'every samples playback, so it needs an animation');
    if (options.step !== undefined || options.offset !== undefined) fail('inspect.every', 'every picks positions by time; omit step and offset');
    const a = project.animations[options.animation], count = Math.ceil(a.duration / every), most = Math.ceil(a.duration / 256);
    if (count > 256) defer(Object.assign(new PixelError('inspect.every', `${a.duration} ms at one cell per ${every} ms is ${count} cells; at most 256, so choose every ${most} or more`),
      { every: most, cells: count, held: 256, duration: a.duration, why: 'a sheet holds at most', alone: true }));
    positions = Array.from({ length: short ? 1 : count }, (_, n) => animationPosition(project, a, n * every));
    methods.push(`one cell per ${every} ms of playback`);
  }
  if (step > 1 || offset > 0) {
    positions = positions.filter(i => i >= offset && (i - offset) % step === 0);
    const suffix = step % 100 >= 11 && step % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][step % 10] ?? 'th';
    methods.push(step === 1 ? `every position from ${offset}` : `every ${step}${suffix} position from ${offset}`);
  }
  const spread = (chosen, count) => Array.from({ length: count }, (_, i) => chosen[count === 1 ? 0 : Math.floor(i * (chosen.length - 1) / (count - 1))]);
  // Cells by time read as playback only while every one is shown: where a sheet of big frames (over 256 a side) or a
  // share of a beside image cannot hold the cells `every` makes, it is refused with the `every` that fits, as more
  // than 256 is. A maxCells the caller gives thins them evenly instead, as it thins frames. The refusal carries what
  // stackEvery reads: the every needed, the cells the sheet holds, the bound it met and whether that bound is the
  // sheet's own (`alone`: no every below the one needed holds, whatever the stack does).
  const thinEvery = (count, why) => {
    const { duration } = project.animations[options.animation];
    throw Object.assign(new PixelError('inspect.every', `${duration} ms at one cell per ${every} ms is ${positions.length} cells, and ${why} ${count}; choose every ${Math.ceil(duration / count)} or more`),
      { every: Math.ceil(duration / count), cells: positions.length, held: count, duration, why, alone: !share });
  };
  const box = mode === 'tile' ? { w: width * 3, h: height * 3 } : region;
  if (options.maxCells !== undefined) {
    const requested = integer(options.maxCells, 'inspect.maxCells', 1, 256);
    // What one sheet holds is measured as the sheet itself measures it (a rougher bound here said 45 cells of 1024×256
    // where the same sheet without maxCells showed 60).
    const count = Math.min(positions.length, requested, Math.max(1, cellsThatFit(positions.length, box.w, box.h, 1)));
    if (count < positions.length && every !== undefined && count < requested && (width > 256 || height > 256)) thinEvery(count, `one 4096-pixel sheet of ${box.w}×${box.h} cells holds`);
    if (count < positions.length) { positions = spread(positions, count); methods.push('evenly spaced, including endpoints'); }
  }
  // Big frames (an animation's are up to 1024 a side) or a long play order may not fit one sheet at scale 1; with no
  // scale asked for, the sheet shows as many evenly spaced cells as it holds rather than refusing. A scale asked for
  // that does not fit is still refused, with what to lower. The room is what the image adds round the cells: the parts
  // legend, and for a sheet stacked beside others a label band and the stack's height: each sheet is first drawn as
  // it would be alone, and stackViews refits the tallest (`share`) only when the stack would pass STACK_SIDE.
  let room = NO_ROOM;
  if (options.scale === undefined && (mode === 'parts' || sheets > 1)) {
    room = { pixels: PNG_PIXELS, height: sheets > 1 ? STACK_BAND : 0, maxHeight: sheets > 1 ? STACK_SIDE : Infinity, maxWidth: Infinity, sheets, stack: STACK_SIDE, why: `${grouped(STACK_SIDE)} pixels tall at most`,
      legend: mode === 'parts' ? legendRoom(project.ownerNames) : null, ...(sheets > 1 && share) };
  }
  const inStack = `the height left to it in an image of ${sheets} sheets stacked (${room.why}) holds`;
  if (options.scale === undefined) {
    const count = Math.max(1, cellsThatFit(positions.length, box.w, box.h, 1, room));
    if (count < positions.length && every !== undefined) {
      try { thinEvery(count, share ? inStack : `one 4096-pixel sheet${sheets > 1 ? ` (one of ${sheets} in the image)` : ''} of ${box.w}×${box.h} cells holds`); } catch (error) { defer(error); }
    }
    // A sheet stackViews will refuse is only measured again, so it is drawn with one cell.
    if (short) positions = spread(positions, 1);
    else if (count < positions.length) { positions = spread(positions, count); methods.push(`evenly spaced to fit ${share ? 'the height left to it in the stacked image' : 'the 4096-pixel sheet'}, including endpoints`); }
  }
  cells = positions.map(i => cells[i]);
  const unique = [...new Set(cells)];
  if (grid && unique.length * region.w * region.h > 16384) fail('inspect.grid', `grids are limited to 16,384 pixels, not ${unique.length} × ${region.w}×${region.h}; select fewer frames or a smaller region`);
  let view;
  if (mode === 'tile') {
    const repeats = new Map(unique.map(i => [i, measure ? null : tileRepeat(frames[i].data, width, height)]));
    const tiled = { x: 0, y: 0, w: width * 3, h: height * 3 };
    view = { cells: cells.map(i => ({ frame: frames[i].name, duration: frames[i].duration })), region, sheet: drawSheet(cells.map(i => repeats.get(i)), width * 3, tiled, { scale, background, room, layoutOnly: measure }), mode };
    if (!measure) view.tiles = unique.map(i => ({ frame: frames[i].name, ...tileReport(frames[i].data, width, height) }));
    if (native && !measure && view.sheet.scale > 1) view.nativeSheet = drawSheet(cells.map(i => repeats.get(i)), width * 3, tiled, { scale: 1, background });
  } else {
    const parts = mode === 'parts' ? partColors(project, unique, region) : null;
    const sources = cells.map((i, n) => measure ? null : mode === 'onion' ? onionPixels(project, project.animations[options.animation], positions[n]) : parts ? parts.pixels.get(i) : reviewPixels(frames[i].data, mode));
    view = { cells: cells.map(i => ({ frame: frames[i].name, duration: frames[i].duration })), region, sheet: drawSheet(sources, width, region, { scale, background, room, layoutOnly: measure }) };
    if (guides && !measure) {
      // Over every cell of the enlarged sheet; the native sheet keeps its exact pixels.
      const { sheet } = view, w = region.w * sheet.scale, h = region.h * sheet.scale;
      cells.forEach((_, n) => drawGuides(sheet.data, sheet.width, { left: sheet.gap + (n % sheet.columns) * (w + sheet.gap), top: sheet.gap + Math.floor(n / sheet.columns) * (h + sheet.gap), w, h }, sheet.scale, region, guides));
      view.guides = guides;
    }
    if (mode !== 'color') view.mode = mode;
    if (native && !measure && (view.sheet.scale > 1 || guides)) view.nativeSheet = drawSheet(sources, width, region, { scale: 1, background });
    if (parts) {
      view.parts = parts.legend.map(({ name, color, pixels }) => ({ name, color: toHex(color), pixels }));
      view.sheet = drawPartLegend(view.sheet, parts.legend);
      if (view.nativeSheet) view.nativeSheet = drawPartLegend(view.nativeSheet, parts.legend);
    }
  }
  // A sheet already at scale 1 is the native sheet: said once rather than drawn and sent twice.
  if (native && !view.nativeSheet) view.native = 'same as sheet';
  // How narrow and how short stackViews can make this sheet: one cell at scale 1, with its legend.
  if (room.sheets > 1) {
    const one = { columns: 1, rows: 1, scale: 1, width: box.w + 4, height: box.h + 4 }, legend = room.legend ? room.legend(one) : { width: 0, height: 0 };
    // A refit redraws the sheet; what does not depend on it (diagnostics, timing) is kept rather than measured again.
    const redraw = { ...options, diagnostics: undefined };
    view[REFIT] = Object.assign(share => {
      const again = inspectProject(source, redraw, { sheets, share, measure });
      delete again.timing;
      return Object.assign(again, view.diagnostics && { diagnostics: view.diagnostics }, view.timing && { timing: view.timing });
    }, { narrow: one.width + legend.width, low: Math.max(one.height, legend.height), short,
      // The sheet inspected afresh at another every, for stackEvery.
      ...(every !== undefined && { every: next => inspectProject(source, { ...redraw, every: next }, { sheets, measure: true }) }) });
  }
  if (every !== undefined) view.sampling = { total, shown: cells.length, every, positions, method: `${methods.join(', then ')}; a frame fills a cell for each ${every} ms it is held` };
  else if (total !== cells.length) view.sampling = { total, shown: cells.length, omitted: total - cells.length, positions, ...((step > 1 || offset > 0) && { step, offset }), method: `${methods.join(', then ')}; durations are original, not playback timing` };
  if (diagnostics) view.diagnostics = analyzeProject(project);
  if (options.animation !== undefined && !measure && (diagnostics || mode === 'onion' || every !== undefined)) {
    const a = project.animations[options.animation], fps = animationFps(project, options.animation); let start = 0;
    view.timing = { animation: options.animation, duration: a.duration, loop: a.loop, ...(fps !== undefined && { fps }), entries: a.frames.map((index, position) => {
      const entry = { position, frame: frames[index].name, start, duration: frames[index].duration, ...animationNeighbors(a, position) };
      // How many pixels this step changes: 0 is a hold, and a step far above its neighbours is a jump.
      if (entry.previous !== null) entry.changed = changedPixels(frames[a.frames[entry.previous]].data, frames[index].data);
      start += entry.duration; return entry;
    }) };
  }
  if (!grid) return view;
  if (mode === 'parts') {
    // One character per part: its legend symbol, "." where nothing drew.
    const symbols = new Map(view.parts.map((part, i) => [part.name, legendSymbols[i] ?? '?']));
    const key = id => id ? symbols.get(project.ownerNames[id - 1]) : '.';
    view.grids = unique.map(index => ({ frame: frames[index].name, rows: Array.from({ length: region.h }, (_, y) =>
      Array.from({ length: region.w }, (_, x) => key(frames[index].owners[(region.y + y) * width + region.x + x])).join('')) }));
    view.legend = Object.fromEntries(view.parts.map((part, i) => [legendSymbols[i] ?? '?', { part: part.name, color: part.color }]));
    return view;
  }
  const namer = colorNamer(project);
  view.grids = unique.map(index => ({ frame: frames[index].name, rows: readRegion(frames[index].data, width, region, namer) }));
  view.legend = namer.legend();
  return view;
}

function changedPixels(a, b) {
  let count = 0;
  for (let at = 0; at < a.length; at += 4) if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2] || a[at + 3] !== b[at + 3]) count++;
  return count;
}
// Positions refer to the expanded sequence, never the recipe's frame order.
export function animationPosition(project, animation, time) {
  let cursor = animation.loop ? ((time % animation.duration) + animation.duration) % animation.duration : Math.max(0, Math.min(time, animation.duration));
  for (let position = 0; position < animation.frames.length; position++) {
    const duration = project.frames[animation.frames[position]].duration;
    if (cursor < duration) return position;
    cursor -= duration;
  }
  return animation.frames.length - 1;
}
// Frames per second of an animation of two or more frames that all last the same, for engines and editors that ask
// for a rate: to two decimals (70 ms a frame is 14.29), or three significant figures under 1 (60 s a frame is 0.0167);
// undefined when the durations differ or there is one frame.
export function animationFps(project, key) {
  const durations = project.animations[key].frames.map(i => project.frames[i].duration);
  if (durations.length < 2 || durations.some(ms => ms !== durations[0])) return undefined;
  const fps = 1000 / durations[0];
  return fps >= 1 ? Math.round(fps * 100) / 100 : Number(fps.toPrecision(3));
}
export function animationNeighbors(animation, position) {
  integer(position, 'animation.position', 0, animation.frames.length - 1);
  const count = animation.frames.length;
  return { previous: position > 0 ? position - 1 : animation.loop ? count - 1 : null, next: position + 1 < count ? position + 1 : animation.loop ? 0 : null };
}
export function reviewPixels(data, mode = 'color') {
  if (mode === 'color') return data;
  if (!['silhouette', 'grayscale'].includes(mode)) fail('view', 'expected color, silhouette or grayscale');
  const result = new Uint8ClampedArray(data.length);
  for (let at = 0; at < data.length; at += 4) {
    if (!data[at + 3]) continue;
    const value = mode === 'silhouette' ? 240 : Math.round(.2126 * data[at] + .7152 * data[at + 1] + .0722 * data[at + 2]);
    result.set([value, value, value, mode === 'silhouette' ? 255 : data[at + 3]], at);
  }
  return result;
}
export function onionPixels(project, animation, position) {
  const result = new Uint8ClampedArray(project.width * project.height * 4);
  const neighbors = animationNeighbors(animation, position);
  for (const [neighbor, color] of [[neighbors.previous, [240, 83, 120, 100]], [neighbors.next, [65, 201, 240, 100]]]) {
    if (neighbor === null) continue;
    const data = project.frames[animation.frames[neighbor]].data;
    for (let at = 0; at < data.length; at += 4) if (data[at + 3]) blend(result, at, color, data[at + 3] / 255);
  }
  const current = project.frames[animation.frames[position]].data;
  for (let at = 0; at < current.length; at += 4) blend(result, at, current.subarray(at, at + 4));
  return result;
}

// Advisory evidence, not an aesthetic score. Never changes artwork or invalidates holds/sparks.
export function analyzeProject(project) {
  const { width, height, frames } = project, findings = [], hashes = new Map(), cleanup = new Map();
  const known = new Set(Object.values(project.palette).map(color => colorId(parseColor(color), 0)));
  const stats = frames.map(frame => {
    const colors = new Set(), outside = new Set(), blended = new Set(), isolated = [], unlisted = [], mixes = [];
    // Colors a frame or layer palette introduces are declared for that frame, and for the frames that continue it or
    // copy from it (`inherited`), whose pixels carry them.
    const introduced = frameColours(frame);
    const declared = introduced.length ? new Set([...known, ...introduced.map(color => colorId(parseColor(color), 0))]) : known;
    let visible = 0, isolatedCount = 0, hash = 2166136261;
    for (let at = 0; at < frame.data.length; at += 4) {
      const id = frame.data[at + 3] ? colorId(frame.data, at) : 0;
      hash = Math.imul(hash ^ id, 16777619) >>> 0;
      if (!id) continue;
      visible++; colors.add(id);
      const x = at / 4 % width, y = Math.floor(at / 4 / width);
      if (!declared.has(id)) {
        const mixed = frame.blendMask?.[at / 4], seen = mixed ? blended : outside, samples = mixed ? mixes : unlisted;
        if (!seen.has(id)) {
          seen.add(id);
          if (samples.length < 32) samples.push({ x, y, color: toHex(frame.data.subarray(at, at + 4)) });
        }
      }
      let neighbor = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && frame.data[((y + dy) * width + x + dx) * 4 + 3]) neighbor = true;
      }
      if (!neighbor) { isolatedCount++; if (isolated.length < 32) isolated.push({ x, y }); }
    }
    const peers = hashes.get(hash) ?? [];
    const same = peers.find(other => frame.data.every((value, i) => value === other.data[i] || (!frame.data[i - i % 4 + 3] && !other.data[i - i % 4 + 3])));
    if (same) findings.push({ code: 'duplicate', frame: frame.name, sameAs: same.name, note: 'Repeated poses and holds are valid; compare action intent.' });
    peers.push(frame); hashes.set(hash, peers);
    if (!visible) findings.push({ code: 'empty', frame: frame.name, note: 'An empty effect/transition frame may be intentional.' });
    if (isolatedCount) findings.push({ code: 'isolated', frame: frame.name, count: isolatedCount, coordinates: isolated, omitted: isolatedCount - isolated.length, note: 'No visible 8-connected neighbor. Exempt intentional sparks, stars and detached accents.' });
    if (outside.size) findings.push({ code: 'palette', frame: frame.name, count: outside.size, coordinates: unlisted, omitted: outside.size - unlisted.length, note: 'Directly drawn colors outside the declared palette.' });
    if (blended.size) findings.push({ code: 'alpha-blend', frame: frame.name, count: blended.size, coordinates: mixes, omitted: blended.size - mixes.length, note: 'Colors outside the declared palette produced by alpha blending or layer opacity.' });
    // How many pixels a `cleanup` patch change would alter with corners or strays alone. Counts, not findings: in
    // finished art most L-steps and specks are deliberate (highlight strokes, small rounded corners, texture).
    if (!cleanup.has(same?.name)) {
      const ids = visible ? idsOf(frame.data) : null;
      cleanup.set(frame.name, ids ? { corners: cleanupIds(ids, width, height, { corners: true }).length, strays: cleanupIds(ids, width, height, { strays: true }).length } : { corners: 0, strays: 0 });
    } else cleanup.set(frame.name, cleanup.get(same.name));
    return { frame: frame.name, visible, colors: colors.size, ...cleanup.get(frame.name) };
  });
  const difference = (a, b) => {
    let pixels = 0, left = width, top = height, right = -1, bottom = -1;
    for (let at = 0; at < a.length; at += 4) if (colorId(a, at) !== colorId(b, at) && (a[at + 3] || b[at + 3])) {
      pixels++; const x = at / 4 % width, y = Math.floor(at / 4 / width);
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return { pixels, ...(pixels && { box: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 } }) };
  };
  // Stills are reviewed as frames: their flipbook is no animation, so it gets no row and no loop finding.
  const animations = Object.entries(project.stills ? {} : project.animations).map(([name, a]) => {
    const deltas = a.frames.slice(1).map((index, i) => difference(frames[a.frames[i]].data, frames[index].data).pixels);
    const nonzero = deltas.filter(n => n).sort((a, b) => a - b), median = nonzero[Math.floor(nonzero.length / 2)] ?? 0;
    const boundary = difference(frames[a.frames.at(-1)].data, frames[a.frames[0]].data);
    if (a.loop && boundary.pixels > Math.max(4, median * 3)) findings.push({ code: 'loop-jump', animation: name, from: frames[a.frames.at(-1)].name, to: frames[a.frames[0]].name, ...boundary, note: 'Loop boundary changes over three times the median nonzero adjacent change. Intentional cuts are exempt.' });
    // A one-shot never plays its last frame into its first, so it has no boundary to read as a seam.
    return { animation: name, duration: a.duration, entries: a.frames.length, repeatedAdjacent: deltas.filter(n => !n).length, ...(a.loop && { boundary }) };
  });
  return { advisory: true, frames: stats, ...(!project.stills && { animations }), findings };
}

// Diagnostics as a reply carries them. Up to DIAGNOSTIC_ROWS frames keep a row each; past that the rows are added up
// (`frameTotals`: ranges of visible pixels and colours, cleanup counts summed) and `frames` keeps only three rows,
// since thirty rows of near-equal counts tell a reader nothing a total does not: frames with findings first (then
// those whose only finding is off-palette colours), then the most corners and strays. Findings follow the rows: those
// of the frames kept are listed, those of the other frames added up by code (`findingTotals`: "isolated": "129 pixels
// in 16 frames"), since a particle overlay has strays in every frame and a block of coordinates each would be most of
// the reply; a code in eight frames or fewer names them ("8 pixels in resonate-5, resonate-25"). Off-palette colours
// are added up by colour ("#123456 in 7 frames"), as one colour in many frames is one colour to fix, followed by the
// frames when eight or fewer ("; in smoke-3 … smoke-5"). A finding with no coordinates (`empty`) costs a line,
// so it stays listed, once for every frame it names. Animations and their findings are kept whole. `duplicate` is
// left out: a pose a cycle passes twice, or a hold, is no finding to act on, and two cold runs read the list as noise
// (`--full` keeps everything). `analyzeProject` still measures every frame.
export const DIAGNOSTIC_ROWS = 8;
export function briefDiagnostics(diagnostics) {
  const { frames, ...rest } = diagnostics;
  rest.findings = rest.findings.filter(finding => finding.code !== 'duplicate');
  if (frames.length <= DIAGNOSTIC_ROWS) return { advisory: rest.advisory, frames, ...(rest.animations && { animations: rest.animations }), findings: rest.findings };
  const range = key => [Math.min(...frames.map(row => row[key])), Math.max(...frames.map(row => row[key]))], sum = key => frames.reduce((total, row) => total + row[key], 0);
  // Place drawing findings first, then direct off-palette colours, then expected blends.
  const flagged = new Map();
  for (const finding of rest.findings) if (finding.coordinates) flagged.set(finding.frame, Math.max(flagged.get(finding.frame) ?? 0, finding.code === 'alpha-blend' ? 1 : finding.code === 'palette' ? 2 : 3));
  const most = frames.map((row, index) => ({ row, index, flagged: flagged.get(row.frame) ?? 0, count: row.corners + row.strays })).filter(entry => entry.flagged || entry.count)
    .sort((a, b) => b.flagged - a.flagged || b.count - a.count || a.index - b.index).slice(0, 3).map(entry => entry.row);
  const kept = new Set(most.map(row => row.frame)), totals = new Map(), named = new Map(), paletteTotals = new Map(), plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const findings = rest.findings.filter(finding => {
    if (finding.frame === undefined) return true;
    if (!finding.coordinates) {
      const names = named.get(finding.code);
      if (names) { names.push(finding.frame); return false; }
      named.set(finding.code, [finding.frame]); return true;
    }
    if (kept.has(finding.frame)) return true;
    if (finding.code === 'palette' || finding.code === 'alpha-blend') {
      const total = paletteTotals.get(finding.code) ?? { colours: new Map(), frames: [], unlisted: false };
      for (const { color } of finding.coordinates) total.colours.set(color, (total.colours.get(color) ?? 0) + 1);
      total.unlisted ||= finding.omitted > 0; total.frames.push(finding.frame); paletteTotals.set(finding.code, total);
    } else {
      const total = totals.get(finding.code) ?? { count: 0, frames: [] };
      total.count += finding.count ?? 0; total.frames.push(finding.frame); totals.set(finding.code, total);
    }
    return false;
  }).map(finding => {
    const names = finding.coordinates ? null : named.get(finding.code);
    if (!names || names.length === 1) return finding;
    const { frame, ...same } = finding;
    return { code: same.code, frames: nameRuns(names).join(', '), ...same };
  });
  const findingTotals = Object.fromEntries([...totals].map(([code, { count, frames }]) => [code, `${count ? `${code === 'isolated' ? plural(count, 'pixel') : count} in ` : ''}${frames.length <= DIAGNOSTIC_ROWS ? nameRuns(frames).join(', ') : plural(frames.length, 'frame')}`]));
  for (const [code, { colours, frames: paletteFrames, unlisted }] of paletteTotals) {
    // The colours in the most frames first; past eight, how many more.
    const listed = [...colours].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), shown = listed.slice(0, 8).map(([color, frames]) => `${color} in ${plural(frames, 'frame')}`), more = listed.length - shown.length;
    // A frame lists its first 32 colours, so one with more may hold colours no frame names.
    if (more || unlisted) shown.push(`${more ? `${more}${unlisted ? ' or more' : ''} ` : ''}other colour${more === 1 && !unlisted ? '' : 's'}`);
    findingTotals[code] = `${shown.join(', ')}${paletteFrames.length <= DIAGNOSTIC_ROWS ? `; in ${nameRuns(paletteFrames).join(', ')}` : ''}`;
  }
  return { advisory: rest.advisory, frameTotals: { frames: frames.length, visible: range('visible'), colors: range('colors'), corners: sum('corners'), strays: sum('strays') }, frames: most, omitted: frames.length - most.length, ...(rest.animations && { animations: rest.animations }), findings, ...(Object.keys(findingTotals).length && { findingTotals }) };
}

// Cells (or frames) as a reply carries them: in order, a line per run that lasts the same, and a run of three or more
// numbered names as its ends. Nineteen cells of a smoke puff read ["smoke-puff-0 … smoke-puff-18: 60 ms each"], where
// a `{frame, duration}` object each was most of a reply. Cells that carry more than a name and a duration (a motion
// review's) are returned as they are.
// Names in order, a run of three or more numbered ones (a-0, a-1, a-2) written as "a-0 … a-2".
function nameRuns(labels) {
  const numbered = label => /^(.*?)(\d+)$/.exec(label), names = [];
  for (let a = 0, b; a < labels.length; a = b) {
    const first = numbered(labels[a]);
    for (b = a + 1; first && b < labels.length; b++) { const next = numbered(labels[b]); if (!next || next[1] !== first[1] || Number(next[2]) !== Number(first[2]) + b - a) break; }
    if (b - a > 2) names.push(`${labels[a]} … ${labels[b - 1]}`);
    else { names.push(labels[a]); b = a + 1; }
  }
  return names;
}
export function briefCells(cells) {
  if (!cells.every(cell => Object.keys(cell).every(key => key === 'frame' || key === 'name' || key === 'duration'))) return cells;
  const lines = [];
  for (let start = 0, end; start < cells.length; start = end) {
    for (end = start + 1; end < cells.length && cells[end].duration === cells[start].duration; end++);
    lines.push(`${nameRuns(cells.slice(start, end).map(cell => cell.frame ?? cell.name)).join(', ')}: ${cells[start].duration} ms${end - start > 1 ? ' each' : ''}`);
  }
  return lines;
}

// A comparison as a reply carries it. Up to COMPARED changed frames are listed each with its own figures. Past that
// (a palette change touches every frame of a character) the same few lines would repeat for every frame, so the
// reply says how many changed and which, the pixels and the box over all of them, the commonest colour changes
// summed, and the three frames that changed most; a long list of unchanged frames is their names in runs.
const COMPARED = 8;
// Frames that became stills are said once, with how to get the flipbook back.
const NOW_STILLS = 'the frames are now stills ("animations": {}): an export plays no animation and writes no SpriteFrames, animated PNGs, GIFs, CSS or player; remove the animations field to play every frame in order again, or name animations under it';
export function briefComparison(full) {
  const report = full.stills ? { ...full, stills: NOW_STILLS } : full;
  const { changed, unchanged, ...rest } = report.frames;
  // Frames that all changed alike (a recoloured key in every frame) are said once, as many frames are.
  const alike = changed.length > 1 && changed.every(entry => entry.transitions && JSON.stringify(entry.transitions) === JSON.stringify(changed[0].transitions));
  if (changed.length <= COMPARED && unchanged.length <= COMPARED * 2 && !alike) return report;
  const brief = list => (list.length <= COMPARED * 2 ? list : { count: list.length, frames: nameRuns(list).join(', ') });
  if (changed.length <= COMPARED && !alike) return { ...report, frames: { changed, unchanged: brief(unchanged), ...rest } };
  const measured = changed.filter(entry => entry.box), sums = new Map();
  // A frame with few changed pixels lists each one; a frame with many, its colour changes. Both are counted.
  const add = (from, to, pixels) => { const key = `${from}\n${to}`; sums.set(key, (sums.get(key) ?? 0) + pixels); };
  for (const entry of changed) { for (const { from, to, pixels } of entry.transitions ?? []) add(from, to, pixels); for (const { from, to } of entry.changes ?? []) add(from, to, 1); }
  const box = measured.reduce((all, { box: b }) => (all ? { x: Math.min(all.x, b.x), y: Math.min(all.y, b.y), x2: Math.max(all.x2, b.x + b.w), y2: Math.max(all.y2, b.y + b.h) } : { x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h }), null);
  const transitions = [...sums].sort((a, b) => b[1] - a[1]).slice(0, COMPARED).map(([key, pixels]) => ({ from: key.split('\n')[0], to: key.split('\n')[1], pixels }));
  return { ...report, frames: {
    changed: { count: changed.length, frames: unchanged.length ? nameRuns(changed.map(entry => entry.frame)).join(', ') : 'every frame', pixels: changed.reduce((sum, entry) => sum + (entry.pixels ?? 0), 0),
      ...(box && { box: { x: box.x, y: box.y, w: box.x2 - box.x, h: box.y2 - box.y } }), ...(transitions.length && { transitions }),
      ...(!alike && { most: [...measured].sort((a, b) => b.pixels - a.pixels).slice(0, 3).map(({ frame, pixels, box: b }) => ({ frame, pixels, box: b })) }) },
    unchanged: brief(unchanged), ...rest } };
}

// Two names make one number: the first times NAME_PAIRS (2 to the 26th, more names than a frame has pixels) plus the second.
const NAME_PAIRS = 67108864;
// A namer's names as small numbers: `index` names a pixel's colour (once per colour, through `char`, which also notes
// the legend) and returns the name's place in `chars`, the same place for colours that share a name.
function nameIndex(namer) {
  const byColor = new Map(), byChar = new Map(), chars = [];
  return { chars, index(data, at) {
    const id = colorId(data, at);
    let place = byColor.get(id);
    if (place === undefined) {
      const char = namer.char(data, at);
      place = byChar.get(char);
      if (place === undefined) { place = chars.length; chars.push(char); byChar.set(char, place); }
      byColor.set(id, place);
    }
    return place;
  } };
}

// Compares two rendered revisions, matching frames by name, so a patch can report every visible effect.
export function compareProjects(before, after) {
  const { width, height } = after, resized = before.width !== width || before.height !== height;
  const namer = colorNamer(after, [before]), previous = new Map(before.frames.map(frame => [frame.name, frame]));
  const names = nameIndex(namer);
  const kept = new Set(after.frames.map(frame => frame.name)), changed = [], unchanged = [], added = [], durations = [], shown = [];
  for (const frame of after.frames) {
    const old = previous.get(frame.name);
    if (!old) { added.push(frame.name); shown.push({ frame: frame.name, status: 'added', before: null, after: frame.data }); continue; }
    if (old.duration !== frame.duration) durations.push({ frame: frame.name, from: old.duration, to: frame.duration });
    if (resized) { changed.push({ frame: frame.name }); continue; }
    let pixels = 0, left = width, top = height, right = -1, bottom = -1;
    // Each colour is named once and each pair of names counted under a number, in the order pairs first appear, so a
    // still whose every pixel changes costs a few array reads a pixel instead of two lookups, a string and a map entry.
    const changes = [], transitions = new Map(), { data } = frame, was = old.data;
    for (let y = 0, at = 0; y < height; y++) for (let x = 0; x < width; x++, at += 4) {
      if ((data[at] === was[at] && data[at + 1] === was[at + 1] && data[at + 2] === was[at + 2] && data[at + 3] === was[at + 3]) || (!data[at + 3] && !was[at + 3])) continue;
      const from = names.index(was, at), to = names.index(data, at), pair = from * NAME_PAIRS + to;
      pixels++; if (x < left) left = x; if (y < top) top = y; if (x > right) right = x; bottom = y;
      if (changes.length < 16) changes.push({ x, y, from: names.chars[from], to: names.chars[to] });
      transitions.set(pair, (transitions.get(pair) ?? 0) + 1);
    }
    if (!pixels) { unchanged.push(frame.name); continue; }
    const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    // A few pixels are listed one by one. More, or four or more where each colour became one colour and no two became
    // the same one (recoloured palette keys, a filled patch), are summed up by what became what.
    const pairs = [...transitions.keys()], recoloured = pixels >= 4 && new Set(pairs.map(pair => Math.floor(pair / NAME_PAIRS))).size === pairs.length && new Set(pairs.map(pair => pair % NAME_PAIRS)).size === pairs.length;
    const detail = pixels <= 16 && !recoloured ? { changes } : { transitions: [...transitions].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pair, count]) => ({ from: names.chars[Math.floor(pair / NAME_PAIRS)], to: names.chars[pair % NAME_PAIRS], pixels: count })) };
    changed.push({ frame: frame.name, pixels, box, ...detail });
    shown.push({ frame: frame.name, status: 'changed', before: old.data, after: frame.data, box });
  }
  const removed = before.frames.filter(frame => !kept.has(frame.name)).map(frame => frame.name);
  for (const name of removed) shown.push({ frame: name, status: 'removed', before: previous.get(name).data, after: null });
  const sequence = (project, key) => project.animations[key].frames.map(i => project.frames[i].name);
  // Stills have no animations: the flipbook they keep for viewing is never reported added or removed.
  const played = project => (project.stills ? {} : project.animations), was = played(before), is = played(after);
  const animations = { changed: [], added: [], removed: Object.keys(was).filter(key => !own(is, key)) };
  for (const key of Object.keys(is)) {
    if (!own(was, key)) { animations.added.push(key); continue; }
    const from = sequence(before, key), to = sequence(after, key), loop = [before.animations[key].loop, after.animations[key].loop];
    if (from.join() !== to.join() || loop[0] !== loop[1]) animations.changed.push({ animation: key, ...(from.join() !== to.join() && { frames: { from, to } }), ...(loop[0] !== loop[1] && { loop: { from: loop[0], to: loop[1] } }) });
  }
  const filled = value => Object.fromEntries(Object.entries(value).filter(([, list]) => list.length));
  const report = {
    ...(resized && { canvas: { from: { w: before.width, h: before.height }, to: { w: width, h: height } } }),
    frames: { changed, unchanged, ...filled({ added, removed, durations }) },
    ...(Object.keys(filled(animations)).length && { animations: filled(animations) }),
    // The frames became stills (a patch removed the last named animation, or set "animations" to {}).
    ...(after.stills && !before.stills && { stills: true })
  };
  // Before and after share one row per frame, cropped to the changed area plus 2 pixels unless frames were added or removed.
  // When two frames side by side would pass the sheet limit (a still over 2048 wide), before goes above after; a
  // comparison too large either way (over 2048 a side, which no recipe is) keeps its report without the image.
  if (shown.length && !resized) {
    let region = { x: 0, y: 0, w: width, h: height };
    if (shown.every(row => row.box)) {
      const x = Math.max(0, Math.min(...shown.map(row => row.box.x)) - 2), y = Math.max(0, Math.min(...shown.map(row => row.box.y)) - 2);
      region = { x, y, w: Math.min(width, Math.max(...shown.map(row => row.box.x + row.box.w)) + 2) - x, h: Math.min(height, Math.max(...shown.map(row => row.box.y + row.box.h)) + 2) - y };
    }
    const stacked = 2 * region.w > SHEET_SIDE;
    if (stacked && 2 * region.h > SHEET_SIDE) report.imageNote = `no before/after image: two ${region.w}×${region.h} frames pass the 4096-pixel sheet limit side by side and stacked; inspect each revision with a region instead`;
    else {
      const rows = shown.slice(0, Math.max(1, Math.min(16, Math.floor(4094 / ((stacked ? 2 : 1) * (region.h + 2))))));
      report.image = { region, frames: rows.map(({ frame, status }) => ({ frame, status })), ...(rows.length < shown.length && { omitted: shown.length - rows.length }), sheet: drawSheet(rows.flatMap(row => [row.before, row.after]), width, region, { columns: stacked ? 1 : 2, where: 'image' }) };
      if (stacked) report.imageNote = `before above after: side by side, two ${region.w}-pixel frames would pass the 4096-pixel sheet limit`;
    }
  }
  // A colour with no one-letter palette key is written out where it is reported: its palette name, or its hex. Only
  // "?" (more colours than there are symbols) still needs a legend.
  // Beside a hex the other side is a hex too, with its key: a recoloured key reads "#d9a566" to "#8a5a2c (c)", not
  // a colour turning into a letter.
  const legend = namer.legend(), written = symbol => (symbol !== '?' && own(legend, symbol) ? legend[symbol].palette ?? legend[symbol].color : symbol);
  const hex = value => value.startsWith('#'), keyed = key => (own(after.palette, key) ? `${toHex(parseColor(after.palette[key]))} (${key})` : key);
  for (const frame of changed) for (const item of frame.changes ?? frame.transitions ?? []) {
    const from = written(item.from), to = written(item.to);
    item.from = hex(to) && !hex(from) ? keyed(from) : from; item.to = hex(from) && !hex(to) ? keyed(to) : to;
  }
  if (own(legend, '?')) report.legend = { '?': legend['?'] };
  return report;
}

