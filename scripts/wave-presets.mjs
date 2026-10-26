// Authored rims and palette choices live with the preset, not inside the compiler.
const grid = (w, h, pixel) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => pixel(x, y) ?? '.').join(''));
const palette = { b: '#358f9c', c: '#66c7bf', d: '#c6f1d0', k: '#211d36', q: '#675081',
  r: '#a56fb1', s: '#d6a1cf', t: '#fae1c8', u: '#526261', v: '#34434b', g: '#c39e65' };
export const wavePresets = {
  interference: {
    format: 'pixelforge-wave', version: 1, name: 'interference', width: 48, height: 30,
    palette: { b: palette.b, c: palette.c, d: palette.d }, anchor: [24, 15],
    effects: { resonate: { frames: 40, duration: 60,
      sources: [17.5, 29.5].map(x => ({ kind: 'radial', at: [x, 14.5], stretch: [1, 0.55], wavelength: 10, amplitude: 0.7, cycles: 2 })),
      mask: { at: [23.5, 14.5], radius: [23, 13], feather: 0.22 },
      look: { colors: ['b', 'c', 'd'], thresholds: [0.32, 0.72, 1.06] },
      overlay: grid(48, 30, (x, y) => { for (const sx of [17, 29]) if (Math.abs(x - sx) + Math.abs(y - 14) < 2) return 'd'; })
    } }
  },
  portal: {
    format: 'pixelforge-wave', version: 1, name: 'portal', width: 38, height: 56,
    palette: Object.fromEntries(Object.entries(palette).filter(([key]) => !['b', 'c', 'd'].includes(key))), anchor: [19, 51],
    effects: { open: { frames: 40, duration: 60,
      sources: [
        { kind: 'radial', at: [18.5, 27], stretch: [0.8, 1.6], wavelength: 9, amplitude: 0.65, cycles: -2 },
        ...[0, 180].map(angle => ({ kind: 'directional', at: [18.5, 27], angle, wavelength: 12, amplitude: 0.3, cycles: 1 }))
      ],
      mask: { at: [18.5, 27], radius: [13, 21], feather: 0.2 },
      look: { colors: ['q', 'r', 's'], thresholds: [0.25, 0.62, 0.94] },
      underlay: grid(38, 56, (x, y) => {
        const u = (x - 18.5) / 16, v = (y - 27) / 24, d = u * u + v * v;
        if (y >= 50 && y <= 53 && x >= 4 && x <= 33) return y === 50 ? 'u' : 'v';
        if (d < 1.07 && d > 0.69) return d > 0.96 ? 'k' : x < 18 && y < 29 ? 'u' : 'v';
        if (d <= 0.69) return 'k';
      }),
      overlay: grid(38, 56, (x, y) => {
        const u = (x - 18.5) / 14, v = (y - 27) / 22, d = u * u + v * v;
        if (d > 0.93 && d < 1.05) return x < 18 ? 's' : 'r';
        if ((x === 5 || x === 32) && y >= 24 && y <= 29) return 't';
        if (y === 4 && x >= 17 && x <= 20) return 't';
        if (y === 51 && x >= 15 && x <= 22) return 'g';
      })
    } }
  }
};
