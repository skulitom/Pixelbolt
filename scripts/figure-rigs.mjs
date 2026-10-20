// Reproducible figure fixtures used by the quality lab, performance checks and visual evidence.
import { expandPoses } from '../src/authoring.js';
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

// R2: a hooded brass-and-teal courier, with a hand-drawn face and sword views.
export function heroRig() {
  const bone = (length, width, base = 2) => ({ bone: { length, width, ramp: 0, base, outline: 'k', caps: ['socket', 'round'] }, points: { end: 'end' } });
  const parts = {
    body: { mass: { size: [10, 12], ramp: 0, base: 2, outline: 'k' }, points: { farHip: [-2, 4], nearHip: [2, 4], farShoulder: [-4, -3], nearShoulder: [4, -3], neck: [0, -6], back: [-4, -4], belt: [0, 3] } },
    thigh: bone(5, [4, 3]), shin: bone(5, [3, 2]), foot: bone(4, [2, 2]),
    farThigh: bone(5, [4, 3], 1), farShin: bone(5, [3, 2], 1), farFoot: bone(4, [2, 2], 1),
    arm: bone(4, [3, 3]), forearm: bone(4, [3, 2]), hand: bone(2, [2, 2]),
    farArm: bone(4, [3, 3], 1), farForearm: bone(4, [3, 2], 1), farHand: bone(2, [2, 2], 1),
    neck: bone(2, [3, 3]), cape: { ...bone(9, [5, 3], 1), bone: { ...bone(9, [5, 3], 1).bone, caps: ['socket', 'point'] } },
    head: { rows: ['..kkkk..', '.kbbcck.', 'kbbcccak', 'kbaqqqak', 'kbqkqkqk', '.kpqqpk.', '..kppk..', '..kaak..', '...kk...'], anchor: [4, 8] },
    belt: { rows: ['aaadddaaa', 'kkadwdakk'], anchor: [4, 0] },
    sword: { rows: ['.d....w.', 'adwwwwww', '.d....w.'], anchor: [1, 1], points: { tip: [7, 1] }, views: {
      0: { rows: ['.d....w.', 'adwwwwww', '.d....w.'], anchor: [1, 1], points: { tip: [7, 1] } },
      45: { rows: ['.d.....', 'dad....', '.dww...', '..www..', '...www.', '....www', '.....w.'], anchor: [1, 1], points: { tip: [5, 5] } },
      90: { rows: ['.a.', 'ddd', '.w.', '.w.', '.w.', '.w.', 'www', '.w.'], anchor: [1, 1], points: { tip: [1, 7] } }
    } }
  };
  const chain = (label, role, shoulder, far) => {
    const names = role === 'Leg' ? ['Thigh', 'Shin', 'Foot'] : ['Arm', 'Forearm', 'Hand'];
    return names.map((name, i) => ({ name: `${label}${name}`, part: `${far ? 'far' : ''}${far ? name : name[0].toLowerCase() + name.slice(1)}`,
      attach: { part: i ? `${label}${names[i - 1]}` : 'body', point: i ? 'end' : shoulder }, angle: i ? 0 : 90 }));
  };
  const poses = [{ name: 'stand', duration: 100, origin: [24, 22], parts: [
    { name: 'cape', part: 'cape', attach: { part: 'body', point: 'back' }, angle: 105 },
    ...chain('far', 'Leg', 'farHip', true), ...chain('far', 'Arm', 'farShoulder', true),
    { name: 'body', part: 'body' }, ...chain('near', 'Leg', 'nearHip', false),
    { name: 'belt', part: 'belt', attach: { part: 'body', point: 'belt' } },
    { name: 'neck', part: 'neck', attach: { part: 'body', point: 'neck' }, angle: 270 },
    { name: 'head', part: 'head', attach: { part: 'neck', point: 'end' } },
    ...chain('near', 'Arm', 'nearShoulder', false),
    { name: 'sword', part: 'sword', attach: { part: 'nearHand', point: 'end' }, angle: -90 }
  ] }];
  return { format: 'pixelforge-poses', version: 1, name: 'brass-courier', width: 48, height: 48,
    palette: { k: '#121526', s: '#172b35', a: '#28434c', b: '#3e7778', c: '#91bbb0', d: '#cb9a56', p: '#98605a', q: '#e0a77d', w: '#e8dec1' },
    ramps: [['s', 'a', 'b', 'c']], light: 225, parts, poses,
    rig: { body: 'body', head: 'head', ground: 38, rest: 'stand', legs: [['farThigh', 'farShin', 'farFoot'], ['nearThigh', 'nearShin', 'nearFoot']],
      arms: [['farArm', 'farForearm', 'farHand'], ['nearArm', 'nearForearm', 'nearHand']], tail: ['cape'] },
    motions: { idle: { template: 'idle', frames: 4, breath: .1, duration: 180 },
      walk: { template: 'walk', frames: 16, speed: 24, stride: 8, lift: 3, bob: 1, duration: 50 },
      run: { template: 'run', frames: 8, speed: 48, stride: 10, lift: 5, bob: 1, lean: 8, duration: 40 },
      jump: { template: 'jump', apex: 3, duration: 80 },
      attack: { template: 'attack', arm: 1, windup: -130, strike: 25, hold: 2, duration: 80 } }, sheet: { columns: 8 } };
}

// R3: a larger four-legged guardian. Extra anatomy shares the hierarchy; four chains use reach.
export function bossRig() {
  const source = heroRig();
  source.name = 'brass-guardian'; source.width = 128; source.height = 128;
  const scaleRows = rows => rows.flatMap(row => [row, row].map(r => [...r].map(c => c + c).join('')));
  const scalePoints = points => Object.fromEntries(Object.entries(points ?? {}).map(([name, p]) => [name, p === 'end' ? p : p.map(n => n * 2)]));
  for (const part of Object.values(source.parts)) {
    if (part.bone) { part.bone.length *= 2; part.bone.width = part.bone.width.map(n => n * 2); }
    if (part.mass) part.mass.size = part.mass.size.map(n => n * 2);
    if (part.rows) part.rows = scaleRows(part.rows);
    if (part.anchor) part.anchor = part.anchor.map(n => n * 2);
    if (part.points) part.points = scalePoints(part.points);
    for (const view of Object.values(part.views ?? {})) { view.rows = scaleRows(view.rows); view.anchor = view.anchor.map(n => n * 2); view.points = scalePoints(view.points); }
  }
  const rest = source.poses[0]; rest.origin = [64, 68];
  source.rig.ground = 100;
  source.parts.body.points.outerFar = [-8, 7]; source.parts.body.points.outerNear = [8, 7];
  source.parts.body.points.mantle = [0, -3]; source.parts.body.points.hornFar = [-6, -10]; source.parts.body.points.hornNear = [6, -10];
  source.parts.body.points.fin1 = [-8, -5]; source.parts.body.points.fin2 = [-10, 0]; source.parts.body.points.fin3 = [-8, 5];
  const extraLeg = (label, hip, far) => ['Thigh', 'Shin', 'Foot'].map((name, i, names) => ({
    name: `${label}${name}`, part: `${far ? 'far' : ''}${far ? name : name[0].toLowerCase() + name.slice(1)}`,
    attach: { part: i ? `${label}${names[i - 1]}` : 'body', point: i ? 'end' : hip }, angle: i ? 0 : 90
  }));
  rest.parts.unshift(...extraLeg('outerFar', 'outerFar', true));
  rest.parts.push(...extraLeg('outerNear', 'outerNear', false));
  source.rig.legs.push(['outerFarThigh', 'outerFarShin', 'outerFarFoot'], ['outerNearThigh', 'outerNearShin', 'outerNearFoot']);
  const bone = (length, width) => ({ bone: { length, width, ramp: 0, base: 2, outline: 'k', caps: ['socket', 'point'] }, points: { end: 'end' } });
  source.parts.mantle = { mass: { size: [14, 10], ramp: 0, base: 3, outline: 'k' } };
  source.parts.horn = bone(8, [5, 1]); source.parts.tail = bone(8, [4, 2]);
  source.parts.fin = { rows: ['..d..', '.ddd.', 'ddddd', '.ada.', '..a..'], anchor: [2, 2] };
  rest.parts.push({ name: 'mantle', part: 'mantle', attach: { part: 'body', point: 'mantle' } },
    { name: 'hornFar', part: 'horn', attach: { part: 'body', point: 'hornFar' }, angle: 240 },
    { name: 'hornNear', part: 'horn', attach: { part: 'body', point: 'hornNear' }, angle: 300 },
    { name: 'tail2', part: 'tail', attach: { part: 'cape', point: 'end' }, angle: 30 },
    { name: 'tail3', part: 'tail', attach: { part: 'tail2', point: 'end' }, angle: 20 },
    ...[1, 2, 3].map(i => ({ name: `fin${i}`, part: 'fin', attach: { part: 'body', point: `fin${i}` } })));
  source.rig.tail.push('tail2', 'tail3');
  source.motions = { idle: { template: 'idle', frames: 4, breath: .1, duration: 180 },
    walk: { template: 'walk', frames: 16, speed: 48, stride: 16, lift: 6, bob: 2, duration: 50 },
    run: { template: 'run', frames: 16, speed: 64, stride: 20, lift: 8, bob: 2, lean: 6, duration: 40 },
    jump: { template: 'jump', apex: 6, duration: 80 }, attack: { template: 'attack', arm: 1, windup: -120, strike: 30, duration: 80 },
    hurt: { template: 'hurt', recoil: -12, squash: .9, duration: 100 },
    prowl: { template: 'walk', frames: 24, speed: 32, stride: 16, lift: 5, bob: 2, duration: 40 },
    charge: { template: 'run', frames: 22, speed: 80, stride: 20, lift: 6, bob: 2, lean: 10, duration: 30 } };
  // Authored overrides demonstrate a second breathing mass without changing the template's body role.
  const expanded = expandPoses(source);
  for (const name of ['idle-inhale', 'idle-exhale']) {
    const pose = expanded.poses.find(p => p.name === name);
    pose.parts.find(p => p.name === 'mantle').squash = name.endsWith('inhale') ? 1.15 : .85;
    source.poses.push(pose);
  }
  return source;
}
