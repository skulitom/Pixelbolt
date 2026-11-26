// Minimal flat ESLint config that checks only undeclared identifiers (`no-undef`) across the toolkit without
// adding runtime or dev dependencies to package.json. Run locally or in CI with:
//   npx --yes eslint@10.0.0 --config scripts/eslint-undef.config.mjs src bin studio scripts playground
const shared = {
  // Standard ES2024 + Web/WHATWG globals shared by Node 20+ and browsers.
  URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly', Blob: 'readonly', Response: 'readonly',
  CompressionStream: 'readonly', DecompressionStream: 'readonly', WebSocket: 'readonly',
  console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  queueMicrotask: 'readonly', structuredClone: 'readonly', fetch: 'readonly', performance: 'readonly',
  crypto: 'readonly', btoa: 'readonly', atob: 'readonly'
};
const nodeGlobals = {
  ...shared,
  process: 'readonly', Buffer: 'readonly', global: 'readonly', setImmediate: 'readonly', clearImmediate: 'readonly'
};
const browserGlobals = {
  ...shared,
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  Image: 'readonly', ImageData: 'readonly', HTMLCanvasElement: 'readonly', OffscreenCanvas: 'readonly', Option: 'readonly',
  Worker: 'readonly', MessageChannel: 'readonly', CustomEvent: 'readonly', Event: 'readonly',
  ResizeObserver: 'readonly', IntersectionObserver: 'readonly', matchMedia: 'readonly',
  addEventListener: 'readonly', removeEventListener: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly',
  devicePixelRatio: 'readonly', getComputedStyle: 'readonly', confirm: 'readonly', alert: 'readonly', prompt: 'readonly',
  createImageBitmap: 'readonly', FileReader: 'readonly', self: 'readonly', postMessage: 'readonly'
};

export default [
  {
    files: ['src/**/*.js', 'bin/**/*.js', 'scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: nodeGlobals },
    rules: { 'no-undef': 'error' }
  },
  {
    // Browser scripts and QA scripts that pass functions evaluated inside a browser page.
    files: ['studio/**/*.js', 'src/runtime.js', 'src/mcp-app.js', 'playground/**/*.js', 'scripts/qa-quality-lab.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...nodeGlobals, ...browserGlobals } },
    rules: { 'no-undef': 'error' }
  },
  {
    // Pure browser files must never see Node-only globals (process, Buffer, global, setImmediate).
    files: ['studio/**/*.js', 'src/runtime.js', 'src/mcp-app.js', 'playground/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: browserGlobals },
    rules: { 'no-undef': 'error' }
  }
];
