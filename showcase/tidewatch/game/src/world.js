// Deterministic game simulation: no DOM access. Positions are world pixels; y is the ground contact line.
import { TILE, COLS, ROWS, OBJECTS, ENEMIES, START, walkable } from './map.js';

// Sprite anchors (the pixel that stands on an object's ground point) live in the Pixelbolt atlases, authored in
// the recipes. Collision boxes are game rules, relative to that ground point.
const SOLID = {
  lighthouse: [-20, -14, 40, 14], cottage: [-22, -24, 44, 24], palm: [-4, -4, 8, 4], oak: [-5, -4, 10, 4], bush: [-7, -6, 14, 6], rock: [-7, -6, 14, 6],
  'boulder-a': [-13, -8, 26, 8], 'boulder-b': [-12, -6, 24, 6], pot: [-5, -5, 10, 5], chest: [-7, -6, 14, 6], sign: [-4, -4, 8, 4], lamp: [-3, -3, 6, 3], fisher: [-7, -6, 14, 6]
};
const FLAT = new Set(['shell', 'starfish', 'pebbles']);
const INTERACT = new Set(['fisher', 'sign', 'chest', 'lighthouse', 'cottage']);
const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const rectAt = (e, r) => [e.x + r[0], e.y + r[1], r[2], r[3]];
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class World {
  // `keeper` is the keeper's exported atlas JSON: its strike frames carry the blade tip as a `hit` point.
  constructor(keeper, seed = 7) {
    this.random = rng(seed); this.keeper = keeper; this.time = 0;
    this.player = { x: START.x, y: START.y, dir: 'u', state: 'idle', t: 0, hp: 6, maxHp: 6, inv: 0, kx: 0, ky: 0, kt: 0, hitSet: new Set() };
    this.props = OBJECTS.map(([kind, tx, ty, extra = {}], id) => ({ id, kind, x: tx * TILE + 8 + (extra.dx ?? 0), y: ty * TILE + 16 + (extra.dy ?? 0) - (FLAT.has(kind) ? 4 : 0), item: extra.item, alive: true, cut: false, open: false, t: 0, flat: FLAT.has(kind) }));
    this.enemies = ENEMIES.map(([kind, tx, ty], id) => ({ id, kind, x: tx * TILE + 8, y: ty * TILE + 12, hp: kind === 'crab' ? 2 : 1, state: 'idle', t: this.random() * 800, dir: 1, vx: 0, vy: 0, kt: 0, cool: 0, wander: 0, alive: true, hurt: 0 }));
    this.effects = []; this.pickups = []; this.messages = []; this.events = [];
    this.gulls = [0, 1, 2].map(i => ({ x: i * 230 + 40, y: 40 + i * 150, vx: (i % 2 ? -1 : 1) * (16 + i * 4), t: i * 300, glide: 0 }));
    this.flags = { key: false, flint: false, lit: false, talked: false, ending: 0 };
    this.stats = { glass: 0, defeated: 0, cut: 0, pots: 0, time: 0 };
    this.phase = 'day';
  }
  get glass() { return this.stats.glass; }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  say(lines, speaker) { for (const text of lines) this.messages.push({ text, speaker }); }
  solidAt(rect, ignore) {
    for (const x of [rect[0], rect[0] + rect[2] - 1]) for (const y of [rect[1], rect[1] + rect[3] - 1]) if (!walkable(Math.floor(x / TILE), Math.floor(y / TILE))) return true;
    for (const p of this.props) if (p !== ignore && p.alive && !p.cut && SOLID[p.kind] && overlap(rect, rectAt(p, SOLID[p.kind]))) return true;
    return false;
  }
  move(e, dx, dy, box) {
    if (dx) { const r = rectAt({ x: e.x + dx, y: e.y }, box); if (!this.solidAt(r)) e.x += dx; else if (!dy) { for (const nudge of [-1, 1]) { const s = rectAt({ x: e.x + dx, y: e.y + nudge }, box); if (!this.solidAt(s)) { e.y += nudge; break; } } } }
    if (dy) { const r = rectAt({ x: e.x, y: e.y + dy }, box); if (!this.solidAt(r)) e.y += dy; else if (!dx) { for (const nudge of [-1, 1]) { const s = rectAt({ x: e.x + nudge, y: e.y + dy }, box); if (!this.solidAt(s)) { e.x += nudge; break; } } } }
    e.x = Math.max(8, Math.min(COLS * TILE - 8, e.x)); e.y = Math.max(8, Math.min(ROWS * TILE - 2, e.y));
  }
  // Attack reach comes from the atlas: the blade tip (`hit` point) of each strike frame, relative to its anchor.
  attackBox() {
    const p = this.player, frame = this.keeper.frames[`attack-${p.dir}-2`], tip = frame.points.hit, anchor = frame.anchorPx;
    const tx = p.x + tip.x - anchor.x, ty = p.y + tip.y - anchor.y, cx = p.x, cy = p.y - 9;
    const left = Math.min(tx, cx) - 7, top = Math.min(ty, cy) - 7, right = Math.max(tx, cx) + 7, bottom = Math.max(ty, cy) + 7;
    return [left, top, right - left, bottom - top];
  }
  spawnFx(anim, x, y, atlas = 'fx', flip = false) { this.effects.push({ atlas, anim, x, y, t: 0, flip }); }
  drop(x, y, chance = 1) {
    const r = this.random();
    if (r < 0.5 * chance) this.pickups.push({ kind: 'glass', x, y, t: 0, z: 6, vz: -0.9 });
    else if (r < 0.68 * chance && this.player.hp < this.player.maxHp) this.pickups.push({ kind: 'heart', x, y, t: 0, z: 6, vz: -0.9 });
  }
  facingTarget() {
    const p = this.player, reach = { d: [0, 12], u: [0, -14], r: [12, -3], l: [-12, -3] }[p.dir];
    const probe = [p.x + reach[0] - 6, p.y + reach[1] - 6, 12, 12];
    let best = null;
    for (const prop of this.props) if (prop.alive && INTERACT.has(prop.kind)) {
      const box = prop.kind === 'lighthouse' ? [prop.x - 10, prop.y - 6, 20, 10] : prop.kind === 'cottage' ? [prop.x - 8, prop.y - 6, 16, 10] : rectAt(prop, SOLID[prop.kind] ?? [-6, -6, 12, 6]);
      if (overlap(probe, [box[0] - 2, box[1] - 2, box[2] + 4, box[3] + 4])) best = prop;
    }
    return best;
  }
  interact(prop) {
    const f = this.flags;
    if (prop.kind === 'fisher') {
      if (f.lit) this.say(['Look at her shine. Ships will find their way home tonight.', 'Welcome to Tidewatch, keeper.'], 'Old Wren');
      else if (!f.talked) { f.talked = true; this.say(['Ahoy, young keeper! You made it before sundown.', 'Trouble, though: the lamp has gone dark, and the night boats need it.', 'The crabs dragged the old chest with the TOWER KEY off to the east cove.', 'And you will need a SUNFLINT to strike the lamp. One glints in the tall grass west of here, past the cottage.', 'Swing your cutlass with J or Space. Talk and open things with E.'], 'Old Wren'); }
      else if (f.key && f.flint) this.say(['That is everything! Follow the path north to the lighthouse.'], 'Old Wren');
      else this.say([`Still looking? ${f.key ? '' : 'The key is in the east cove. '}${f.flint ? '' : 'Cut the tall grass west of the cottage for the flint.'}`.trim()], 'Old Wren');
    } else if (prop.kind === 'sign') this.say(['TIDEWATCH ISLE. Lighthouse: north. Keeper cottage: west. Mind the crabs.']);
    else if (prop.kind === 'cottage') this.say(['The keeper cottage. Tidy, and smelling of salt and lamp oil.']);
    else if (prop.kind === 'chest') {
      if (prop.open) { this.say(['The chest is empty.']); return; }
      prop.open = true; this.emit('chest'); this.grant(prop.item, prop.x, prop.y);
    } else if (prop.kind === 'lighthouse') {
      if (f.lit) this.say(['The lamp turns steadily above you.']);
      else if (f.key && f.flint) { f.ending = 1; this.player.state = 'idle'; this.emit('ignite'); }
      else if (f.key) this.say(['The key turns, but there is nothing to light the lamp with. Find a SUNFLINT.']);
      else if (f.flint) this.say(['The door is locked. The TOWER KEY is somewhere on the island.']);
      else this.say(['Locked tight. You will need the TOWER KEY and a SUNFLINT.']);
    }
  }
  grant(item, x, y) {
    this.flags[item] = true;
    const p = this.player; p.state = 'hold'; p.t = 0; p.dir = 'd'; p.held = item;
    this.emit('item', { item });
    this.say([item === 'key' ? 'You found the TOWER KEY!' : 'You found a SUNFLINT! It is warm, and faintly glowing.']);
    if (this.phase === 'day') { this.phase = 'dusk'; this.say(['The sun is sinking. Better hurry to the lighthouse.']); }
  }
  hurtPlayer(from) {
    const p = this.player; if (p.inv > 0 || p.state === 'hold' || this.flags.ending) return;
    p.hp = Math.max(0, p.hp - 1); p.inv = 1100; p.state = 'hurt'; p.t = 0;
    const d = Math.hypot(p.x - from.x, p.y - from.y) || 1; p.kx = (p.x - from.x) / d; p.ky = (p.y - from.y) / d; p.kt = 160;
    this.emit('hurt');
    if (p.hp === 0) { this.emit('faint'); p.hp = p.maxHp; p.x = START.x; p.y = START.y; p.dir = 'u'; p.inv = 1500; this.say(['You wake on the pier, a little sore. Old Wren patched you up.']); }
  }
  update(dt, input) {
    this.time += dt; this.stats.time += this.flags.lit ? 0 : dt;
    for (const g of this.gulls) { g.t += dt; g.x += g.vx * dt / 1000; if (g.x > COLS * TILE + 30) g.x = -30; if (g.x < -30) g.x = COLS * TILE + 30; g.y += Math.sin(g.t / 900) * 0.05; }
    for (const e of this.effects) e.t += dt;
    for (const p of this.props) if (p.hitFlash) p.hitFlash = Math.max(0, p.hitFlash - dt);
    if (this.messages.length) return; // dialog pauses the island
    if (this.flags.ending) { this.flags.ending += dt; return; }
    this.updatePlayer(dt, input);
    this.updateEnemies(dt);
    this.updatePickups(dt);
  }
  updatePlayer(dt, input) {
    const p = this.player; p.t += dt; p.inv = Math.max(0, p.inv - dt);
    // The item stays aloft while its announcement is on screen, then control returns immediately.
    if (p.state === 'hold') { if (!this.messages.length) { p.state = 'idle'; p.held = null; } return; }
    if (p.kt > 0) { p.kt -= dt; this.move(p, Math.round(p.kx * 2), Math.round(p.ky * 2), [-5, -4, 10, 5]); if (p.state === 'hurt' && p.kt <= 0) p.state = 'idle'; return; }
    if (p.state === 'hurt') p.state = 'idle';
    if (p.state === 'attack') {
      if (p.t >= 70 && p.t < 240) this.strike();
      if (p.t >= 310) p.state = 'idle';
      return;
    }
    const act = input.take('act'), attack = input.take('attack');
    const target = (act || attack) ? this.facingTarget() : null;
    // E always interacts; the attack button doubles as a context action in front of people, signs, chests and doors.
    if (target && (act || (attack && target.kind !== 'cottage'))) { this.interact(target); return; }
    if (attack) { p.state = 'attack'; p.t = 0; p.hitSet = new Set(); this.spawnFx(`slash-${p.dir}`, p.x, p.y - 9, 'slash'); this.emit('swing'); return; }
    const { x, y } = input.axis();
    if (x || y) {
      if (x && !y) p.dir = x > 0 ? 'r' : 'l'; else if (y && !x) p.dir = y > 0 ? 'd' : 'u';
      else if (!((p.dir === 'r' && x > 0) || (p.dir === 'l' && x < 0) || (p.dir === 'd' && y > 0) || (p.dir === 'u' && y < 0))) p.dir = y > 0 ? 'd' : 'u';
      const speed = 72 * dt / 1000, len = Math.hypot(x, y);
      p.carryX = (p.carryX ?? 0) + x / len * speed; p.carryY = (p.carryY ?? 0) + y / len * speed;
      const mx = Math.trunc(p.carryX), my = Math.trunc(p.carryY); p.carryX -= mx; p.carryY -= my;
      for (let i = 0; i < Math.max(Math.abs(mx), Math.abs(my)); i++) this.move(p, i < Math.abs(mx) ? Math.sign(mx) : 0, i < Math.abs(my) ? Math.sign(my) : 0, [-5, -4, 10, 5]);
      if (p.state !== 'walk') { p.state = 'walk'; p.t = 0; }
    } else if (p.state !== 'idle') { p.state = 'idle'; p.t = 0; }
  }
  strike() {
    const box = this.attackBox(), p = this.player;
    for (const prop of this.props) {
      if (!prop.alive || p.hitSet.has(prop) || !['bush', 'grass', 'pot'].includes(prop.kind) || prop.cut) continue;
      const hit = prop.kind === 'grass' ? [prop.x - 6, prop.y - 10, 12, 10] : rectAt(prop, SOLID[prop.kind]);
      if (!overlap(box, hit)) continue;
      p.hitSet.add(prop);
      if (prop.kind === 'pot') { prop.alive = false; this.stats.pots++; this.spawnFx('shards', prop.x, prop.y); this.emit('smash'); this.drop(prop.x, prop.y - 2, 1.4); }
      else {
        prop.cut = true; this.stats.cut++; this.spawnFx('leaves', prop.x, prop.y - 2); this.emit('cut');
        if (prop.item) this.pickups.push({ kind: prop.item, x: prop.x, y: prop.y - 1, t: 0, z: 8, vz: -1.2 });
        else this.drop(prop.x, prop.y - 2, prop.kind === 'bush' ? 0.9 : 0.55);
      }
    }
    for (const e of this.enemies) {
      if (!e.alive || p.hitSet.has(e)) continue;
      if (!overlap(box, [e.x - 7, e.y - 10, 14, 11])) continue;
      p.hitSet.add(e); e.hp--; e.hurt = 220; e.state = 'hurt'; e.t = 0;
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1; e.vx = (e.x - p.x) / d * 3; e.vy = (e.y - p.y) / d * 3; e.kt = 150;
      this.spawnFx('hit', (e.x + p.x) / 2, e.y - 2); this.emit('hit');
      if (e.hp <= 0) { e.alive = false; this.stats.defeated++; this.spawnFx('poof', e.x, e.y); this.drop(e.x, e.y - 2, 1.2); this.emit('defeat'); }
    }
  }
  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt; e.cool = Math.max(0, e.cool - dt); e.hurt = Math.max(0, e.hurt - dt);
      const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy);
      if (e.kt > 0) { e.kt -= dt; this.move(e, Math.round(e.vx), Math.round(e.vy), [-6, -3, 12, 4]); continue; }
      if (e.state === 'hurt' && e.hurt <= 0) { e.state = 'idle'; e.t = 0; }
      if (e.kind === 'crab') {
        if (e.state === 'snap') {
          if (e.t >= 310 && e.t < 420 && dist < 17 && !e.bit) { e.bit = true; this.hurtPlayer(e); }
          if (e.t >= 470) { e.state = 'idle'; e.t = 0; e.cool = 700; }
          continue;
        }
        if (dist < 16 && e.cool <= 0) { e.state = 'snap'; e.t = 0; e.bit = false; continue; }
        let mx = 0, my = 0;
        if (dist < 70) { mx = Math.sign(dx) * (Math.abs(dx) > 3 ? 1 : 0); my = Math.sign(dy) * (Math.abs(dy) > 2 ? 0.6 : 0); }
        else { e.wander -= dt; if (e.wander <= 0) { e.wander = 900 + this.random() * 1200; e.dir = this.random() < 0.5 ? -1 : 1; e.drift = this.random() < 0.3 ? (this.random() < 0.5 ? -0.5 : 0.5) : 0; } mx = e.wander > 500 ? e.dir : 0; my = e.wander > 500 ? e.drift : 0; }
        const speed = (dist < 70 ? 30 : 18) * dt / 1000;
        e.ax = (e.ax ?? 0) + mx * speed; e.ay = (e.ay ?? 0) + my * speed;
        const sx = Math.trunc(e.ax), sy = Math.trunc(e.ay); e.ax -= sx; e.ay -= sy;
        if (sx || sy) this.move(e, sx, sy, [-6, -3, 12, 4]);
        const moving = mx || my; if (moving && e.state !== 'walk') { e.state = 'walk'; e.t = 0; } else if (!moving && e.state === 'walk') { e.state = 'idle'; e.t = 0; }
      } else {
        if (e.state === 'hop') {
          if (e.t > 110 && e.t < 400) { e.ax = (e.ax ?? 0) + e.hx * 64 * dt / 1000; e.ay = (e.ay ?? 0) + e.hy * 64 * dt / 1000; const sx = Math.trunc(e.ax), sy = Math.trunc(e.ay); e.ax -= sx; e.ay -= sy; if (sx || sy) this.move(e, sx, sy, [-6, -3, 12, 4]); }
          if (e.t >= 520) { e.state = 'idle'; e.t = 0; e.cool = 700 + this.random() * 900; }
        } else if (e.cool <= 0 && e.state !== 'hurt') {
          const toward = dist < 96; const ang = toward ? Math.atan2(dy, dx) : this.random() * Math.PI * 2;
          e.hx = Math.cos(ang); e.hy = Math.sin(ang); e.state = 'hop'; e.t = 0;
        }
        if (dist < 10 && (e.state !== 'hop' || e.t < 110 || e.t > 400)) this.hurtPlayer(e);
      }
      if (e.kind === 'crab' && dist < 9) this.hurtPlayer(e);
    }
  }
  updatePickups(dt) {
    const p = this.player;
    for (const k of this.pickups) {
      k.t += dt; k.vz += 0.004 * dt; k.z = Math.max(0, k.z - k.vz * dt / 16); if (k.z === 0 && k.vz > 0) k.vz = k.vz > 0.4 ? -k.vz * 0.35 : 0;
      if (k.t < 250 || Math.hypot(p.x - k.x, p.y - k.y) > 10) continue;
      k.taken = true;
      if (k.kind === 'glass') { this.stats.glass++; this.emit('glass'); }
      else if (k.kind === 'heart') { p.hp = Math.min(p.maxHp, p.hp + 2); this.emit('heart'); }
      else this.grant(k.kind, k.x, k.y);
    }
    this.pickups = this.pickups.filter(k => !k.taken && k.t < 12000);
  }
}
