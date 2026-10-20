// Reproducible figure fixtures used by the quality lab, performance checks and visual evidence.
export function skinkRig() {
  const rows = lines => lines.map(line => line.padEnd(Math.max(...lines.map(s => s.length)), '.'));
  const limb = (length, width, base = 2, caps = ['socket', 'round']) => ({ bone: { length, width, ramp: 0, base, outline: 'k', caps }, points: { end: 'end' } });
  const head = rows(['..y...y', '..ay.ya', '...ayaa', '..yaaaa', '..aaawaa', '..aaakyaa', '...aarr', '....rr']);
  const parts = {
    body: { mass: { size: [12, 6], ramp: 0, base: 2, outline: 'k' }, points: { hind: [-4, 2], fore: [4, 1], neck: [5, -1], tail: [-6, 0], grip: [3, 1] } },
    thigh: limb(4, [3, 2]), shin: limb(4, [2, 1]), farThigh: limb(4, [3, 2], 1), farShin: limb(4, [2, 1], 1),
    neck: limb(2, [3, 3]), tail1: limb(3, [3, 2]), tail2: limb(3, [2, 2]), tail3: limb(3, [2, 1], 2, ['socket', 'point']),
    head: { rows: head, anchor: [2, 5], points: { mouth: [7, 5] } },
    blink: { rows: head.map((row, y) => y === 4 ? row.replace('w', 'a') : row), anchor: [2, 5], points: { mouth: [7, 5] } },
    charm: { rows: rows(['y', 'a', 'yay', 'ywy', 'yay', '.a']), anchor: [0, 0] }
  };
  const poses = [];
  const pose = (name, { duration = 80, y = 15, lean = 0, squash = 1, tail = 0, blink = false,
    feet = [[13, 23], [21, 23], [12, 23], [20, 23]], neck = -40 } = {}) => {
    const chain = (label, hip, far, target) => [
      { name: `${label}Thigh`, part: far ? 'farThigh' : 'thigh', attach: { part: 'body', point: hip }, angle: 90 },
      { name: `${label}Shin`, part: far ? 'farShin' : 'shin', attach: { part: `${label}Thigh`, point: 'end' }, reach: target, bend: hip === 'fore' ? 'back' : 'forward' }
    ];
    poses.push({ name, duration, origin: [17, y], parts: [
      ...chain('farHind', 'hind', true, feet[2]), ...chain('farFore', 'fore', true, feet[3]),
      { name: 'tail1', part: 'tail1', attach: { part: 'body', point: 'tail' }, angle: 180 + tail },
      { name: 'tail2', part: 'tail2', attach: { part: 'tail1', point: 'end' }, angle: -20 },
      { name: 'tail3', part: 'tail3', attach: { part: 'tail2', point: 'end' }, angle: -25 },
      { name: 'body', part: 'body', angle: lean, squash },
      ...chain('nearHind', 'hind', false, feet[0]), ...chain('nearFore', 'fore', false, feet[1]),
      { name: 'neck', part: 'neck', attach: { part: 'body', point: 'neck' }, angle: neck },
      { name: 'head', part: blink ? 'blink' : 'head', attach: { part: 'neck', point: 'end' } },
      { name: 'charm', part: 'charm', attach: { part: 'body', point: 'grip' } }
    ], markers: ['nearHind', 'nearFore', 'farHind', 'farFore'].map(label => ({ name: `${label}Foot`, part: `${label}Shin`, point: 'end' })) });
  };
  pose('idle', { duration: 880 }); pose('blink', { duration: 100, blink: true, squash: .95 });
  pose('contact-a', { y: 16, lean: -8, feet: [[16, 23], [18, 20], [9, 21], [24, 23]], tail: -5 });
  pose('down-a', { y: 17, lean: -3, squash: .85, feet: [[12, 23], [21, 21], [11, 20], [20, 23]], tail: 5 });
  pose('passing-a', { y: 14, lean: 8, squash: 1.1, feet: [[10, 20], [24, 20], [14, 19], [18, 19]], tail: 15 });
  pose('contact-b', { lean: 6, feet: [[10, 21], [24, 23], [16, 23], [18, 20]], tail: 20 });
  pose('down-b', { y: 16, lean: 1, squash: .85, feet: [[12, 20], [20, 23], [12, 23], [21, 21]], tail: 10 });
  pose('passing-b', { y: 14, lean: -8, squash: 1.1, feet: [[15, 19], [18, 19], [10, 20], [24, 20]], tail: -5 });
  pose('gather', { duration: 220, y: 16, squash: .8, lean: -8, tail: 10, neck: -65 });
  pose('release', { duration: 80, y: 14, squash: 1.15, lean: -6, tail: 15, neck: -25, feet: [[14, 21], [22, 21], [12, 21], [20, 21]] });
  pose('recoil', { duration: 120, y: 16, squash: .85, lean: 10, blink: true, neck: -65 });
  pose('recover', { duration: 180 });
  return {
    format: 'pixelforge-poses', version: 1, name: 'lantern-skink-bones', width: 32, height: 26,
    palette: { k: '#0b1020', p: '#573b57', r: '#8d5260', a: '#cc8762', y: '#e7ce89', w: '#f7edc4' },
    ramps: [['p', 'r', 'a', 'y']], light: 225, rig: { ground: 23 }, parts,
    poses: poses.map(pose => ({ ...pose, contacts: ['contact-a', 'down-a'].includes(pose.name) ? ['nearHindFoot', 'farForeFoot']
      : ['contact-b', 'down-b'].includes(pose.name) ? ['nearForeFoot', 'farHindFoot'] : [] })),
    animations: { idle: { frames: ['idle', 'blink', 'idle'] }, run: { frames: ['contact-a', 'down-a', 'passing-a', 'contact-b', 'down-b', 'passing-b'] },
      cast: { frames: ['gather', 'release', 'recoil', 'recover'], loop: false } }, sheet: { columns: 6 }
  };
}
