// Reads Pixelbolt's shipped gas presets for the Aseprite extension and writes them as one Lua table.
//
// The reader is strict on purpose: the Lua port implements exactly the fields these presets use, so any other field
// (or another value of a field that selects a code path) stops packaging with the field's path. When a preset changes
// upstream in a way the port doesn't cover, a repackage refuses instead of shipping a silent mismatch.
//
//   node aseprite/tools/presets.mjs [--out aseprite/dist/presets.lua]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..', '..');

// The Fluid lab's gas presets, in the Fluid lab's order. Titles and notes come from studio/fluid-controls.js.
export const PRESETS = ['campfire', 'explosion', 'smoke-puff', 'steam-vent', 'magic-swirl', 'torch', 'dust-wave'];

// What the port implements. `fields` lists every allowed key of an object; `values` restricts a key that selects a
// code path to the values the port handles. Anything else fails.
const ANY = null;
const SCHEMA = {
  source: { format: ANY, version: ANY, name: ANY, width: ANY, height: ANY, palette: ANY, symbols: ANY, effects: ANY },
  effect: {
    kind: ['gas'], frames: ANY, duration: ANY, loop: [true, false], seed: ANY, walls: ANY, buoyancy: ANY, vorticity: ANY,
    dissipation: ANY, cooling: ANY, drag: ANY, weight: ANY, substeps: ANY, obstacles: ANY, emitters: ANY, look: ANY,
    cleanup: ANY, outline: ANY
  },
  emitter: {
    name: ANY, at: ANY, area: ANY, radius: ANY, rate: ANY, burst: ANY, start: ANY, end: ANY, temperature: ANY,
    density: ANY, velocity: ANY, noise: ANY, flicker: ANY, expand: ANY, vortex: ANY, falloff: ANY, pulse: ANY,
    orbit: ANY, sparks: ANY, carry: ANY
  },
  sparks: { count: ANY, life: ANY, colors: ANY, trail: [true, false], angle: ANY, speed: ANY, drag: ANY, follow: ANY, gravity: ANY },
  carry: { drag: ANY, release: ANY, gravity: ANY },
  pulse: { amplitude: ANY, period: ANY },
  orbit: { radius: ANY, period: ANY, phase: ANY },
  obstacle: { symbol: ANY, x: ANY, y: ANY, draw: ['none'], keys: ANY },
  key: { frame: ANY, y: ANY, over: ANY },
  look: { field: ['density', 'temperature', 'shadow', 'light'], colors: ANY, thresholds: ANY, dither: ANY, pattern: ['value', 'noise', 'bayer4'] },
  cleanup: { strays: [true, false] }
};
const WALLS = ['bottom'];

export class PresetError extends Error {}
const fail = (file, path, message) => { throw new PresetError(`${file}: ${path}: ${message}`); };
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function check(file, kind, value, path) {
  if (!isObject(value)) fail(file, path, `expected an object`);
  const schema = SCHEMA[kind];
  for (const [key, v] of Object.entries(value)) {
    if (!Object.hasOwn(schema, key)) fail(file, `${path}.${key}`, `not supported by the Lua port (field "${key}")`);
    const allowed = schema[key];
    if (allowed && !allowed.includes(v)) fail(file, `${path}.${key}`, `the Lua port supports only ${allowed.map(a => JSON.stringify(a)).join(', ')} here, not ${JSON.stringify(v)}`);
  }
}
const numbers = (file, v, path, length) => {
  if (!Array.isArray(v) || (length && v.length !== length) || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) fail(file, path, `expected ${length ? length + ' ' : ''}numbers`);
};

// Checks one source against what the port implements. Returns the effect's name.
export function readPreset(source, file) {
  check(file, 'source', source, 'fluid');
  if (source.format !== 'pixelforge-fluid' || source.version !== 1) fail(file, 'fluid', 'expected version-1 pixelforge-fluid');
  for (const [key, color] of Object.entries(source.palette ?? {})) {
    if (key.length !== 1) fail(file, `fluid.palette.${key}`, 'the Lua port expects one-character palette keys');
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) fail(file, `fluid.palette.${key}`, 'the Lua port supports only opaque #rrggbb colours');
  }
  const effects = Object.entries(source.effects ?? {});
  if (effects.length !== 1) fail(file, 'fluid.effects', 'the Lua port expects exactly one effect');
  const [name, effect] = effects[0], path = `fluid.effects.${name}`;
  check(file, 'effect', effect, path);
  for (const [i, wall] of (effect.walls ?? []).entries()) if (!WALLS.includes(wall)) fail(file, `${path}.walls[${i}]`, `the Lua port supports only ${WALLS.join(', ')} walls, not ${JSON.stringify(wall)}`);
  for (const [i, e] of (effect.emitters ?? []).entries()) {
    const p = `${path}.emitters[${i}]`;
    check(file, 'emitter', e, p);
    if (e.at !== undefined) numbers(file, e.at, `${p}.at`, 2);
    for (const part of ['sparks', 'carry', 'pulse', 'orbit']) if (e[part] !== undefined) check(file, part, e[part], `${p}.${part}`);
  }
  for (const [i, o] of (effect.obstacles ?? []).entries()) {
    const p = `${path}.obstacles[${i}]`;
    check(file, 'obstacle', o, p);
    for (const [k, key] of (o.keys ?? []).entries()) check(file, 'key', key, `${p}.keys[${k}]`);
  }
  for (const [i, layer] of (effect.look ?? []).entries()) check(file, 'look', layer, `${path}.look[${i}]`);
  if (effect.cleanup !== undefined) check(file, 'cleanup', effect.cleanup, `${path}.cleanup`);
  return name;
}

// A JSON value as a Lua literal. Arrays become sequences; numbers keep JavaScript's shortest round-trip text, which
// Lua reads back to the same double (whole numbers become Lua integers, equal in value).
export function lua(value, indent = '') {
  if (value === null) fail('lua', 'value', 'null has no Lua form');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('lua', 'value', 'expected a finite number');
    return Object.is(value, -0) ? '-0.0' : String(value);
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return luaString(value);
  const inner = indent + '  ';
  if (Array.isArray(value)) return value.length ? `{ ${value.map(v => lua(v, inner)).join(', ')} }` : '{}';
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${inner}[${luaString(k)}] = ${lua(v, inner)}`).join(',\n')}\n${indent}}`;
}
const luaString = s => '"' + s.replace(/[\\"\n\r\t]/g, c => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c]).replace(/[^\x20-\x7e]/g, c => `\\u{${c.codePointAt(0).toString(16)}}`) + '"';

// `examples` may name another folder of the same files (the strict-reader check uses a changed copy).
export async function loadPresets(root = ROOT, names = PRESETS, examples = process.env.PIXELBOLT_FLUIDS_EXAMPLES || join(root, 'examples')) {
  const { FLUID_PRESETS } = await import(pathToFileURL(join(root, 'studio', 'fluid-controls.js')).href);
  return names.map(name => {
    const file = `examples/${name}.fluid.json`;
    const source = JSON.parse(readFileSync(join(examples, `${name}.fluid.json`), 'utf8'));
    const effect = readPreset(source, file);
    const listed = FLUID_PRESETS.find(p => p.file === name);
    if (!listed) fail(file, 'fluid', 'not listed in the Fluid lab (studio/fluid-controls.js)');
    return { name, title: listed.title, note: listed.note, effect, source, order: Object.keys(source.palette ?? {}) };
  });
}

// The Lua module the extension and the standalone runner load: a list in the Fluid lab's order.
export function presetsModule(presets) {
  const items = presets.map(p => `  {\n    name = ${luaString(p.name)},\n    title = ${luaString(p.title)},\n    note = ${luaString(p.note)},\n    effect = ${luaString(p.effect)},\n    order = ${lua(p.order)},\n    source = ${lua(p.source, '    ')}\n  }`);
  return `-- Generated by aseprite/tools/presets.mjs from Pixelbolt's examples/*.fluid.json. Do not edit.\nreturn {\n${items.join(',\n')}\n}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--out');
  const out = resolve(at > 0 ? process.argv[at + 1] : join(ROOT, 'aseprite', 'dist', 'presets.lua'));
  try {
    const presets = await loadPresets();
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, presetsModule(presets));
    console.log(`wrote ${presets.length} presets to ${out}`);
  } catch (error) {
    if (!(error instanceof PresetError)) throw error;
    console.error(`aseprite presets: ${error.message}`);
    process.exit(1);
  }
}
