import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, PixelError } from '../src/core.js';
import { prepareScene } from '../src/scene.js';
import { compilePoses } from '../src/authoring.js';

const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
// Runs `attempt` with one field present and reports whether the renderer rejected that field as unknown.
const unknown = (attempt, where) => { try { attempt(); return false; } catch (error) { assert.ok(error instanceof PixelError, String(error)); return [`${where}: unknown field`, `${where}: unknown or null field`].includes(error.message); } };

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
  assert.equal(schema.properties.poses.items.properties.parts.items.properties.squash.multipleOf, .05);
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
  assert.deepEqual(Object.keys(schema.properties).sort(), ['$schema', 'anchor', 'animations', 'background', 'frames', 'height', 'name', 'palette', 'ramps', 'sheet', 'symbols', 'version', 'width']);
});

test('scene fields in the schema match what prepareScene accepts', async () => {
  const schema = await read('scene.schema.json');
  const tiny = { version: 1, name: 't', width: 1, height: 1, palette: { k: '#000' }, frames: [{ name: 'f', ops: [{ op: 'pixel', color: 'k' }] }] };
  const scene = extra => ({ format: 'pixelforge-scene', version: 1, name: 's', width: 2, height: 2, assets: { t: tiny }, instances: [], ...extra });
  const instance = schema.properties.instances.items, lighting = schema.properties.lighting, tilemap = instance.properties.tilemap, cue = instance.properties.sequence.items;
  for (const key of Object.keys(schema.properties)) assert.equal(unknown(() => prepareScene({ ...scene(), [key]: scene()[key] ?? 0 }), `scene.${key}`), false, `scene.${key}`);
  for (const key of Object.keys(instance.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], [key]: 0 }] })), `scene.instances[0].${key}`), false, `instance.${key}`);
  for (const key of Object.keys(lighting.properties)) assert.equal(unknown(() => prepareScene(scene({ lighting: { [key]: 0 } })), `scene.lighting.${key}`), false, `lighting.${key}`);
  for (const key of Object.keys(tilemap.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], tilemap: { rows: ['k'], legend: { k: 'f' }, [key]: 0 } }] })), `scene.instances[0].tilemap.${key}`), false, `tilemap.${key}`);
  for (const key of Object.keys(cue.properties)) assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], sequence: [{ time: 0, [key]: 0 }] }] })), `scene.instances[0].sequence[0].${key}`), false, `cue.${key}`);
  assert.equal(unknown(() => prepareScene(scene({ instances: [{ asset: 't', at: [0, 0], notAField: 0 }] })), 'scene.instances[0].notAField'), true);
});

test('every generated schema defines each definition it references, and carries none it does not', async () => {
  for (const file of ['schema.json', 'poses.schema.json', 'scene.schema.json', 'autotile.schema.json', 'fx.schema.json', 'normals.schema.json']) {
    const { $defs = {}, ...root } = await read(file), reached = new Set(), pending = [root];
    while (pending.length) for (const [, name] of JSON.stringify(pending.pop()).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)) {
      assert.ok(Object.hasOwn($defs, name), `${file} references #/$defs/${name}, which it does not define`);
      if (!reached.has(name)) { reached.add(name); pending.push($defs[name]); }
    }
    assert.deepEqual(Object.keys($defs).filter(name => !reached.has(name)), [], `${file} carries definitions nothing references`);
  }
});
