import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, PixelError } from '../src/core.js';
import { prepareScene } from '../src/scene.js';
import { compilePoses, compileAutotile, compileNormals } from '../src/authoring.js';
import { compileEffects } from '../src/fx.js';
import { compileFluid } from '../src/fluid.js';
import { compileWaves } from '../src/wave.js';
import { compileCrystals } from '../src/crystal.js';
import { compilePowder } from '../src/powder.js';
import { compileBodies } from '../src/bodies.js';
import { compileStack } from '../src/stack.js';
import { SCHEMAS } from '../scripts/generate-schema.js';

const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
// Runs `attempt` with one field present and reports whether the renderer rejected that field as unknown.
const unknown = (attempt, where) => { try { attempt(); return false; } catch (error) { assert.ok(error instanceof PixelError, String(error)); return [`${where}: unknown field`, `${where}: unknown or null field`].includes(error.message) || error.message.startsWith(`${where}: unknown field; `); } };

test('pose structural fields in the schema match the compiler', async () => {
  const schema = await read('poses.schema.json');
  const source = () => ({
    format: 'pixelforge-poses', version: 1, name: 'schema-probe', width: 32, height: 32,
    palette: { a: '#123', b: '#456', k: '#000' }, ramps: [['a', 'b']],
    parts: { body: { mass: { size: [6, 4], ramp: 0, base: 1 } }, leg: { bone: { length: 5, width: [3, 2], ramp: 0, base: 1 } } },
    poses: [{ name: 'stand', origin: [16, 16], parts: [{ name: 'body', part: 'body' }, { name: 'leg', part: 'leg' }] }]
  });
  const groups = [
    [schema.properties, s => s, 'poses'],
    [schema.properties.poses.items.properties, s => s.poses[0], 'poses.poses[0]'],
    [schema.properties.poses.items.properties.parts.items.properties, s => s.poses[0].parts[0], 'poses.poses[0].parts[0]'],
    ...schema.properties.parts.additionalProperties.oneOf.filter(p => p.properties.bone || p.properties.mass).map(p => {
      const kind = p.properties.bone ? 'bone' : 'mass', name = kind === 'bone' ? 'leg' : 'body';
      return [p.properties[kind].properties, s => s.parts[name][kind], `poses.parts.${name}.${kind}`];
    })
  ];
  for (const [properties, select, path] of groups) {
    for (const key of [...Object.keys(properties), 'notAField']) {
      const s = source(), object = select(s); object[key] ??= 0;
      assert.equal(unknown(() => compilePoses(s), `${path}.${key}`), key === 'notAField', `${path}.${key}`);
    }
  }
  // Squash has no multipleOf: 0.05 has no exact binary form, so standard validators reject valid values such as 0.95.
  const squash = schema.properties.poses.items.properties.parts.items.properties.squash;
  assert.deepEqual([squash.minimum, squash.maximum, squash.multipleOf], [.5, 2, undefined]);
  assert.ok(schema.properties.parts.additionalProperties.oneOf[1].properties.bone.properties.outline.oneOf.some(p => p.type === 'null'));
});

test('every operation field the schema lists is one the renderer accepts, and no others', async () => {
  const schema = await read('schema.json');
  for (const op of schema.$defs.op.oneOf) {
    const name = op.properties.op.const, keys = Object.keys(op.properties).filter(key => key !== 'op');
    const draw = (key, value = 0) => renderProject({ version: 1, name: 'a', width: 2, height: 2, palette: { k: '#000' }, frames: [{ name: 'f', ops: [{ op: name, [key]: value }] }] });
    for (const key of keys) assert.equal(unknown(() => draw(key), `project.frames[0].ops[0].${key}`), false, `${name}.${key} is in the schema but the renderer rejects it`);
    assert.equal(unknown(() => draw('notAField'), 'project.frames[0].ops[0].notAField'), true, name);
  }
  assert.deepEqual(Object.keys(schema.properties).sort(), ['$schema', 'anchor', 'animations', 'background', 'frames', 'headings', 'height', 'name', 'palette', 'parts', 'ramps', 'scaleTracks', 'sheet', 'symbols', 'version', 'width']);
});

test('scene fields in the schema match what prepareScene accepts', async () => {
  const schema = await read('scene.schema.json');
  const tiny = { version: 1, name: 't', width: 1, height: 1, palette: { k: '#000' }, frames: [{ name: 'f', ops: [{ op: 'pixel', color: 'k' }] }] };
  const scene = extra => ({ format: 'pixelforge-scene', version: 1, name: 's', width: 2, height: 2, assets: { t: tiny }, instances: [], ...extra });
  const instance = schema.properties.instances.items, lighting = schema.properties.lighting, tilemap = instance.properties.tilemap, cue = instance.properties.sequence.items;
  for (const key of Object.keys(schema.properties)) assert.equal(unknown(() => prepareScene({ ...scene(), [key]: scene()[key] ?? 0 }), `scene.${key}`), false, `scene.${key}`);
  for (const key of Object.keys(instance.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], [key]: 0 }] })), `scene.instances[0].${key}`), false, `instance.${key}`);
  for (const key of Object.keys(lighting.properties)) assert.equal(unknown(() => prepareScene(scene({ lighting: { [key]: 0 } })), `scene.lighting.${key}`), false, `lighting.${key}`);
  const light = lighting.properties.lights.items;
  for (const key of [...Object.keys(light.properties), 'notAField']) assert.equal(unknown(() => prepareScene(scene({ lighting: { lights: [{ at: [0, 0], [key]: 0 }] } })), `scene.lighting.lights[0].${key}`), key === 'notAField', `light.${key}`);
  for (const key of Object.keys(tilemap.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], tilemap: { rows: ['k'], legend: { k: 'f' }, [key]: 0 } }] })), `scene.instances[0].tilemap.${key}`), false, `tilemap.${key}`);
  for (const key of Object.keys(cue.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], sequence: [{ time: 0, [key]: 0 }] }] })), `scene.instances[0].sequence[0].${key}`), false, `cue.${key}`);
  assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], notAField: 0 }] })), 'scene.instances[0].notAField'), true);
});

test('committed *.schema.json files match scripts/generate-schema.js byte for byte', async () => {
  for (const [file, value] of SCHEMAS) {
    const onDisk = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(onDisk, JSON.stringify(value, null, 2) + '\n', `${file} is out of date; run node scripts/generate-schema.js`);
  }
});

test('every generated schema defines each definition it references, and carries none it does not', async () => {
  for (const [file] of SCHEMAS) {
    const { $defs = {}, ...root } = await read(file), reached = new Set(), pending = [root];
    while (pending.length) for (const [, name] of JSON.stringify(pending.pop()).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)) {
      assert.ok(Object.hasOwn($defs, name), `${file} references #/$defs/${name}, which it does not define`);
      if (!reached.has(name)) { reached.add(name); pending.push($defs[name]); }
    }
    assert.deepEqual(Object.keys($defs).filter(name => !reached.has(name)), [], `${file} carries definitions nothing references`);
  }
});

test('all source-format schemas match the top-level and key sub-object fields their compilers accept', async () => {
  const tiny = { version: 1, name: 't', width: 2, height: 2, palette: { k: '#000' }, frames: [{ name: 'f', ops: [{ op: 'pixel', x: 0, y: 0, color: 'k' }] }] };
  const probe = (compile, make, select, properties, where) => {
    for (const key of [...Object.keys(properties), 'notAField']) {
      const doc = make(), target = select(doc);
      // Leave fields already populated on the base probe alone so validation reaches the field check cleanly.
      if (!(key in target)) target[key] = 0;
      assert.equal(unknown(() => compile(doc), `${where}.${key}`), key === 'notAField', `${where}.${key}`);
    }
  };
  const autotile = await read('autotile.schema.json');
  probe(compileAutotile, () => ({ format: 'pixelforge-autotile', version: 1, name: 'a', tile: 4, palette: { k: '#000' }, template: Array(12).fill('kkkkkkkkkkkk') }), d => d, autotile.properties, 'autotile');

  const fx = await read('fx.schema.json');
  const makeFx = () => ({ format: 'pixelforge-fx', version: 1, name: 'a', width: 8, height: 8, palette: { k: '#000' }, effects: { e: { frames: 2, emitters: [{ at: [4, 4], colors: ['k'] }] } } });
  probe(compileEffects, makeFx, d => d, fx.properties, 'fx');
  probe(compileEffects, makeFx, d => d.effects.e, fx.properties.effects.additionalProperties.properties, 'fx.effects.e');

  const fluid = await read('fluid.schema.json');
  const makeFluid = () => ({ format: 'pixelforge-fluid', version: 1, name: 'a', width: 8, height: 8, palette: { k: '#000' }, effects: { e: { frames: 2, emitters: [{ at: [4, 4] }], look: [{ colors: ['k'] }] } } });
  probe(compileFluid, makeFluid, d => d, fluid.properties, 'fluid');
  probe(compileFluid, makeFluid, d => d.effects.e, fluid.properties.effects.additionalProperties.properties, 'fluid.effects.e');
  probe(compileFluid, makeFluid, d => d.effects.e.emitters[0], fluid.properties.effects.additionalProperties.properties.emitters.items.properties, 'fluid.effects.e.emitters[0]');

  const wave = await read('wave.schema.json');
  const makeWave = () => ({ format: 'pixelforge-wave', version: 1, name: 'a', width: 8, height: 8, palette: { k: '#000' }, effects: { e: { frames: 2, sources: [{ kind: 'radial', at: [4, 4] }], look: [{ colors: ['k'] }] } } });
  probe(compileWaves, makeWave, d => d, wave.properties, 'wave');
  probe(compileWaves, makeWave, d => d.effects.e, wave.properties.effects.additionalProperties.properties, 'wave.effects.e');

  const crystal = await read('crystal.schema.json');
  const makeCrystal = () => ({ format: 'pixelforge-crystal', version: 1, name: 'a', width: 8, height: 8, palette: { a: '#111', b: '#fff' }, looks: { a: { colors: ['a', 'b'] } }, effects: { e: { frames: 2, crystals: [{ habit: 'cube', at: [4, 4], size: 3, look: 'a' }] } } });
  probe(compileCrystals, makeCrystal, d => d, crystal.properties, 'crystal');
  probe(compileCrystals, makeCrystal, d => d.effects.e, crystal.properties.effects.additionalProperties.properties, 'crystal.effects.e');

  const powder = await read('powder.schema.json');
  const makePowder = () => ({ format: 'pixelforge-powder', version: 1, name: 'a', width: 8, height: 8, base: 'sandbox', clips: { c: { frames: 2 } } });
  probe(compilePowder, makePowder, d => d, powder.properties, 'powder');
  probe(compilePowder, makePowder, d => d.clips.c, powder.properties.clips.additionalProperties.properties, 'powder.clips.c');

  const bodies = await read('bodies.schema.json');
  const makeBodies = () => ({ format: 'pixelforge-bodies', version: 1, name: 'a', width: 8, height: 8, palette: { k: '#000' }, effects: { e: { frames: 2, bodies: [{ shape: 'circle', at: [4, 4], radius: 2, color: 'k' }] } } });
  probe(compileBodies, makeBodies, d => d, bodies.properties, 'bodies');
  probe(compileBodies, makeBodies, d => d.effects.e, bodies.properties.effects.additionalProperties.properties, 'bodies.effects.e');

  const stack = await read('stack.schema.json');
  probe(compileStack, () => ({ format: 'pixelforge-stack', version: 1, name: 'a', palette: { k: '#000' }, slices: [Array(4).fill('kkkk')] }), d => d, stack.properties, 'stack');

  const normals = await read('normals.schema.json');
  const makeNormals = () => ({ format: 'pixelforge-normals', version: 1, recipe: tiny, detail: { amount: 0.5 } });
  probe(compileNormals, makeNormals, d => d, normals.properties, 'normals');
  const detailObject = normals.properties.detail.oneOf.find(branch => branch.type === 'object');
  probe(compileNormals, makeNormals, d => d.detail, detailObject.properties, 'normals.detail');
});
