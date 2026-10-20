// Shared benchmark fixtures. Small stamps on large canvases expose layer-compositing overhead.
export function stampRig(size, instances, frames) {
  const rows = ['..hh..', '.hbbh.', 'hbssbh', '.bssb.', '..bb..'];
  return {
    format: 'pixelforge-poses', version: 1, name: `stamp-${size}`, width: size, height: size,
    palette: { h: '#d9bf8f', b: '#936f53', s: '#463b45' },
    parts: { segment: { rows, anchor: [2, 2], points: { tip: [2, 4] } } },
    poses: Array.from({ length: frames }, (_, frame) => ({
      name: `pose-${frame}`, duration: 80, origin: [0, 0],
      parts: Array.from({ length: instances }, (_, i) => ({
        name: `part-${i}`, part: 'segment',
        at: [3 + (i * 7 + frame) % (size - 7), 3 + (i * 11 + frame * 2) % (size - 7)],
        ...(i % 2 && { flipX: true })
      }))
    }))
  };
}

export function mergedStamps(recipe) {
  return { ...recipe, frames: recipe.frames.map(({ layers, ...frame }) => ({
    ...frame, ops: layers.flatMap(layer => layer.ops)
  })) };
}

// M1 primitive coverage, independent of the future R1–R3 character rigs.
export function structuralFixture() {
  const parts = {}, poses = [], angles = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180, 225, 270, 315];
  const pose = (name, part, extra = {}) => poses.push({ name, origin: [24, 24], parts: [{ name: 'shape', part, ...extra }] });
  for (let width = 1; width <= 6; width++) {
    const name = `width-${width}`;
    parts[name] = { bone: { length: 12, width: [width, width], ramp: 0, base: 2, outline: 'k' }, points: { tip: 'end' } };
    for (const angle of angles) pose(`${name}-angle-${angle}`, name, { rotate: angle });
  }
  parts.mass = { mass: { size: [12, 7], ramp: 0, base: 2, outline: 'k' } };
  for (const squash of [.5, .75, 1, 1.25, 1.5, 1.75, 2]) pose(`mass-${squash * 100}`, 'mass', { squash });
  for (const start of ['round', 'flat', 'point', 'socket']) for (const end of ['round', 'flat', 'point', 'socket']) {
    const name = `${start}-${end}`;
    parts[name] = { bone: { length: 12, width: [3, 6, 2], ramp: 0, base: 2, outline: 'k', caps: [start, end] } };
    pose(name, name, { rotate: 30 });
  }
  return {
    format: 'pixelforge-poses', version: 1, name: 'structural-parts', width: 48, height: 48,
    palette: { k: '#151321', a: '#392c36', b: '#72504b', c: '#bc7e60', d: '#f5c184' },
    ramps: [['a', 'b', 'c', 'd']], light: 225, parts, poses, sheet: { columns: 13 }
  };
}
