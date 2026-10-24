import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { PLAYGROUND_URL, LINK_LIMIT, RECIPE_LIMIT, ShareError, recipeKind, shareLink, readShareLink, embedRecipe, readEmbeddedRecipe } from '../src/share.js';
import { resolveReferences } from '../src/resolve.js';
import { encodePNG } from '../src/png.js';
import { decodePNG } from '../src/import.js';

const recipe = { version: 1, name: 'share-test', width: 2, height: 1, frames: [{ name: 'still' }] };
const pixels = Uint8Array.of(1, 20, 255, 128, 255, 0, 3, 255);
const png = encodePNG(pixels, 2, 1);
const packed = text => deflateRawSync(text).toString('base64url');
const rejectsShare = (promise, message) => assert.rejects(promise, error => error instanceof ShareError && message.test(error.message));

test('share links preserve version and exact JSON for every accepted top-level example', async () => {
  const folder = new URL('../examples/', import.meta.url);
  let count = 0;
  for (const file of await readdir(folder)) {
    if (!file.endsWith('.json')) continue;
    const source = JSON.parse(await readFile(new URL(file, folder), 'utf8'));
    try { recipeKind(source); } catch { continue; }
    const { document } = await resolveReferences(source, { baseDir: fileURLToPath(folder) });
    const link = await shareLink(document, '0.9.0');
    assert.ok(link.startsWith(`${PLAYGROUND_URL}#v=0.9.0&r=`), file);
    const opened = await readShareLink(link);
    assert.equal(opened.version, '0.9.0', file);
    assert.equal(JSON.stringify(opened.recipe), JSON.stringify(document), file);
    count++;
  }
  assert.ok(count >= 20);
});

test('share links refuse the documented limit on both writing and reading', async () => {
  await rejectsShare(shareLink({ ...recipe, noise: randomBytes(20000).toString('base64') }, '0.9.0'), /16,384-character limit.*Download the recipe or a PNG/);
  await rejectsShare(readShareLink('x'.repeat(LINK_LIMIT + 1)), /16,384-character limit/);
});

for (const [label, fragment, message] of [
  ['no version', '#r=AA', /needs both v= and r=/],
  ['no recipe', '#v=0.9.0', /needs both v= and r=/],
  ['bad base64url', '#v=0.9.0&r=!', /not base64url/],
  ['bad deflate', '#v=0.9.0&r=AA', /does not unpack/],
  ['invalid JSON', `#v=0.9.0&r=${packed('{nope')}`, /not valid JSON/],
  ['old engine', `#v=0.8.9&r=${packed('{}')}`, /older than.*0.9.0/],
  ['non-semver engine', `#v=latest&r=${packed('{}')}`, /version must look like 0.9.0/]
]) test(`malformed share link: ${label}`, async () => { await rejectsShare(readShareLink(fragment), message); });

// Deliberately independent of share.js: a renamed keyword or changed iTXt layout must fail this reader.
function chunks(bytes) {
  const buffer = Buffer.from(bytes), found = [];
  for (let at = 8; at < buffer.length;) {
    const size = buffer.readUInt32BE(at), type = buffer.toString('ascii', at + 4, at + 8);
    found.push({ type, start: at, data: buffer.subarray(at + 8, at + 8 + size) });
    at += size + 12;
  }
  return found;
}
test('PNG recipe round trip keeps pixels and absent chunks return null', async () => {
  const embedded = await embedRecipe(png, recipe, '0.9.0'), decoded = decodePNG(embedded);
  assert.deepEqual([...decoded.data], [...pixels]);
  assert.equal(decoded.width, 2); assert.equal(decoded.height, 1);
  assert.deepEqual(await readEmbeddedRecipe(embedded), { version: '0.9.0', kind: 'project', recipe });
  assert.equal(await readEmbeddedRecipe(png), null);
});
test('independent iTXt reader agrees on keyword, compression, version, kind and source', async () => {
  const embedded = await embedRecipe(png, recipe, '0.9.0');
  const chunk = chunks(embedded).find(entry => entry.type === 'iTXt');
  const end = chunk.data.indexOf(0);
  assert.deepEqual(chunk.data.subarray(0, end), Buffer.from('pixelbolt-recipe'));
  assert.deepEqual([...chunk.data.subarray(end, end + 5)], [0, 1, 0, 0, 0]);
  const independent = JSON.parse(inflateSync(chunk.data.subarray(end + 5)).toString('utf8'));
  const opened = await readEmbeddedRecipe(embedded);
  assert.deepEqual(independent, { v: opened.version, kind: opened.kind, recipe: opened.recipe });
});
test('damaged and truncated embedded PNGs give distinct messages', async () => {
  const embedded = await embedRecipe(png, recipe, '0.9.0'), damaged = embedded.slice();
  const chunk = chunks(embedded).find(entry => entry.type === 'iTXt');
  damaged[chunk.start + 8 + chunk.data.length - 1] ^= 1;
  await rejectsShare(readEmbeddedRecipe(damaged), /checksum does not match/);
  await rejectsShare(readEmbeddedRecipe(embedded.subarray(0, embedded.length - 3)), /cut short/);
});
test('re-embedding replaces the recipe and leaves exactly one recipe chunk', async () => {
  const replacement = { ...recipe, name: 'revised' };
  const embedded = await embedRecipe(await embedRecipe(png, recipe, '0.9.0'), replacement, '0.9.1');
  assert.equal(chunks(embedded).filter(entry => entry.type === 'iTXt').length, 1);
  assert.deepEqual(await readEmbeddedRecipe(embedded), { version: '0.9.1', kind: 'project', recipe: replacement });
  assert.deepEqual([...decodePNG(embedded).data], [...pixels]);
});
test('playground share module is byte-identical to the engine source', async () => {
  assert.deepEqual(await readFile(new URL('../playground/share.js', import.meta.url)), await readFile(new URL('../src/share.js', import.meta.url)));
});

// Node.js 20.0 to 20.11 have CompressionStream without 'deflate-raw'; links must still work there, both ways.
test('share links fall back to node:zlib where deflate-raw streams are missing', async () => {
  const [compress, decompress] = [globalThis.CompressionStream, globalThis.DecompressionStream];
  const made = await shareLink(recipe, '0.9.0');
  const without = Base => class extends Base { constructor(format) { if (format === 'deflate-raw') throw new TypeError('Unsupported format'); super(format); } };
  let fallback;
  try {
    globalThis.CompressionStream = without(compress); globalThis.DecompressionStream = without(decompress);
    fallback = await shareLink(recipe, '0.9.0');
    assert.deepEqual((await readShareLink(made)).recipe, recipe);
    await rejectsShare(readShareLink('#v=0.9.0&r=AA'), /does not unpack/);
    // PNG chunks use zlib streams, which every supported runtime has.
    assert.deepEqual((await readEmbeddedRecipe(await embedRecipe(png, recipe, '0.9.0'))).recipe, recipe);
  } finally { globalThis.CompressionStream = compress; globalThis.DecompressionStream = decompress; }
  assert.deepEqual((await readShareLink(fallback)).recipe, recipe);
});

test('a recipe too large to reopen is refused before anything is written', async () => {
  const huge = { ...recipe, notes: 'x'.repeat(RECIPE_LIMIT) };
  await rejectsShare(embedRecipe(png, huge, '0.9.0'), /too large to carry in a PNG/);
  await rejectsShare(shareLink(huge, '0.9.0'), /larger than 16,777,216 bytes/);
  // Multi-byte characters count as the bytes they take.
  await rejectsShare(embedRecipe(png, { ...recipe, notes: 'é'.repeat(RECIPE_LIMIT / 2) }, '0.9.0'), /too large/);
});
