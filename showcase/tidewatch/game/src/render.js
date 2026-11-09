// Draws atlas frames into three aligned low-resolution buffers (colour, normal, emissive) and composites them
// with banded point lights, a rotating lighthouse beam and an ambient tint. Output stays at native 240x160.
import { drawFrame } from './pixelforge/runtime.js';
export const VIEW_W = 240, VIEW_H = 160;
const makeCanvas = () => { const c = document.createElement('canvas'); c.width = VIEW_W; c.height = VIEW_H; return c; };
export class Renderer {
  constructor(output) {
    this.output = output; this.out = output.getContext('2d');
    this.color = makeCanvas(); this.normal = makeCanvas(); this.emissive = makeCanvas();
    this.c = this.color.getContext('2d', { willReadFrequently: true });
    this.n = this.normal.getContext('2d', { willReadFrequently: true });
    this.e = this.emissive.getContext('2d', { willReadFrequently: true });
    for (const g of [this.c, this.n, this.e, this.out]) g.imageSmoothingEnabled = false;
    this.lighting = null; this.cam = { x: 0, y: 0 }; this.draws = 0;
    this.frame = this.out.createImageData(VIEW_W, VIEW_H);
  }
  begin(cam, lighting) {
    this.cam = cam; this.lighting = lighting; this.draws = 0;
    this.c.fillStyle = '#213f7a'; this.c.fillRect(0, 0, VIEW_W, VIEW_H);
    if (lighting) { this.n.fillStyle = '#8080ff'; this.n.fillRect(0, 0, VIEW_W, VIEW_H); this.e.clearRect(0, 0, VIEW_W, VIEW_H); this.e.fillStyle = '#000'; this.e.fillRect(0, 0, VIEW_W, VIEW_H); }
  }
  // (x, y) is where the frame's atlas anchor lands in world pixels (its top-left corner for frames without an
  // anchor, such as tiles). Pixelbolt's drawFrame restores trimmed frames and mirrors flips around the source
  // canvas; offscreen draws are culled against that canvas.
  draw(atlas, name, x, y, { flip = false, alpha = 1, lightPasses = true } = {}) {
    const entry = atlas.frames[name];
    if (!entry) throw new Error(`${atlas.name}: unknown frame ${name}`);
    const sx = Math.round(x - this.cam.x), sy = Math.round(y - this.cam.y), source = entry.sourceSize, anchor = entry.anchorPx ?? { x: 0, y: 0 };
    const left = sx - (flip ? source.w - anchor.x : anchor.x), top = sy - anchor.y;
    if (left + source.w < 0 || top + source.h < 0 || left >= VIEW_W || top >= VIEW_H) return;
    this.draws++;
    const blit = (g, image) => drawFrame(g, { image, atlas: atlas.meta }, name, sx, sy, { flipX: flip });
    if (alpha !== 1) this.c.globalAlpha = alpha;
    blit(this.c, atlas.color);
    this.c.globalAlpha = 1;
    if (this.lighting && lightPasses) {
      blit(this.n, atlas.normal);
      blit(this.e, atlas.shadow);
      if (atlas.emissive) blit(this.e, atlas.emissive);
    }
  }
  rect(x, y, w, h, color) { this.c.fillStyle = color; this.c.fillRect(Math.round(x - this.cam.x), Math.round(y - this.cam.y), w, h); }
  // Composite: colour x (ambient + banded diffuse point lights + beam) + emissive, at native resolution.
  // Each light only visits pixels inside its radius, accumulating into a shared light buffer.
  finish() {
    const L = this.lighting;
    if (!L) { this.out.drawImage(this.color, 0, 0); return; }
    const color = this.c.getImageData(0, 0, VIEW_W, VIEW_H).data, normal = this.n.getImageData(0, 0, VIEW_W, VIEW_H).data;
    const glow = this.e.getImageData(0, 0, VIEW_W, VIEW_H).data, out = this.frame.data;
    const light = this.light ??= new Float32Array(VIEW_W * VIEW_H * 3);
    const [ar, ag, ab] = L.ambient, bands = L.bands ?? 4;
    for (let i = 0; i < light.length; i += 3) { light[i] = ar; light[i + 1] = ag; light[i + 2] = ab; }
    for (const l of L.lights) {
      const sx = l.x - this.cam.x, sy = l.y - this.cam.y, r = l.radius;
      const x0 = Math.max(0, Math.floor(sx - r)), x1 = Math.min(VIEW_W - 1, Math.ceil(sx + r)), y0 = Math.max(0, Math.floor(sy - r)), y1 = Math.min(VIEW_H - 1, Math.ceil(sy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = sx - x, dy = sy - y, d2 = dx * dx + dy * dy; if (d2 >= r * r) continue;
        const i = (y * VIEW_W + x) * 4, nx = normal[i] / 127.5 - 1, ny = normal[i + 1] / 127.5 - 1, nz = normal[i + 2] / 127.5 - 1;
        const lambert = (nx * dx + ny * dy + nz * l.z) / Math.sqrt(d2 + l.z * l.z); if (lambert <= 0) continue;
        const fall = 1 - Math.sqrt(d2) / r, k = Math.round(lambert * fall * fall * l.intensity * bands) / bands; if (!k) continue;
        const j = (y * VIEW_W + x) * 3; light[j] += k * l.color[0]; light[j + 1] += k * l.color[1]; light[j + 2] += k * l.color[2];
      }
    }
    const beam = L.beam;
    if (beam) {
      const bx = beam.x - this.cam.x, by = beam.y - this.cam.y, reach = beam.length;
      // Bound the sweep to the wedge's box (the beam is squashed vertically for the 3/4 view).
      const ends = [-beam.width, 0, beam.width].map(o => [bx + Math.cos(beam.angle + o) * reach, by + Math.sin(beam.angle + o) * reach / 1.6]);
      const bx0 = Math.max(0, Math.floor(Math.min(bx, ...ends.map(e => e[0])))), bx1 = Math.min(VIEW_W - 1, Math.ceil(Math.max(bx, ...ends.map(e => e[0]))));
      const by0 = Math.max(0, Math.floor(Math.min(by, ...ends.map(e => e[1])))), by1 = Math.min(VIEW_H - 1, Math.ceil(Math.max(by, ...ends.map(e => e[1]))));
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const dx = x - bx, dy = (y - by) * 1.6, dist = Math.hypot(dx, dy);
        if (dist <= 6 || dist >= beam.length) continue;
        let da = Math.abs(Math.atan2(dy, dx) - beam.angle) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
        if (da >= beam.width) continue;
        const onWater = beam.water ? beam.water(x + this.cam.x, y + this.cam.y) : true;
        const k = Math.round((1 - da / beam.width) * (1 - dist / beam.length) * 3) / 3 * beam.intensity * (onWater ? 1 : 0.25), j = (y * VIEW_W + x) * 3;
        light[j] += k; light[j + 1] += k * 0.95; light[j + 2] += k * 0.75;
      }
    }
    for (let i = 0, j = 0; i < out.length; i += 4, j += 3) {
      out[i] = Math.min(255, color[i] * light[j] + glow[i]); out[i + 1] = Math.min(255, color[i + 1] * light[j + 1] + glow[i + 1]); out[i + 2] = Math.min(255, color[i + 2] * light[j + 2] + glow[i + 2]); out[i + 3] = 255;
    }
    this.out.putImageData(this.frame, 0, 0);
  }
}
