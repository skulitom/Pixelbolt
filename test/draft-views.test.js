// Draft views: a small grid part turned to the angles an author asks for, by pixel-art rules (src/craft.js draftTurn),
// as rows to correct and paste into the part's `views`. The target is the hero's hand-drawn boot views.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { draftTurn } from '../src/craft.js';
import { draftViews, compilePoses } from '../src/authoring.js';
import { pictureSheet } from '../src/core.js';
import { decodePNG } from '../src/import.js';
import { startMCP } from '../src/mcp.js';
import { heroRig } from '../scripts/figure-rigs.mjs';
import { goldens } from '../scripts/goldens.mjs';

const golden = goldens(new URL('./goldens/drafts.json', import.meta.url));
const read = name => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const hero = read('hero.poses.json'), heroSword = read('hero-sword.poses.json'), courier = heroRig();
const cli = fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url));
const run = promisify(execFile);
const draft = (part, angle) => draftTurn(part.rows, angle, { anchor: part.anchor ?? [0, 0], points: part.points ?? {} });
const drawn = (rows, x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[0].length && rows[y][x] !== '.' && rows[y][x] !== ' ';
const keys = rows => new Set(rows.join('').replace(/[. ]/g, ''));
const count = rows => rows.join('').replace(/[. ]/g, '').length;
// Sides of a pixel of any colour but the outline that touch an empty pixel or the picture's edge.
const bare = (rows, outline) => { let n = 0; rows.forEach((row, y) => [...row].forEach((key, x) => { if (drawn(rows, x, y) && key !== outline) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (!drawn(rows, x + dx, y + dy)) n++; })); return n; };
const angles = Array.from({ length: 72 }, (_, i) => i * 5);
const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-drafts-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};

test('a boot slides its columns along a clean slope: the hero\'s hand-drawn 30° and 330° views are its drafts at 15° and 345°', () => {
  for (const name of ['boot', 'farBoot']) {
    const part = hero.parts[name];
    for (const [angle, key] of [[15, 30], [345, 330]]) {
      const turned = draft(part, angle);
      assert.deepEqual({ rows: turned.rows, anchor: turned.anchor }, part.views[key], `${name} at ${angle}°`);
      assert.equal(turned.how, 'shear'); assert.equal(turned.slope, '1:4');
    }
    // At 30° and 330° the slope is 1:2, and the boot drops the column that repeats its neighbour so it keeps its length
    // along the slope: the drawn view's design, one column shorter.
    for (const angle of [30, 330]) {
      const turned = draft(part, angle), shorter = part.views[angle].rows.map(row => row.slice(0, 2) + row.slice(3));
      assert.deepEqual({ rows: turned.rows, anchor: turned.anchor, slope: turned.slope, shortened: turned.shortened }, { rows: shorter, anchor: [1, 1], slope: '1:2', shortened: 1 }, `${name} at ${angle}°`);
    }
  }
});

test('drafts invent no colours, keep a boot\'s and a blade\'s outline closed, and carry points onto the pixels under them', () => {
  const parts = [['hero', hero.parts], ['hero-sword', { sword: heroSword.parts.sword }], ['courier', { head: courier.parts.head, sword: courier.parts.sword }]];
  for (const [figure, defined] of parts) for (const [name, part] of Object.entries(defined).filter(([, part]) => part.rows)) for (const angle of angles) {
    const turned = draft(part, angle), at = `${figure} ${name} at ${angle}°`;
    for (const key of keys(turned.rows)) assert.ok(keys(part.rows).has(key), `${at} draws ${key}, which the part does not`);
    assert.ok(turned.rows.every(row => row.length === turned.rows[0].length), at);
    for (const [point, [x, y]] of Object.entries(part.points ?? {})) if (drawn(part.rows, x, y)) assert.ok(drawn(turned.rows, ...turned.points[point]), `${at}: point ${point} lands off the picture`);
  }
  // Shears move whole columns, so a pixel is bared only where its neighbour slid away; the outline colour closes it.
  for (const part of [hero.parts.boot, hero.parts.farBoot, heroSword.parts.sword]) for (const angle of angles) {
    const turned = draft(part, angle);
    if (turned.how === 'cover') continue;
    assert.ok(bare(turned.rows, 'k') <= bare(part.rows, 'k'), `${part.rows[0]} at ${angle}°: ${bare(turned.rows, 'k')} bare sides, flat ${bare(part.rows, 'k')}\n${turned.rows.join('\n')}`);
  }
  // The hero's sword tip stays on the blade's end, which the shear moves along the slope.
  assert.deepEqual(draft(heroSword.parts.sword, 30).points, {});
  const tipped = { ...heroSword.parts.sword, points: { tip: [12, 3] } };
  for (const angle of [15, 30, 45, 330]) { const { rows, points: { tip } } = draft(tipped, angle); assert.equal(rows[tip[1]][tip[0]], 'k', `${angle}°`); }
});

test('a point on a repeated column that the draft drops moves to the kept column beside it, toward the anchor', () => {
  // A bare blade whose tip is on its last column, which repeats the one before it: at 30° the drawing is 9 × 5 and
  // ends at (8, 4); at 45°, 7 × 7 ending at (6, 6). A point one past the tip stays one step past it along the slope.
  const blade = ['wwwwwwwwww'], turn = (angle, points) => draftTurn(blade, angle, { anchor: [0, 0], points });
  assert.deepEqual(turn(30, { tip: [9, 0] }).points.tip, [8, 4]);
  assert.deepEqual(turn(45, { tip: [9, 0], past: [10, 0] }).points, { tip: [6, 6], past: [7, 7] });
  // Every pixel as a point, of blades anchored at either end, in the middle and off the drawing, wide and tall, at
  // every whole degree: each lands on a drawn pixel of its own colour.
  const parts = [[blade, [0, 0]], [blade, [9, 0]], [blade, [4, 0]], [blade, [-3, 0]], [blade.join('').split(''), [0, 9]], [['wwwwwwwwwww', 'gggggggggga'], [0, 1]]];
  for (const [rows, anchor] of parts) for (let angle = 0; angle < 360; angle++) {
    const points = Object.fromEntries(rows.flatMap((row, y) => [...row].map((_, x) => [`p${x}-${y}`, [x, y]])));
    const turned = draftTurn(rows, angle, { anchor, points });
    for (const [name, [x, y]] of Object.entries(points)) {
      const [px, py] = turned.points[name];
      assert.ok(drawn(turned.rows, px, py) && turned.rows[py][px] === rows[y][x], `${rows[0]} anchored at ${anchor} at ${angle}°: ${name} lands at ${px},${py}\n${turned.rows.join('\n')}`);
    }
  }
});

test('quarter turns are exact, a flat angle is the drawing itself and a turn under 5° draws nothing new', () => {
  const part = courier.parts.sword;
  assert.deepEqual(draft(part, 0), { rows: part.rows, anchor: part.anchor, points: part.points, how: 'flat' });
  assert.deepEqual(draft(part, 4), { rows: part.rows, anchor: part.anchor, points: part.points, how: 'flat' });
  // The courier's hand-drawn 90° view is the exact quarter turn, tip and all.
  assert.deepEqual(draft(part, 90), { ...part.views[90], how: 'quarter' });
  const half = draft(part, 180);
  assert.deepEqual(half.rows, part.rows.map(row => [...row].reverse().join('')).reverse());
  assert.deepEqual(half.points.tip, [part.rows[0].length - 1 - part.points.tip[0], part.rows.length - 1 - part.points.tip[1]]);
  assert.deepEqual(draft(part, 272).rows, draft(part, 270).rows);
});

test('a compact part keeps its area and its features: the hero\'s hands stay round and the face keeps one cheek pixel', () => {
  for (const name of ['hand', 'farHand']) for (const angle of [15, 30, 330, 345]) {
    const turned = draft(hero.parts[name], angle);
    assert.equal(turned.how, 'cover');
    assert.deepEqual(turned.rows, hero.parts[name].rows, `${name} at ${angle}°`);
  }
  for (const angle of angles) {
    const turned = draft(hero.parts.head, angle);
    assert.ok(Math.abs(count(turned.rows) - count(hero.parts.head.rows)) <= 2, `head at ${angle}°`);
    // x is one pixel none of its neighbours share; it is drawn once, wherever the head turns it.
    assert.equal(turned.rows.join('').split('x').length - 1, 1, `head at ${angle}°`);
    const scarf = draft(hero.parts.scarf, angle);
    assert.ok(Math.abs(count(scarf.rows) - count(hero.parts.scarf.rows)) <= 2, `scarf at ${angle}°`);
  }
});

golden.test('the drafts of the hero\'s and the courier\'s grid parts stay as reviewed', () => {
  // Every 15°, hashed per part. A deliberate change to draftTurn moves them: node scripts/goldens.mjs drafts draws
  // each part's drafts before and after, then --write takes the new ones.
  const parts = { boot: hero.parts.boot, farBoot: hero.parts.farBoot, hand: hero.parts.hand, head: hero.parts.head, scarf: hero.parts.scarf,
    sword: heroSword.parts.sword, courierSword: courier.parts.sword, courierHead: courier.parts.head };
  const palettes = { courierSword: courier.palette, courierHead: courier.palette };
  for (const [name, part] of Object.entries(parts)) {
    const drafts = angles.filter(angle => angle % 15 === 0).map(angle => [angle, draft(part, angle)]);
    const palette = palettes[name] ?? heroSword.palette;
    golden.equal(name, createHash('sha256').update(JSON.stringify(drafts)).digest('hex'), { frames: () => drafts.map(([angle, { rows }]) => {
      const width = rows[0].length, height = rows.length, data = new Uint8Array(width * height * 4);
      rows.forEach((row, y) => [...row].forEach((key, x) => { const hex = palette[key]; if (hex) data.set([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(255), (y * width + x) * 4); }));
      return { name: `${name} ${angle}`, width, height, data };
    }) });
  }
});

test('draft views come back as source to paste: the compiler then draws them as the part\'s views, attachments and all', () => {
  const source = { format: 'pixelforge-poses', version: 1, name: 'blade', width: 24, height: 24, palette: { k: '#111', s: '#ccd', g: '#da3' },
    parts: { blade: { rows: ['.k.......', 'kgkkkkkkk', 'kgssssssk', 'kgkkkkkkk', '.k.......'], anchor: [1, 2], points: { tip: [8, 2] } }, gem: { rows: ['g'] } },
    poses: [{ name: 'swing', origin: [6, 6], parts: [{ name: 'blade', part: 'blade', rotate: 30 }, { name: 'gem', part: 'gem', attach: { part: 'blade', point: 'tip' } }] }] };
  const { drafts, sheet } = draftViews(source, { blade: [30, 330] });
  assert.deepEqual(Object.keys(drafts.blade.views), ['30', '330']);
  assert.match(drafts.blade.notes[30], /1:2 slope/);
  assert.ok(sheet.width > 0 && sheet.height > 0 && sheet.data.length === sheet.width * sheet.height * 4);
  // Turned today (no views) the blade is rotated by the compiler; pasted, the draft is drawn as it is.
  const before = compilePoses(source).recipe, after = compilePoses({ ...source, parts: { ...source.parts, blade: { ...source.parts.blade, views: drafts.blade.views } } }).recipe;
  assert.equal(before.frames[0].layers[0].ops[0].symbol, 'blade-r30');
  assert.equal(after.frames[0].layers[0].ops[0].symbol, 'blade-v30');
  assert.deepEqual(after.symbols['blade-v30'], drafts.blade.views[30].rows);
  // The gem hangs on the drafted tip.
  const blade = after.frames[0].layers[0].ops[0], gem = after.frames[0].layers[1].ops[0], [tx, ty] = drafts.blade.views[30].points.tip;
  assert.deepEqual([gem.x, gem.y], [blade.x + tx, blade.y + ty]);
  // A view already drawn is named in the notes, and the sheet gains a column for it.
  const hero2 = draftViews(hero, { boot: [15, 90] });
  assert.match(hero2.drafts.boot.notes[15], /the compiler draws authored view 30 here/);
  assert.doesNotMatch(hero2.drafts.boot.notes[90], /authored/);
  assert.ok(hero2.sheet.width > draftViews(hero, { hand: [15, 90] }).sheet.width);
});

test('draft views refuse what they cannot draft, naming the part or angle', () => {
  const fails = (request, pattern, source = hero) => assert.throws(() => draftViews(source, request), pattern);
  fails({ boot: [30] }, /pixelforge-poses/, { ...hero, format: 'pixelforge-fx' });
  fails({}, /name grid parts/);
  fails({ shoe: [30] }, /draftViews\.shoe: no part named shoe; the source defines hips, chest/);
  fails({ thigh: [30] }, /bone part, which the compiler draws afresh/);
  fails({ boot: [360] }, /draftViews\.boot\[0\]: expected whole degrees from 0 to 359/);
  fails({ boot: [30, 30] }, /each angle once/);
  fails({ boot: Array.from({ length: 17 }, (_, i) => i) }, /1–16 angles/);
  fails({ boot: Array.from({ length: 16 }, (_, i) => i), hand: Array.from({ length: 16 }, (_, i) => i), head: [1] }, /at most 32 drafts/);
  fails({ big: [30] }, /at most 64×64 pixels; this one is 65×1/, { ...hero, parts: { big: { rows: ['k'.repeat(65)] } } });
  fails({ boot: [30] }, /poses\.parts\.boot\.rows\[1\]/, { ...hero, parts: { boot: { rows: ['kk', 'k'] } } });
});

// A part with an unfinished authored view, and one anchored far from its pixels (the compiler allows ±4096).
const unfinished = (views, parts = {}) => ({ format: 'pixelforge-poses', version: 1, name: 'drafting', width: 16, height: 16, palette: { k: '#111', c: '#ccd' },
  parts: { box: { rows: ['kkk', 'kck', 'kkk'], points: { tip: [2, 1] }, ...(views && { views }) }, reach: { rows: ['kkk', 'kck', 'kkk'], anchor: [-1400, 1] }, ...parts }, poses: [] });

test('an unfinished authored view at the angle is named in the draft\'s note and left off the sheet', () => {
  const plain = draftViews(unfinished(), { box: [30] });
  for (const [view, problem] of [[{ rows: ['kkk', 'kck', 'kkk'], points: { tip: [2, 1] } }, 'views.30.anchor: expected two integer coordinates'], [{ rows: 'kkk', anchor: [1, 1] }, 'views.30.rows: expected an array'],
    [{ rows: ['kkk', 'kc'], anchor: [1, 1], points: { tip: [2, 1] } }, 'views.30.rows[1]: all rows must be 3 characters wide'], [{ rows: ['kkk'], anchor: [1, 1] }, 'views.30.points.tip: expected two integer'], [null, 'views.30: expected an object']]) {
    const { drafts, sheet } = draftViews(unfinished({ 30: view }), { box: [30] });
    assert.deepEqual(drafts.box.views, plain.drafts.box.views);
    assert.ok(drafts.box.notes[30].includes(`authored view 30 would be drawn here but is unfinished (poses.parts.box.${problem}`), drafts.box.notes[30]);
    assert.deepEqual([sheet.width, sheet.height], [plain.sheet.width, plain.sheet.height]);
  }
  // Finished, it is drawn beside the draft; a view keyed as no angle is not a view.
  const finished = draftViews(unfinished({ 30: { rows: ['kkk', 'kck', 'kkk'], anchor: [1, 1], points: { tip: [2, 1] } }, east: { rows: 'k' } }), { box: [30] });
  assert.match(finished.drafts.box.notes[30], /the compiler draws authored view 30 here$/);
  assert.ok(finished.sheet.width > plain.sheet.width);
});

test('a sheet too large to draw leaves the drafts to come back alone, and points count in each cell\'s size', () => {
  const source = unfinished(), alone = draftViews(source, { reach: [30] }, { sheet: false });
  assert.deepEqual(Object.keys(alone), ['drafts']);
  assert.deepEqual(alone.drafts.reach.views[30].rows, ['kkk', 'kck', 'kkk']);
  const { drafts, sheet, noSheet } = draftViews(source, { reach: [30] });
  assert.deepEqual([drafts, sheet], [alone.drafts, null]);
  assert.match(noSheet, /^the picture sheet would be 4278×\d+ pixels, above the 4096-pixel limit; .*an anchor or point far from its pixels/);
  // A point off the picture gets its whole ring inside its own cell, not clipped or drawn over the next cell.
  const ringPixels = image => { let n = 0; for (let i = 0; i < image.data.length; i += 4) if (image.data[i] === 64 && image.data[i + 1] === 224 && image.data[i + 2] === 255) n++; return n; };
  const marked = pictureSheet({ palette: { k: '#111' }, rows: [{ label: 'far', cells: [{ rows: ['k'], anchor: [0, 0], points: { right: [6, 0], above: [0, -3] } }, { rows: ['k'], anchor: [0, 0] }] }], scale: 4 });
  assert.equal(ringPixels(marked), 2 * (4 * marked.scale + 4));
  // Labels the font cannot draw show ? instead of failing.
  const label = text => pictureSheet({ palette: { k: '#111' }, rows: [{ label: text, cells: [{ rows: ['k'], anchor: [0, 0] }] }] }).data;
  assert.deepEqual(label('tip·足'), label('tip·?'));
});

test('compile --draft-views prints drafts, writes only the files named, and never touches the source', async t => {
  const dir = await temp(t), source = path.join(dir, 'hero.poses.json'), text = JSON.stringify(hero);
  await writeFile(source, text);
  const printed = JSON.parse((await run(process.execPath, [cli, 'compile', source, '--draft-views', 'boot:15,345,hand:30'])).stdout);
  assert.deepEqual(printed.drafts.boot.views[15], hero.parts.boot.views[30]);
  assert.deepEqual(printed.drafts.hand.views[30].rows, hero.parts.hand.rows);
  assert.match(printed.next, /Drafts, not art/); assert.match(printed.hint, /--preview/);
  const out = path.join(dir, 'drafts.json'), preview = path.join(dir, 'drafts.png');
  const saved = JSON.parse((await run(process.execPath, [cli, 'compile', source, '--draft-views', 'farBoot:345', '--out', out, '--preview', preview])).stdout);
  assert.deepEqual(saved.parts, ['farBoot']);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')).drafts.farBoot.views[345], hero.parts.farBoot.views[330]);
  const image = decodePNG(await readFile(preview));
  assert.ok(image.width > 100 && image.height > 30);
  assert.equal(await readFile(source, 'utf8'), text);
  // Existing files are kept unless --force, and the flag's form is checked.
  await assert.rejects(run(process.execPath, [cli, 'compile', source, '--draft-views', 'farBoot:345', '--preview', preview]), /Output already exists/);
  await assert.rejects(run(process.execPath, [cli, 'compile', source, '--draft-views', '30,boot']), /expects part:angle,angle such as boot:30,330/);
  await assert.rejects(run(process.execPath, [cli, 'compile', source, '--draft-views', 'boot:30', '--metadata', out]), /--metadata cannot be combined with --draft-views/);
  // A preset works as its file does.
  assert.deepEqual(JSON.parse((await run(process.execPath, [cli, 'compile', '--preset', 'hero', '--draft-views', 'boot:345'])).stdout).drafts.boot.views[345], hero.parts.boot.views[330]);
  // The sheet is drawn only for --preview: a part anchored far away and an unfinished view still draft, and a
  // preview too large to draw is not written, saying why.
  const drafting = path.join(dir, 'drafting.poses.json'), far = path.join(dir, 'far.png');
  await writeFile(drafting, JSON.stringify(unfinished({ 30: { rows: ['kkk', 'kck', 'kkk'] } })));
  const printedDrafts = JSON.parse((await run(process.execPath, [cli, 'compile', drafting, '--draft-views', 'box:30,reach:30'])).stdout);
  assert.deepEqual(Object.keys(printedDrafts.drafts), ['box', 'reach']);
  assert.match(printedDrafts.drafts.box.notes[30], /unfinished \(poses\.parts\.box\.views\.30\.anchor: /);
  const unshown = JSON.parse((await run(process.execPath, [cli, 'compile', drafting, '--draft-views', 'reach:30', '--preview', far])).stdout);
  assert.deepEqual(unshown.drafts, { reach: printedDrafts.drafts.reach });
  assert.match(unshown.preview, /^not written: the picture sheet would be 4278×\d+ pixels/);
  await assert.rejects(readFile(far), { code: 'ENOENT' });
});

test('pixel_compile with draftViews returns the drafts and their sheet instead of compiling', async t => {
  const directory = await temp(t), input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ directory, root: directory, input, output });
  t.after(async () => { input.end(); await running; });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const call = async args => (await request('tools/call', { name: 'pixel_compile', arguments: args })).result;
  const result = await call({ preset: 'hero', draftViews: { boot: [15], head: [345] } }), info = JSON.parse(result.content[0].text);
  assert.deepEqual(info.drafts.boot.views[15], hero.parts.boot.views[30]);
  assert.equal(info.revision, undefined);
  assert.equal(result.content[1].type, 'image');
  assert.ok(decodePNG(Buffer.from(result.content[1].data, 'base64')).width > 100);
  // A sheet too large to draw is left out, saying why, and the drafts still come back.
  const far = await call({ source: unfinished(), draftViews: { reach: [30] } }), farInfo = JSON.parse(far.content[0].text);
  assert.deepEqual([far.isError, far.content.length, farInfo.drafts.reach.views[30].rows], [undefined, 1, ['kkk', 'kck', 'kkk']]);
  assert.match(farInfo.sheet, /^not drawn: the picture sheet would be 4278×\d+ pixels/);
  const refused = await call({ preset: 'smoke-puff', draftViews: { boot: [15] } });
  assert.equal(refused.isError, true);
  assert.match(JSON.parse(refused.content[0].text).error, /pixelforge-poses source/);
});
