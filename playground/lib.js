export function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  return Math.sign(left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
}
export const filterExamples = (entries, version) => entries.filter(entry => compareVersions(entry.minVersion, version) <= 0);
export const formatSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
export const safeName = name => String(name ?? '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 96) || 'recipe';
export const engineBase = (version, override = null) => override ?? `https://cdn.jsdelivr.net/npm/pixelbolt@${version}/src/`;

export function engineOverride(pageURL) {
  const page = new URL(pageURL), requested = page.searchParams.get('engine');
  if (requested === null) return { base: null, notice: '' };
  const refused = { base: null, notice: 'Ignored ?engine=: use this page’s origin, or loopback on both URLs.' };
  try {
    const url = new URL(requested, page), loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    if (!['http:', 'https:'].includes(url.protocol) || !['http:', 'https:'].includes(page.protocol) || url.username || url.password || url.search || url.hash) return refused;
    if (url.origin !== page.origin && !(loopback(url.hostname) && loopback(page.hostname))) return refused;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return { base: url.href, notice: 'Local test engine override is active. The version label is requested metadata; this engine may differ.' };
  } catch { return refused; }
}

// Moves a playing animation on to time `now`. `nextAt` is when the shown step ends; overshoot carries over, so short
// frames play at their real speed however often the screen repaints. A one-shot animation holds its last step for
// `hold` ms before playing again. Returns the new position, the new end time and whether the step changed.
export function advancePlayback({ position, nextAt, now, durations, loop, hold = 600 }) {
  if (!nextAt) return { position, nextAt: now + durations[position], moved: false };
  let moved = false;
  for (let guard = 0; now >= nextAt && guard < 100000; guard++) {
    position = (position + 1) % durations.length; moved = true;
    nextAt += durations[position] + (!loop && position === durations.length - 1 ? hold : 0);
  }
  // A stalled tab picks up from now instead of racing through every step it missed.
  if (now >= nextAt) nextAt = now + durations[position];
  return { position, nextAt, moved };
}

// Edits nobody has kept yet (by downloading the recipe or copying its link). Whatever would replace the recipe asks
// first through `keep()`, which is true when the person chose to keep their edits; and while there are edits, leaving
// or reloading the page asks too. That listener is only on `target` while needed: a page with one can't be kept in the
// browser's back/forward cache.
export const REPLACE_EDITS = 'Replace your edited recipe? Download it or copy its link first if you want to keep it.';
export function editGuard({ ask, target }) {
  let unsaved = false;
  const warn = event => { event.preventDefault(); event.returnValue = ''; };
  return {
    get unsaved() { return unsaved; },
    set(value) {
      if (value === unsaved) return;
      unsaved = value;
      if (value) target.addEventListener('beforeunload', warn); else target.removeEventListener('beforeunload', warn);
    },
    keep: () => unsaved && !ask(REPLACE_EDITS)
  };
}

// The render time limit. `?limit=<ms>` (100 to 20000) lowers it for tests, and only on a loopback page, so a shared
// link can't change it for anyone else.
export function timeLimit(pageURL, fallback = 20000) {
  const page = new URL(pageURL), requested = page.searchParams.get('limit');
  if (requested === null || !['localhost', '127.0.0.1', '[::1]'].includes(page.hostname) || !/^\d{3,5}$/.test(requested)) return fallback;
  return Math.min(fallback, Math.max(100, Number(requested)));
}

export function jsonErrorLocation(text, error) {
  const message = typeof error === 'string' ? error : error.message;
  const lineColumn = /(?:at\s+)?line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]), message };
  const position = /position\s+(\d+)/i.exec(message);
  if (position) {
    const before = text.slice(0, Number(position[1])), lines = before.split('\n');
    return { line: lines.length, column: lines.at(-1).length + 1, message };
  }
  return { message };
}

export function examplePath(name, from = '') {
  if (typeof name !== 'string' || !name.split('/').every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part))) {
    throw new Error(`Example reference ${String(name)} must be a plain relative name inside the examples folder.`);
  }
  return from.slice(0, from.lastIndexOf('/') + 1) + name;
}

// The same palette inheritance, passes and themes as resolve.js, with a caller-supplied reader instead of files.
export async function inlineExample(document, file, read) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const shared = async (reference, from) => {
    const value = await read(examplePath(reference, from)), palette = object(value?.palette) ? value.palette : value;
    if (!object(palette) || Object.values(palette).some(color => typeof color !== 'string')) throw new Error(`${reference} must contain a palette object of colour strings.`);
    if (Object.hasOwn(palette, '$ref')) throw new Error('Nested palette references are not supported.');
    return { palette, ramps: object(value?.palette) ? value.ramps : null };
  };
  const palette = async (value, from) => {
    if (!object(value?.palette) || !Object.hasOwn(value.palette, '$ref')) return value;
    const { $ref, ...local } = value.palette, loaded = await shared($ref, from);
    return { ...value, palette: { ...loaded.palette, ...local },
      ...(loaded.ramps && value.format === undefined && value.ramps === undefined ? { ramps: loaded.ramps } : {}) };
  };
  const recipe = async (value, from) => {
    if (typeof value === 'string') { const path = examplePath(value, from); return palette(await read(path), path); }
    if (value?.revision !== undefined) throw new Error('Saved revision references need the MCP server; inline the recipe here.');
    return palette(value, from);
  };
  const theme = async value => typeof value === 'string' ? (await shared(value, file)).palette : value;
  if (document?.format === 'pixelforge-scene' && object(document.assets)) {
    const assets = [];
    for (const [id, value] of Object.entries(document.assets)) {
      if (object(value) && value.version === undefined && ['recipe', 'normal', 'emissive'].some(key => value[key] !== undefined)) {
        const entry = { ...value };
        for (const key of ['recipe', 'normal', 'emissive']) if (value[key] !== undefined) entry[key] = await recipe(value[key], file);
        if (value.palette !== undefined) entry.palette = await theme(value.palette);
        assets.push([id, entry]);
      } else assets.push([id, await recipe(value, file)]);
    }
    return { ...document, assets: Object.fromEntries(assets), ...(document.palette !== undefined ? { palette: await theme(document.palette) } : {}) };
  }
  if (document?.format === 'pixelforge-normals' && document.recipe !== undefined) return { ...document, recipe: await recipe(document.recipe, file) };
  return palette(document, file);
}
