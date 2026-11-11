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
