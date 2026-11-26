import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { renderProject, compareProjects, PixelError } from '../src/core.js';
import { renderAction } from '../src/actions.js';
import { startMCP } from '../src/mcp.js';
import { startStudio } from '../src/server.js';
import { createRevisionStore } from '../src/revisions.js';
import { resolveReferences } from '../src/resolve.js';
import { compileFluid } from '../src/fluid.js';
import { compileBodies } from '../src/bodies.js';
import { compileStack } from '../src/stack.js';
import { keepFrames } from '../src/resize.js';
import { patchRecipe } from '../src/patch.js';
import { drawFrame } from '../src/runtime.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/pixelbolt.js');

const tiny = {
  version: 1, name: 'tiny', width: 4, height: 4,
  palette: { a: '#ff0000', b: '#00ff00' },
  frames: [
    { name: 'f1', duration: 100, ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'a' }] },
    { name: 'f2', duration: 100, ops: [{ op: 'rect', x: 1, y: 1, w: 2, h: 2, color: 'b' }] }
  ],
  animations: { idle: { frames: ['f1', 'f2'], loop: true } }
};

function startClient(dir, rootDir) {
  const input = new PassThrough(), output = new PassThrough();
  const done = startMCP({ input, output, directory: dir, root: rootDir, version: '0.21.0' });
  let buffer = '', nextId = 1;
  const pending = new Map();
  output.setEncoding('utf8');
  output.on('data', chunk => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const send = (method, params) => new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    send,
    call: (name, args) => send('tools/call', { name, arguments: args }),
    async close() { input.end(); await done; }
  };
}

test('renderAction flags missing GIFs when expect.gifScale is set and gif is omitted', async () => {
  const result = await renderAction(tiny, { expect: { gifScale: 4 }, call: 'mcp' });
  assert.equal(result.gifs.length, 0);
  assert.equal(result.check.ok, false);
  assert.ok(result.check.problems.some(p => p.got === 'no GIF'), JSON.stringify(result.check));
});

test('MCP pixel_inspect validates beside, rejects sourceRevisions, disables playable on beside, and fixes schema metadata', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixelbolt-bugfix-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mcp = startClient(path.join(dir, 'out'), root);
  t.after(() => mcp.close());
  await mcp.send('initialize', { protocolVersion: '2025-11-25', capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } });

  // Schema checks: scale max 16 on pixel_scene, clean × on pixel_inspect poseSheet.
  const list = (await mcp.send('tools/list', {})).result.tools;
  const sceneTool = list.find(tool => tool.name === 'pixel_scene');
  assert.equal(sceneTool.inputSchema.properties.scale.maximum, 16);
  const inspectTool = list.find(tool => tool.name === 'pixel_inspect');
  assert.match(inspectTool.inputSchema.properties.poseSheet.description, /×/);
  assert.doesNotMatch(inspectTool.inputSchema.properties.poseSheet.description, /Ã/);

  // Validate tiny to get a revision id.
  const val = await mcp.call('pixel_validate', { project: tiny });
  const rev = JSON.parse(val.result.content[0].text).revision;

  // Invalid beside values produce clean PixelError responses (never raw TypeError).
  for (const bad of [null, 123, [], Array(9).fill(rev)]) {
    const res = await mcp.call('pixel_inspect', { revision: rev, beside: bad });
    assert.equal(res.result.isError, true, JSON.stringify(bad));
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.path, 'beside');
  }

  // Valid beside with MCP Apps UI must show the stacked comparison image (not playable primary-only).
  const besideRes = await mcp.call('pixel_inspect', { revision: rev, beside: [rev] });
  assert.ok(!besideRes.result.isError);
  const previewPayload = Object.values(besideRes.result._meta ?? {})[0]?.preview;
  assert.equal(previewPayload?.frames?.[0]?.name, 'inspection');

  // pixel_compile & pixel_render(normal) resolve pixelforge-normals referencing a .poses.json source file.
  const normCompile = await mcp.call('pixel_compile', { source: { format: 'pixelforge-normals', version: 1, recipe: 'examples/slime-idle.poses.json' } });
  assert.ok(!normCompile.result.isError, normCompile.result.content[0].text);

  // pixel_compile rejects incompatible slices/metadata with draftViews/sequence.
  const badCompile = await mcp.call('pixel_compile', { source: { format: 'pixelforge-poses', version: 1, name: 'p', width: 8, height: 8, palette: { a: '#fff' }, parts: { p: { rows: ['a'] } }, poses: [{ name: 'idle', origin: [4, 4], parts: [{ name: 'p', part: 'p', at: [0, 0] }] }] }, draftViews: { p: [45] }, slices: true });
  assert.equal(badCompile.result.isError, true);

  // pixel_import rejects non-string data/path cleanly with PixelError path.
  const badImportData = await mcp.call('pixel_import', { data: 123 });
  assert.equal(badImportData.result.isError, true);
  assert.equal(JSON.parse(badImportData.result.content[0].text).path, 'data');
  const badImportPath = await mcp.call('pixel_import', { path: null });
  assert.equal(badImportPath.result.isError, true);
  assert.equal(JSON.parse(badImportPath.result.content[0].text).path, 'path');

  // pixel_inspect rejects non-pose sourceRevision on view: motion cleanly.
  const stackCompiled = await mcp.call('pixel_compile', { preset: 'lodekeeper-faceted' });
  const stackSrcRev = JSON.parse(stackCompiled.result.content[0].text).sourceRevision;
  assert.ok(stackSrcRev);
  const badMotion = await mcp.call('pixel_inspect', { revision: stackSrcRev, view: 'motion', animation: 'turn' });
  assert.equal(badMotion.result.isError, true);
  assert.equal(JSON.parse(badMotion.result.content[0].text).path, 'revision');
  const badRef = await mcp.call('pixel_inspect', { revision: rev, reference: stackSrcRev });
  assert.equal(badRef.result.isError, true);
  assert.equal(JSON.parse(badRef.result.content[0].text).path, 'reference');
});

test('Studio server handles requests arriving after server.close without crashing', async t => {
  const server = await startStudio({ port: 0, quiet: true });
  t.after(() => new Promise(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && address.port > 0);
  // Emit a synthetic request event after server.close() clears server.address().
  let destroyed = false;
  await new Promise(resolve => server.close(resolve));
  assert.equal(server.address(), null);
  server.emit('request', { headers: {}, method: 'GET', url: '/' }, { destroy() { destroyed = true; }, writeHead() {}, end() {} });
  assert.equal(destroyed, true);
});

test('revisions.js skips vanished/unreadable subdirectories and resolve.js rejects directories', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixelbolt-bugfix-fs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createRevisionStore(dir);
  await mkdir(path.join(dir, 'subdir'));
  await assert.rejects(() => store.read('000000000000'), /unknown revision/);
  // resolveReferences rejects a directory referenced as a palette file cleanly.
  await assert.rejects(
    () => resolveReferences({ ...tiny, palette: { $ref: 'subdir' } }, { baseDir: dir }),
    error => error instanceof PixelError && /not a regular file/.test(error.message)
  );
  // saveAs rejects a dangling symlink cleanly when symlink creation is permitted.
  const linkPath = path.join(dir, 'broken.png');
  let linked = false;
  try { await symlink(path.join(dir, 'missing-target.png'), linkPath); linked = true; } catch { /* skip on restricted Windows */ }
  if (linked) {
    const mcp = startClient(path.join(dir, 'out'), dir);
    t.after(() => mcp.close());
    await mcp.send('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
    const res = await mcp.call('pixel_render', { project: tiny, saveAs: { sheet: 'broken.png' } });
    assert.equal(res.result.isError, true);
    assert.match(JSON.parse(res.result.content[0].text).error, /not a file/);
  }
});

test('CLI fixes: --beside -,- double stdin, gif source refusal, inspect --reference source compile, strict flags & numbers', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixelbolt-bugfix-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runCLI = args => exec(process.execPath, [cli, ...args], { cwd: root }).then(
    ok => ({ ok: true, stdout: ok.stdout }),
    err => ({ ok: false, stdout: err.stdout, stderr: err.stderr })
  );

  // --beside -,- refuses duplicate stdin before reading.
  const dupStdin = await runCLI(['inspect', 'examples/coin.json', '--beside', '-,-']);
  assert.equal(dupStdin.ok, false);
  assert.match(dupStdin.stderr + dupStdin.stdout, /Only one input can use stdin/);

  // gif on a fluid source advises compile instead of raw project.format error.
  const badGif = await runCLI(['gif', 'examples/campfire.fluid.json', '--out', path.join(dir, 'c.gif')]);
  assert.equal(badGif.ok, false);
  assert.match(badGif.stderr + badGif.stdout, /compile it first/);

  // inspect --reference compiles source formats (.poses.json).
  const refPoses = await runCLI(['inspect', 'examples/four-way-knight.poses.json', '--reference', 'examples/four-way-mage.poses.json']);
  assert.equal(refPoses.ok, true, refPoses.stderr + refPoses.stdout);

  // Incompatible flags rejected: --motion --every and compile --expand --slices.
  const badMotion = await runCLI(['inspect', 'examples/four-way-knight.poses.json', '--motion', 'walk-down', '--every', '100']);
  assert.equal(badMotion.ok, false);
  assert.match(badMotion.stderr + badMotion.stdout, /--every cannot be combined with --motion/);

  const badExpand = await runCLI(['compile', 'examples/four-way-knight.poses.json', '--expand', '--slices']);
  assert.equal(badExpand.ok, false);
  assert.match(badExpand.stderr + badExpand.stdout, /--slices/);

  // Trailing comma in --offset rejected instead of coercing empty string to 0.
  const badOffset = await runCLI(['sequence', 'examples/coin.json', '--out', path.join(dir, 'seq'), '--fps', '10', '--offset', '4,']);
  assert.equal(badOffset.ok, false);
});

test('fluid: liquid with heat + strand look layer without ice does not crash', () => {
  const result = compileFluid({
    format: 'pixelforge-fluid', version: 1, name: 'hot-strand', width: 12, height: 12,
    palette: { w: '#4ea8de', s: '#caf0f8' },
    effects: {
      pour: {
        kind: 'liquid', frames: 4, duration: 80, seed: 1,
        walls: ['bottom', 'left', 'right'],
        heat: { ambient: 0.2, conduct: 0.1, air: 0.05 },
        fill: [{ x: 3, y: 6, w: 6, h: 4 }],
        emitters: [],
        look: [
          { field: 'density', colors: ['w'], thresholds: [0.2], dither: 0 },
          { field: 'strand', colors: ['s'], thresholds: [0.3], dither: 0 }
        ]
      }
    }
  });
  assert.equal(result.recipe.frames.length, 4);
});

test('fluid: smooth obstacle near top wall never pushes particles OOB or produces NaN energy', () => {
  const result = compileFluid({
    format: 'pixelforge-fluid', version: 1, name: 'smooth-edge', width: 6, height: 6,
    palette: { w: '#4ea8de', o: '#6c757d' },
    symbols: { ramp: ['oo', 'o.'] },
    effects: {
      splash: {
        kind: 'liquid', frames: 6, duration: 80, seed: 1,
        walls: ['top'], gravity: [0, 0.4], flip: 1,
        heat: { conduct: 0.2, contact: 0.2, air: 0.1 },
        obstacles: [{ symbol: 'ramp', x: 1, y: 1, surface: 'smooth' }],
        fill: [{ x: 0, y: 1, w: 1, h: 2, velocity: [7, -1] }],
        emitters: [],
        look: [{ field: 'density', colors: ['w'], thresholds: [0.2], dither: 0 }]
      }
    }
  });
  assert.equal(result.recipe.frames.length, 6);
  const project = renderProject(result.recipe);
  assert.equal(project.frames.length, 6);
});

test('bodies: valid thin convex polygon with subpixels > 1 does not crash paintBodiesFine', () => {
  const result = compileBodies({
    format: 'pixelforge-bodies', version: 1, name: 'thin-poly', width: 32, height: 32, subpixels: 2,
    palette: { r: '#e63946' },
    effects: {
      fall: {
        frames: 3, duration: 80,
        bodies: [{ shape: 'polygon', points: [[-10, 0], [10, 0], [0, 0.06]], at: [16, 16], fill: 'r' }]
      }
    }
  });
  assert.equal(result.recipe.frames.length, 3);
});

test('runtime drawFrame: flipX mirrors unanchored sprites in place instead of shifting left', () => {
  const calls = [];
  const ctx = {
    imageSmoothingEnabled: true,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    translate(x, y) { calls.push(['translate', x, y]); },
    rotate(r) { calls.push(['rotate', r]); },
    scale(sx, sy) { calls.push(['scale', sx, sy]); },
    drawImage(_img, sx, sy, sw, sh, dx, dy, dw, dh) { calls.push(['draw', sx, sy, sw, sh, dx, dy, dw, dh]); }
  };
  const sheet = {
    image: {},
    atlas: {
      frames: {
        plain: { frame: { x: 0, y: 0, w: 4, h: 4 }, sourceSize: { w: 4, h: 4 }, spriteSourceSize: { x: 0, y: 0, w: 4, h: 4 } },
        anchored: { frame: { x: 0, y: 0, w: 4, h: 4 }, sourceSize: { w: 8, h: 8 }, spriteSourceSize: { x: 2, y: 2, w: 4, h: 4 }, anchorPx: { x: 3, y: 4 } }
      }
    }
  };
  // Unanchored frame at (10, 10) with flipX: true draws inside [10, 14] (translate to 14, scale -1, draw 0..4).
  drawFrame(ctx, sheet, 'plain', 10, 10, { flipX: true });
  assert.deepEqual(calls.find(c => c[0] === 'translate'), ['translate', 14, 10]);

  // Anchored frame with anchor: false mirrors inside [10, 18] (offset.x=2 -> dx=2, translate to 10+(2+4)=16, draws [12, 16]).
  calls.length = 0;
  drawFrame(ctx, sheet, 'anchored', 10, 10, { flipX: true, anchor: false });
  assert.deepEqual(calls.find(c => c[0] === 'translate'), ['translate', 16, 12]);

  // Anchored frame with anchor: true preserves exact anchor mirroring: left = 10 - (8 - 3) = 5, translate = 5 + (2 + 4) = 11.
  calls.length = 0;
  drawFrame(ctx, sheet, 'anchored', 10, 10, { flipX: true, anchor: true });
  assert.deepEqual(calls.find(c => c[0] === 'translate'), ['translate', 11, 8]);
});

test('stack: 1x2 and 2x1 iso stacks with cell compile cleanly and case-insensitive animation collisions fail', () => {
  for (const slices of [[['a', 'a']], [['aa']]]) {
    const compiled = compileStack({
      format: 'pixelforge-stack', version: 1, name: 'thin-iso', projection: 'iso', cell: 2,
      palette: { a: '#d98a4a' }, headings: [0, 90], slices
    });
    assert.equal(compiled.recipe.frames.length, 2);
  }
  assert.throws(() => compileStack({
    format: 'pixelforge-stack', version: 1, name: 'case-clash',
    palette: { a: '#d98a4a' }, headings: [0], slices: [['aa', 'aa']],
    sockets: { s: { at: [0, 0, 0] } },
    animations: {
      Walk: { frames: 2, sockets: { s: [{ frame: 0, angle: 0 }, { frame: 1, angle: 10 }] } },
      walk: { frames: 2, sockets: { s: [{ frame: 0, angle: 0 }, { frame: 1, angle: 20 }] } }
    }
  }), /unique ignoring case/);
});

test('resize keepFrames clamps merged durations past 60000 ms to produce a valid recipe', () => {
  const long = {
    version: 1, name: 'slow', width: 2, height: 2, palette: { a: '#fff' },
    frames: [1, 2, 3, 4].map(n => ({ name: `f${n}`, duration: 20000, ops: [{ op: 'pixel', x: 0, y: 0, color: 'a' }] })),
    animations: { slow: { frames: ['f1', 'f2', 'f3', 'f4'], loop: true } }
  };
  const { recipe, notes } = keepFrames(long, 1);
  assert.equal(recipe.frames[0].duration, 60000);
  assert.ok(notes.some(n => /clamped to the 60000 ms/.test(n)));
  assert.equal(renderProject(recipe).frames.length, 1);
});

test('compareProjects respects PNG_PIXELS area cap on 2048x2045 renamed stills', () => {
  const makeStill = name => renderProject({
    version: 1, name: 'big', width: 2048, height: 2045, palette: { a: '#fff' },
    frames: [{ name, ops: [{ op: 'pixel', x: 0, y: 0, color: 'a' }] }], animations: {}
  });
  const cmp = compareProjects(makeStill('f1'), makeStill('f2'));
  assert.ok(cmp.image.sheet.width * cmp.image.sheet.height <= 16777216);
  assert.equal(cmp.image.omitted, 1);
});

test('patchRecipe parsePath turns malformed quoted JSON escapes into PixelError', () => {
  assert.throws(
    () => patchRecipe(tiny, [{ set: 'frames["bad\\x"]', value: 1 }]),
    error => error instanceof PixelError && error.path === 'changes[0].set' && /invalid quoted key/.test(error.message)
  );
});
