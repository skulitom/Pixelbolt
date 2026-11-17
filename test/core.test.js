import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { renderProject, buildAtlas, parseColor, scalePixels, analyzeProject, inspectProject } from '../src/core.js';

const make = (ops = [], extra = {}) => ({ version: 1, name: 'test', width: 4, height: 4, palette: { r: '#f00', b: '#00f', g: '#0f0' }, frames: [{ name: 'a', ops }], ...extra });
const pixel = (frame, x, y, width = 4) => [...frame.data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
test('hex shorthand, alpha and named colors', () => {
  assert.deepEqual(parseColor('#0f08'), [0, 255, 0, 136]);
  assert.deepEqual(parseColor('blue', { blue: '#11223344' }), [17, 34, 51, 68]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.throws(() => parseColor('missing'), /unknown color/);
});
test('grid dots skip existing pixels, with exact palette colors', () => {
  const { frames: [f] } = renderProject(make([{ op: 'rect', w: 4, h: 4, color: 'b' }, { op: 'grid', rows: ['r.', '.g'] }]));
  assert.deepEqual(pixel(f, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(f, 1, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(f, 1, 1), [0, 255, 0, 255]);
});
test('a field a frame does not have is reported with what else is wrong, an animation\'s missing frame included', () => {
  const recipe = { ...make([{ op: 'pixel', x: 0, y: 0, color: 'nope' }]), animations: { idle: { frames: ['missing'] } } };
  recipe.frames[0].hold = 2;
  assert.throws(() => renderProject(recipe), error => {
    assert.deepEqual(error.errors.map(item => item.path), ['project.frames[0].hold', 'project.frames[0].ops[0].color', 'project.animations.idle.frames[0]']);
    return true;
  });
  // A frame that is not an object, or holds a null, still stops at once.
  assert.throws(() => renderProject({ ...make([]), frames: ['rest'] }), error => error.errors === undefined && error.path === 'project.frames[0]');
  assert.throws(() => renderProject({ ...make([]), frames: [{ name: 'a', duration: null }] }), error => error.errors === undefined && /null is not supported/.test(error.message));
});
test('grid shape and color errors include the exact source path', () => {
  assert.throws(() => renderProject(make([{ op: 'grid', rows: ['rr', 'r'] }])), /project.frames\[0\].ops\[0\].rows\[1\]: all rows must be 2/);
  assert.throws(() => renderProject(make([{ op: 'grid', rows: ['z'] }])), /unknown palette character "z"/);
});
test('validation names every miscounted row, and every broken operation, in one error', () => {
  // A grid gives each row that differs from row 0 with its own width, and every unknown character.
  assert.throws(() => renderProject(make([{ op: 'grid', rows: ['rrrr', 'rrr', 'rr', 'rrrrr'] }])), error => error.path === 'project.frames[0].ops[0].rows[1]'
    && error.message === 'project.frames[0].ops[0].rows[1]: all rows must be 4 characters wide, as row 0 is: row 1 has 3, row 2 has 2, row 3 has 5');
  assert.throws(() => renderProject(make([{ op: 'grid', rows: ['rz', 'qr', 'zr'] }])), /rows\[0\]: unknown palette character "z"; also "q" in row 1$/);
  // Broken operations in different frames and layers are each named; the first is the error's path.
  const recipe = make([], {
    frames: [{ name: 'a', ops: [{ op: 'grid', rows: ['rr', 'r'] }, { op: 'pixel', x: 0, y: 0, color: 'r' }] }, { name: 'b', layers: [{ ops: [{ op: 'rect', x: 0, y: 0, w: 0, h: 1, color: 'r' }, { op: 'pixel', x: 1, y: 1, color: 'nope' }] }] }] });
  assert.throws(() => renderProject(recipe), error => {
    assert.equal(error.path, 'project.frames[0].ops[0].rows[1]');
    assert.deepEqual(error.errors.map(item => item.path), ['project.frames[0].ops[0].rows[1]', 'project.frames[1].layers[0].ops[0].w', 'project.frames[1].layers[0].ops[1].color']);
    assert.match(error.message, /row 1 has 1; 2 more errors: project\.frames\[1\]\.layers\[0\]\.ops\[0\]\.w: .*; project\.frames\[1\]\.layers\[0\]\.ops\[1\]\.color: unknown color "nope"/);
    return true;
  });
  // A later error outside any operation joins them; a single error stays as it was, with no list.
  assert.throws(() => renderProject({ ...recipe, animations: { idle: { frames: ['missing'] } } }), error => error.errors.length === 4 && error.errors[3].path.startsWith('project.animations'));
  assert.throws(() => renderProject(make([{ op: 'pixel', x: 0, y: 0, color: 'nope' }])), error => error.errors === undefined && error.path === 'project.frames[0].ops[0].color');
  // Checking stops after ten.
  const many = make(Array.from({ length: 30 }, () => ({ op: 'pixel', x: 0, y: 0, color: 'nope' })));
  assert.throws(() => renderProject(many), error => error.errors.length === 10 && /9 more errors \(checking stopped at 10\)/.test(error.message));
});
test('an operation a ground-sorted layer cannot take is one broken operation among the others', () => {
  const base = { version: 1, name: 't', width: 8, height: 8, palette: { k: '#000', r: '#f00', g: '#0f0' } };
  const badPixel = { op: 'pixel', x: 1, y: 1, color: 'nope' }, fill = { op: 'fill', x: 0, y: 0, color: 'k' };
  const errors = frames => { try { renderProject({ ...base, frames }); } catch (error) { return error.errors ?? [{ path: error.path, error: error.message }]; } return []; };
  const paths = frames => errors(frames).map(item => item.path), L = 'project.frames[0].layers';
  const area = `${L}[0].ops[0].op: fill works on an area rather than standing on the ground; draw it in a layer without sort`;
  const nope = path => ({ path, error: `${path}: unknown color "nope"; use a palette name or #RGB, #RGBA, #RRGGBB, #RRGGBBAA` });
  // Alone it is the plain error it was, with no list.
  assert.throws(() => renderProject({ ...base, frames: [{ name: 'a', layers: [{ sort: 'ground', ops: [fill] }] }] }), error => error.errors === undefined && error.path === `${L}[0].ops[0].op` && error.message === area);
  // With a broken operation in another layer, whichever comes first: both, each with the path and message it has alone.
  assert.deepEqual(errors([{ name: 'a', layers: [{ sort: 'ground', ops: [fill] }, { ops: [badPixel] }] }]), [{ path: `${L}[0].ops[0].op`, error: area }, nope(`${L}[1].ops[0].color`)]);
  assert.deepEqual(paths([{ name: 'a', layers: [{ ops: [badPixel] }, { sort: 'ground', ops: [fill] }] }]), [`${L}[0].ops[0].color`, `${L}[1].ops[0].op`]);
  // In the same layer: text without ground, a ground that is no row, and two area operations.
  assert.deepEqual(errors([{ name: 'a', layers: [{ sort: 'ground', ops: [{ op: 'text', x: 0, y: 0, text: 'a', color: 'k' }, badPixel] }] }]), [
    { path: `${L}[0].ops[0].ground`, error: `${L}[0].ops[0].ground: text in a layer with sort "ground" needs ground: the row it stands on` },
    nope(`${L}[0].ops[1].color`)]);
  assert.deepEqual(paths([{ name: 'a', layers: [{ sort: 'ground', ops: [{ op: 'pixel', x: 0, y: 0, color: 'k', ground: 'low' }, badPixel] }] }]), [`${L}[0].ops[0].ground`, `${L}[0].ops[1].color`]);
  assert.deepEqual(paths([{ name: 'a', layers: [{ sort: 'ground', ops: [fill, { op: 'outline', color: 'k' }] }] }]), [`${L}[0].ops[0].op`, `${L}[0].ops[1].op`]);
  assert.deepEqual(paths([{ name: 'a', layers: [{ sort: 'ground', ops: [badPixel, fill] }] }]).sort(), [`${L}[0].ops[0].color`, `${L}[0].ops[1].op`]);
  // The rest of the frame, and the frames after it, are still checked.
  assert.deepEqual(paths([{ name: 'a', layers: [{ sort: 'ground', ops: [fill] }], pixels: [] }, { name: 'b', ops: [badPixel] }]), [`${L}[0].ops[0].op`, 'project.frames[1].ops[0].color']);
  // What the layer cannot take is noted before it draws; the others still draw far to near, so their errors come by row.
  assert.deepEqual(paths([{ name: 'a', layers: [{ sort: 'ground', ops: [{ ...badPixel, y: 5 }, fill, { ...badPixel, y: 1 }] }] }]), [`${L}[0].ops[1].op`, `${L}[0].ops[2].color`, `${L}[0].ops[0].color`]);
  // Still at most ten.
  for (const ops of [Array.from({ length: 30 }, () => fill), Array.from({ length: 12 }, (_, i) => (i % 2 ? fill : badPixel))]) {
    assert.throws(() => renderProject({ ...base, frames: [{ name: 'a', layers: [{ sort: 'ground', ops }] }] }), error => error.errors.length === 10 && /9 more errors \(checking stopped at 10\)/.test(error.message));
  }
  // The 20,000-operation budget is not a broken operation: it stops the check, listed after what was noted before it.
  const crowd = Array.from({ length: 10 }, () => ({ ops: Array.from({ length: 2048 }, () => ({ op: 'pixel', x: 0, y: 0, color: 'k' })) }));
  const over = errors([{ name: 'a', layers: [{ sort: 'ground', ops: [fill, badPixel] }, ...crowd, { ops: [badPixel] }] }]);
  assert.deepEqual(over.map(item => item.path), [`${L}[0].ops[0].op`, `${L}[0].ops[1].color`, `${L}[10].ops`]);
  assert.equal(over[2].error, `${L}[10].ops: project exceeds 20,000 drawing operations`);
});
test('a ground-sorted layer of sound operations renders the bytes it did', () => {
  // Every kind of operation that can stand, listed out of order; the hash was taken before sorted layers noted errors.
  const ops = [
    { op: 'stamp', x: 2, y: 5, symbol: 'short' }, { op: 'stamp', x: 2, y: 1, symbol: 'tall' }, { op: 'rect', x: 0, y: 4, w: 16, h: 3, color: 'n' },
    { op: 'line', x: 5, y: 0, x2: 5, y2: 5, color: 'f' }, { op: 'ellipse', x: 6, y: 0, w: 8, h: 6, color: 't' }, { op: 'box', x: 0, y: 8, w: 6, d: 4, h: 3, top: 'f', left: 'n', right: 't', edge: '#ffffff' },
    { op: 'grid', x: 9, y: 7, rows: ['ff', 'nf', 'ff'], scale: 2, rotate: 90 }, { op: 'stamp', x: 10, y: 8, symbol: 'wide', scale: 2, rotate: 270, flipX: true },
    { op: 'copy', x: 12, y: 9, symbol: 'tall', h: 3 }, { op: 'autotile', x: 1, y: 9, symbol: 'tiles', mask: 0 }, { op: 'pixel', x: 3, y: 3, color: 't' },
    { op: 'text', x: 1, y: 9, text: 'Hi', color: 't', ground: 12 }, { op: 'stamp', x: 7, y: 6, symbol: 'tall', ground: 0 }, { op: 'rect', x: 3, y: 2, w: 9, h: 9, color: '#ff00ff80', filled: false }
  ];
  const recipe = {
    version: 1, name: 'ground', width: 16, height: 16, palette: { n: '#ff0000', f: '#00ff00', t: '#0000ff' },
    symbols: { tall: ['f', 'f', 'f', 'f', 'f'], short: ['n', 'n'], wide: ['ff', 'fn', 'ff'], tiles: ['tttt', 'tnnt', 'tttt', 'tttt', 'tfft', 'tttt'] },
    frames: [{ name: 'a', layers: [{ sort: 'ground', ops }, { sort: 'ground', x: 1, opacity: .5, ops: [...ops].reverse() }] }, { name: 'b', from: 'a', layers: [{ sort: 'ground', palette: { n: '#ffff00' }, ops: ops.slice(0, 5) }] }]
  };
  const project = renderProject(recipe), hash = createHash('sha256');
  for (const frame of project.frames) hash.update(frame.data);
  assert.equal(hash.digest('hex'), '462429a1291f3842ae649a79f08bb8690f2b912526e89707a12d320f580beed0');
  // The second layer is moved a pixel right, so its last column is clipped, as it was.
  assert.deepEqual(project.clipping, [{ path: 'project.frames[0].layers[1]', pixels: 7 }]);
});
test('colours a frame continues or copies from a recoloured frame are declared for it', () => {
  const base = { version: 1, name: 't', width: 8, height: 8, palette: { k: '#000', r: '#f00', g: '#0f0' } };
  const outside = project => analyzeProject(project).findings.filter(finding => finding.code === 'palette').map(({ frame, coordinates }) => ({ frame, coordinates }));
  const hex = (frame, x, y) => '#' + pixel(frame, x, y, 8).slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
  // `hit` recolours k white for its own drawing; `hit-2` continues it and draws k itself, which is still black.
  const hit = { name: 'hit', palette: { k: '#ffffff' }, ops: [{ op: 'rect', x: 2, y: 2, w: 3, h: 3, color: 'k' }] };
  const chain = renderProject({ ...base, frames: [hit, { name: 'hit-2', from: 'hit', ops: [{ op: 'pixel', x: 6, y: 6, color: 'r' }, { op: 'pixel', x: 7, y: 7, color: 'k' }] }] });
  assert.equal(hex(chain.frames[1], 3, 3), '#ffffff'); assert.equal(hex(chain.frames[1], 7, 7), '#000000');
  assert.deepEqual(outside(chain), []);
  assert.deepEqual(inspectProject(chain, { diagnostics: true }).diagnostics.findings.filter(finding => finding.code === 'palette'), []);
  assert.equal(chain.frames[1].palette, undefined);
  assert.deepEqual(chain.frames[1].inherited, ['#ffffff']); assert.equal(chain.frames[0].inherited, undefined);
  // A colour nothing declares is still found on the continuing frame, and only that colour.
  const stray = renderProject({ ...base, frames: [hit, { name: 'hit-2', from: 'hit', ops: [{ op: 'pixel', x: 6, y: 6, color: '#123456' }] }] });
  assert.deepEqual(outside(stray), [{ frame: 'hit-2', coordinates: [{ x: 6, y: 6, color: '#123456' }] }]);
  // A frame that continues nothing gets nothing from a recoloured frame beside it.
  const apart = renderProject({ ...base, frames: [hit, { name: 'other', ops: [{ op: 'pixel', x: 0, y: 0, color: '#ffffff' }] }] });
  assert.deepEqual(outside(apart), [{ frame: 'other', coordinates: [{ x: 0, y: 0, color: '#ffffff' }] }]);
  // A chain: each frame's own frame and layer palettes reach every frame that continues it, however far down.
  const nested = renderProject({ ...base, frames: [
    hit,
    { name: 'b', from: 'hit', palette: { r: '#0000ff' }, ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }], layers: [{ palette: { g: '#ff00ff' }, ops: [{ op: 'pixel', x: 1, y: 0, color: 'g' }] }] },
    { name: 'c', from: 'b', translate: [1, 1] },
    { name: 'd', from: 'c', ops: [{ op: 'pixel', x: 0, y: 7, color: 'g' }, { op: 'pixel', x: 7, y: 0, color: '#abcdef' }] }
  ] });
  assert.equal(hex(nested.frames[3], 3, 3), '#ffffff'); assert.equal(hex(nested.frames[3], 1, 1), '#0000ff'); assert.equal(hex(nested.frames[3], 2, 1), '#ff00ff'); assert.equal(hex(nested.frames[3], 0, 7), '#00ff00');
  assert.deepEqual(nested.frames[3].inherited, ['#0000ff', '#ff00ff', '#ffffff']);
  assert.deepEqual(outside(nested), [{ frame: 'd', coordinates: [{ x: 7, y: 0, color: '#abcdef' }] }]);
  // A copy of an earlier frame keeps exact RGBA, so it brings that frame's colours the same way.
  const copied = renderProject({ ...base, frames: [hit, { name: 'dst', ops: [{ op: 'copy', from: 'hit', x: 3, y: 3 }] }, { name: 'dst-2', layers: [{ ops: [{ op: 'copy', from: 'dst', x: 0, y: 0 }] }] }] });
  assert.equal(hex(copied.frames[2], 6, 6), '#ffffff');
  assert.deepEqual(outside(copied), []);
});
test('an unknown field or operation names the one most likely meant and what is accepted; a missing number says so', () => {
  const message = op => { try { renderProject(make([op])); } catch (error) { return error.message; } return null; };
  assert.equal(message({ op: 'rect', x: 0, y: 0, width: 2, h: 2, color: 'r' }), 'project.frames[0].ops[0].width: unknown field; did you mean "w"? Fields here: op, x, y, w, h, color, filled, ground');
  assert.match(message({ op: 'line', x1: 0, y: 0, x2: 3, y2: 3, color: 'r' }), /\.x1: unknown field; did you mean "x"\?/);
  // No likely match: only the accepted fields.
  assert.equal(message({ op: 'pixel', x: 0, y: 0, color: 'r', zz: 1 }), 'project.frames[0].ops[0].zz: unknown field; fields here: op, x, y, color, ground');
  // Operations: a common other name, a one-letter typo and another case.
  assert.match(message({ op: 'circle', x: 0, y: 0, w: 2, h: 2, color: 'r' }), /\.op: unknown operation "circle"; did you mean "ellipse"\? It takes x, y, w, h \(the box it fills: a circle of radius r about cx, cy is x cx - r, y cy - r, w and h 2r \+ 1\), color and optionally filled\. Operations: pixel, rect, ellipse, /);
  // The fields said with a suggestion are fields that operation has: each other name an agent might write, drawn with
  // the fields its hint names, is refused only for a value, never for an unknown field.
  for (const [other, fields] of [['oval', 'ellipse'], ['square', 'rect'], ['dot', 'pixel'], ['flood', 'fill'], ['erase', 'clear'], ['label', 'text'], ['sprite', 'stamp'], ['image', 'grid'], ['recolour', 'replace'], ['border', 'outline']]) {
    const hint = /did you mean "([a-z]+)"\? It takes ([^.]+)\./.exec(message({ op: other }));
    assert.equal(hint?.[1], fields, other);
    const named = hint[2].replace(/\([^)]*\)/g, '').split(/,| and optionally /).map(field => field.trim()).filter(Boolean);
    assert.doesNotMatch(message({ op: fields, ...Object.fromEntries(named.map(field => [field, 0])) }) ?? '', /unknown field/, `${fields}: ${named}`);
  }
  assert.match(message({ op: 'elipse', x: 0, y: 0, w: 2, h: 2, color: 'r' }), /did you mean "ellipse"\?/);
  assert.match(message({ op: 'Rect', x: 0, y: 0, w: 2, h: 2, color: 'r' }), /did you mean "rect"\?/);
  assert.match(message({ op: 'polygon' }), /unknown operation "polygon"; operations: pixel, /);
  assert.match(message({ op: 7 }), /unknown operation 7; operations: pixel, /);
  // Recipe and frame fields get the same help.
  assert.throws(() => renderProject(make([], { animation: {} })), { message: /^project\.animation: unknown field; did you mean "animations"\?/ });
  assert.throws(() => renderProject(make([], { frames: [{ name: 'a', durration: 100 }] })), { message: /^project\.frames\[0\]\.durration: unknown field; did you mean "duration"\?/ });
  // A required number that is absent is called missing; one out of range keeps the plain message.
  assert.equal(message({ op: 'rect', x: 0, y: 0, color: 'r' }), 'project.frames[0].ops[0].w: missing; expected an integer from 1 to 512');
  assert.equal(message({ op: 'rect', x: 0, y: 0, w: 0, h: 1, color: 'r' }), 'project.frames[0].ops[0].w: expected an integer from 1 to 512');
});

test('non-square stamp rotates clockwise and flips before rotation', () => {
  const p = renderProject(make([{ op: 'stamp', symbol: 's', rotate: 90 }], { symbols: { s: ['rg', 'b.','r.'] } }));
  assert.deepEqual(pixel(p.frames[0], 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(p.frames[0], 1, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(p.frames[0], 2, 1), [0, 255, 0, 255]);
  const q = renderProject(make([{ op: 'stamp', symbol: 's', flipX: true, rotate: 90 }], { symbols: { s: ['rg', 'b.','r.'] } }));
  assert.deepEqual(pixel(q.frames[0], 0, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(q.frames[0], 2, 0), [0, 255, 0, 255]);
});
test('Bresenham line includes both endpoints in every direction', () => {
  for (const [x, y, x2, y2] of [[0,0,3,3], [3,3,0,0], [0,3,3,0], [3,0,0,3]]) {
    const f = renderProject(make([{ op: 'line', x, y, x2, y2, color: 'r' }])).frames[0];
    assert.equal(f.data.filter((_, i) => i % 4 === 3 && f.data[i] === 255).length, 4);
    assert.equal(pixel(f, x, y)[3], 255); assert.equal(pixel(f, x2, y2)[3], 255);
  }
});
test('outlined ellipse has a transparent center; rectangles can be outlined', () => {
  const f = renderProject(make([{ op: 'ellipse', w: 4, h: 4, filled: false, color: 'g' }])).frames[0];
  assert.equal(pixel(f, 1, 1)[3], 0); assert.equal(pixel(f, 1, 0)[3], 255); assert.equal(pixel(f, 0, 0)[3], 0);
  const r = renderProject(make([{ op: 'rect', w: 4, h: 4, filled: false, color: 'g' }])).frames[0];
  assert.equal(pixel(r, 1, 1)[3], 0); assert.equal(pixel(r, 0, 0)[3], 255);
});
test('flood fill respects boundaries and fills the target region exactly', () => {
  const f = renderProject(make([{ op: 'line', x: 2, x2: 2, y2: 3, color: 'b' }, { op: 'fill', color: 'r' }])).frames[0];
  assert.deepEqual(pixel(f, 1, 3), [255, 0, 0, 255]);
  assert.deepEqual(pixel(f, 2, 3), [0, 0, 255, 255]);
  assert.deepEqual(pixel(f, 3, 3), [0, 0, 0, 0]);
});
test('clear erases alpha and replace matches the full RGBA value', () => {
  const f = renderProject(make([{ op: 'rect', w: 4, h: 4, color: 'r' }, { op: 'clear', w: 1, h: 1 }, { op: 'replace', from: 'r', to: '#00f8' }])).frames[0];
  assert.deepEqual(pixel(f, 0, 0), [0, 0, 0, 0]); assert.deepEqual(pixel(f, 1, 1), [0, 0, 255, 136]);
});
test('pixel, rect, ellipse, line and grid in transparent leave pixels as they are, as the quick start says; clear, fill and replace to transparent erase', async () => {
  const drawn = [{ op: 'pixel', color: 'transparent' }, { op: 'rect', w: 2, h: 2, color: 'transparent' }, { op: 'ellipse', w: 4, h: 4, color: 'transparent' }, { op: 'line', x2: 3, y2: 3, color: 'transparent' }, { op: 'grid', rows: ['z'] }];
  const erased = [{ op: 'clear', w: 1, h: 1 }, { op: 'fill', x: 0, y: 0, color: 'transparent' }, { op: 'replace', from: 'r', to: 'transparent' }];
  const after = op => pixel(renderProject(make([{ op: 'rect', w: 4, h: 4, color: 'r' }, op], { palette: { r: '#f00', z: 'transparent' } })).frames[0], 0, 0);
  for (const op of drawn) assert.deepEqual(after(op), [255, 0, 0, 255], op.op);
  for (const op of erased) assert.deepEqual(after(op), [0, 0, 0, 0], op.op);
  const quick = await readFile(new URL('../docs/agent-quick-start.md', import.meta.url), 'utf8');
  assert.match(quick, /as `transparent` does in shapes and grids; `clear` erases, as do `fill` and `replace` to `transparent`\./);
});
test('the palette keys . and space are refused with what they do instead', () => {
  for (const key of ['.', ' ']) assert.throws(() => renderProject(make([], { palette: { [key]: 'transparent' } })), { message: `project.palette.${key}: "." and space are reserved: in grid rows they leave the pixel alone and need no palette entry (a transparent colour is "transparent" under another key)` });
  assert.throws(() => renderProject(make([], { palette: { transparent: '#000' } })), /invalid or reserved palette name/);
});
test('layer opacity applies once after the layer is flattened', () => {
  const f = renderProject(make([{ op: 'rect', w: 4, h: 4, color: 'b' }], { frames: [{ name: 'a', ops: [{ op: 'rect', w: 4, h: 4, color: 'b' }], layers: [{ opacity: .5, ops: [{ op: 'pixel', color: 'r' }, { op: 'pixel', color: 'r' }] }] }] })).frames[0];
  assert.deepEqual(pixel(f, 0, 0), [128, 0, 128, 255]);
});
test('frame inheritance copies pixels without mutating the parent', () => {
  const frames = [{ name: 'a', ops: [{ op: 'pixel', color: 'r' }] }, { name: 'b', from: 'a', translate: [1, 1], ops: [{ op: 'pixel', color: 'b' }] }];
  const p = renderProject(make([], { frames }));
  assert.deepEqual(pixel(p.frames[0], 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(p.frames[1], 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(p.frames[1], 0, 0), [0, 0, 255, 255]);
});
test('animation direction preserves timings and avoids duplicate pingpong endpoints', () => {
  const frames = [{ name: 'a', duration: 50 }, { name: 'b', duration: 70 }, { name: 'c', duration: 100 }];
  const p = renderProject(make([], { frames, animations: { bounce: { frames: ['a','b','c'], direction: 'pingpong' }, backwards: { frames: ['a','c'], direction: 'reverse', loop: false } } }));
  assert.deepEqual(p.animations.bounce.frames, [0,1,2,1]); assert.equal(p.animations.bounce.duration, 290);
  assert.deepEqual(p.animations.backwards.frames, [2,0]); assert.equal(p.animations.backwards.loop, false);
});
test('atlas positions include scaled padding and no color interpolation', () => {
  const p = renderProject(make([], { width: 1, height: 1, frames: [{ name: 'a', ops: [{ op: 'pixel', color: 'r' }] }, { name: 'b', ops: [{ op: 'pixel', color: 'b' }] }], sheet: { columns: 1, padding: 1, scale: 2 } }));
  const atlas = buildAtlas(p);
  assert.equal(atlas.width, 6); assert.equal(atlas.height, 12);
  assert.deepEqual(atlas.metadata.frames.a.frame, { x: 2, y: 2, w: 2, h: 2 });
  assert.deepEqual(atlas.metadata.frames.b.frame, { x: 2, y: 8, w: 2, h: 2 });
  assert.deepEqual(pixel(atlas, 2, 8, 6), [0, 0, 255, 255]); assert.equal(pixel(atlas, 1, 8, 6)[3], 0);
});
test('clipping warns once, and invalid fill seeds are rejected', () => {
  assert.equal(renderProject(make([{ op: 'rect', x: -2, w: 4, h: 4, color: 'r' }])).warnings.length, 1);
  assert.throws(() => renderProject(make([{ op: 'fill', x: -1, color: 'r' }])), /fill seed/);
});
test('invalid references, duplicate names, typos and resource limits fail early', () => {
  for (const spec of [make([], { width: 1025, frames: [{ name: 'a' }, { name: 'b' }] }), make([], { width: 1024, height: 257, frames: [{ name: 'a' }, { name: 'b' }] }), make([], { width: 4097 }), make([], { width: 2049, height: 2049 }), make([], { frames: [{ name: 'a', from: 'later' }] }), make([], { frames: [{ name: 'a' }, { name: 'a' }] }), make([{ op: 'rect', w: 2, h: 2, color: 'r', widht: 3 }]), make([], { animations: { bad: { frames: ['absent'] } } }), make([], { sheet: { scale: 1.5 } }), make([], { sheet: { columns: 256, scale: 16 }, width: 256, height: 256 })]) assert.throws(() => renderProject(spec));
});
test('prototype-like palette keys are safe and are not inherited', () => {
  assert.throws(() => renderProject(make([{ op: 'pixel', color: 'toString' }])), /unknown color/);
  const p = renderProject(make([{ op: 'pixel', color: 'toString' }], { palette: { toString: '#f00' } }));
  assert.deepEqual(pixel(p.frames[0], 0, 0), [255, 0, 0, 255]);
});
test('integer scaling replicates pixels exactly', () => {
  assert.deepEqual([...scalePixels(new Uint8Array([1,2,3,4]), 1, 1, 2)], [1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4]);
});
test('portable output names reject devices, case collisions and null options', () => {
  for (const n of ['CON', 'nul', 'Lpt1']) assert.throws(() => renderProject(make([], { name: n })), /reserved filename/);
  assert.throws(() => renderProject(make([], { frames: [{ name: 'Idle' }, { name: 'idle' }] })), /ignoring case/);
  assert.throws(() => renderProject(make([], { animations: { Idle: { frames: ['a'] }, idle: { frames: ['a'] } } })), /ignoring case/);
  assert.throws(() => renderProject(make([], { sheet: null })), /null is not supported/);
});
