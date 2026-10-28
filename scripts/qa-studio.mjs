// Walks the studio in a real browser, the way a person would use it: every sample, editing, a broken recipe, the
// preview controls, downloads that really land on disk, draft recovery, keyboard access, narrow and wide windows and
// the scene page. It drives an installed Chromium-based browser (Edge or Chrome) headless, with a throwaway profile,
// over the DevTools protocol, using only Node's own WebSocket (Node.js 22 or newer). Nothing is installed.
//   node scripts/qa-studio.mjs [--app <package folder>] [--browser <program>] [--browser-arg <flag>]... [--out <new folder>]
// --app is the package to serve: this checkout by default, or the app folder of an extracted portable build.
// Screenshots and the downloaded files are kept in --out (default: a new folder under output/studio-qa).
// Exit code 3 means no browser was found, so nothing was checked.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readZip } from './build-studio.mjs';
import { FLUID_PRESETS } from '../studio/fluid-controls.js';

const root = fileURLToPath(new URL('../', import.meta.url)), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const options = { app: root, 'browser-arg': [] };
for (let args = process.argv.slice(2), i = 0; i < args.length; i++) {
  if (!['--app', '--browser', '--out', '--browser-arg'].includes(args[i]) || !args[i + 1]) { console.error(`Unknown or incomplete option: ${args[i]}`); process.exit(2); }
  if (args[i] === '--browser-arg') options['browser-arg'].push(args[++i]); else options[args[i].slice(2)] = args[++i];
}
if (typeof WebSocket !== 'function') { console.error('This check needs Node.js 22 or newer, which has a WebSocket client built in.'); process.exit(2); }

// Edge first on Windows, where it is always present; Chrome first elsewhere.
const programs = base => [path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')];
const installed = {
  win32: [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean).flatMap(programs).sort((a, b) => b.includes('Edge') - a.includes('Edge')),
  darwin: ['Google Chrome', 'Microsoft Edge', 'Chromium'].map(name => `/Applications/${name}.app/Contents/MacOS/${name}`),
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].flatMap(name => ['/usr/bin', '/usr/local/bin', '/snap/bin'].map(folder => `${folder}/${name}`))
}[process.platform] ?? [];
let program = options.browser ?? null;
for (const candidate of program ? [] : installed) if (await access(candidate).then(() => true, () => false)) { program = candidate; break; }
if (!program) { console.log('No Chromium-based browser (Edge or Chrome) was found, so the studio was not walked. Name one with --browser.'); process.exit(3); }

const out = options.out ? path.resolve(options.out) : null, results = [];
if (out) await mkdir(out); else await mkdir(path.join(root, 'output', 'studio-qa'), { recursive: true });
const kept = out ?? await mkdtemp(path.join(root, 'output', 'studio-qa', 'run-')), profile = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-browser-'));
const check = async (name, run) => {
  try { const detail = await run(); results.push({ name, ok: true }); console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`  FAIL  ${name}\n        ${String(error.message).replace(/\n/g, '\n        ')}`); }
};
const note = text => console.log(`  note  ${text}`);

const { startStudio } = await import(pathToFileURL(path.join(path.resolve(options.app), 'src', 'server.js')));
const { renderProject, MAX_REQUEST_BYTES } = await import(pathToFileURL(path.join(path.resolve(options.app), 'src', 'core.js')));
const { compilePoses } = await import(pathToFileURL(path.join(path.resolve(options.app), 'src', 'authoring.js')));
const server = await startStudio({ port: 0, quiet: true }), origin = `http://127.0.0.1:${server.address().port}`;
// Every studio the walk opens; a linked recipe gets one of its own from `pixelbolt preview`.
const origins = [origin];
const browser = spawn(program, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--mute-audio', '--window-size=1440,900', ...options['browser-arg'], 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let exitCode = 1, closeBrowser = null;
try {
  // The browser writes its DevTools address into the profile. The program that was started may hand over to another
  // process and exit at once (Edge does on Windows), so its exit says nothing; the file does.
  let complaints = '';
  browser.stderr.on('data', chunk => { complaints += chunk; }); browser.once('error', error => { complaints += error.message; });
  const endpoint = await (async () => {
    for (const start = Date.now(); Date.now() - start < 30000; await sleep(100)) {
      const [port, address] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n');
      if (address) return `ws://127.0.0.1:${port}${address}`;
    }
    throw new Error(`the browser did not open its DevTools port within 30 seconds:\n${complaints}`);
  })();
  // One connection to the browser; each page is a session on it.
  const socket = new WebSocket(endpoint), pending = new Map(), listeners = new Set();
  let sequence = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', () => reject(new Error('could not connect to the browser'))); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) { for (const listener of listeners) listener(message); return; }
    const waiting = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`)); else waiting.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { pending.set(++sequence, { resolve, reject, method }); socket.send(JSON.stringify({ id: sequence, method, params, ...(sessionId && { sessionId }) })); });
  closeBrowser = () => Promise.race([send('Browser.close'), sleep(3000)]);
  const version = await send('Browser.getVersion');
  console.log(`Studio ${origin} from ${path.resolve(options.app)}\nBrowser ${version.product}, headless, throwaway profile\nKeeping screenshots and downloads in ${kept}`);

  // Everything a page reports as wrong, and every address it asks for, is collected for the last check.
  const problems = [], requests = [], dialogs = [];
  async function openPage() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' }), { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    listeners.add(message => {
      if (message.sessionId !== sessionId) return;
      const { method, params } = message;
      if (method === 'Runtime.exceptionThrown') problems.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') problems.push(`console.error: ${params.args.map(arg => arg.value ?? arg.description).join(' ')}`);
      else if (method === 'Log.entryAdded' && params.entry.level === 'error') problems.push(`${params.entry.source}: ${params.entry.text} ${params.entry.url ?? ''}`);
      else if (method === 'Network.requestWillBeSent') requests.push(params.request.url);
      else if (method === 'Page.javascriptDialogOpening') { dialogs.push(`${params.type}: ${params.message}`); page('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
    });
    for (const domain of ['Page', 'Runtime', 'Network', 'Log', 'DOM']) await page(`${domain}.enable`);
    // Some systems (Windows Server, some macOS images) ask for reduced motion, and the studio then starts paused.
    // The walk sets the preference itself so that it sees the same studio everywhere.
    const motion = value => page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
    await motion('no-preference');
    const evaluate = async expression => {
      const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    // A page that is navigating cannot answer; that counts as "not yet". The wait asks whether something happens, not
    // how fast: it returns as soon as it does, and the 30 s is room for a busy CI runner (a cold browser on one took
    // more than 8 s to load the studio), so only something that never happens fails.
    const until = async (expression, what, timeout = 30000) => {
      for (const start = Date.now(); ;) { const value = await evaluate(expression).catch(() => false); if (value) return value; if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`); await sleep(50); }
    };
    const goto = async url => { await page('Page.navigate', { url }); await until('document.readyState === "complete"', `${url} to load`); };
    const reload = async () => { await evaluate('window.__before = true'); await page('Page.reload'); await until('!window.__before && document.readyState === "complete"', 'the page to reload'); };
    // A real mouse click at the middle of the element, so the page sees a user gesture.
    const click = async selector => {
      const at = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; element.scrollIntoView({ block: 'center', inline: 'center' }); const box = element.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
      assert.ok(at, `nothing matches ${selector}`);
      for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    };
    // Only the portable key code is sent. A native code means another key on macOS, and naming an editing command
    // there (insertTab) makes the browser type a tab into a text field instead of moving focus.
    const key = async (name, code, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp']) await page('Input.dispatchKeyEvent', { type, key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code, modifiers, ...(type === 'keyDown' && name === ' ' && { text: ' ' }) });
    };
    const choose = (id, value) => evaluate(`(() => { const select = document.getElementById(${JSON.stringify(id)}); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); return select.value; })()`);
    const size = (width, height) => page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const shot = async (name, whole = false) => { await writeFile(path.join(kept, `${name}.png`), Buffer.from((await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: whole })).data, 'base64')); };
    const close = () => send('Target.closeTarget', { targetId });
    return { page, evaluate, until, goto, reload, click, key, choose, size, shot, motion, close };
  }
  let downloads = 0;
  // Runs `action` and returns the file the browser saved because of it.
  async function download(action) {
    const folder = path.join(kept, 'downloads', String(++downloads));
    await mkdir(folder, { recursive: true });
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: folder, eventsEnabled: true });
    const saved = new Promise((resolve, reject) => {
      let filename = null;
      const timer = setTimeout(() => { listeners.delete(listener); reject(new Error('no download arrived within 30 seconds')); }, 30000);
      const listener = ({ method, params }) => {
        if (method === 'Browser.downloadWillBegin') filename = params.suggestedFilename;
        else if (method === 'Browser.downloadProgress' && params.state !== 'inProgress') { clearTimeout(timer); listeners.delete(listener); params.state === 'completed' ? resolve(path.join(folder, filename)) : reject(new Error(`the download was ${params.state}`)); }
      };
      listeners.add(listener);
    });
    await action();
    return saved;
  }

  const studio = await openPage(), { evaluate, until, click, key, choose } = studio;
  const text = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  // What the preview canvas shows: its size, how many pixels are drawn, the colours and a hash of every pixel.
  const canvas = () => evaluate(`(() => { const c = document.getElementById('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, colors = new Set(); let drawn = 0, hash = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3]) { drawn++; colors.add((d[i] << 16 | d[i + 1] << 8 | d[i + 2]).toString(16).padStart(6, '0')); } hash = (hash * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0; } return { width: c.width, height: c.height, shown: c.style.width, drawn, hash, colors: [...colors] }; })()`);
  const pressed = id => evaluate(`document.getElementById(${JSON.stringify(id)}).getAttribute('aria-pressed')`);
  const loaded = `document.querySelectorAll('#examples .example').length > 0 && document.getElementById('example-count').textContent !== '' && document.getElementById('source').value.length > 0 && document.getElementById('timeline').children.length > 0`;
  const ready = (page = studio) => page.until(loaded, 'the studio to finish loading');
  // Replaces the whole recipe the way typing does, then pauses; each caller waits for what the recompile shows.
  const type = async recipe => {
    await evaluate(`(() => { const source = document.getElementById('source'); source.focus(); source.select(); })()`);
    await studio.page('Input.insertText', { text: recipe });
    await sleep(600);
  };
  const samples = await (async () => { await studio.size(1440, 900); await studio.goto(`${origin}/`); await ready(); return evaluate(`[...document.querySelectorAll('#examples .example')].map(button => ({ file: button.dataset.file, title: button.querySelector('strong').textContent }))`); })();

  console.log('Samples and playback');
  await check('the studio loads with its samples listed and counted, and the first one drawn', async () => {
    assert.equal(await evaluate('document.title'), 'Pixelbolt · Sprite studio');
    assert.ok(samples.length >= 7); assert.equal(await text('example-count'), String(samples.length).padStart(2, '0'));
    assert.equal(await evaluate(`document.getElementById('error').hidden`), true); assert.ok((await canvas()).drawn > 0);
    await studio.shot('wide'); return `${samples.length} samples`;
  });
  await check('the animation plays, pauses, and a frame can be picked from the timeline', async () => {
    const before = await text('frame-counter');
    await until(`document.getElementById('frame-counter').textContent !== ${JSON.stringify(before)}`, 'the frame counter to advance');
    await click('#play'); assert.equal(await evaluate(`document.getElementById('play').getAttribute('aria-label')`), 'Play animation');
    await click('#timeline .frame:nth-child(2)');
    assert.match(await text('frame-counter'), /^02 \//); assert.equal(await evaluate(`document.querySelector('#timeline .frame:nth-child(2)').getAttribute('aria-pressed')`), 'true');
    await click('#play'); assert.equal(await evaluate(`document.getElementById('play').getAttribute('aria-label')`), 'Pause animation');
  });
  for (const [index, sample] of samples.entries()) await check(`sample "${sample.title}" opens and renders`, async () => {
    await click(`#examples .example:nth-child(${index + 1})`);
    await until(`document.querySelector('#examples .example:nth-child(${index + 1})').classList.contains('active') && document.getElementById('source').value.includes(${JSON.stringify(`"name": "`)})`, 'the sample to load');
    // Wait for the drawing rather than a fixed pause; if it never comes, the assertion below says what is missing.
    await until(`(() => { const c = document.getElementById('canvas'); if (!c.width || !document.getElementById('timeline').children.length) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })()`, 'the sample to draw').catch(() => {});
    const [drawn, frames, hidden, status] = [(await canvas()).drawn, await evaluate(`document.getElementById('timeline').children.length`), await evaluate(`document.getElementById('error').hidden`), await text('compile-status')];
    assert.ok(drawn > 0 && frames > 0 && hidden, `drawn ${drawn}, frames ${frames}, error hidden ${hidden}`);
    await studio.shot(`sample-${sample.file.replace('/', '-')}`); return `${frames} frames, ${status.replace('● ', '')}`;
  });

  console.log('Moving figures');
  await check('pose source opens, plays, reviews contacts and saves its editable source', async () => {
    // The R2 rig is a test fixture, not a shipped example: open it as a user would open their own pose source.
    const { heroRig } = await import('./figure-rigs.mjs'), figure = path.join(kept, 'figure.poses.json');
    await writeFile(figure, JSON.stringify(heroRig(), null, 2));
    const { root: { nodeId: documentNode } } = await studio.page('DOM.getDocument'), picker = await studio.page('DOM.querySelector', { nodeId: documentNode, selector: '#file' });
    await studio.page('DOM.setFileInputFiles', { files: [figure], nodeId: picker.nodeId });
    await until(`document.getElementById('project-name').textContent === 'Brass courier'`, 'the figure');
    await choose('animation', 'run');
    if (await evaluate(`document.getElementById('play').getAttribute('aria-label') === 'Play animation'`)) await click('#play');
    const before = await text('frame-counter'); await until(`document.getElementById('frame-counter').textContent !== ${JSON.stringify(before)}`, 'the figure to move');
    await click('#timeline .frame:nth-child(1)');
    const plain = await canvas(); await click('#contacts'); assert.notEqual((await canvas()).hash, plain.hash); await click('#contacts');
    await click('#motion-view'); assert.match(await text('motion-summary'), /pass/); assert.doesNotMatch(await text('motion-summary'), /check|unavailable/);
    assert.ok((await canvas()).width > plain.width); await studio.shot('figure-motion');
    await choose('motion-speed', '0'); assert.match(await text('motion-summary'), /check/); await choose('motion-speed', '48');
    await click('#animation-view'); await choose('zoom', '4'); await click('#contacts'); await studio.shot('figure-contacts');
    await studio.size(390, 844);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'figure controls cause horizontal overflow');
    await studio.shot('figure-narrow'); await studio.size(1440, 900); await click('#contacts');
    const saved = await download(() => click('#save'));
    assert.equal(JSON.parse(await readFile(saved, 'utf8')).format, 'pixelforge-poses');
    const { root: { nodeId } } = await studio.page('DOM.getDocument'), input = await studio.page('DOM.querySelector', { nodeId, selector: '#file' });
    await studio.page('DOM.setFileInputFiles', { files: [saved], nodeId: input.nodeId });
    await until(`document.getElementById('toast').textContent.startsWith('Opened ')`, 'saved poses to reopen');
  });
  await check('R1–R3 compiled JSON and every RGBA frame match Node in the browser', async () => {
    const { skinkRig, heroRig, bossRig } = await import('./figure-rigs.mjs');
    const hashes = [];
    for (const build of [skinkRig, heroRig, bossRig]) {
      const source = build(), compiled = compilePoses(source), project = renderProject(compiled.recipe);
      const sha = data => createHash('sha256').update(data).digest('hex');
      const expected = { compiled: sha(JSON.stringify(compiled)), rgba: project.frames.map(f => sha(f.data)) };
      const actual = await evaluate(`(async () => {
        const {compilePoses} = await import('/authoring.js'), {renderProject} = await import('/core.js');
        const compiled = compilePoses(${JSON.stringify(source)}), project = renderProject(compiled.recipe);
        const sha = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2,'0')).join('');
        return { compiled: await sha(new TextEncoder().encode(JSON.stringify(compiled))), rgba: await Promise.all(project.frames.map(f => sha(f.data))) };
      })()`);
      assert.deepEqual(actual, expected, build.name); hashes.push({ fixture: build.name, ...actual });
    }
    await writeFile(path.join(kept, 'figure-browser-hashes.json'), JSON.stringify(hashes, null, 2));
    return 'all 148 frames and complete recipe/metadata JSON';
  });
  await check('R2 live edits each redraw once, timed against the 500 ms budget', async () => {
    // Each edit must reach one compile and a painted frame. How long that takes (debounce, compile, render, DOM work and
    // a browser paint) is recorded against the 500 ms p95 budget, but a busy CI machine is not a broken studio: going
    // over it is a warning, never a failure. Forty timed edits after three warm-ups; an edit that never redraws fails.
    const { renders, times } = await evaluate(`(async () => {
      const source = document.getElementById('source'), values = [];
      let renders = 0;
      const count = () => { renders++; };
      source.addEventListener('pixelbolt:rendered', count);
      try {
        for (let i=0; i<43; i++) {
          const value = JSON.parse(source.value); value.motions.run.lean = i%2 ? 8 : 7;
          const start = performance.now();
          await new Promise((resolve, reject) => {
            const lost = setTimeout(() => reject(new Error('edit ' + (i + 1) + ' never redrew: ' + document.getElementById('compile-status').textContent)), 30000);
            source.addEventListener('pixelbolt:rendered', () => requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(lost); resolve(); })), {once:true});
            source.value = JSON.stringify(value, null, 2); source.dispatchEvent(new Event('input', {bubbles:true}));
          });
          if (i>=3) values.push(performance.now()-start);
        }
      } finally { source.removeEventListener('pixelbolt:rendered', count); }
      return { renders, times: values.sort((a,b)=>a-b) };
    })()`);
    assert.equal(renders, 43, `43 edits should redraw 43 times, not ${renders}`);
    const result = { medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * .95) - 1], maxMs: times.at(-1), budgetMs: 500, samples: times, browser: version.product };
    await writeFile(path.join(kept, 'figure-edit-latency.json'), JSON.stringify(result, null, 2));
    const timing = `${result.medianMs.toFixed(1)} ms median / ${result.p95Ms.toFixed(1)} ms p95 / ${result.maxMs.toFixed(1)} ms slowest of ${times.length}; reference target 100 ms`;
    if (result.p95Ms <= result.budgetMs) return timing;
    note(`R2 live edits took ${result.p95Ms.toFixed(1)} ms at the 95th percentile, over the ${result.budgetMs} ms budget. A busy machine can do this, so it fails nothing; compare with an idle run before acting.`);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Studio edit latency::R2 live edits took ${result.p95Ms.toFixed(1)} ms at the 95th percentile in ${version.product}, over the ${result.budgetMs} ms budget. This never fails CI.`);
    return `${timing}; over the ${result.budgetMs} ms budget, reported only`;
  });

  console.log('Preview controls');
  const spirit = samples.findIndex(sample => sample.file === 'forest-spirit') + 1;
  await click(`#examples .example:nth-child(${spirit})`); await until(`document.getElementById('project-name').textContent === 'Forest spirit'`, 'the forest spirit');
  await click('#play'); await click('#timeline .frame:nth-child(1)');
  const still = await canvas();
  await check('zoom, grid, onion skin, review view and sheet view each change the preview and change it back', async () => {
    await choose('zoom', '4'); assert.equal((await canvas()).shown, `${still.width * 4}px`); await choose('zoom', '12');
    await click('#grid'); assert.deepEqual([await pressed('grid'), await evaluate(`document.getElementById('canvas-wrap').classList.contains('grid')`)], ['true', true]);
    await click('#grid'); assert.equal(await pressed('grid'), 'false');
    await click('#onion'); assert.equal(await pressed('onion'), 'true'); assert.notEqual((await canvas()).hash, still.hash, 'onion skin drew nothing extra');
    await click('#onion'); assert.equal((await canvas()).hash, still.hash);
    await choose('review-view', 'silhouette'); const silhouette = await canvas(); assert.notEqual(silhouette.hash, still.hash); assert.ok(silhouette.colors.length < still.colors.length);
    await choose('review-view', 'color'); assert.equal((await canvas()).hash, still.hash);
    await click('#sheet-view'); const sheet = await canvas(); assert.ok(sheet.width > still.width, 'the sheet is no wider than one frame'); assert.match(await text('artboard-caption'), /Export layout/);
    await click('#animation-view'); assert.equal((await canvas()).hash, still.hash);
  });
  await check('the wheel zooms at the pointer, dragging pans, the − and 0 keys zoom out and fit, and full screen fills the window until Escape', async () => {
    const view = () => evaluate(`(() => { const b = document.getElementById('artboard'), c = document.getElementById('canvas').getBoundingClientRect(), box = b.getBoundingClientRect(); return { zoom: document.getElementById('zoom').value, left: b.scrollLeft, top: b.scrollTop, maxLeft: b.scrollWidth - b.clientWidth, maxTop: b.scrollHeight - b.clientHeight, canvas: { x: c.left, y: c.top, w: c.width, h: c.height }, x: box.left + box.width / 2, y: box.top + box.height / 2, inner: { x: box.left + b.clientLeft + b.clientWidth / 2, y: box.top + b.clientTop + b.clientHeight / 2 }, pannable: b.classList.contains('pannable') }; })()`);
    await evaluate(`document.getElementById('artboard').scrollIntoView({ block: 'center' })`);
    let at = await view();
    // One wheel notch is one step (12× to 16×). Along a side where the picture overflows the artboard, the picture
    // point under the pointer stays under it; along a side where it fits, the picture stays centred.
    const point = { x: at.x + 30, y: at.y + 20 }, u = (point.x - at.canvas.x) / at.canvas.w, v = (point.y - at.canvas.y) / at.canvas.h;
    await studio.page('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -100 });
    await until(`document.getElementById('zoom').value === '16'`, 'the wheel to zoom in one step');
    at = await view();
    assert.ok(at.maxTop > 0, 'a 16× sprite should overflow the artboard\'s height');
    assert.ok(Math.abs(at.canvas.y + v * at.canvas.h - point.y) < 1.5, 'the picture moved under the pointer');
    assert.ok(at.maxLeft > 0 ? Math.abs(at.canvas.x + u * at.canvas.w - point.x) < 1.5 : Math.abs(at.canvas.x + at.canvas.w / 2 - at.inner.x) < 1.5, 'the picture is neither under the pointer nor centred across');
    // Dragging moves the picture with the pointer, as far as the artboard scrolls.
    await choose('zoom', '32'); at = await view(); assert.equal(at.pannable, true, 'a 32× sprite does not pan');
    await studio.page('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
    await studio.page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 40, y: at.y - 30, button: 'left', buttons: 1 });
    await studio.page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x - 40, y: at.y - 30, button: 'left', clickCount: 1 });
    const panned = await view();
    assert.deepEqual([panned.left, panned.top], [Math.min(at.maxLeft, at.left + 40), Math.min(at.maxTop, at.top + 30)]);
    await evaluate(`document.activeElement.blur()`);
    await key('-', 189); await until(`document.getElementById('zoom').value === '24'`, 'the − key to zoom out');
    await key('0', 48); await until(`document.getElementById('zoom').value === 'fit'`, 'the 0 key to fit');
    const fitted = await view(); assert.equal(fitted.pannable, false, 'the fitted sprite still overflows the artboard');
    await click('#fullscreen');
    await until(`document.querySelector('.artboard-section').classList.contains('expanded')`, 'full screen');
    assert.deepEqual(await evaluate(`(() => { const r = document.querySelector('.artboard-section').getBoundingClientRect(); return [r.left, r.top, Math.round(r.width) === innerWidth, Math.round(r.height) === innerHeight, document.getElementById('fullscreen').getAttribute('aria-pressed')]; })()`), [0, 0, true, true, 'true']);
    assert.ok((await view()).canvas.w > fitted.canvas.w, 'the fitted sprite did not grow in full screen');
    await studio.shot('full-screen');
    await key('Escape', 27);
    await until(`!document.querySelector('.artboard-section').classList.contains('expanded') && !document.fullscreenElement`, 'Escape to leave full screen');
    await choose('zoom', '12');
    return `fit ${Math.round(fitted.canvas.w / still.width)}×, larger in full screen`;
  });
  await check('the animation, speed and palette controls respond', async () => {
    const [timing, others] = [await text('timing'), await evaluate(`[...document.getElementById('animation').options].map(option => option.value)`)];
    await choose('animation', others.at(-1)); assert.notEqual(await text('timing'), timing); await choose('animation', others[0]);
    assert.equal(await choose('speed', '2'), '2'); await click('#play');
    const before = await text('frame-counter'); await until(`document.getElementById('frame-counter').textContent !== ${JSON.stringify(before)}`, 'playback at double speed'); await click('#play'); await choose('speed', '1');
    await click('#palette .swatch'); assert.match(await text('color-info'), /#[0-9a-f]{6}/i);
    return `${others.length} animations`;
  });

  console.log('Editing');
  const original = await evaluate(`document.getElementById('source').value`), edited = original.replace('"#72b58d"', '"#ff00ff"');
  // Each edit waits for what the studio's recompile shows, since a busy machine can run it later than type()'s pause.
  await check('an edit to the recipe updates the preview', async () => {
    assert.notEqual(edited, original);
    await type(edited);
    await until(`[...document.querySelectorAll('#palette .swatch')].some(swatch => swatch.title.includes('#ff00ff'))`, 'the palette to show the new colour');
    await click('#timeline .frame:nth-child(1)');
    assert.ok((await canvas()).colors.includes('ff00ff'), 'the new colour is not in the preview');
  });
  await check('a broken recipe shows what is wrong, and the studio recovers when it is mended', async () => {
    await type(edited.slice(0, -3)); await until(`!document.getElementById('error').hidden`, 'the error for the broken recipe');
    assert.deepEqual([await evaluate(`document.getElementById('error').hidden`), await evaluate(`document.getElementById('export').disabled`)], [false, true]);
    const message = await text('error'); assert.ok(message.length > 5); assert.match(await text('compile-status'), /Fix the recipe/);
    await studio.shot('broken-recipe');
    await type(edited); await until(`document.getElementById('error').hidden`, 'the mended recipe to recompile');
    assert.deepEqual([await evaluate(`document.getElementById('error').hidden`), await evaluate(`document.getElementById('export').disabled`)], [true, false]);
    return message.slice(0, 60);
  });

  console.log('Files');
  let savedRecipe;
  await check('Save JSON puts the recipe on disk exactly as it is in the editor', async () => {
    savedRecipe = await download(() => click('#save'));
    assert.equal(path.basename(savedRecipe), 'forest-spirit.pixel.json'); assert.equal(await readFile(savedRecipe, 'utf8'), edited);
    // The page cannot see whether the browser kept the file, so it does not say it did.
    assert.equal(await text('toast'), 'Sent forest-spirit.pixel.json to your browser to save. Until you load another recipe, its draft is kept here too.'); return path.basename(savedRecipe);
  });
  await check('Open project brings the saved recipe back', async () => {
    await click('#new'); await until(`document.getElementById('project-name').textContent === 'New sprite'`, 'the blank canvas');
    const { root: { nodeId } } = await studio.page('DOM.getDocument'), input = await studio.page('DOM.querySelector', { nodeId, selector: '#file' });
    await studio.page('DOM.setFileInputFiles', { files: [savedRecipe], nodeId: input.nodeId });
    await until(`document.getElementById('project-name').textContent === 'Forest spirit'`, 'the opened recipe');
    assert.equal(await evaluate(`document.getElementById('source').value`), JSON.stringify(JSON.parse(edited), null, 2)); assert.match(await text('toast'), /^Opened /);
  });
  await check('Open project accepts a valid saved recipe larger than 2 MiB', async () => {
    const recipe = { version: 1, name: 'large-project', width: 128, height: 128, palette: { x: '#72b58d' }, frames: Array.from({ length: 128 }, (_, i) => ({ name: `frame-${i}`, ops: [{ op: 'grid', rows: Array(128).fill('x'.repeat(128)) }] })) };
    const rendered = renderProject(recipe), json = JSON.stringify(recipe, null, 2), bytes = Buffer.byteLength(json), file = path.join(kept, 'large-project.pixel.json');
    assert.ok(bytes > 2 * 1024 * 1024 && bytes < MAX_REQUEST_BYTES, `fixture size: ${bytes} bytes`);
    assert.equal(rendered.frames.length, 128);
    await writeFile(file, json);
    const { root: { nodeId } } = await studio.page('DOM.getDocument'), input = await studio.page('DOM.querySelector', { nodeId, selector: '#file' });
    try {
      await studio.page('DOM.setFileInputFiles', { files: [file], nodeId: input.nodeId });
      await until(`document.getElementById('file').value === ''`, 'the large file to finish opening');
      assert.equal(await text('toast'), 'Opened large-project.pixel.json', 'opening a valid large recipe must not show an error toast');
      assert.equal(await text('project-name'), 'Large project');
      assert.equal(await evaluate(`document.getElementById('error').hidden`), true);
      assert.equal(await evaluate(`document.getElementById('timeline').children.length`), 128);
      assert.deepEqual(JSON.parse(await evaluate(`document.getElementById('source').value`)), recipe);
    } finally {
      // Leave the saved forest spirit in place for the existing export checks.
      await studio.page('DOM.setFileInputFiles', { files: [savedRecipe], nodeId: input.nodeId });
      await until(`document.getElementById('project-name').textContent === 'Forest spirit'`, 'the saved recipe to be restored');
    }
    return `${bytes} bytes, 128 frames`;
  });
  await check('Export assets downloads a ZIP whose preview.html shows every animation from disk', async () => {
    const zip = await download(() => click('#export')), entries = readZip(await readFile(zip)), folder = path.join(kept, 'exported');
    assert.equal(path.basename(zip), 'forest-spirit.zip');
    for (const file of ['forest-spirit.png', 'forest-spirit.atlas.json', 'forest-spirit.pixel.json', 'forest-spirit.css', 'player.js', 'preview.html']) assert.ok(entries.has(file), `${file} is missing from the ZIP`);
    for (const [file, entry] of entries) { await mkdir(path.dirname(path.join(folder, file)), { recursive: true }); await writeFile(path.join(folder, file), entry.read()); }
    const preview = await openPage();
    await preview.goto(pathToFileURL(path.join(folder, 'preview.html')).href);
    const images = await preview.evaluate(`Promise.all([...document.images].map(image => image.decode().then(() => image.naturalWidth, () => 0)))`);
    assert.ok(images.length > 0 && images.every(width => width > 0), `images that did not load: ${images}`);
    assert.equal(images.length, [...entries.keys()].filter(file => file.startsWith('animations/')).length);
    await preview.shot('exported-preview'); return `${entries.size} files, ${images.length} animations shown`;
  });
  await check('GIF downloads the current animation at the current zoom, and the browser decodes it', async () => {
    await choose('zoom', '4');
    const gif = await download(() => click('#gif')), bytes = await readFile(gif), expected = await evaluate(`document.getElementById('timeline').children.length`);
    assert.match(path.basename(gif), /^forest-spirit-.+\.gif$/); assert.equal(bytes.toString('latin1', 0, 6), 'GIF89a');
    const decoded = await evaluate(`(async () => { const decoder = new ImageDecoder({ data: Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0)), type: 'image/gif' }); try { await decoder.tracks.ready; await decoder.completed; const { image } = await decoder.decode({ frameIndex: 0 }); try { return { frames: decoder.tracks.selectedTrack.frameCount, width: image.displayWidth }; } finally { image.close(); } } finally { decoder.close(); } })()`);
    assert.deepEqual(decoded, { frames: expected, width: still.width * 4 }); await choose('zoom', '12');
    return `${path.basename(gif)}, ${decoded.frames} frames, ${decoded.width} px wide`;
  });
  await check('Frames exports numbered PNG frames for a video editor, and shows the same call for the command line and MCP', async () => {
    const open = `document.getElementById('frames-dialog').open`, animation = await evaluate(`document.getElementById('animation').value`), base = `forest-spirit-${animation}`;
    await click('#frames'); await until(open, 'the frames dialog');
    await choose('frames-fps', '24'); await choose('frames-size', '720p'); await studio.shot('frames-dialog');
    const call = await text('frames-call');
    assert.ok(call.startsWith(`pixelbolt sequence forest-spirit.pixel.json --fps 24 --size 720p --animation ${animation} --out frames\n`), call);
    assert.ok(call.includes(`pixel_render { "revision": "…", "sequence": {"fps":"24","animation":"${animation}","size":"720p"} }`), call);
    const zip = await download(() => click('#frames-export')), entries = readZip(await readFile(zip)), info = JSON.parse(entries.get(`${base}/sequence.json`).read().toString());
    const pictures = [...entries.keys()].filter(name => name.endsWith('.png')), first = entries.get(`${base}/${base}_0001.png`).read();
    assert.equal(path.basename(zip), `${base}-frames.zip`);
    assert.deepEqual([info.frames, info.width, info.height, info.fps.label, info.animation], [pictures.length, 1280, 720, '24', animation]);
    assert.deepEqual([first.toString('latin1', 1, 4), first.readUInt32BE(16), first.readUInt32BE(20), entries.has(`${base}/README.txt`)], ['PNG', 1280, 720, true]);
    await until(`!${open}`, 'the dialog to close'); assert.match(await text('toast'), /^Frames saved: \d+ PNGs, 1280 × 720, 24 fps\./);
    // Without a canvas the sprite is exported at the current zoom; Escape closes the dialog without exporting.
    await click('#frames'); await until(open, 'the frames dialog'); await choose('frames-size', '');
    assert.ok((await text('frames-call')).includes('--scale 12 '), await text('frames-call'));
    await key('Escape', 27); await until(`!${open}`, 'Escape to close the dialog');
    return `${pictures.length} frames in ${path.basename(zip)}`;
  });

  console.log('Draft recovery');
  await check('an unsaved edit is offered back after the page is reloaded and restored on request; Save JSON keeps it, and replacing the recipe removes it', async () => {
    await type(edited.replace('"name": "forest-spirit"', '"name": "draft-walk"'));
    // The draft keeps the file name the editor shows, which changes only when the studio recompiles (350 ms after the
    // last keystroke, later on a busy machine). Reloading before that would keep the draft under the old name.
    await until(`document.getElementById('source-filename').textContent === 'draft-walk.json'`, 'the editor to show draft-walk.json before the reload');
    await studio.reload(); await ready();
    assert.equal(await evaluate(`document.getElementById('draft').hidden`), false, 'no draft was offered after the reload'); assert.match(await text('draft-text'), /draft-walk\.json/);
    await studio.shot('draft-offered');
    await click('#draft-restore'); await until(`document.getElementById('project-name').textContent === 'Draft walk'`, 'the draft to be restored');
    assert.equal(await evaluate(`document.getElementById('draft').hidden`), true);
    // Save JSON cannot tell a kept file from a cancelled save dialog, so the draft stays and leaving still asks.
    await download(() => click('#save'));
    const asked = dialogs.length;
    await studio.reload(); await ready();
    assert.ok(dialogs.slice(asked).some(dialog => dialog.startsWith('beforeunload')), 'reloading after Save JSON did not ask first');
    assert.equal(await evaluate(`document.getElementById('draft').hidden`), false, 'Save JSON removed the draft'); assert.match(await text('draft-text'), /^A draft of draft-walk\.json, /);
    // Replacing the recipe on purpose is what removes it, and the question says the file may not have been saved.
    await click('#draft-restore'); await until(`document.getElementById('project-name').textContent === 'Draft walk'`, 'the draft to be restored again');
    await download(() => click('#save'));
    const replacing = dialogs.length;
    await click('#examples .example:nth-child(1)'); await until(`!document.getElementById('source').value.includes('"name": "draft-walk"')`, 'a sample to replace the saved recipe');
    assert.deepEqual(dialogs.slice(replacing), ['confirm: Replace this recipe? Save JSON sent it to your browser; if that save was cancelled, choose Cancel and save again.']);
    await studio.reload(); await ready();
    assert.deepEqual([await evaluate(`document.getElementById('draft').hidden`), await evaluate(`localStorage.length`)], [true, 0]);
  });
  await check('each tab keeps its own draft: another tab loading a sample or editing leaves it alone, and a closed tab\'s draft is offered to the next', async () => {
    // The names of the drafts this browser keeps, from any tab.
    const kept = page => page.evaluate(`Object.keys(localStorage).filter(key => key.startsWith('pixelforge.studio.draft')).map(key => JSON.parse(localStorage.getItem(key)).name).sort().join(', ')`);
    const offered = page => page.evaluate(`document.getElementById('draft').hidden ? 'nothing' : document.getElementById('draft-text').textContent`);
    await type(edited.replace('"name": "forest-spirit"', '"name": "tab-a"'));
    await until(`Object.values(localStorage).some(value => value.includes('tab-a.json'))`, "the first tab's draft");
    // A second tab loads a sample (which replaces its own recipe on purpose), then edits it.
    const second = await openPage();
    await second.size(1440, 900); await second.goto(`${origin}/`); await ready(second);
    assert.equal(await offered(second), 'nothing', 'a tab that is still open had its draft offered to another');
    await second.click('#examples .example[data-file="coin"]');
    await second.until(`document.querySelector('#examples .example[data-file="coin"]').classList.contains('active')`, 'the coin sample in the second tab');
    assert.equal(await kept(second), 'tab-a.json', 'loading a sample in one tab removed the other\'s draft');
    const coin = await second.evaluate(`document.getElementById('source').value`);
    await second.evaluate(`(() => { const source = document.getElementById('source'); source.focus(); source.select(); })()`);
    await second.page('Input.insertText', { text: coin.replace('"name": "coin"', '"name": "tab-b"') });
    await second.until(`Object.values(localStorage).some(value => value.includes('tab-b.json'))`, "the second tab's draft");
    assert.equal(await kept(studio), 'tab-a.json, tab-b.json', 'one tab\'s edits replaced the other\'s draft');
    assert.equal(await evaluate(`document.getElementById('source').value.includes('"name": "tab-a"')`), true);
    // The second tab closes. A new tab is offered its draft, never that of the first tab, which is still open. A tab
    // counts as open until the browser lets go of the lock on its id, a moment after it closes.
    const secondId = await second.evaluate(`sessionStorage.getItem('pixelforge.studio.tab')`);
    await second.close();
    await until(`navigator.locks.query().then(state => !state.held.some(lock => lock.name === 'pixelforge.studio.tab.' + ${JSON.stringify(secondId)}))`, 'the second tab to close');
    const third = await openPage();
    await third.size(1440, 900); await third.goto(`${origin}/`); await ready(third);
    assert.match(await offered(third), /^A draft of tab-b\.json from another tab, /);
    await third.click('#draft-restore'); await third.until(`document.getElementById('project-name').textContent === 'Tab b'`, 'the closed tab\'s draft to be restored');
    // Restored, it is this tab's draft now: still one copy, and no longer offered to anyone else.
    assert.equal(await kept(third), 'tab-a.json, tab-b.json');
    await third.click('#examples .example:nth-child(1)'); await third.until(`document.querySelector('#examples .example:nth-child(1)').classList.contains('active')`, 'a sample in the third tab');
    assert.equal(await kept(third), 'tab-a.json');
    await third.close();
    await click('#examples .example:nth-child(1)'); await until(`!document.getElementById('source').value.includes('"name": "tab-a"')`, 'a sample to replace the first tab\'s edit');
    assert.equal(await evaluate(`localStorage.length`), 0);
    await studio.reload(); await ready(); assert.equal(await offered(studio), 'nothing');
  });

  console.log('Shared palettes');
  await check('a recipe that links a shared palette file opens as written, draws with that file, and Save JSON keeps the link', async () => {
    // Opened as people open their own, with `pixelbolt preview` from the package being walked. It has its own address,
    // so its drafts stay apart from the walk's.
    const folder = path.join(kept, 'linked'), app = path.resolve(options.app);
    const shared = { palette: { g: '#72b58d', d: '#1d2b33' }, ramps: [['d', 'g']] };
    const recipe = { version: 1, name: 'linked-hero', width: 4, height: 2, palette: { $ref: 'shared.json', s: '#ff0000' }, frames: [{ name: 'idle', ops: [{ op: 'grid', rows: ['gdsg', 'ddgg'] }] }] };
    const written = JSON.stringify(recipe, null, 2);
    await mkdir(folder); await writeFile(path.join(folder, 'shared.json'), JSON.stringify(shared)); await writeFile(path.join(folder, 'linked-hero.json'), written);
    const { resolveReferences } = await import(pathToFileURL(path.join(app, 'src', 'resolve.js')));
    const preview = spawn(process.execPath, [path.join(app, 'bin', 'pixelbolt.js'), 'preview', path.join(folder, 'linked-hero.json'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let linked = null;
    try {
      const address = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`pixelbolt preview did not start within 30 seconds:\n${output}`)), 30000);
        for (const stream of [preview.stdout, preview.stderr]) stream.on('data', chunk => { output += chunk; const found = /Pixelbolt studio: (http:\/\/127\.0\.0\.1:\d+)/.exec(output); if (found) { clearTimeout(timer); resolve(found[1]); } });
        preview.once('error', reject); preview.once('exit', code => { clearTimeout(timer); reject(new Error(`pixelbolt preview exited with ${code}:\n${output}`)); });
      });
      origins.push(address);
      linked = await openPage();
      const pixels = `(() => { const c = document.getElementById('canvas'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data).join(); })()`;
      const node = async value => Array.from(renderProject((await resolveReferences(value, { baseDir: folder })).document).frames[0].data).join();
      const replace = async value => { await linked.evaluate(`(() => { const source = document.getElementById('source'); source.focus(); source.select(); })()`); await linked.page('Input.insertText', { text: value }); };
      await linked.size(1440, 900); await linked.goto(`${address}/`); await ready(linked);
      await linked.until(`document.getElementById('project-name').textContent === 'Linked hero'`, 'the linked recipe');
      // The editor holds the recipe as written; the swatches and the drawing have the shared file's colours, as in Node.
      assert.equal(await linked.evaluate(`document.getElementById('source').value`), written);
      assert.deepEqual([await linked.evaluate(`document.getElementById('error').hidden`), await linked.evaluate(`document.getElementById('color-count').textContent`)], [true, '3 colors · shared.json']);
      assert.equal(await linked.evaluate(pixels), await node(recipe));
      // An edit to the recipe's own entries redraws, and Save JSON writes it with the link.
      const edit = JSON.stringify({ ...recipe, palette: { $ref: 'shared.json', s: '#3050ff', w: '#ffffff' }, frames: [{ name: 'idle', ops: [{ op: 'grid', rows: ['gdsw', 'ddgg'] }] }] }, null, 2);
      await replace(edit);
      await linked.until(`document.getElementById('color-count').textContent === '4 colors · shared.json'`, 'the edit to redraw');
      const drawn = await linked.evaluate(pixels);
      assert.equal(drawn, await node(JSON.parse(edit)));
      const saved = await download(() => linked.click('#save'));
      assert.equal(path.basename(saved), 'linked-hero.pixel.json'); assert.equal(await readFile(saved, 'utf8'), edit);
      assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')).palette, { $ref: 'shared.json', s: '#3050ff', w: '#ffffff' });
      // Open project brings the saved file back, drawn the same.
      await linked.click('#new'); await linked.until(`document.getElementById('project-name').textContent === 'New sprite'`, 'the blank canvas');
      const { root: { nodeId } } = await linked.page('DOM.getDocument'), input = await linked.page('DOM.querySelector', { nodeId, selector: '#file' });
      await linked.page('DOM.setFileInputFiles', { files: [saved], nodeId: input.nodeId });
      await linked.until(`document.getElementById('project-name').textContent === 'Linked hero'`, 'the saved recipe to reopen');
      assert.equal(await linked.evaluate(`document.getElementById('source').value`), edit); assert.equal(await linked.evaluate(pixels), drawn);
      // The page reads no other file: a recipe that links one is not drawn, and says why.
      await replace(edit.replace('"$ref": "shared.json"', '"$ref": "other.json"'));
      await linked.until(`!document.getElementById('error').hidden`, 'the other file to be refused');
      assert.match(await linked.evaluate(`document.getElementById('error').textContent`), /^project\.palette\.\$ref: the studio has only "shared\.json", the palette file of the recipe pixelbolt preview opened, so it cannot draw "other\.json"\./);
      await replace(edit); await linked.until(`document.getElementById('error').hidden`, 'the link to be drawn again');
      await linked.size(390, 844);
      assert.ok(await linked.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'the linked palette heading causes horizontal overflow');
      await linked.shot('linked-palette-narrow', true);
      return `saved ${path.basename(saved)} with "$ref": "shared.json"`;
    } finally { await linked?.close(); preview.kill(); }
  });

  console.log('Keyboard and window sizes');
  await check('Tab reaches every main control, and the recipe editor does not trap the keyboard', async () => {
    await evaluate(`document.activeElement.blur()`);
    const reached = [];
    for (let i = 0; i < 80; i++) {
      await key('Tab', 9);
      const focus = await evaluate(`(() => { const e = document.activeElement; return e === document.body ? '' : e.id || e.className.split(' ')[0]; })()`);
      if (focus === 'source') break;
      reached.push(focus);
    }
    const wanted = ['open', 'export', 'example', 'new', 'guide-toggle', 'animation-view', 'sheet-view', 'review-view', 'grid', 'onion', 'zoom', 'play', 'animation', 'gif', 'frames', 'speed', 'frame', 'save'];
    assert.deepEqual(wanted.filter(control => !reached.includes(control)), [], `reached: ${[...new Set(reached)].join(', ')}`);
    assert.equal(await evaluate(`document.activeElement.id`), 'source', 'Tab never reached the recipe editor');
    // Inside the editor Tab indents. Escape and then Tab moves on; Shift+Tab moves back.
    const before = await evaluate(`document.getElementById('source').value`);
    // Every key the page receives is written down with what handled it and where focus was, for the failure message.
    await evaluate(`(() => { window.__keys = []; document.addEventListener('keydown', event => window.__keys.push(event.key + (event.defaultPrevented ? ' (taken by the editor)' : '') + ' at ' + (document.activeElement.id || document.activeElement.className))); })()`);
    await key('Tab', 9); assert.deepEqual([await evaluate(`document.activeElement.id`), (await evaluate(`document.getElementById('source').value`)).length], ['source', before.length + 2]);
    await key('Escape', 27); await key('Tab', 9);
    const focus = await evaluate(`document.activeElement.id || document.activeElement.className`), seen = await evaluate(`window.__keys.join('; ')`), length = (await evaluate(`document.getElementById('source').value`)).length;
    assert.notEqual(focus, 'source', `after Escape, Tab still stays in the editor. Keys the page saw: ${seen}. The recipe grew by ${length - before.length} characters.`);
    const after = await evaluate(`document.activeElement.className`);
    await key('Tab', 9, 8); assert.equal(await evaluate(`document.activeElement.id`), 'source'); await key('Tab', 9, 8);
    assert.equal(await evaluate(`document.activeElement.id`), 'save', 'Shift+Tab did not leave the editor backwards');
    await evaluate(`document.getElementById('grid').focus()`); await key(' ', 32); assert.equal(await pressed('grid'), 'true'); await key(' ', 32);
    return `${new Set(reached).size} controls before the editor, then ${after}`;
  });
  for (const [name, width, height] of [['wide', 1440, 900], ['narrow', 390, 844]]) await check(`a ${name} window (${width} × ${height}) shows the controls without sideways scrolling`, async () => {
    await studio.size(width, height); await studio.goto(`${origin}/`); await ready();
    const layout = await evaluate(`(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, hidden: ['open', 'export', 'artboard', 'play', 'gif', 'save', 'source'].filter(id => { const box = document.getElementById(id).getBoundingClientRect(); return box.width < 1 || box.height < 1 || box.left < -1 || box.right > innerWidth + 1; }), clipped: (() => { const board = document.getElementById('artboard'); board.scrollLeft = 0; board.scrollTop = 0; const sprite = document.getElementById('canvas').getBoundingClientRect(), frame = board.getBoundingClientRect(); return sprite.left < frame.left - 1 || sprite.top < frame.top - 1; })() }))()`);
    assert.ok(layout.overflow <= 1, `the page is ${layout.overflow} px wider than the window`); assert.deepEqual(layout.hidden, []);
    // A sprite larger than the artboard scrolls inside it, and its left and top edges must be reachable.
    assert.equal(layout.clipped, false, 'part of the sprite cannot be scrolled into view');
    await studio.shot(name, true);
  });
  await check('when the system asks for reduced motion, the studio starts paused and plays on request', async () => {
    await studio.motion('reduce'); await studio.size(1440, 900); await studio.goto(`${origin}/`); await ready();
    const [label, before] = [await evaluate(`document.getElementById('play').getAttribute('aria-label')`), await text('frame-counter')];
    await sleep(1500);
    assert.deepEqual([label, await text('frame-counter')], ['Play animation', before]);
    await click('#play'); await until(`document.getElementById('frame-counter').textContent !== ${JSON.stringify(before)}`, 'playback after pressing play');
    await studio.motion('no-preference');
  });
  await check('the scene study page draws its scene', async () => {
    await studio.size(1440, 900); await studio.goto(`${origin}/scene.html`);
    await until(`document.getElementById('name').textContent !== 'Loading scene'`, 'the scene to load');
    const drawn = await evaluate(`(() => { const c = document.getElementById('scene'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`);
    assert.ok(drawn > 0); assert.equal(await text('error'), ''); await studio.shot('scene');
    return await text('name');
  });
  await check('dragging on the scene moves a light, its controls relight the scene live, and saving keeps what changed and the files the scene names', async () => {
    const pixels = `(() => { const c = document.getElementById('scene'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data).join(); })()`;
    if (await text('play') === 'Pause') await click('#play');
    const before = await evaluate(pixels), source = await evaluate(`fetch('./scene.json').then(r => r.json())`);
    const box = await evaluate(`(() => { const c = document.getElementById('scene'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, width: c.width, height: c.height }; })()`);
    // Press on the first light's marker and drag it a little way, so it still reaches what it lights.
    const from = source.lighting.lights[0].at, to = [from[0] - 12, from[1] + 6], screen = ([x, y]) => ({ x: box.x + (x + 0.5) * box.w / box.width, y: box.y + (y + 0.5) * box.h / box.height });
    await studio.page('Input.dispatchMouseEvent', { type: 'mousePressed', ...screen(from), button: 'left', buttons: 1, clickCount: 1 });
    await studio.page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...screen(to), button: 'left', buttons: 1 });
    await studio.page('Input.dispatchMouseEvent', { type: 'mouseReleased', ...screen(to), button: 'left', clickCount: 1 });
    assert.deepEqual([Number(await evaluate(`document.getElementById('light-x').value`)), Number(await evaluate(`document.getElementById('light-y').value`))], to);
    const moved = await evaluate(pixels);
    assert.notEqual(moved, before, 'moving the light changes the lit scene');
    assert.equal(await evaluate(`document.querySelectorAll('#light-marks circle').length`), source.lighting.lights.length * 2);
    await evaluate(`(() => { const input = document.getElementById('light-height'); input.value = '6'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.notEqual(await evaluate(pixels), moved, 'a lower light changes the lit scene');
    assert.equal(await text('light-height-value'), '6 px');
    await studio.shot('scene-light');
    const saved = JSON.parse(await readFile(await download(() => click('#save')), 'utf8')), light = saved.lighting.lights[0], original = source.lighting.lights[0];
    assert.deepEqual([light.at, light.height, light.radius, light.color], [to, 6, original.radius, original.color]);
    // The saved scene is the scene as written with those two changes: its assets are still the files it names.
    const written = await evaluate(`fetch('./scene-source.json').then(r => r.json())`);
    assert.equal(typeof written.assets.spirit.recipe, 'string');
    assert.deepEqual(saved, { ...written, lighting: { ...written.lighting, lights: [{ ...written.lighting.lights[0], at: to, height: 6 }, ...written.lighting.lights.slice(1)] } });
    return `light moved to ${to.join(', ')}`;
  });
  await check('the Depth box swaps in the enlarged depth view at the same display size, with who covers whom and the matching MCP and CLI calls', async () => {
    const size = `(() => { const c = document.getElementById('scene'); return [c.width, c.height, c.style.width, c.style.height]; })()`;
    const [width, height, cssWidth, cssHeight] = await evaluate(size), scale = Number(await evaluate(`document.getElementById('scale').value`));
    await click('#depth');
    assert.deepEqual(await evaluate(size), [width * scale, height * scale, cssWidth, cssHeight]);
    assert.equal(await evaluate(`document.getElementById('depth-report').hidden`), false);
    assert.match(await text('depth-text'), /Far to near|No placement is sorted/);
    assert.match(await text('depth-mcp'), /"view": "depth"/); assert.match(await text('depth-cli'), /--view depth/);
    await studio.shot('scene-depth');
    await click('#depth');
    assert.deepEqual(await evaluate(size), [width, height, cssWidth, cssHeight]);
    assert.equal(await evaluate(`document.getElementById('depth-report').hidden`), true);
    return `depth view at ${scale}×`;
  });

  console.log('Baked wave effects');
  await studio.goto(`${origin}/`); await ready();
  await check('both wave presets match Node recipes and every RGBA frame in the browser', async () => {
    const { compileWaves } = await import(pathToFileURL(path.join(path.resolve(options.app), 'src', 'wave.js')));
    const sha = data => createHash('sha256').update(data).digest('hex'), hashes = [];
    for (const name of ['interference', 'portal']) {
      const source = JSON.parse(await readFile(path.join(path.resolve(options.app), 'examples', `${name}.wave.json`), 'utf8'));
      const compiled = compileWaves(source), project = renderProject(compiled.recipe);
      const expected = { compiled: sha(JSON.stringify(compiled)), rgba: project.frames.map(f => sha(f.data)) };
      const actual = await evaluate(`(async () => {
        const { compileWaves } = await import('/wave.js'), { renderProject } = await import('/core.js');
        const source = await (await fetch('/examples/${name}.wave.json')).json(), compiled = compileWaves(source), project = renderProject(compiled.recipe);
        const sha = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('');
        return { compiled: await sha(new TextEncoder().encode(JSON.stringify(compiled))), rgba: await Promise.all(project.frames.map(f => sha(f.data))) };
      })()`);
      assert.deepEqual(actual, expected, name); hashes.push({ name, ...actual });
    }
    await writeFile(path.join(kept, 'wave-browser-hashes.json'), JSON.stringify(hashes, null, 2));
    return '80 RGBA frames plus recipes, metadata and warnings';
  });
  await check('wave source edits play, save as source and export as ordinary assets; pose controls stay disabled', async () => {
    const source = JSON.parse(await readFile(path.join(path.resolve(options.app), 'examples', 'portal.wave.json'), 'utf8'));
    await type(JSON.stringify(source));
    await until(`document.getElementById('source-filename').textContent === 'portal.wave.json' && document.getElementById('timeline').children.length === 40`, 'the portal wave source');
    assert.equal(await evaluate(`document.getElementById('error').hidden`), true);
    assert.equal(await evaluate(`document.getElementById('motion-view').disabled`), true);
    assert.equal(await evaluate(`document.getElementById('contacts').disabled`), true);
    await click('#timeline .frame:nth-child(1)'); const before = await canvas();
    source.effects.open.sources[0].phase = 90;
    await type(JSON.stringify(source)); await click('#timeline .frame:nth-child(1)');
    assert.notEqual((await canvas()).hash, before.hash);
    if (await evaluate(`document.getElementById('play').getAttribute('aria-label') === 'Play animation'`)) await click('#play');
    const counter = await text('frame-counter'); await until(`document.getElementById('frame-counter').textContent !== ${JSON.stringify(counter)}`, 'the portal animation to advance');
    await click('#timeline .frame:nth-child(1)');
    const saved = await download(() => click('#save'));
    assert.match(saved, /portal\.wave\.json$/); assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), source);
    const zip = readZip(await readFile(await download(() => click('#export'))));
    const recipeFile = [...zip.keys()].find(name => name.endsWith('.pixel.json'));
    const exported = JSON.parse(zip.get(recipeFile).read().toString());
    assert.equal(exported.format, undefined); assert.equal(exported.frames.length, 40);
    assert.ok(exported.frames.every(frame => frame.layers.some(layer => layer.name === 'wave')));
    await choose('zoom', '4'); await studio.shot('wave-portal');
    await studio.size(390, 844);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'wave source overflows the narrow studio');
    await studio.shot('wave-narrow'); await studio.size(1440, 900);
    source.effects.open.sources[0].cycles = 1.5; await type(JSON.stringify(source));
    await until(`!document.getElementById('error').hidden`, 'the invalid wave cycle error');
    assert.match(await text('error'), /wave\.effects\.open\.sources\[0\]\.cycles/);
    assert.equal(await evaluate(`document.getElementById('export').disabled`), true);
  });

  // The lab compiles fluid sources in the page with src/fluid.js; its status line names the time the simulation took.
  console.log('Fluid lab');
  const simulated = () => until(`document.getElementById('status').textContent.includes('simulated in')`, 'the fluid lab to finish simulating');
  const labPixels = `(() => { const c = document.getElementById('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i++) h = (Math.imul(h, 31) + d[i]) >>> 0; return h; })()`;
  await check('the fluid lab lists its presets, simulates the first in the browser and plays it', async () => {
    await studio.size(1440, 900); await studio.goto(`${origin}/fluid.html`); await simulated();
    assert.deepEqual([await evaluate('document.title'), await evaluate(`document.querySelectorAll('#presets .example').length`), await evaluate(`document.getElementById('error').hidden`)], ['Pixelbolt · Fluid lab', FLUID_PRESETS.length, true]);
    const first = await evaluate(labPixels);
    await until(`${labPixels} !== ${first}`, 'the preview to play');
    assert.match(await text('cli'), /^pixelbolt compile campfire\.fluid\.json --out campfire\.json\n/);
    await studio.shot('fluid-lab');
    return await text('status');
  });
  await check('every fluid preset simulates in the browser without an error, to the same recipe as Node', async () => {
    const names = await evaluate(`[...document.querySelectorAll('#presets .example')].map(button => button.dataset.file)`), seen = [];
    const { compileFluid } = await import(pathToFileURL(path.join(path.resolve(options.app), 'src', 'fluid.js')));
    const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    for (const name of names) {
      await click(`#presets .example[data-file="${name}"]`);
      await until(`document.getElementById('name').textContent !== '' && location.hash === '#${name}' && document.getElementById('status').textContent.includes('simulated in')`, `${name} to simulate`);
      assert.equal(await evaluate(`document.getElementById('error').hidden`), true, name);
      const browser = await evaluate(`(async () => { const { compileFluid } = await import('/fluid.js'), source = await (await fetch('/examples/${name}.fluid.json')).json(); const bytes = new TextEncoder().encode(JSON.stringify(compileFluid(source).recipe)); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); })()`);
      assert.equal(browser, digest(compileFluid(JSON.parse(await readFile(path.join(path.resolve(options.app), 'examples', `${name}.fluid.json`), 'utf8'))).recipe), `${name} compiles differently in the browser`);
      seen.push(`${name} ${(await text('status')).match(/simulated in (\d+) ms/)[1]} ms`);
    }
    return seen.join(', ');
  });
  await check('a slider reruns the simulation, and the GIF, sheet and edited source download', async () => {
    await click('#presets .example[data-file="torch"]');
    await until(`location.hash === '#torch' && document.getElementById('slider-buoyancy') !== null && document.getElementById('status').textContent.includes('simulated in')`, 'the torch to simulate');
    if (await evaluate(`document.getElementById('play').getAttribute('aria-label')`) === 'Pause animation') await click('#play');
    const before = await evaluate(labPixels);
    await evaluate(`(() => { const input = document.getElementById('slider-buoyancy'); input.value = '0.9'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`document.getElementById('status').textContent.includes('simulated in') && ${labPixels} !== ${before}`, 'the edited simulation to draw');
    const source = JSON.parse(await readFile(await download(() => click('#fluid-source')), 'utf8'));
    assert.equal(source.effects.torch.buoyancy, 0.9);
    const gif = await readFile(await download(() => click('#gif')));
    assert.equal(gif.toString('latin1', 0, 6), 'GIF89a');
    const decoded = await evaluate(`(async () => { const decoder = new ImageDecoder({ data: Uint8Array.from(atob(${JSON.stringify(gif.toString('base64'))}), c => c.charCodeAt(0)), type: 'image/gif' }); try { await decoder.tracks.ready; await decoder.completed; return decoder.tracks.selectedTrack.frameCount; } finally { decoder.close(); } })()`);
    assert.equal(decoded, 16);
    const sheet = await readFile(await download(() => click('#sheet')));
    assert.equal(sheet.toString('latin1', 1, 4), 'PNG');
    await click('#reset'); await simulated();
    return `buoyancy 0.9 in the saved source; GIF with ${decoded} frames`;
  });

  console.log('Afterwards');
  await check('no page reported an error, and no request left this computer', () => {
    const foreign = requests.filter(url => !origins.some(studioOrigin => url.startsWith(`${studioOrigin}/`)) && !/^(data|blob|about|file):/.test(url));
    assert.deepEqual(problems, []); assert.deepEqual(foreign, []);
    return `${requests.length} requests, all to ${origins.join(' or ')} or local files`;
  });
  if (dialogs.length) note(`Confirmations the studio asked for and the walk accepted: ${[...new Set(dialogs)].join(' | ')}`);
  const failed = results.filter(result => !result.ok);
  console.log(`${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map(result => result.name).join('; ')}` : ''}`);
  exitCode = failed.length ? 1 : 0;
} catch (error) { console.error(error.stack); }
finally {
  // Ask the browser to quit; then stop whatever still runs on this run's profile, which nothing else uses.
  await closeBrowser?.().catch(() => {});
  browser.kill(); server.closeAllConnections(); server.close();
  await sleep(500);
  if (process.platform === 'win32') spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:PF_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { env: { ...process.env, PF_PROFILE: profile }, windowsHide: true });
  else spawnSync('pkill', ['-f', profile]);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
}
process.exit(exitCode);
