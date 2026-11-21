// The imported-sprite example keeps its original pixels while moving rigid grid parts on invisible carriers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { decodePNG } from '../src/import.js';
import { inspectMotion } from '../src/motion.js';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root));
const source = JSON.parse(read('examples/sprite-walk.poses.json'));
const compiled = compilePoses(source);
// validate uses renderProject too: this checks the ordinary recipe, not just the pose source.
const project = renderProject(compiled.recipe);
const original = decodePNG(read('examples/sprite-walk.png'));
const frame = name => project.frames.find(item => item.name === name);
const rgba = (data, x, y) => Array.from(data.slice((y * 32 + x) * 4, (y * 32 + x + 1) * 4));

test('sprite-walk compiles, validates and keeps the imported stand pixel for pixel', () => {
  assert.ok(read('examples/sprite-walk.poses.json').length < 25000, 'keep the recipe hand-readable and compact');
  assert.deepEqual([project.width, project.height, original.width, original.height], [32, 32, 32, 32]);
  assert.deepEqual(project.warnings, []);
  assert.deepEqual(Buffer.from(frame('stand').data), Buffer.from(original.data), 'stand must preserve every RGBA pixel');
});

test('sprite-walk passes every right-facing motion check with symmetric contact spacing', () => {
  const motion = inspectMotion(project, { animation: 'walk', metadata: compiled.metadata }).motion;
  assert.deepEqual(motion.checks, {
    slide: true, ground: true, poseSpread: true, loopSeam: true,
    armSwing: true, contactLegs: true, kneeLift: true,
  });
  assert.equal(motion.speed, 24);
  for (const name of compiled.recipe.animations.walk.frames) {
    const parts = compiled.metadata.poses[name].parts;
    assert.equal(parts.nearThigh.joints.start[0], parts.farThigh.joints.start[0], `${name}: hips share x`);
  }
  const spacing = ['walk-contact-a', 'walk-contact-b'].map(name => {
    const parts = compiled.metadata.poses[name].parts;
    return Math.abs(parts.nearShin.joints.end[0] - parts.farShin.joints.end[0]);
  });
  assert.deepEqual(spacing, [8, 8]);
});

test('sprite-walk has eight walk and four idle frames, with exact left mirrors', () => {
  assert.equal(project.frames.length, 25, 'stand plus both directions of walk and idle');
  for (const [animation, count] of [['walk', 8], ['idle', 4]]) {
    const right = project.animations[animation], left = project.animations[`${animation}-left`];
    assert.equal(right.frames.length, count);
    assert.equal(left.frames.length, count);
    assert.equal(right.loop, true);
    assert.equal(left.loop, true);
    for (let i = 0; i < count; i++) {
      const a = project.frames[right.frames[i]], b = project.frames[left.frames[i]];
      assert.equal(a.duration, b.duration);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        assert.deepEqual(rgba(a.data, x, y), rgba(b.data, 31 - x, y), `${b.name} at ${31 - x},${y}`);
      }
    }
  }
});

// Eight-connected foreground catches a detached head or belt; four-connected background catches knee pinholes.
function components(data, opaque) {
  const unseen = new Set(Array.from({ length: 1024 }, (_, i) => i).filter(i => !!data[i * 4 + 3] === opaque));
  const groups = [], steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (opaque) steps.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  while (unseen.size) {
    const group = [unseen.values().next().value];
    unseen.delete(group[0]);
    for (let i = 0; i < group.length; i++) for (const [dx, dy] of steps) {
      const x = group[i] % 32 + dx, y = Math.floor(group[i] / 32) + dy, next = y * 32 + x;
      if (x >= 0 && x < 32 && y >= 0 && y < 32 && unseen.delete(next)) group.push(next);
    }
    groups.push(group);
  }
  return groups;
}

test('sprite-walk closes knee and neck gaps and keeps the idle to a one-pixel breath', () => {
  for (const item of project.frames) {
    assert.equal(components(item.data, true).length, 1, `${item.name}: connected head, body and limbs`);
    const holes = components(item.data, false).filter(group => !group.some(i =>
      i % 32 === 0 || i % 32 === 31 || i < 32 || i >= 992));
    assert.deepEqual(holes, [], `${item.name}: no enclosed transparent holes`);
  }
  for (const name of ['idle-rest', 'idle-settle', 'idle-exhale']) {
    assert.deepEqual(Buffer.from(frame(name).data), Buffer.from(original.data), name);
  }
  for (const index of project.animations.idle.frames) {
    const item = project.frames[index];
    assert.equal(item.duration, 400);
    assert.deepEqual(rgba(item.data, 12, 26), rgba(original.data, 12, 26), item.name);
    const parts = compiled.metadata.poses[item.name].parts, rest = compiled.metadata.poses.stand.parts;
    const dy = item.name === 'idle-inhale' ? -1 : 0;
    for (const part of ['head', 'torso']) assert.equal(parts[part].anchor[1] - rest[part].anchor[1], dy);
  }
});

test('the documented mirrored-rest review leaves every played frame unchanged', () => {
  const reviewSource = expandPoses(source);
  reviewSource.poses.push({ name: 'walk-rest-left', mirror: reviewSource.rig.rest });
  reviewSource.rig.rest = 'walk-rest-left';
  const review = compilePoses(reviewSource), rendered = renderProject(review.recipe);
  for (const item of project.frames) {
    assert.deepEqual(rendered.frames.find(other => other.name === item.name), item, item.name);
  }
  assert.deepEqual(review.recipe.animations, compiled.recipe.animations);
  const motion = inspectMotion(rendered, { animation: 'walk-left', metadata: review.metadata }).motion;
  assert.ok(Object.values(motion.checks).every(value => value === true));
  assert.equal(motion.gait.lift.largest.degrees, 34);
});

test('the tutorial commands read existing files or outputs made earlier in the page', () => {
  const page = read('docs/animate-your-sprite.md').toString('utf8');
  const produced = new Set(), commands = new Set(), out = 'output/sprite-walk/';
  let checked = 0;
  const input = name => {
    const present = name.startsWith(out) ? produced.has(name) : existsSync(new URL(name, root));
    assert.ok(present, `missing command input: ${name}`);
    checked++;
  };
  // A script the page says to save runs where a shell block runs it, so its reads are checked there.
  const scripts = new Map([...page.matchAll(/Save this as `([^`]+\.mjs)`[^\n]*\n\n```js\n([\s\S]*?)```/g)].map(match => [match[1], match[2]]));
  assert.deepEqual([...scripts.keys()], [`${out}rest-copies.mjs`, `${out}left-review.mjs`]);
  for (const block of page.matchAll(/```sh\n([\s\S]*?)```/g)) for (const line of block[1].split('\n')) {
    const args = line.trim().split(/\s+/);
    if (line.startsWith('node bin/pixelbolt.js ')) {
      const command = args[2];
      commands.add(command);
      input(args[3]);
      for (let i = 4; i < args.length; i++) if (args[i].includes('/')) {
        if (args[i - 1] === '--out' || (command === 'compile' && args[i - 1] === '--metadata')) produced.add(args[i]);
        else input(args[i]);
      }
    } else if (line.startsWith('node ')) {
      assert.ok(scripts.has(args[1]), `a script the page never shows: ${args[1]}`);
      for (const match of scripts.get(args[1]).matchAll(/fs\.(readFileSync|writeFileSync)\('([^']+)'/g)) {
        if (match[1] === 'readFileSync') input(match[2]);
        else produced.add(match[2]);
      }
    } else assert.equal(line.trim(), '', `a command the test doesn't read: ${line}`);
  }
  assert.deepEqual([...commands].sort(), ['compile', 'gif', 'import', 'inspect', 'render', 'validate']);
  assert.ok(checked >= 20, `check all command inputs, including the saved scripts (${checked})`);
  assert.ok([...produced].every(name => name.startsWith(out)), 'every output goes under output/sprite-walk/');
  for (const link of page.matchAll(/\]\((\.\.\/examples\/[^)]+)\)/g)) {
    assert.ok(existsSync(new URL(link[1], new URL('../docs/', import.meta.url))), link[1]);
  }
});
