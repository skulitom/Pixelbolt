// No static imports: Node checks and the worker must run exactly the same engine calls.
export const ENGINE_MODULES = ['core', 'authoring', 'fx', 'fluid', 'scene', 'gif'];

export async function loadEngine(base) {
  return Object.fromEntries(await Promise.all(ENGINE_MODULES.map(async name => [name, await import(new URL(`${name}.js`, base))])));
}

export function assertInline(document) {
  const file = value => {
    if (typeof value === 'string') throw new Error(`This recipe names the file ${value}; the playground needs it inline.`);
    if (value?.revision !== undefined) throw new Error('Saved revision references need the MCP server; inline the recipe here.');
  };
  const palette = value => { if (value?.palette?.$ref !== undefined) file(value.palette.$ref); };
  const recipe = value => { file(value); palette(value); };
  if (document?.format === 'pixelforge-scene') {
    file(document.palette);
    palette(document);
    for (const asset of Object.values(document.assets ?? {})) {
      if (asset && typeof asset === 'object' && asset.version === undefined && ['recipe', 'normal', 'emissive'].some(key => asset[key] !== undefined)) {
        for (const key of ['recipe', 'normal', 'emissive']) if (asset[key] !== undefined) recipe(asset[key]);
        file(asset.palette);
        palette(asset);
      } else recipe(asset);
    }
  } else if (document?.format === 'pixelforge-normals') recipe(document.recipe);
  else palette(document);
}

export function renderRecipe(engine, document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('A recipe must be a JSON object.');
  assertInline(document);
  if (document.format === 'pixelforge-scene') {
    const prepared = engine.scene.prepareScene(document), frames = [], warnings = new Set(prepared.warnings);
    const count = Math.max(1, Math.min(240, Math.ceil(prepared.duration / 100)));
    if (prepared.duration > 24000) warnings.add('Scene preview and exports stop at 24 seconds (240 frames).');
    for (let i = 0; i < count; i++) {
      const frame = engine.scene.renderScene(prepared, { time: i * 100, lit: true, density: false });
      frames.push({ name: `scene-${i + 1}`, width: prepared.width, height: prepared.height, duration: 100, data: frame.data });
      for (const warning of frame.warnings ?? []) warnings.add(warning);
    }
    return { kind: 'scene', name: document.name, width: prepared.width, height: prepared.height, frames,
      animations: { scene: { frames: frames.map((_, i) => i), loop: true } }, warnings: [...warnings] };
  }
  const compilers = {
    'pixelforge-poses': engine.authoring.compilePoses,
    'pixelforge-autotile': engine.authoring.compileAutotile,
    'pixelforge-normals': engine.authoring.compileNormals,
    'pixelforge-fx': engine.fx.compileEffects,
    'pixelforge-fluid': engine.fluid.compileFluid
  };
  if (document.format !== undefined && !Object.hasOwn(compilers, document.format)) {
    throw new Error(`Recipes with format ${JSON.stringify(String(document.format)).slice(0, 80)} cannot be rendered on their own.`);
  }
  const kind = document.format === undefined ? 'project' : document.format.slice('pixelforge-'.length);
  const recipe = kind === 'project' ? document : compilers[document.format](document).recipe;
  const project = engine.core.renderProject(recipe);
  return { kind, name: project.name, width: project.width, height: project.height,
    frames: project.frames.map(frame => ({ ...frame, width: project.width, height: project.height })),
    animations: project.animations, warnings: project.warnings, project };
}

export async function framesDigest(frames) {
  const bytes = new Uint8Array(frames.reduce((sum, frame) => sum + 8 + frame.data.byteLength, 0)), view = new DataView(bytes.buffer);
  let at = 0;
  for (const frame of frames) {
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.data.byteLength !== frame.width * frame.height * 4) {
      throw new Error('Digest frames need width, height and matching RGBA bytes.');
    }
    view.setUint32(at, frame.width, false); view.setUint32(at + 4, frame.height, false);
    bytes.set(frame.data, at + 8); at += 8 + frame.data.byteLength;
  }
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Scenes have no sprite atlas metadata, but their sampled frames can still form a sheet or a GIF.
export function sceneSheet(rendered) {
  const columns = Math.ceil(Math.sqrt(rendered.frames.length)), width = columns * rendered.width;
  const height = Math.ceil(rendered.frames.length / columns) * rendered.height, data = new Uint8Array(width * height * 4);
  rendered.frames.forEach((frame, i) => {
    for (let y = 0; y < rendered.height; y++) {
      data.set(frame.data.subarray(y * rendered.width * 4, (y + 1) * rendered.width * 4),
        ((Math.floor(i / columns) * rendered.height + y) * width + i % columns * rendered.width) * 4);
    }
  });
  return { width, height, data };
}
