import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject, describeStampRecipe, parseColor } from '../src/core.js';
import { inspectMotion } from '../src/motion.js';
import { plainRig } from '../scripts/figure-rigs.mjs';

// What makes a walk or run read as one, measured on the plain side-view humanoid (the hero example's figure). It
// faces right and travels right, so a larger arm angle swings the arm back.
const { recipe, metadata } = compilePoses(plainRig());
const pose = name => metadata.poses[name].parts;
const restArm = pose('stand').nearUpper.worldAngle;
const legLength = (() => {
  const { nearThigh, nearShin } = pose('stand');
  return Math.hypot(nearShin.joints.end[0] - nearThigh.joints.start[0], nearShin.joints.end[1] - nearThigh.joints.start[1]);
})();

for (const gait of ['walk', 'run']) {
  test(`${gait}: at each contact the arm on the leading leg's side is behind its partner, and they come together as the legs pass`, () => {
    for (const [suffix, lead, trail] of [['a', 'near', 'far'], ['b', 'far', 'near']]) {
      const parts = pose(`${gait}-contact-${suffix}`);
      assert.ok(parts[`${lead}Shin`].joints.end[0] > parts[`${trail}Shin`].joints.end[0], `${suffix}: the ${lead} foot leads`);
      // A run's arms are furthest out in flight, where its legs are held furthest apart, so at contact they are on the way.
      assert.ok(parts[`${lead}Upper`].worldAngle > restArm && parts[`${trail}Upper`].worldAngle < restArm, `${suffix}: the ${lead} arm is back, the ${trail} arm forward`);
      assert.ok(parts[`${lead}Upper`].worldAngle - parts[`${trail}Upper`].worldAngle >= 40, `${suffix}: the arms are well apart`);
      // The elbow bends coming forward: the forward forearm turns further forward than its upper arm.
      const bend = ((parts[`${trail}Fore`].worldAngle - parts[`${trail}Upper`].worldAngle) % 360 + 540) % 360 - 180;
      assert.ok(bend < -15, `${suffix}: the forward elbow bends (${bend}°)`);
    }
    // Where the feet pass each other (closest in x: a walk's passing pose, a run's down pose), so do the hands.
    const apart = name => Math.abs(pose(name).nearUpper.worldAngle - pose(name).farUpper.worldAngle);
    const feet = name => Math.abs(pose(name).nearShin.joints.end[0] - pose(name).farShin.joints.end[0]);
    const frames = recipe.animations[gait].frames, half = frames.length / 2;
    for (const [suffix, part] of [['a', frames.slice(0, half)], ['b', frames.slice(half)]]) {
      const passing = part.reduce((best, name) => feet(name) < feet(best) ? name : best);
      assert.ok(apart(passing) * 2 < apart(`${gait}-contact-${suffix}`), `${passing}: the arms come together as the feet pass`);
    }
  });
}

test('walk: contacts are centred under the hip with long legs, the body dips after each contact, and the lifted foot leaves behind and lands from in front', () => {
  for (const suffix of ['a', 'b']) {
    const parts = pose(`walk-contact-${suffix}`), hip = parts.nearThigh.joints.start;
    const feet = ['near', 'far'].map(side => parts[`${side}Shin`].joints.end);
    const ahead = Math.max(...feet.map(f => f[0])) - hip[0], behind = hip[0] - Math.min(...feet.map(f => f[0]));
    assert.ok(Math.abs(ahead - behind) <= 1, `contact-${suffix}: feet ${ahead} ahead and ${behind} behind the hip`);
    // Both legs are planted and nearly straight: the body has not sunk into a crouch.
    for (const foot of feet) assert.ok(Math.hypot(foot[0] - hip[0], foot[1] - hip[1]) >= legLength - 1, `contact-${suffix}: a planted leg is long`);
    assert.deepEqual(metadata.poses[`walk-contact-${suffix}`].contacts.toSorted(), ['farShinFoot', 'nearShinFoot']);
    const down = pose(`walk-down-${suffix}`).nearThigh.joints.start, passing = pose(`walk-passing-${suffix}`).nearThigh.joints.start;
    assert.ok(down[1] > hip[1], `down-${suffix} is lower than contact`);
    assert.ok(passing[1] < down[1], `passing-${suffix} rises from down`);
  }
  // The far leg lifts after contact-a and lands at contact-b: behind the hip when it leaves, ahead before it lands.
  const order = recipe.animations.walk.frames, lifted = order.slice(1, order.indexOf('walk-contact-b'))
    .filter(name => !metadata.poses[name].contacts.includes('farShinFoot'));
  assert.ok(lifted.length >= 2);
  const at = name => { const parts = pose(name); return parts.farShin.joints.end[0] - parts.farThigh.joints.start[0]; };
  assert.ok(at(lifted[0]) < 0, `${lifted[0]}: the lifted foot starts behind the hip`);
  assert.ok(at(lifted.at(-1)) > 0, `${lifted.at(-1)}: it reaches forward before landing`);
});

// The motion review's gait checks, on the walk as the templates make it and on three ways a walk went wrong before:
// arms a quarter cycle late (hanging at each contact, furthest out at passing), a body that sinks into a crouch at
// each contact, and a lifted knee marched up in front.
const review = (source, animation = 'walk') => {
  const { recipe, metadata } = compilePoses(source);
  return inspectMotion(renderProject(recipe), { animation, metadata, scale: 1 }).motion;
};
const broken = change => {
  const source = expandPoses(plainRig()), walk = source.poses.filter(p => p.name.startsWith('walk-'));
  walk.forEach((p, i) => change(p, i, name => p.parts.find(part => part.name === name)));
  return source;
};
test('the gait checks pass the template walk and run, and leave other motions unmeasured', () => {
  const walk = review(plainRig());
  assert.deepEqual([walk.checks.armSwing, walk.checks.contactLegs, walk.checks.kneeLift], [true, true, true]);
  assert.ok(walk.gait.arms.degreesFromOpposite <= 10, `arms against legs: ${walk.gait.arms.degreesFromOpposite}° from opposite`);
  const run = review(plainRig(), 'run');
  // A run has no moment with both feet down, so neither knee measure applies.
  assert.deepEqual([run.checks.armSwing, run.checks.contactLegs, run.checks.kneeLift], [true, null, null]);
  for (const animation of ['idle', 'jump', 'attack', 'hurt']) {
    const motion = review(plainRig(), animation);
    assert.equal(motion.gait.legsTrade, false, animation);
    assert.deepEqual([motion.checks.armSwing, motion.checks.contactLegs, motion.checks.kneeLift], [null, null, null], animation);
  }
});
const lateArms = () => broken((p, i, part) => {
  const swing = 25 * Math.sin(i * Math.PI / 4);
  part('nearUpper').angle += Math.round(swing - 25 * Math.cos(i * Math.PI / 4));
  part('farUpper').angle -= Math.round(swing - 25 * Math.cos(i * Math.PI / 4));
});
// Three pixels lower at each contact: the feet still land on their marks, so slide and ground pass it.
const crouchedContacts = () => broken(p => { if (p.name.includes('contact')) p.origin = [p.origin[0], p.origin[1] + 3]; });
const marchedKnee = () => broken((p, i, part) => { if (p.name === 'walk-up-a') part('farShin').reach = [part('farShin').reach[0] + 1, part('farShin').reach[1] - 5]; });
test('the gait checks fail arms a quarter cycle late, a crouch at contact and a marched knee', () => {
  const late = review(lateArms());
  assert.equal(late.checks.armSwing, false, `${late.gait.arms.degreesFromOpposite}° from opposite`);
  const crouch = review(crouchedContacts());
  assert.deepEqual([crouch.checks.slide, crouch.checks.ground, crouch.checks.contactLegs], [true, true, false]);
  assert.ok(crouch.gait.contact.largest.degrees > 30 && /contact/.test(crouch.gait.contact.largest.frame));
  const march = review(marchedKnee());
  assert.equal(march.checks.kneeLift, false);
  assert.deepEqual([march.gait.lift.largest.frame, march.gait.lift.largest.leg], ['walk-up-a', 'farThigh']);
  // Each change breaks only its own measure.
  assert.deepEqual([late.checks.contactLegs, late.checks.kneeLift, crouch.checks.armSwing, march.checks.armSwing], [true, true, true, true]);
});

test('jump: the legs push off long, tuck up under the body at the apex and reach down to land, and the arms swing back, then forward', () => {
  const reach = name => {
    const { nearThigh, nearShin } = pose(name);
    return Math.hypot(nearShin.joints.end[0] - nearThigh.joints.start[0], nearShin.joints.end[1] - nearThigh.joints.start[1]);
  };
  assert.ok(reach('jump-take-off') >= legLength - 1.5, `long at take-off (${reach('jump-take-off')} of ${legLength})`);
  assert.ok(reach('jump-apex') <= legLength * .75, `tucked at the apex (${reach('jump-apex')} of ${legLength})`);
  assert.ok(reach('jump-rise') > reach('jump-apex') && reach('jump-fall') > reach('jump-apex'), 'the tuck is deepest at the apex');
  // The knees come forward, ahead of the hips, and bend again on landing.
  for (const leg of ['near', 'far']) assert.ok(pose('jump-apex')[`${leg}Thigh`].joints.end[0] > pose('jump-apex')[`${leg}Thigh`].joints.start[0] + 1, `${leg} knee forward`);
  assert.ok(pose('jump-land').nearShin.worldAngle !== pose('jump-land').nearThigh.worldAngle, 'the knee bends on landing');
  // A larger arm angle is further back: back in the crouch, forward through the take-off, home on recovery.
  assert.ok(pose('jump-crouch').nearUpper.worldAngle > restArm + 20 && pose('jump-take-off').nearUpper.worldAngle < restArm - 40);
  assert.equal(pose('jump-recover').nearUpper.worldAngle, restArm);
});

// The lowest row each frame draws, and which instance draws each pixel.
const rendered = new Map(renderProject(recipe).frames.map(frame => [frame.name, frame]));
const lowestRow = name => {
  const { data } = rendered.get(name);
  for (let y = recipe.height - 1; y >= 0; y--) for (let x = 0; x < recipe.width; x++) if (data[(y * recipe.width + x) * 4 + 3]) return y;
  return -1;
};
const owners = name => {
  const owner = new Map();
  for (const layer of recipe.frames.find(f => f.name === name).layers) for (const op of layer.ops) recipe.symbols[op.symbol].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') owner.set(`${op.flipX ? op.x + row.length - 1 - x : op.x + x},${op.y + y}`, layer.name);
  });
  return owner;
};
const moving = ['walk', 'run', 'jump'].flatMap(name => [...new Set(recipe.animations[name].frames)]);

test('feet drawn with views roll: the heel lands with the toe up and the toe trails down as the foot leaves, never below the sole', () => {
  // The boots have a toe-up view (330) and a toe-down one (30), so the compiled poses use the boot-v330 and boot-v30 symbols.
  const view = (name, leg) => { const part = pose(name)[`${leg}Boot`]; return /-v(\d+)$/.exec(part.symbol ?? '')?.[1] ?? 'flat'; };
  const planted = (name, leg) => metadata.poses[name].contacts.includes(`${leg}ShinFoot`);
  for (const gait of ['walk', 'run']) {
    const frames = recipe.animations[gait].frames;
    frames.forEach((name, i) => {
      const before = frames.at(i - 1);
      for (const leg of ['near', 'far']) {
        // A planted foot never stands on its toe: lifting its heel would bare the end of the shin.
        if (planted(name, leg)) assert.notEqual(view(name, leg), '30', `${name}: planted ${leg} foot`);
        if (planted(name, leg) && !planted(before, leg)) assert.equal(view(name, leg), '330', `${name}: the ${leg} heel strikes`);
        if (!planted(name, leg) && planted(before, leg)) assert.equal(view(name, leg), '30', `${name}: the ${leg} toe trails`);
      }
    });
  }
  assert.deepEqual(['take-off', 'rise', 'apex'].map(key => view(`jump-${key}`, 'near')), ['30', '30', 'flat']);
  // The toe-down boot hangs a row lower than the flat one, so a foot showing it is held up: nothing draws below the sole.
  const sole = lowestRow('stand');
  for (const name of moving) assert.ok(lowestRow(name) <= sole, `${name} draws below the sole row`);
  // Without views the feet stay flat.
  const flat = plainRig();
  for (const boot of ['boot', 'farBoot']) delete flat.parts[boot].views;
  assert.ok(expandPoses(flat).poses.every(p => p.parts.every(part => !/Boot$/.test(part.name) || part.rotate === undefined)));
});

test('no hand shows while all of its arm is hidden: where a swing would leave one floating, the elbow bends further', () => {
  for (const name of moving) {
    const owner = owners(name);
    for (const side of ['near', 'far']) {
      const hand = [], arm = new Set();
      for (const [at, part] of owner) { if (part === `${side}Hand`) hand.push(at); else if (part === `${side}Upper` || part === `${side}Fore`) arm.add(at); }
      const touches = hand.some(at => { const [x, y] = at.split(',').map(Number); return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => arm.has(`${x + dx},${y + dy}`)); });
      assert.ok(!hand.length || touches, `${name}: the ${side} hand floats`);
    }
  }
  // The far arm swings forward behind the chest at the first contact; its elbow bends further than the near one does
  // in the matching pose, bringing the hand up with its forearm out in front.
  const elbow = (name, side) => ((pose(name)[`${side}Fore`].worldAngle - pose(name)[`${side}Upper`].worldAngle) % 360 + 540) % 360 - 180;
  assert.ok(elbow('walk-contact-a', 'far') <= elbow('walk-contact-b', 'near') - 15, `${elbow('walk-contact-a', 'far')}° against ${elbow('walk-contact-b', 'near')}°`);
});

// The arcs panel of the motion review draws those faults rather than measuring them: each foot's, hand's and the
// head's path over one cycle on one figure, ringed where a foot lands (that foot, its hand and the head).
const arcs = source => {
  const { recipe, metadata } = compilePoses(source), view = inspectMotion(renderProject(recipe), { animation: 'walk', metadata, scale: 1 });
  const { origin, magnification: m } = view.arcs, sheet = view.nativeSheet;
  const traced = Object.fromEntries(view.arcs.tracks.map(track => [track.part, metadata.animations.walk.entries.map(entry => {
    const part = metadata.poses[entry.frame].parts[track.part];
    return track.kind === 'head' ? [part.anchor[0], part.topLeft[1]] : part.joints.end;
  })]));
  const panel = ([x, y]) => [origin[0] + (x + 1) * m + (m >> 1), origin[1] + (y + 1) * m + (m >> 1)];
  const color = (x, y) => '#' + [...sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 3)].map(v => v.toString(16).padStart(2, '0')).join('');
  // The highest row of the panel that shows a colour.
  const top = hex => { for (let y = origin[1]; y < origin[1] + view.arcs.height; y++) for (let x = origin[0]; x < origin[0] + view.arcs.width; x++) if (color(x, y) === hex) return y; return null; };
  return { view, traced, panel, color, top, m };
};
test('the arcs panel traces each foot, hand and the head through the walk and rings them where a foot lands', () => {
  const { view, traced, panel, color, m } = arcs(plainRig());
  assert.deepEqual(view.arcs.tracks.map(t => [t.kind, t.part, t.side]), [['foot', 'nearShin', 'near'], ['foot', 'farShin', 'far'], ['hand', 'nearFore', 'near'], ['hand', 'farFore', 'far'], ['head', 'head', 'near']]);
  assert.deepEqual(view.arcs.landings.map(l => [l.frame, l.side, l.ring]), [['walk-contact-a', 'near', '#ffffff'], ['walk-contact-b', 'far', '#ffce53']]);
  assert.equal(view.arcs.figure, 'walk-contact-a');
  // Every sample is a dot in its track's colour, unless a ring crosses it.
  const colors = Object.fromEntries(view.arcs.tracks.map(t => [t.part, t.color])), rings = ['#ffffff', '#ffce53'];
  for (const track of view.arcs.tracks.filter(t => t.side === 'near')) for (const point of traced[track.part]) assert.ok([colors[track.part], ...rings].includes(color(...panel(point))), `${track.part} at ${point}`);
  // Each landing rings its own side's foot and hand and the head; most of each ring survives the rings drawn after it.
  for (const landing of view.arcs.landings) for (const track of view.arcs.tracks.filter(t => t.side === landing.side || t.kind === 'head')) {
    const [cx, cy] = panel(traced[track.part][landing.position]), r = m + (landing.side === 'far' ? 1 : 0);
    let ring = 0;
    for (let i = -r; i <= r; i++) for (const [x, y] of [[cx + i, cy - r], [cx + i, cy + r], [cx - r, cy + i], [cx + r, cy + i]]) if (color(x, y) === landing.ring) ring++;
    assert.ok(ring >= 4 * r, `${landing.frame} ${track.part}: ${ring} ring pixels`);
  }
  // The figure faces right: at each landing the landing foot is at the front of its loop and its hand at the back of
  // its arc, which is how arms swinging against the legs look.
  for (const [frame, side] of [['walk-contact-a', 'near'], ['walk-contact-b', 'far']]) {
    const at = view.arcs.landings.find(l => l.frame === frame).position, xs = part => traced[part].map(p => p[0]);
    assert.equal(traced[`${side}Shin`][at][0], Math.max(...xs(`${side}Shin`)), `${frame}: the foot lands in front`);
    assert.ok(traced[`${side}Fore`][at][0] <= Math.min(...xs(`${side}Fore`)) + 1, `${frame}: its hand is back`);
  }
  // The head is not at its lowest where a foot lands; it sinks after.
  const head = traced.head.map(p => p[1]);
  assert.ok(head[0] < Math.max(...head));
});
test('the arcs show arms a quarter cycle late, a crouch at contact and a marched knee', () => {
  const late = arcs(lateArms()), at = late.view.arcs.landings[0].position, hand = late.traced.nearFore.map(p => p[0]);
  // The near hand is ringed in the middle of its arc, not at its back end.
  assert.ok(late.traced.nearFore[at][0] - Math.min(...hand) >= 2 && Math.max(...hand) - late.traced.nearFore[at][0] >= 2, `${late.traced.nearFore[at]} within ${Math.min(...hand)}–${Math.max(...hand)}`);
  // The head's path reaches 3 pixels lower, and its lowest point is where the feet land.
  const crouch = arcs(crouchedContacts()), head = crouch.traced.head.map(p => p[1]);
  for (const landing of crouch.view.arcs.landings) assert.equal(head[landing.position], Math.max(...head));
  assert.ok(Math.max(...head) - Math.min(...head) >= 3);
  // The far foot's dashed loop rises five pixels above the near foot's in the image itself.
  const march = arcs(marchedKnee()), plain = arcs(plainRig()), [near, far] = march.view.arcs.tracks.slice(0, 2).map(t => t.color);
  assert.ok(march.top(near) - march.top(far) >= 4 * march.m, `far foot drawn from row ${march.top(far)}, near from ${march.top(near)}`);
  assert.ok(Math.abs(plain.top(near) - plain.top(far)) <= plain.m);
});

test('the attack swings in the body\'s frame, though the arms hang from a chest that stands up from the hips', () => {
  // windup -130 and strike 50 are the template's defaults; follow-through carries the strike 45° further.
  const turn = degrees => ((degrees % 360) + 360) % 360, rest = plainRig().poses[0].parts;
  assert.equal(rest.find(part => part.name === 'nearUpper').attach.part, 'chest');
  assert.equal(rest.find(part => part.name === 'chest').attach.part, 'hips');
  for (const [name, expected] of [['attack-anticipation', -130], ['attack-strike', 50], ['attack-follow-through', 95]]) {
    const parts = pose(name);
    assert.equal(turn(parts.nearUpper.worldAngle - (parts.hips.rotate ?? 0)), turn(expected), name);
  }
});

// A bone across a mass, so the bone's outline crosses the body: once in the pose as written, once mirrored.
const crossing = innerLines => ({
  format: 'pixelforge-poses', version: 1, name: 'crossing', width: 24, height: 24, ...(innerLines && { innerLines }),
  palette: { k: '#101018', a: '#402020', b: '#804040', c: '#c06060' }, ramps: [['a', 'b', 'c']],
  parts: {
    body: { mass: { size: [10, 12], ramp: 0, base: 1, outline: 'k' } },
    arm: { bone: { length: 8, width: [2, 2], ramp: 0, base: 2, outline: 'k' }, points: { end: 'end' } }
  },
  poses: [
    { name: 'cross', origin: [12, 12], parts: [{ name: 'body', part: 'body' }, { name: 'arm', part: 'arm', at: [-3, -4], angle: 60 }] },
    { name: 'mirrored', mirror: 'cross' }
  ]
});
const key = (palette, name) => parseColor(palette[name]).join();
const outlineInside = (project, palette) => project.frames.map(frame => {
  const w = project.width, h = project.height, rgba = (x, y) => [...frame.data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)].join();
  const empty = (x, y) => x < 0 || y < 0 || x >= w || y >= h || frame.data[(y * w + x) * 4 + 3] === 0;
  let inside = 0, shade = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba(x, y) === key(palette, 'k') && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => empty(x + dx, y + dy))) inside++;
    if (rgba(x, y) === key(palette, 'b')) shade++;
  }
  return { frame: frame.name, inside, shade };
});

test('a figure keeps one outline round its silhouette: an outline inside it takes the ramp step below the base, mirrored too', () => {
  const source = crossing(), { recipe } = compilePoses(source);
  for (const { frame, inside } of outlineInside(renderProject(recipe), source.palette)) assert.equal(inside, 0, `${frame}: no outline colour inside the figure`);
  for (const frame of recipe.frames) {
    assert.ok(frame.pixels?.length > 0, `${frame.name}: the arm's inner outline is drawn as final pixels`);
    // The arm's base is c, so its inner line is b.
    assert.ok(frame.pixels.every(pixel => pixel.color === 'b'), frame.name);
  }
  // innerLines: "outline" keeps the outline colour inside the figure, as before.
  const kept = crossing('outline'), black = compilePoses(kept).recipe;
  assert.ok(black.frames.every(frame => frame.pixels === undefined));
  for (const { frame, inside } of outlineInside(renderProject(black), kept.palette)) assert.ok(inside > 0, `${frame}: the outline crosses the body`);
  assert.throws(() => compilePoses(crossing('none')), /poses\.innerLines/);
});

test('a compiled stamp recipe accepts final pixels in palette keys inside the canvas, and reports a bad one by path', () => {
  const base = { version: 1, name: 'stamped', width: 4, height: 4, palette: { k: '#000000' }, symbols: { dot: ['k'] },
    frames: [{ name: 'only', layers: [{ name: 'dot', ops: [{ op: 'stamp', symbol: 'dot', x: 1, y: 1 }] }] }] };
  const frame = pixels => ({ ...base, frames: [{ ...base.frames[0], pixels }] });
  assert.equal(describeStampRecipe(frame([{ x: 2, y: 2, color: 'k' }])).frames.length, 1);
  assert.throws(() => describeStampRecipe(frame([{ x: 2, y: 2, color: '#ffffff' }])), /project\.frames\[0\]\.pixels\[0\]\.color/);
  assert.throws(() => describeStampRecipe(frame([{ x: 4, y: 0, color: 'k' }])), /project\.frames\[0\]\.pixels\[0\]\.x/);
});

test('a figure facing left (negative speed) bends its knees and leans the way it faces, and passes the gait checks', () => {
  // The plain figure mirrored: every authored part flipped about its pose's origin, its turns negated, and the walk and
  // run sent left. A bend is a side of the canvas, so the templates once bent a left-facing figure's knees backward.
  const right = plainRig(), left = structuredClone(right);
  for (const p of left.poses) if (p.parts) p.parts = p.parts.map(part => {
    const q = { ...part, at: [-(part.at?.[0] ?? 0) - (part.attach ? 0 : 1), part.at?.[1] ?? 0], flipX: !part.flipX };
    if (!q.flipX) delete q.flipX;
    if (part.angle !== undefined) q.angle = -part.angle;
    if (part.rotate !== undefined) q.rotate = -part.rotate;
    if (part.reach) { q.reach = [2 * p.origin[0] - 1 - part.reach[0], part.reach[1]]; q.bend = (part.bend ?? 'forward') === 'forward' ? 'back' : 'forward'; }
    return q;
  });
  for (const [name, motion] of Object.entries(left.motions)) if (['walk', 'run'].includes(motion.template)) motion.speed = -(motion.speed ?? { walk: 24, run: 48 }[motion.template]);
  else delete left.motions[name];
  const R = compilePoses(right).metadata, L = compilePoses(left), project = renderProject(L.recipe);
  const side = ([ax, ay], [mx, my], [bx, by]) => Math.sign((bx - ax) * (my - ay) - (by - ay) * (mx - ax));
  for (const animation of ['walk', 'run']) {
    for (const name of new Set(L.metadata.animations[animation].entries.map(entry => entry.frame))) for (const [thigh, shin] of [['nearThigh', 'nearShin'], ['farThigh', 'farShin']]) {
      const knee = M => { const parts = M.poses[name].parts; return side(parts[thigh].joints.start, parts[thigh].joints.end, parts[shin].joints.end); };
      const r = knee(R), l = knee(L.metadata);
      assert.ok(r === 0 || l === 0 || l === -r, `${name} ${thigh}: the knee bends as the mirror's does`);
    }
    const { checks } = inspectMotion(project, { animation, metadata: L.metadata, scale: 1 }).motion;
    assert.deepEqual(Object.entries(checks).filter(([, value]) => value === false).map(([key]) => key), [], `${animation} facing left`);
  }
});

test('a tail swings on its own, so it cannot also be a bone of a leg or arm', () => {
  for (const [extra, role] of [['nearShin', 'a leg'], ['nearUpper', 'an arm']]) {
    const source = plainRig();
    source.rig.tail = [...source.rig.tail, extra];
    assert.throws(() => compilePoses(source), error => error.path === `poses.rig.tail[${source.rig.tail.length - 1}]` && /already a motion role/.test(error.message), role);
  }
});
