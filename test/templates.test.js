import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject, parseColor } from '../src/core.js';
import { inspectMotion } from '../src/motion.js';
import { cleanupIds, rasterizeBone, rasterizeMass } from '../src/craft.js';
import { heroRig, bossRig } from '../scripts/figure-rigs.mjs';

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
    assert.ok(f.times.compile < (make === heroRig ? 400 : 2000), `compile CI budget: ${f.times.compile}`);
    assert.ok(f.times.render < (make === heroRig ? 150 : 600), `render CI budget: ${f.times.render}`);
    if (make === heroRig) assert.ok(f.times.expand < 50, `expand CI budget: ${f.times.expand}`);
    const colors = new Set(Object.values(f.source.palette).map(c => new Uint32Array(Uint8Array.from(parseColor(c)).buffer)[0]));
    for (const frame of f.project.frames) {
      const pixels = new Uint32Array(frame.data.buffer);
      for (let i = 0; i < pixels.length; i++) if (frame.data[i * 4 + 3]) assert.ok(colors.has(pixels[i]), `palette ${frame.name}`);
    }
  });
  const motions = make === heroRig ? ['idle', 'walk', 'run', 'jump', 'attack'] : ['idle', 'walk', 'run', 'jump', 'attack', 'hurt', 'prowl', 'charge'];
  for (const animation of motions) test(`${make.name}: ${animation} has clean parts, joined bones and passing motion measurements`, () => {
    const f = fixture(make), view = inspectMotion(f.project, { animation, metadata: f.metadata, scale: 1 });
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
  assert.ok(ahead(a, 'farThigh', 'body') && ahead(b, 'nearThigh', 'body'));
  assert.ok(ahead(a, 'body', 'sword') && ahead(b, 'sword', 'body'), 'weapon stays in its arm subtree across unequal-depth swaps');
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
