import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { inspectMotion } from '../src/motion.js';
import { plainRig } from '../scripts/figure-rigs.mjs';

// The four-legged gaits, measured on the example fox (examples/fox.poses.json), which faces right and travels right.
const fox = JSON.parse(await readFile(new URL('../examples/fox.poses.json', import.meta.url), 'utf8'));
const { recipe, metadata, warnings } = compilePoses(fox), project = renderProject(recipe);
const LEGS = ['nearHind', 'farHind', 'nearFore', 'farFore'];
const frames = animation => recipe.animations[animation].frames;
const down = name => LEGS.filter(leg => metadata.poses[name].contacts.includes(`${leg}Foot`));
// The frame of the animation on which each foot lands: down there, lifted in the frame before.
const landings = animation => {
  const list = frames(animation);
  return Object.fromEntries(LEGS.map(leg => [leg, list.findIndex((name, i) => down(name).includes(leg) && !down(list.at(i - 1)).includes(leg))]));
};
const review = (source, animation) => {
  const { recipe, metadata } = compilePoses(source);
  return inspectMotion(renderProject(recipe), { animation, metadata, scale: 1 }).motion;
};

test('the fox example compiles without warnings, and each gait passes its motion review with all four feet measured', () => {
  assert.equal(warnings, undefined);
  for (const animation of Object.keys(fox.motions)) {
    const { motion } = inspectMotion(project, { animation, metadata });
    for (const [check, pass] of Object.entries(motion.checks)) assert.notEqual(pass, false, `${animation}.${check}`);
    // Every foot is a contact somewhere in every motion, so slide and ground measure all four.
    assert.deepEqual(new Set(motion.slide.map(phase => phase.marker)), new Set(LEGS.map(leg => `${leg}Foot`)), animation);
  }
  for (const animation of ['walk', 'trot', 'run']) {
    const { motion } = inspectMotion(project, { animation, metadata });
    // Measured, not skipped; the biped gait checks don't apply to four legs, so they say null, never a pass.
    assert.deepEqual(motion.checks, { slide: true, ground: true, poseSpread: true, loopSeam: true, armSwing: null, contactLegs: null, kneeLift: null }, animation);
    assert.equal(motion.gait.legsTrade, null, animation);
  }
});

test('walk: a lateral sequence, near hind, near fore, far hind, far fore, a quarter cycle apart, with three feet down', () => {
  const at = landings('walk'), count = frames('walk').length;
  assert.deepEqual(at, { nearHind: 0, nearFore: count / 4, farHind: count / 2, farFore: count * 3 / 4 });
  for (const name of frames('walk')) assert.equal(down(name).length, 3, name);
  assert.equal(frames('walk')[0], 'walk-contact-a');
  assert.equal(frames('walk')[count / 2], 'walk-contact-b');
});

test('trot: diagonal pairs land together and are down together', () => {
  const at = landings('trot');
  assert.equal(at.nearHind, at.farFore);
  assert.equal(at.farHind, at.nearFore);
  assert.equal(Math.abs(at.nearHind - at.farHind), frames('trot').length / 2);
  for (const name of frames('trot')) {
    const feet = down(name);
    assert.equal(feet.includes('nearHind'), feet.includes('farFore'), name);
    assert.equal(feet.includes('farHind'), feet.includes('nearFore'), name);
    assert.ok(feet.length > 0, `${name}: some foot is down`);
  }
});

test('run: a rotary gallop with an extended and a gathered flight, a back that bends and a body that rocks', () => {
  const at = landings('run'), list = frames('run');
  assert.ok(at.nearHind < at.farHind && at.farHind < at.farFore && at.farFore < at.nearFore, JSON.stringify(at));
  const flights = list.filter(name => !down(name).length);
  assert.ok(flights.includes('run-extended') && flights.includes('run-gathered'), flights.join(', '));
  const parts = name => metadata.poses[name].parts, turn = (a, b) => ((a - b) % 360 + 540) % 360 - 180;
  const curl = name => turn(parts(name).chest.worldAngle, parts(name).hips.rotate ?? 0);
  // Curled in the gathered flight (the chest turned down against the hips), stretched in the extended one.
  assert.ok(curl('run-gathered') > 0 && curl('run-extended') < 0, `curl ${curl('run-gathered')}° gathered, ${curl('run-extended')}° extended`);
  // The body rocks: the rump is down (the body turned front up) as the hind feet land, and up as the fore feet do.
  const pitch = name => turn(parts(name).hips.rotate ?? 0, 0);
  assert.ok(pitch('run-contact-a') < 0 && pitch('run-fore-b') > 0, `hips ${pitch('run-contact-a')}° as the hind feet land, ${pitch('run-fore-b')}° as the fore feet do`);
  // The head turns back against the chest, so it tips less than the body.
  const tilt = name => turn(parts(name).neck.worldAngle, -50);
  assert.ok(Math.abs(tilt('run-gathered')) < Math.abs(curl('run-gathered')) + Math.abs(parts('run-gathered').hips.rotate ?? 0), 'the neck counters the chest');
});

test('a lifted fore foot folds back at the wrist, a planted fore leg gives at the elbow, and a hind leg folds at the hock', () => {
  // Which side of the line from a leg's first joint to its foot the middle joint lies on: + ahead (right), - behind, 0
  // within a pixel of it. A leg that straight may land its pixels with either bend, so it isn't judged.
  const side = (name, leg) => {
    const { [`${leg}Upper`]: upper, [`${leg}Lower`]: lower } = metadata.poses[name].parts, [a, b, c] = [upper.joints.start, upper.joints.end, lower.joints.end];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return Math.abs(cross) < Math.hypot(c[0] - a[0], c[1] - a[1]) ? 0 : Math.sign(cross);
  };
  let lifted = 0, planted = 0, hocks = 0;
  for (const animation of ['walk', 'trot', 'run']) for (const name of frames(animation)) for (const leg of LEGS) {
    const value = side(name, leg);
    if (value === 0) continue;
    if (leg.endsWith('Hind')) { assert.equal(value, -1, `${name} ${leg}: the hock is behind`); hocks++; }
    else if (down(name).includes(leg)) { assert.equal(value, -1, `${name} ${leg}: the elbow is behind`); planted++; }
    else { assert.equal(value, 1, `${name} ${leg}: the wrist is ahead`); lifted++; }
  }
  assert.ok(lifted >= 10 && planted >= 10 && hocks >= 30, `measured ${lifted} lifted fore legs, ${planted} planted and ${hocks} hind legs`);
});

test('jump and hurt keep all four feet on the ground where they stand, and the jump lands on its feet', () => {
  for (const [animation, standing] of [['jump', ['jump-crouch', 'jump-land', 'jump-recover']], ['hurt', ['hurt-recoil', 'hurt-recover']]]) {
    for (const name of standing) assert.deepEqual(down(name), LEGS, name);
    const { motion } = inspectMotion(project, { animation, metadata });
    assert.ok(motion.groundErrors.length && motion.groundErrors.every(e => e.pixels === 0), animation);
  }
  for (const name of ['jump-take-off', 'jump-rise', 'jump-apex', 'jump-fall']) assert.deepEqual(down(name), [], name);
  // At take-off the fore feet are already up while the hind feet push off from just above the ground.
  const feet = metadata.poses['jump-take-off'].markers, y = leg => feet.find(m => m.name === `${leg}Foot`).at[1];
  assert.ok(y('nearFore') < y('nearHind') && y('nearHind') === fox.rig.ground - 1);
});

test('four-legged rigs are refused where a template or field cannot apply, with the path to fix', () => {
  const expect = (change, path, words) => {
    const source = structuredClone(fox); change(source);
    assert.throws(() => expandPoses(source), error => error.name === 'PixelError' && error.message.includes(path) && words.test(error.message), `${path}`);
  };
  expect(s => { delete s.rig.hind; }, 'poses.rig.hind', /rig\.fore needs rig\.hind/);
  expect(s => { s.rig.legs = s.rig.hind; }, 'poses.rig.legs', /fore and rig\.hind/);
  expect(s => { s.rig.fore.push(['nearForeUpper', 'nearForeLower']); }, 'poses.rig.fore', /near leg, then the far/);
  expect(s => { s.rig.chest = 'neck'; }, 'poses.rig.chest', /attach to the body/);
  expect(s => { s.rig.neck = 'nearForePaw'; }, 'poses.rig.neck', /bone instance/);
  expect(s => { s.motions.bite = { template: 'attack' }; }, 'poses.motions.bite.template', /rig\.arms/);
  expect(s => { s.motions.run.flex = 31; }, 'poses.motions.run.flex', /0 to 30/);
  // The biped hero has no fore and hind legs to trot on or a spine to flex.
  const hero = plainRig();
  hero.motions = { trot: { template: 'trot' } };
  assert.throws(() => expandPoses(hero), /poses\.motions\.trot\.template: trot is a four-legged gait/);
  hero.motions = { run: { template: 'run', flex: 10 } };
  assert.throws(() => expandPoses(hero), /poses\.motions\.run\.flex/);
  hero.motions = {}; hero.rig.chest = 'chest';
  assert.throws(() => expandPoses(hero), /poses\.rig\.chest: chest is for a four-legged rig/);
});

test('the motion review traces all four feet and rings only the foot that lands', () => {
  const { motion, arcs } = inspectMotion(project, { animation: 'walk', metadata });
  const feet = arcs.tracks.filter(track => track.kind === 'foot');
  assert.deepEqual(feet.map(track => `${track.part}:${track.side}`).toSorted(), ['farForeLower:far', 'farHindLower:far', 'nearForeLower:near', 'nearHindLower:near']);
  assert.equal(arcs.landings.length, motion.slide.length);
  // A hind and a fore leg pair up for the loop seam: each joint is compared with itself and its partner on the other side.
  const joint = motion.loopSeam.joints.find(j => j.name === 'nearForeUpper');
  assert.equal(joint.partner, 'farForeUpper');
});

test('a rig with fore and hind legs leaves the biped figures as they were', () => {
  // The hero example's walk compiles the same with and without the four-legged code paths: its legs alternate half a
  // cycle apart and its poses keep their names.
  const { recipe } = compilePoses(plainRig());
  assert.deepEqual(recipe.animations.walk.frames, ['walk-contact-a', 'walk-down-a', 'walk-passing-a', 'walk-up-a', 'walk-contact-b', 'walk-down-b', 'walk-passing-b', 'walk-up-b']);
});

test('a quick or many-framed four-legged gait keys each flight once, so every pose name is its own', () => {
  // A cycle that leaves the ground more than once after the same feet named each flight alike, and the compile
  // refused the duplicate pose.
  for (const [animation, change] of [['walk', { speed: 72 }], ['walk', { frames: 32 }], ['walk', { stride: 1 }], ['run', { frames: 12, speed: 128 }], ['run', { frames: 40 }]]) {
    const source = structuredClone(fox);
    Object.assign(source.motions[animation], change);
    const compiled = compilePoses(source), names = compiled.recipe.animations[animation].frames;
    assert.equal(names.length, source.motions[animation].frames ?? names.length, `${animation} ${JSON.stringify(change)}`);
  }
});
