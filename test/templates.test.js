import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject, parseColor } from '../src/core.js';
import { inspectMotion } from '../src/motion.js';
import { cleanupIds, rasterizeBone, rasterizeMass } from '../src/craft.js';
import { heroRig, bossRig, plainRig } from '../scripts/figure-rigs.mjs';

const cached = new Map();
function fixture(make) {
  if (!cached.has(make)) {
    const source = make(), start = performance.now(), expanded = expandPoses(source), expandedAt = performance.now(), compiled = compilePoses(source), compiledAt = performance.now(), project = renderProject(compiled.recipe, { stats: true });
    cached.set(make, { source, expanded, ...compiled, project, rasters: new Map(),
      times: { expand: expandedAt - start, compile: compiledAt - expandedAt, render: performance.now() - compiledAt } });
  }
  return cached.get(make);
}
for (const [make, count, instances] of [[heroRig, 40, 18], [bossRig, 96, 32]]) {
  test(`${make.name}: editable expansion round-trips, deduplicates drawings and preserves named layers`, () => {
    const f = fixture(make), before = JSON.stringify(f.source);
    assert.equal(f.recipe.frames.length, count);
    assert.ok(f.recipe.frames.every(frame => frame.layers.length === instances));
    assert.deepEqual(compilePoses(f.expanded), { recipe: f.recipe, metadata: f.metadata });
    assert.equal(JSON.stringify(f.source), before);
    const rows = Object.values(f.recipe.symbols).map(rows => JSON.stringify(rows));
    assert.equal(new Set(rows).size, rows.length);
    assert.equal(f.metadata.warnings, undefined);
    assert.equal(f.project.clipping, undefined);
    if (make === heroRig) assert.ok(JSON.stringify(f.recipe).length < 150000);
    else assert.ok(f.project.work.pixels <= 6700000);
    if (make === heroRig) {
      // Match the benchmark's warm-median contract (three warm-ups, then the median of fifteen runs), including on
      // translated Intel runtimes. The hero's first compile and render also warm the whole compiler and renderer, so
      // a single cold sample is not the budget. The three are timed in turn, so each median's samples spread over the
      // whole measurement: a burst of CPU from a test file running beside this one moves a median only if it lasts
      // about half the measurement.
      const runs = { expand: () => expandPoses(f.source), compile: () => compilePoses(f.source), render: () => renderProject(f.recipe, { stats: true }) };
      const times = { expand: [], compile: [], render: [] };
      for (let i = 0; i < 18; i++) for (const [name, run] of Object.entries(runs)) {
        const start = performance.now();
        run();
        if (i >= 3) times[name].push(performance.now() - start);
      }
      const [expand, compile, render] = Object.values(times).map(samples => samples.sort((a, b) => a - b)[7]);
      assert.ok(expand < 50, `expand CI budget, warmed median: ${expand}`);
      assert.ok(compile < 400, `compile CI budget, warmed median: ${compile}`);
      assert.ok(render < 150, `render CI budget, warmed median: ${render}`);
    } else {
      // In a full run the hero's tests have already warmed the compiler, so this sample is mostly the boss's own work.
      assert.ok(f.times.compile < 2000, `compile CI budget: ${f.times.compile}`);
      assert.ok(f.times.render < 600, `render CI budget: ${f.times.render}`);
    }
    const colors = new Set(Object.values(f.source.palette).map(c => new Uint32Array(Uint8Array.from(parseColor(c)).buffer)[0]));
    for (const frame of f.project.frames) {
      const pixels = new Uint32Array(frame.data.buffer);
      for (let i = 0; i < pixels.length; i++) if (frame.data[i * 4 + 3]) assert.ok(colors.has(pixels[i]), `palette ${frame.name}`);
    }
  });
  const motions = make === heroRig ? ['idle', 'walk', 'run', 'jump', 'attack'] : ['idle', 'walk', 'run', 'jump', 'attack', 'hurt', 'prowl', 'charge'];
  for (const animation of motions) test(`${make.name}: ${animation} has clean parts, joined bones and passing motion measurements`, () => {
    const f = fixture(make), start = performance.now(), view = inspectMotion(f.project, { animation, metadata: f.metadata, scale: 1 });
    if (make === heroRig) assert.ok(performance.now() - start < 500, 'R2 image-inclusive motion review CI budget');
    for (const [name, pass] of Object.entries(view.motion.checks)) assert.notEqual(pass, false, `${name}: ${JSON.stringify(view.motion)}`);
    const names = new Set(f.project.animations[animation].frames.map(i => f.project.frames[i].name));
    for (const pose of f.expanded.poses.filter(p => names.has(p.name))) {
      const placed = f.metadata.poses[pose.name].parts;
      for (const [i, instance] of pose.parts.entries()) {
        const part = placed[instance.name], definition = f.source.parts[instance.part], shape = definition.bone ?? definition.mass;
        if (!shape) continue;
        const key = JSON.stringify([instance.part, part.rotate ?? 0, instance.flipX ?? false, instance.squash ?? 1]);
        if (!f.rasters.has(key)) {
          const raster = (definition.bone ? rasterizeBone : rasterizeMass)(shape, { angle: part.rotate ?? 0, flipX: instance.flipX === true, squash: instance.squash ?? 1, ramp: f.source.ramps[shape.ramp], light: f.source.light });
          const ids = Uint32Array.from([...raster.rows.join('')].map(c => c === '.' ? 0 : c.charCodeAt(0))), spine = new Set((raster.spine ?? []).map(([x, y]) => y * raster.width + x));
          assert.equal(cleanupIds(ids, raster.width, raster.height, { corners: true, allowed: j => Boolean(raster.outlineMask[j] || spine.has(j)) }).length, 0, `${pose.name}/${instance.name} corners`);
          assert.equal(cleanupIds(ids, raster.width, raster.height, { strays: true, allowed: j => Boolean(raster.fill[j] && !spine.has(j)) }).length, 0, `${pose.name}/${instance.name} orphans`);
          if (definition.mass) {
            const normal = rasterizeMass(shape, { angle: part.rotate ?? 0, flipX: instance.flipX === true, ramp: f.source.ramps[shape.ramp], light: f.source.light });
            const area = r => r.rows.join('').replaceAll('.', '').length;
            assert.ok(Math.abs(area(raster) / area(normal) - 1) <= .1, `${pose.name}/${instance.name} mass area`);
          }
          f.rasters.set(key, raster);
        }
        if (part.reach) assert.equal(part.reach.error, 0, `${pose.name}/${instance.name} reach`);
        const parent = placed[instance.attach?.part];
        if (!parent?.joints || !part.joints) continue;
        assert.deepEqual(part.joints.start, parent.joints.end, `${pose.name}/${instance.name} joint`);
        const child = f.rasters.get(key), parentInstance = pose.parts.find(p => p.name === instance.attach.part), parentShape = f.source.parts[parentInstance.part].bone;
        const parentRaster = rasterizeBone(parentShape, { angle: parent.rotate ?? 0, flipX: parentInstance.flipX === true, ramp: f.source.ramps[parentShape.ramp], light: f.source.light });
        const joint = part.joints.start;
        const local = new Uint8Array(9);
        for (const p of [parent, part]) {
          const rows = f.recipe.symbols[p.symbol ?? p.definition];
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = joint[0] + dx - p.topLeft[0], y = joint[1] + dy - p.topLeft[1], c = rows[y]?.[x];
            if (c && c !== '.' && c !== ' ') local[(dy + 1) * 3 + dx + 1] = 1;
          }
        }
        const reached = new Set([4]), queue = [4];
        while (queue.length) {
          const at = queue.pop(), x = at % 3, y = Math.floor(at / 3);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy, next = ny * 3 + nx;
            if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3 && local[next] && !reached.has(next)) { reached.add(next); queue.push(next); }
          }
        }
        for (const [p, r] of [[parent, parentRaster], [part, child]]) {
          const x = joint[0] - p.topLeft[0], y = joint[1] - p.topLeft[1];
          assert.ok(r.fill[y * r.width + x], `${pose.name}/${instance.name} shared filled joint`);
          assert.ok([...reached].some(at => {
            const nx = x + at % 3 - 1, ny = y + Math.floor(at / 3) - 1;
            return at !== 4 && nx >= 0 && ny >= 0 && nx < r.width && ny < r.height && r.fill[ny * r.width + nx];
          }), `${pose.name}/${instance.name} edge-connected joint into ${p.definition}`);
        }
        if (pose.parts.indexOf(parentInstance) < i) {
          const rows = f.recipe.symbols[part.symbol ?? part.definition];
          for (let y = 0; y < child.height; y++) for (let x = 0; x < child.width; x++) {
            const px = part.topLeft[0] + x - parent.topLeft[0], py = part.topLeft[1] + y - parent.topLeft[1];
            if (child.outlineMask[y * child.width + x] && px >= 0 && py >= 0 && px < parentRaster.width && py < parentRaster.height && parentRaster.fill[py * parentRaster.width + px]) assert.equal(rows[y][x], '.', `${pose.name}/${instance.name} internal seam`);
          }
        }
      }
    }
  });
}

test('templates expose authored overrides, depth swaps, strike holds, metadata speed and two-pose breathing', () => {
  const source = heroRig(), expanded = expandPoses(source), a = expanded.poses.find(p => p.name === 'run-contact-a'), b = expanded.poses.find(p => p.name === 'run-contact-b');
  const ahead = (pose, first, second) => pose.parts.findIndex(p => p.name === first) < pose.parts.findIndex(p => p.name === second);
  // A side view keeps its near limbs and held weapon in front in both halves of the cycle.
  for (const pose of [a, b]) assert.ok(ahead(pose, 'farThigh', 'body') && ahead(pose, 'body', 'nearThigh') && ahead(pose, 'body', 'sword'), pose.name);
  // swapDepth (front or back views) exchanges the paired subtrees in the second half, held items included.
  const swapped = structuredClone(source); swapped.motions.run.swapDepth = true;
  const [sa, sb] = ['run-contact-a', 'run-contact-b'].map(name => expandPoses(swapped).poses.find(p => p.name === name));
  assert.ok(ahead(sa, 'farThigh', 'body') && ahead(sb, 'nearThigh', 'body'));
  assert.ok(ahead(sa, 'body', 'sword') && ahead(sb, 'sword', 'body'), 'weapon stays in its arm subtree across unequal-depth swaps');
  swapped.motions.run.swapDepth = 'yes'; assert.throws(() => expandPoses(swapped), /poses\.motions\.run\.swapDepth/);
  const changed = structuredClone(a); changed.duration = 123; source.poses.push(changed);
  assert.equal(expandPoses(source).poses.find(p => p.name === changed.name).duration, 123);
  assert.equal(expanded.animations.attack.frames.filter(name => name === 'attack-strike').length, 2);
  assert.ok(expanded.poses.find(p => p.name === 'attack-strike').markers.some(m => m.name === 'strike'));
  assert.equal(expanded.motionInfo.run.speed, 48);
  source.motions.idle.frames = 2;
  const idle = expandPoses(source).poses.filter(p => p.name.startsWith('idle-'));
  assert.deepEqual(idle.map(p => p.name), ['idle-inhale', 'idle-exhale']);
  assert.notEqual(idle[0].parts.find(p => p.name === 'body').squash, idle[1].parts.find(p => p.name === 'body').squash);
  source.motions.run.lift = 0;
  source.poses = [source.poses[0]];
  for (const pose of expandPoses(source).poses.filter(p => p.name.startsWith('run-'))) {
    for (const chain of source.rig.legs) assert.equal(pose.parts.find(p => p.name === chain.at(-1)).reach[1], source.rig.ground);
  }
});

test('cache order cannot change a rig drawing, symbol table or pose metadata', () => {
  const { expanded, recipe, metadata } = fixture(heroRig), reordered = structuredClone(expanded);
  reordered.poses.reverse();
  const again = compilePoses(reordered);
  assert.deepEqual(again.recipe.symbols, recipe.symbols);
  for (const frame of recipe.frames) assert.deepEqual(again.recipe.frames.find(f => f.name === frame.name), frame);
  for (const [name, pose] of Object.entries(metadata.poses)) assert.deepEqual(again.metadata.poses[name], pose);
});

test('templates reject bad roles, ranges, chains, annotations and conflicting names with paths', () => {
  const checks = [
    s => { s.rig.body = 'absent'; }, s => { s.rig.rest = 'absent'; }, s => { s.rig.legs[0][1] = 'head'; },
    s => { s.rig.legs[1][0] = s.rig.legs[0][0]; }, s => { s.motions.run.frames = 5; },
    s => { s.motions.run.speed = null; }, s => { s.motions.idle.breath = 2; }, s => { s.motions.idle.stride = 5; },
    s => { s.motions.attack.arm = 4; }, s => { s.motions.attack.hold = 0; }, s => { s.motions.jump.apex = 40; },
    s => { s.motions.run.template = 'fly'; }, s => { s.motionInfo = {}; }, s => { s.animations = { run: { frames: ['stand'] } }; }
  ];
  for (const mutate of checks) { const s = heroRig(); mutate(s); assert.throws(() => expandPoses(s), /poses\.(rig|motions|motionInfo)/); }
  const s = expandPoses(heroRig()); s.motionInfo.run.keyPoses = ['missing']; assert.throws(() => compilePoses(s), /motionInfo.run.keyPoses/);
});

test('motion code uses deterministic polynomial mathematics', async () => {
  for (const file of ['motions.js', 'motion.js']) assert.doesNotMatch(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'), /Math\.(sin|cos|tan|atan|atan2|acos|asin|hypot|pow|random)\s*\(/);
});

test('malformed pose sources fail with a path, not a TypeError', () => {
  // A marker naming an Object.prototype key ("toString") once reached Object.hasOwn(undefined, ...).
  const marker = { format: 'pixelforge-poses', version: 1, name: 'm', width: 8, height: 8, palette: { r: '#ff0000' }, parts: { dot: { rows: ['r'] } },
    poses: [{ name: 'p', parts: [{ name: 'dot', part: 'dot' }], markers: [{ name: 'm', part: 'toString', point: 'x' }] }] };
  for (const name of ['toString', 'constructor', 'hasOwnProperty']) {
    marker.poses[0].markers[0].part = name;
    assert.throws(() => compilePoses(marker), error => error.name === 'PixelError' && /poses\.poses\[0\]\.markers\[0\]/.test(error.message));
  }
  // A null pose beside motions once crashed the rest-pose lookup.
  const source = heroRig(); source.poses.push(null);
  for (const run of [() => expandPoses(source), () => compilePoses(source)]) assert.throws(run, error => error.name === 'PixelError' && /poses\.poses\[1\]/.test(error.message));
});

test('every template at its defaults passes its own motion checks on a plain side-view humanoid', () => {
  const source = plainRig(), { recipe, metadata } = compilePoses(source), project = renderProject(recipe);
  assert.deepEqual(metadata.warnings ?? [], []);
  for (const animation of Object.keys(source.motions)) {
    const { motion } = inspectMotion(project, { animation, metadata });
    for (const [check, pass] of Object.entries(motion.checks)) assert.notEqual(pass, false, `${animation}.${check}`);
  }
  for (const animation of ['walk', 'run']) {
    const { motion } = inspectMotion(project, { animation, metadata });
    // Measured, not skipped: feet stay planted on the ground, and the contact poses trade legs.
    assert.deepEqual(motion.checks, { slide: true, ground: true, poseSpread: true, loopSeam: true }, animation);
    const pair = motion.poseSpread.find(p => p.from === `${animation}-contact-a` && p.to === `${animation}-contact-b`);
    assert.ok(pair.jointDegrees >= 20, `${animation} contact poses differ by ${pair.jointDegrees}°`);
    // Near limbs stay in front of the body in both halves of a side-view cycle.
    for (const name of [`${animation}-contact-a`, `${animation}-contact-b`]) {
      const layers = recipe.frames.find(f => f.name === name).layers.map(l => l.name);
      assert.ok(layers.indexOf('farThigh') < layers.indexOf('torso') && layers.indexOf('torso') < layers.indexOf('nearThigh'), name);
    }
  }
});

test('structural drawing has a deterministic work budget, and cached masses are copies', () => {
  // Many distinct large masses (each squash and angle is a new drawing) fail fast with a path instead of drawing
  // for seconds and blocking the MCP server or the studio thread.
  const poses = Array.from({ length: 4 }, (_, i) => ({ name: `p${i}`, origin: [64, 64], parts: Array.from({ length: 64 }, (_, j) => ({ name: `m${j}`, part: 'blob', rotate: (i * 64 + j) % 360, squash: [.5, .75, 1.25, 1.5, 2][(i + j) % 5], flipX: (i + j) % 2 === 1 })) }));
  const source = { format: 'pixelforge-poses', version: 1, name: 'heavy', width: 128, height: 128, palette: { k: '#000000', a: '#333333', b: '#666666' }, ramps: [['a', 'b']], parts: { blob: { mass: { size: [64, 64], ramp: 0, base: 1, outline: 'k' } } }, poses };
  const failure = (() => { try { compilePoses(source); } catch (error) { return error; } })();
  assert.equal(failure?.name, 'PixelError');
  assert.match(failure.message, /^poses\.poses\[\d+\]\.parts\[\d+\]: drawing bone and mass parts exceeds the 8,388,608-pixel budget/);
  // Work is nominal, so a cached drawing charges what drawing it would: the verdict never depends on the caches.
  const mass = { size: [12, 7], base: 1, outline: 'k' }, options = { angle: 30, squash: 1.2, ramp: ['a', 'b', 'c'] };
  const first = rasterizeMass(mass, options), second = rasterizeMass(mass, options);
  assert.ok(first.work > 0 && first.work === second.work);
  first.fill.fill(9); first.rows[0] = 'changed'; first.pivot[0] = 99;
  const third = rasterizeMass(mass, options);
  assert.deepEqual([third.rows, third.fill, third.pivot], [second.rows, second.fill, second.pivot]);
  assert.deepEqual(third.map([3, -2]), second.map([3, -2]));
});
