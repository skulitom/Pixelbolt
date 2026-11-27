import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { layoutText, measureText, hasGlyph, FONT_CHARACTERS, FONT_HEIGHT, FONT_CAP_HEIGHT } from '../src/font.js';
import { STUDIO_PATHS } from '../src/server.js';
import { createSceneBundle } from '../src/scene-export.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// The CJK unified ideographs' block, where the font's ideographs are.
const isIdeograph = character => character.codePointAt(0) >= 0x4E00 && character.codePointAt(0) <= 0x9FFF;
// Renders one frame of ops on a w × h canvas and returns it as rows of "#" (drawn) and "." (empty).
const draw = (w, h, ops, extra = {}) => {
  const project = renderProject({ version: 1, name: 'probe', width: w, height: h, palette: { k: '#000000', w: '#ffffff' }, frames: [{ name: 'a', ops }], ...extra }), { data } = project.frames[0];
  return { project, rows: Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => data[(y * w + x) * 4 + 3] ? '#' : '.').join('')) };
};

test('the built-in font covers ASCII, western European, Cyrillic, Japanese Kana and ideographs, with tabular digits', () => {
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''), more = '¡¢£¥©«®°±·»¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿŒœŠšŸŽž–—‘’‚“”„•…‹›€';
  const latin = ascii + more;
  for (const ch of latin) assert.ok(FONT_CHARACTERS.includes(ch), `missing Latin char ${JSON.stringify(ch)}`);
  assert.deepEqual([FONT_HEIGHT, FONT_CAP_HEIGHT], [8, 7]);
  for (const character of FONT_CHARACTERS) {
    const { width, height, top, rows } = layoutText(character);
    // A line is 8 rows; a capital with an accent starts 2 rows higher, and an ideograph, in its 9×9 cell, one row
    // higher unless its top row is empty (一). Nothing else is wider than 8 pixels.
    const ideograph = isIdeograph(character);
    assert.ok(height === 8 - top && (top === 0 || top === (ideograph ? -1 : -2)) && rows.length === height && width >= 1 && width <= (ideograph ? 9 : 8) && rows.every(row => row.length === width), JSON.stringify(character));
    // Every glyph but spaces has ink, and non-digits are trimmed to ink on both sides.
    if (character === ' ') { assert.equal(width, 3); continue; }
    if (character === '\u3000') { assert.equal(width, 7); continue; }
    assert.ok(rows.some(row => row.includes('#')), `${character} is blank`);
    if (!/\d/.test(character) && !ideograph) assert.ok(rows.some(row => row[0] === '#') && rows.some(row => row.at(-1) === '#'), `${character} has an empty edge column`);
  }
  assert.deepEqual([...'0123456789'].map(digit => measureText(digit).width), Array(10).fill(5));
  // Capitals stand on the baseline (row 6); only descenders and the underscore use the row below it.
  for (const character of 'ABCXYZ0189') assert.equal(layoutText(character).rows[7].includes('#'), false, character);
  assert.deepEqual([...latin].filter(character => layoutText(character).rows.at(-1).includes('#')).join(''), ',;_gjpqyÇçýþÿ‚„');
  // Within Latin, accented capitals are the only glyphs reaching above cap height and five glyphs are wider than 5 px.
  assert.deepEqual([[...latin].filter(character => layoutText(character).top === -2).join(''), [...latin].filter(character => layoutText(character).width > 5).join('')], ['ÀÁÂÃÄÅÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŠŸŽ', '©®Œœ—']);
  // An accented letter is its base letter with a mark: below the mark, é is e and É is E.
  assert.deepEqual([layoutText('é').rows.slice(2), layoutText('É').rows.slice(2), layoutText('é').rows.slice(0, 2), layoutText('É').rows.slice(0, 2)], [layoutText('e').rows.slice(2), layoutText('E').rows, ['..#..', '.#...'], ['..#..', '.#...']]);
});
test('Cyrillic and Japanese Kana are drawn, and voiced kana differ from their base', () => {
  // Russian + Ukrainian Cyrillic
  for (const sample of ['Привет мир!', 'Ёжик №1 — 500₽', 'Київ Є Ї Ґ']) {
    const out = layoutText(sample);
    assert.ok(out.width > 0 && out.rows.some(row => row.includes('#')), sample);
  }
  assert.equal(layoutText('Ё').top, -2);
  assert.equal(layoutText('Й').top, -2);
  // Hiragana, Katakana and their voiced and half-voiced forms stay on the Latin rows.
  for (const sample of ['あいうえお がぎぐげご ぱぴぷぺぽ', 'ピクセルボルト！', '「ようこそ！」']) {
    const out = layoutText(sample);
    assert.ok(out.width > 0 && out.top === 0 && out.rows.some(row => row.includes('#')), sample);
  }
  assert.notDeepEqual(layoutText('か').rows, layoutText('が').rows);
  assert.notDeepEqual(layoutText('は').rows, layoutText('ぱ').rows);
  assert.equal(hasGlyph('😀'), false);
});
// The Hangul syllable of an initial, a vowel and a final (0 for none), by their places in the code chart.
const syllable = (initial, vowel, final = 0) => String.fromCodePoint(0xAC00 + (initial * 21 + vowel) * 28 + final);
const cells = character => layoutText(character).rows.join('');
const apart = (a, b) => { let count = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++; return count; };
test('every Hangul syllable is a picture of its own in a 9×9 cell', () => {
  const seen = new Map();
  for (let code = 0xAC00; code <= 0xD7A3; code++) {
    const character = String.fromCodePoint(code), { width, height, top, rows } = layoutText(character), key = rows.join('|');
    if (width !== 9 || height !== 9 || top !== -1) assert.fail(`${character} is ${width}×${height} from row ${top}`);
    // 1,148 syllables were once drawn as another: two finals shared a shape, and ㄲ and ㅍ did over a compound vowel.
    if (seen.has(key)) assert.fail(`${character} is drawn as ${seen.get(key)} is`);
    seen.set(key, character);
  }
  assert.equal(seen.size, 11172);
  assert.deepEqual([hasGlyph('가'), hasGlyph('힣'), hasGlyph('힤')], [true, true, false]);
  // 꽝 and 퐝, and 갊 and 갎, were pairs drawn alike.
  assert.ok(apart(cells('꽝'), cells('퐝')) >= 6 && apart(cells('갊'), cells('갎')) >= 2);
  // What they look like: an upright vowel beside the initial (한), a flat one under it (를), both (왜), and ㅜ moved
  // up against the initial where its tick would run into the final (국).
  assert.deepEqual(layoutText('한').rows, ['#####.#..', '......#..', '.###..###', '#...#.#..', '.###..#..', '.........', '.#.......', '.#.......', '.#######.']);
  assert.deepEqual(layoutText('를').rows, ['..######.', '....#....', '.######..', '.........', '#########', '.........', '..######.', '....#....', '.######..']);
  assert.deepEqual(layoutText('왜').rows, ['.###..#.#', '#...#.#.#', '#...#.#.#', '#...#.#.#', '.###..###', '......#.#', '..#...#.#', '..#...#.#', '#####.#.#']);
  assert.deepEqual(layoutText('국').rows, ['.#######.', '.......#.', '.......#.', '#########', '....#....', '.........', '.#######.', '.......#.', '.......#.']);
  // Combining jamo compose to the same syllable.
  assert.deepEqual(layoutText('한').rows, layoutText('한').rows);
  // A line of Hangul starts one row above the capitals of a Latin line and ends on its descender row.
  assert.deepEqual([measureText('한글'), measureText('Ab 한').top, measureText('a\n한').top], [{ width: 19, height: 9, top: -1, lines: [{ text: '한글', width: 19 }] }, -1, 0]);
});
test('Hangul syllables that differ in one part differ by more than a stray pixel', () => {
  // The closest two of a row of syllables that differ only in the part being varied.
  const closest = row => {
    let least = Infinity, pair = '';
    for (let i = 0; i < row.length; i++) for (let j = i + 1; j < row.length; j++) { const d = apart(cells(row[i]), cells(row[j])); if (d < least) [least, pair] = [d, row[i] + row[j]]; }
    return { least, pair };
  };
  const initials = Array.from({ length: 19 }, (_, i) => i), vowels = Array.from({ length: 21 }, (_, i) => i), finals = Array.from({ length: 28 }, (_, i) => i);
  // Initials, in each box an initial is drawn in: beside ㅏ, over ㅗ, over ㅘ, each with and without a final, and
  // over ㅜ with a final under its tick.
  for (const [vowel, final] of [[0, 0], [0, 4], [8, 0], [8, 4], [9, 0], [9, 4], [13, 1]]) {
    const { least, pair } = closest(initials.map(initial => syllable(initial, vowel, final)));
    assert.ok(least >= 2, `${pair} differ by ${least}`);
  }
  // Finals, under each kind of vowel.
  for (const vowel of [0, 8, 13, 14]) {
    const { least, pair } = closest(finals.map(final => syllable(11, vowel, final)));
    assert.ok(least >= 2, `${pair} differ by ${least}`);
  }
  // Vowels. With no final every pair is two pixels apart or more. With one, a flat vowel's tick is a single pixel
  // (온 and 은), the least a 9-row cell leaves it; nothing else is that close.
  assert.ok(closest(vowels.map(vowel => syllable(11, vowel))).least >= 2);
  for (const final of [1, 4, 8, 16, 21]) for (const initial of [0, 6, 11]) {
    const row = vowels.map(vowel => syllable(initial, vowel, final));
    for (let i = 0; i < row.length; i++) for (let j = i + 1; j < row.length; j++) {
      const flat = v => [8, 12, 13, 17, 18].includes(v) ? 'flat' : [9, 10, 11, 14, 15, 16, 19].includes(v) ? 'compound' : 'upright';
      const d = apart(cells(row[i]), cells(row[j]));
      assert.ok(d >= 2 || (d === 1 && flat(i) === flat(j) && flat(i) !== 'upright'), `${row[i]}${row[j]} differ by ${d}`);
    }
  }
  // 운 is not 은 plus a pixel: where the final leaves room, the tick under the bar is two rows long.
  assert.equal(apart(cells('운'), cells('은')), 2);
});
test('ideographs are 9×9 drawings of their own, with room left inside them', () => {
  const ideographs = [...FONT_CHARACTERS].filter(isIdeograph), seen = new Map();
  assert.ok(ideographs.length >= 150, `${ideographs.length} ideographs`);
  for (const character of ideographs) {
    const { width, height, top, rows } = layoutText(character), drawn = (top ? '' : '.........') + rows.join(''), ink = drawn.split('#').length - 1;
    // The cell starts one row above the capitals; a drawing whose top row is empty (一, 三) starts with them.
    assert.ok(width === 9 && height === 8 - top && (top === -1 || top === 0) && hasGlyph(character), character);
    // A drawing with much over half its cell inked is a blob, not strokes: the densest is a box round something (国).
    assert.ok(ink >= 9 && ink <= 50, `${character} has ${ink} of 81 pixels inked`);
    for (const [other, cellsOf] of seen) if (apart(cellsOf, drawn) < 2) assert.fail(`${character} and ${other} differ by less than two pixels`);
    seen.set(character, drawn);
  }
  // Two as drawn, and the dot that makes 氷 of 水.
  assert.deepEqual(layoutText('日').rows, ['.#######.', '.#.....#.', '.#.....#.', '.#.....#.', '.#######.', '.#.....#.', '.#.....#.', '.#.....#.', '.#######.']);
  assert.deepEqual(layoutText('木').rows, ['....#....', '....#....', '#########', '....#....', '...###...', '..#.#.#..', '.#..#..#.', '#...#...#', '....#....']);
  assert.equal(apart(cells('水'), cells('氷')), 2);
  // Kana stay 7 rows on the Latin rows, so a line of kana and ideographs is one row taller than a line of kana.
  assert.deepEqual([measureText('ひ').top, measureText('日本のテキスト').top, measureText('火と水').height], [0, -1, 9]);
  // An ideograph the font does not draw is an error that says how many it does.
  assert.equal(hasGlyph('你'), false);
  assert.throws(() => layoutText('你好'), new RegExp(`no glyph for "你".*${ideographs.length} ideographs of game menus`));
  assert.throws(() => renderProject({ version: 1, name: 'probe', width: 32, height: 16, palette: { k: '#000000' }, frames: [{ name: 'a', ops: [{ op: 'text', x: 0, y: 2, text: '你好', color: 'k' }] }] }), error => error instanceof PixelError && /no glyph/.test(error.message));
});
test('text is laid out with glyph spacing, line height and alignment', () => {
  assert.deepEqual(layoutText('i.').rows, ['.#...', '.....', '##...', '.#...', '.#...', '.#...', '###.#', '.....']);
  assert.deepEqual(measureText('Hi'), { width: 9, height: 8, top: 0, lines: [{ text: 'Hi', width: 9 }] });
  assert.deepEqual(measureText('A\nBB'), { width: 11, height: 18, top: 0, lines: [{ text: 'A', width: 5 }, { text: 'BB', width: 11 }] });
  // An accented capital on the first line makes the block start two rows above that line's capitals. On a later
  // line the accent sits in the gap between lines, unless the lines are closer than two rows.
  assert.deepEqual([measureText('École'), measureText('a\nÉ'), measureText('é').top, measureText('a\nÉ', { lineHeight: 1 }).top], [{ width: 27, height: 10, top: -2, lines: [{ text: 'École', width: 27 }] }, { width: 5, height: 18, top: 0, lines: [{ text: 'a', width: 5 }, { text: 'É', width: 5 }] }, 0, -1]);
  assert.deepEqual(layoutText('a\nÉ').rows.slice(8, 11), ['..#..', '.#...', '#####']);
  // A letter followed by a combining accent is the same as the composed letter.
  assert.deepEqual(layoutText('cafe\u0301').rows, layoutText('café').rows);
  assert.deepEqual([measureText('AB', { spacing: 0 }).width, measureText('AB', { spacing: 4 }).width, measureText('A\nB', { lineHeight: 20 }).height, measureText('a b').width], [10, 14, 28, 15]);
  // A shorter line sits left, in the middle or right of the block.
  const first = align => layoutText('.\nAAA', { align }).rows[6];
  assert.deepEqual([first('left'), first('center'), first('right')], ['#................', '........#........', '................#']);
  assert.deepEqual(measureText('\n'), { width: 1, height: 18, top: 0, lines: [{ text: '', width: 0 }, { text: '', width: 0 }] });
  assert.throws(() => layoutText('😀'), /no glyph for "😀"/);
});
test('the text operation draws exact glyph pixels, placed by align and changed by the usual transforms', () => {
  // "i." at 1,1: a three-wide i, one pixel of spacing, and a full stop on the baseline.
  assert.deepEqual(draw(7, 10, [{ op: 'text', x: 1, y: 1, text: 'i.', color: 'w' }]).rows, ['.......', '..#....', '.......', '.##....', '..#....', '..#....', '..#....', '.###.#.', '.......', '.......']);
  // x is the left edge, the centre or the right edge of the block. "II" is 7 wide: 3 + 1 + 3.
  const top = align => draw(20, 8, [{ op: 'text', x: 10, y: 0, text: 'II', color: 'w', ...(align && { align }) }]).rows[0];
  assert.deepEqual([top(), top('center'), top('right')], ['..........###.###...', '.......###.###......', '...###.###..........']);
  // Scale enlarges every glyph pixel; rotation and flips work as for grids.
  assert.deepEqual(draw(4, 16, [{ op: 'text', x: 0, y: 0, text: '!', color: 'w', scale: 2 }]).rows.map(row => row.slice(0, 2)), ['##', '##', '##', '##', '##', '##', '##', '##', '##', '##', '..', '..', '##', '##', '..', '..']);
  assert.deepEqual(draw(8, 2, [{ op: 'text', x: 0, y: 0, text: '!', color: 'w', rotate: 90 }]).rows, ['.#.#####', '........']);
  assert.deepEqual(draw(5, 8, [{ op: 'text', x: 0, y: 0, text: 'L', color: 'w', flipX: true }]).rows.slice(5, 7), ['....#', '#####']);
  // Colours come from the palette or a hex value; layers and several lines work like any other drawing.
  const { project, rows } = draw(11, 18, [], { frames: [{ name: 'a', layers: [{ name: 'label', ops: [{ op: 'text', x: 0, y: 0, text: 'A\nBB', color: '#ff000080' }] }] }] });
  assert.deepEqual([rows[0], rows[10], [...project.frames[0].data.subarray(4, 8)]], ['.###.......', '####..####.', [255, 0, 0, 128]]);
  // y is the top of the capitals: the accent of a capital is drawn in the two rows above it, and is clipped and
  // reported like any other overhang when y leaves it no room.
  assert.deepEqual(draw(5, 10, [{ op: 'text', x: 0, y: 2, text: 'É', color: 'w' }]).rows.slice(0, 4), ['..#..', '.#...', '#####', '#....']);
  assert.deepEqual([draw(5, 8, [{ op: 'text', x: 0, y: 0, text: 'É', color: 'w' }]).project.clipping, draw(5, 8, [{ op: 'text', x: 0, y: 0, text: 'é', color: 'w' }]).project.clipping], [[{ path: 'project.frames[0].ops[0]', pixels: 2 }], undefined]);
  assert.deepEqual(draw(10, 20, [{ op: 'text', x: 0, y: 4, text: 'É', color: 'w', scale: 2 }]).rows.slice(0, 5).map(row => row.slice(0, 10)), ['....##....', '....##....', '..##......', '..##......', '##########']);
  // Text that runs off the canvas is clipped and reported at its operation, like every other overhang.
  assert.deepEqual(draw(6, 8, [{ op: 'text', x: 0, y: 0, text: 'WW', color: 'w' }]).project.clipping.map(entry => entry.path), ['project.frames[0].ops[0]']);
});
test('an accent on the first line never moves the letters, however the text is rotated, flipped or aligned', () => {
  // The accent rows used to move the whole block up even when rotation or a vertical flip put them below or beside the
  // letters, so turning CAFE into CAFÉ moved a rotated sign by 2 × scale pixels.
  const pixels = ops => new Set(draw(160, 160, ops).rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '#' ? [`${x},${y}`] : []))));
  for (const rotate of [0, 90, 180, 270]) for (const flipY of [false, true]) for (const flipX of [false, true]) for (const align of ['left', 'center', 'right']) for (const scale of [1, 2]) {
    const op = text => ({ op: 'text', x: 80, y: 80, color: 'k', text, rotate, flipX, flipY, align, scale });
    const label = JSON.stringify({ rotate, flipY, flipX, align, scale });
    for (const [plain, accented] of [['CAFE', 'CAFÉ'], ['E\nE', 'É\nE']]) {
      const before = pixels([op(plain)]), after = pixels([op(accented)]);
      assert.ok([...before].every(at => after.has(at)), `${label} ${plain}: the letters moved`);
      assert.ok(after.size > before.size, `${label} ${plain}: no accent drawn`);
    }
  }
});
test('text errors name the field and the character', () => {
  for (const [op, where, message] of [
    [{ text: 'hi 😀', color: 'w' }, 'text', /no glyph for "😀"; the built-in font draws printable ASCII, western European accented letters, Cyrillic, Japanese Kana, Korean Hangul/], [{ text: '', color: 'w' }, 'text', /1–512 characters/], [{ text: 'x'.repeat(513), color: 'w' }, 'text', /1–512 characters/],
    [{ text: 7, color: 'w' }, 'text', /1–512 characters/], [{ text: 'a\n'.repeat(64), color: 'w' }, 'text', /at most 64 lines/], [{ text: 'a', color: 'w', align: 'middle' }, 'align', /left, center or right/],
    [{ text: 'a', color: 'w', spacing: 17 }, 'spacing', /0 to 16/], [{ text: 'a', color: 'w', lineHeight: 0 }, 'lineHeight', /1 to 64/], [{ text: 'a', color: 'nope' }, 'color', /unknown color/],
    [{ text: 'a' }, 'color', /palette name or hex/], [{ text: 'a', color: 'w', font: 'tiny' }, 'font', /unknown field/], [{ text: 'a', color: 'w', scale: 17 }, 'scale', /1 to 16/]
  ]) assert.throws(() => draw(8, 8, [{ op: 'text', x: 0, y: 0, ...op }]), error => error instanceof PixelError && error.path === `project.frames[0].ops[0].${where}` && message.test(error.message), `${where}: ${JSON.stringify(op).slice(0, 60)}`);
});
test('the schema describes the text operation the renderer accepts', async () => {
  // Only the recipe schema and the schemas that embed a recipe (scenes, normal sources) carry drawing operations.
  for (const file of ['schema.json', 'scene.schema.json', 'normals.schema.json']) {
    const text = JSON.parse(await readFile(path.join(root, file), 'utf8')).$defs.op.oneOf.find(op => op.properties.op.const === 'text');
    assert.deepEqual([Object.keys(text.properties).sort(), text.required, text.additionalProperties], [['align', 'color', 'flipX', 'flipY', 'ground', 'lineHeight', 'op', 'rotate', 'scale', 'spacing', 'text', 'x', 'y'], ['op', 'text', 'color'], false], file);
    assert.deepEqual([text.properties.text.maxLength, text.properties.align.enum, text.properties.spacing.maximum, text.properties.lineHeight.maximum], [512, ['left', 'center', 'right'], 16, 64], file);
  }
});
test('every module the browser imports is served by the studio and packed with scene exports', async () => {
  // The renderer gained a module for the font; a page that imports the renderer needs that module too.
  const imports = async file => [...(await readFile(path.join(root, file), 'utf8')).matchAll(/^import [^;]*? from '([^']+)';/gm)].map(match => match[1]);
  const served = { '/core.js': 'src/core.js', '/craft.js': 'src/craft.js', '/font.js': 'src/font.js', '/gif.js': 'src/gif.js', '/authoring.js': 'src/authoring.js', '/autotile.js': 'src/autotile.js', '/scene.js': 'src/scene.js', '/studio.js': 'studio/studio.js', '/scene-player.js': 'studio/scene-player.js', '/draft.js': 'studio/draft.js', '/fluid.js': 'src/fluid.js', '/fluid-lab.js': 'studio/fluid-lab.js' };
  served['/pose-geometry.js'] = 'src/pose-geometry.js';
  served['/terrain.js'] = 'src/terrain.js';
  served['/motions.js'] = 'src/motions.js';
  served['/motion.js'] = 'src/motion.js';
  served['/fluid-controls.js'] = 'studio/fluid-controls.js';
  Object.assign(served, { '/fx.js': 'src/fx.js', '/shapes.js': 'src/shapes.js', '/wave.js': 'src/wave.js', '/effects-lab.js': 'studio/effects-lab.js', '/effects-controls.js': 'studio/effects-controls.js' });
  Object.assign(served, { '/powder.js': 'src/powder.js', '/powder-lab.js': 'studio/powder-lab.js', '/powder-controls.js': 'studio/powder-controls.js' });
  for (const route of Object.keys(served)) assert.ok(STUDIO_PATHS.includes(route), `${route} is not served`);
  // Every module those import, and everything that imports in turn (bodies.js brought territory.js, which the labs then
  // failed to load), is served too.
  const queue = Object.values(served), seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift();
    for (const specifier of await imports(file)) {
      assert.ok(STUDIO_PATHS.includes(`/${path.posix.basename(specifier)}`), `${file} imports ${specifier}, which the studio does not serve`);
      // The studio serves src/ and studio/ side by side at its root, so a page's './core.js' is src/core.js.
      const name = path.posix.basename(specifier), next = existsSync(path.join(root, 'src', name)) ? `src/${name}` : `studio/${name}`;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  const scene = JSON.parse(await readFile(path.join(root, 'examples', 'quality', 'stride.scene.json'), 'utf8')), { files } = await createSceneBundle(scene);
  for (const file of [...files.keys()].filter(name => name.endsWith('.js'))) for (const [, specifier] of files.get(file).toString().matchAll(/^[ \t]*(?:import|export)[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/gm)) assert.ok(files.has(path.posix.join(path.posix.dirname(file), specifier)), `the scene bundle's ${file} imports ${specifier}, which is not in the bundle`);
});
