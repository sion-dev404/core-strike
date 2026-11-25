// 컴퓨터 요원: 길 찾기, 보기·반응, 사격, 엄폐·후퇴, 연막, 설치·해체
import * as THREE from 'three';
import { collide, groundAt, findPath, lineClear, randomNear, inSite, SITES, walkClear } from './map.js';
import { WEAPONS, newGun, ARMOR } from './weapons.js';
import { makeSoldier } from './models.js';

export const TEAM_COLOR = { atk: 0xff7a45, def: 0x2bb3a3 };
const EYE = 1.58;

export function makeBotMesh(team) { return makeSoldier(team, TEAM_COLOR[team]); }

// 라운드 시작 때 장비 사기 (돈을 아끼는 라운드도 있다)
export function botBuy(b, teamSave) {
  const c = b.credits;
  if (!teamSave && (!b.primary || b.primary.w.id === 'burst')) {
    if (c >= WEAPONS.lancer.price + ARMOR.light.price) { b.primary = newGun(Math.random() < 0.18 && c >= WEAPONS.longshot.price + 400 ? 'longshot' : 'lancer'); b.credits -= b.primary.w.price; }
    else if (!b.primary && c >= WEAPONS.burst.price + ARMOR.light.price) { b.primary = newGun('burst'); b.credits -= WEAPONS.burst.price; }
  }
  if (b.armor < 50 && b.credits >= ARMOR.heavy.price + 800) { b.armor = 50; b.credits -= ARMOR.heavy.price; }
  else if (b.armor < 25 && b.credits >= ARMOR.light.price) { b.armor = 25; b.credits -= ARMOR.light.price; }
  b.gun = b.primary || b.sidearm;
}

export const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export const eyeOf = (u) => new THREE.Vector3(u.pos.x, u.pos.y + (u.crouch ? 1.1 : (u.isPlayer ? 1.6 : EYE)), u.pos.z);
const flat = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

function canSee(G, b, e) {
  const d = flat(b, e);
  if (d > 80) return false;
  if (d > 4) { // 등 뒤는 못 본다
    const want = Math.atan2(-(e.pos.x - b.pos.x), -(e.pos.z - b.pos.z));
    if (Math.abs(angDiff(b.yaw, want)) > 1.2) return false;
  }
  const a = eyeOf(b), t = eyeOf(e); t.y -= 0.12;
  return lineClear(a, t, G.smokes);
}

function setGoal(G, b, x, z) {
  if (b.goal && Math.hypot(b.goal.x - x, b.goal.z - z) < 1.5 && b.path.length) return;
  b.goal = { x, z }; b.path = findPath(b.pos.x, b.pos.z, x, z); b.stuckT = 0;
}

function stepTo(b, dx, dz, dist) {
  const ox = b.pos.x, oz = b.pos.z;
  b.pos.x += dx * dist; b.pos.z += dz * dist;
  collide(b.pos, 0.38, b.pos.y);
  b.pos.y = groundAt(b.pos.x, b.pos.z, 0.38, b.pos.y);
  return Math.hypot(b.pos.x - ox, b.pos.z - oz);
}

function moveAlong(G, b, dt, speed) {
  if (!b.path.length) { b.moving = false; return true; }
  while (b.path.length > 1 && walkClear(b.pos.x, b.pos.z, b.path[1].x, b.path[1].z)) b.path.shift();
  const p = b.path[0]; const dx = p.x - b.pos.x, dz = p.z - b.pos.z; const d = Math.hypot(dx, dz);
  if (d < 0.5) { b.path.shift(); return !b.path.length; }
  const step = Math.min(d, speed * dt);
  const moved = stepTo(b, dx / d, dz / d, step);
  b.moving = true; b.running = speed > 4;
  const want = Math.atan2(-dx, -dz);
  b.yaw += angDiff(b.yaw, want) * Math.min(1, dt * 7);
  if (moved < step * 0.3) { b.stuckT += dt; if (b.stuckT > 0.6 && b.goal) { b.path = findPath(b.pos.x, b.pos.z, b.goal.x, b.goal.z); b.stuckT = 0; if (b.path.length > 1) b.path.shift(); } }
  else b.stuckT = 0;
  return false;
}

// 라운드 시작: 역할 나누기
export function planRound(G) {
  const R = G.round;
  const atkBots = G.units.filter((u) => !u.isPlayer && u.team === 'atk');
  const defBots = G.units.filter((u) => !u.isPlayer && u.team === 'def');
  R.attackSite = R.call || (Math.random() < 0.5 ? 'A' : 'B');
  R.smoked = { atk: false, def: false };
  atkBots.forEach((b, i) => {
    const s = SITES[R.attackSite];
    b.role = i === 3 ? 'lurk' : 'push';
    b.spot = randomNear(s.x, s.z, 6);
    b.waitT = i * 1.0 + Math.random() * 1.5;
  });
  const order = ['A', 'A', 'B', 'B', 'mid'];
  defBots.forEach((b, i) => {
    const k = order[(i + R.n) % order.length];
    b.role = k;
    if (k === 'mid') b.spot = randomNear(0, -14, 4);
    else { const s = SITES[k]; b.spot = randomNear(s.x + (s.x < 0 ? 5 : -5), s.z + 2, 5); }
    b.waitT = Math.random() * 1.2;
  });
}

// 길목 (지키는 쪽이 바라보는 곳)
const CHOKES = { A: [{ x: -38, z: 4 }, { x: -15, z: -10 }], B: [{ x: 38, z: 4 }, { x: 15, z: -10 }], mid: [{ x: 0, z: 6 }] };

export function updateBot(G, b, dt) {
  if (!b.alive) return;
  const R = G.round;
  const gun = b.gun;
  if (gun.cool > 0) gun.cool -= dt;
  if (gun.reloading > 0) { gun.reloading -= dt; if (gun.reloading <= 0) { const take = Math.min(gun.w.mag - gun.mag, gun.reserve); gun.mag += take; gun.reserve -= take; } }
  b.running = false;
  if (R.phase === 'buy') return;

  // 보기 (0.12초마다) + 가까운 발소리 듣기
  b.scanT -= dt;
  if (b.scanT <= 0) {
    b.scanT = 0.1 + Math.random() * 0.05;
    let best = null, bd = 1e9;
    for (const e of G.units) {
      if (!e.alive || e.team === b.team) continue;
      const d = (e.pos.x - b.pos.x) ** 2 + (e.pos.z - b.pos.z) ** 2;
      if (d < bd && canSee(G, b, e)) { bd = d; best = e; }
      else if (!b.target && e.running && d < 14 * 14 && b.lastSeenT <= 0) { b.lastSeen = { x: e.pos.x, z: e.pos.z }; b.lastSeenT = 2; }
    }
    if (best && best !== b.target) {
      b.reactT = G.diff.react * (0.7 + Math.random() * 0.6) + (b.lastSeenT > 0 ? -0.12 : 0);
      b.burst = 0;
      const far = Math.sqrt(bd) > 14 && b.gun.w.id !== 'burst';
      b.crouch = far && Math.random() < 0.55; // 멀면 앉아서 쏜다
    }
    b.target = best;
    if (best) {
      b.lastSeen = { x: best.pos.x, z: best.pos.z }; b.lastSeenT = 4;
      if (b.team === 'def') { const s = inSite(best.pos.x, best.pos.z) || (Math.abs(best.pos.x) > 18 && best.pos.z < 2 ? (best.pos.x < 0 ? 'A' : 'B') : null); if (s) R.alert = { site: s, t: 6 }; }
    }
  }

  // 싸우기
  if (b.target && b.target.alive) {
    b.plantT = 0; b.defuseT = 0;
    const t = b.target;
    const want = Math.atan2(-(t.pos.x - b.pos.x), -(t.pos.z - b.pos.z));
    b.yaw += angDiff(b.yaw, want) * Math.min(1, dt * 12);
    // 다쳤으면 뒤로 물러나며 쏜다
    if (b.hp < 35 && b.retreatT === undefined && Math.random() < 0.5) b.retreatT = 1.4;
    if (b.retreatT > 0) {
      b.retreatT -= dt; b.crouch = false;
      const d = flat(b, t) || 1;
      b.moving = stepTo(b, (b.pos.x - t.pos.x) / d, (b.pos.z - t.pos.z) / d, 3.2 * dt) > 0.001;
    } else if (!b.crouch) { // 옆걸음
      b.strafeT -= dt; if (b.strafeT <= 0) { b.strafeT = 0.35 + Math.random() * 0.7; b.strafe = Math.random() < 0.4 ? 0 : (Math.random() < 0.5 ? -1 : 1); }
      b.moving = b.strafe ? stepTo(b, Math.cos(b.yaw) * b.strafe, -Math.sin(b.yaw) * b.strafe, 2.4 * dt) > 0.001 : false;
    } else b.moving = false;
    b.reactT -= dt;
    if (b.reactT <= 0 && Math.abs(angDiff(b.yaw, want)) < 0.22) botFire(G, b, t);
    return;
  }
  b.target = null; b.crouch = false;
  if (b.retreatT !== undefined && b.retreatT <= 0 && b.hp >= 35) b.retreatT = undefined;
  if (gun.mag < gun.w.mag * 0.4 && gun.reloading <= 0 && gun.reserve > 0) gun.reloading = gun.w.reload;

  if (b.waitT > 0) { b.waitT -= dt; return; }
  const speed = 5.4;
  const core = R.core;

  // 공격팀
  if (b.team === 'atk') {
    if (core.state === 'dropped') {
      const mine = G.units.filter((u) => u.alive && u.team === 'atk' && !u.isPlayer).sort((a, c) => Math.hypot(a.pos.x - core.pos.x, a.pos.z - core.pos.z) - Math.hypot(c.pos.x - core.pos.x, c.pos.z - core.pos.z))[0];
      if (mine === b) { setGoal(G, b, core.pos.x, core.pos.z); moveAlong(G, b, dt, speed); return; }
    }
    const s = SITES[R.attackSite];
    // 지점에 들어가기 직전 연막으로 수비 쪽 길을 막는다
    if (!R.smoked.atk && R.phase === 'live' && Math.hypot(b.pos.x - s.x, b.pos.z - s.z) < 20) {
      R.smoked.atk = true; G.addSmoke(new THREE.Vector3(s.x < 0 ? -34 : 34, 1.8, -26), b);
      G.addSmoke(new THREE.Vector3(s.x < 0 ? -16 : 16, 1.8, -10), b);
    }
    if (core.state === 'carried' && core.carrier === b && R.phase === 'live') {
      if (inSite(b.pos.x, b.pos.z) && Math.hypot(b.pos.x - s.x, b.pos.z - s.z) < s.r - 2) {
        b.moving = false; b.crouch = true; b.plantT += dt; G.progress(b, 'plant', b.plantT / 4);
        if (b.plantT >= 4) G.plantCore(b);
        return;
      }
      setGoal(G, b, s.x, s.z); moveAlong(G, b, dt, speed); return;
    }
    if (core.state === 'planted') {
      if (!b.guard || Math.hypot(b.guard.x - core.pos.x, b.guard.z - core.pos.z) > 10) b.guard = randomNear(core.pos.x + (core.pos.x < 0 ? -4 : 4), core.pos.z + 6, 5);
      setGoal(G, b, b.guard.x, b.guard.z); if (moveAlong(G, b, dt, speed)) { b.crouch = true; lookAround(b, dt, core.pos); }
      return;
    }
    if (b.lastSeenT > 0) { b.lastSeenT -= dt; setGoal(G, b, b.lastSeen.x, b.lastSeen.z); moveAlong(G, b, dt, speed * 0.75); return; }
    if (b.role === 'lurk' && R.t > 55) { setGoal(G, b, 0, -8); if (moveAlong(G, b, dt, speed * 0.6)) lookAround(b, dt, { x: 0, z: -30 }); return; }
    setGoal(G, b, b.spot.x, b.spot.z);
    if (moveAlong(G, b, dt, speed)) lookAround(b, dt, { x: s.x, z: -32 });
    return;
  }

  // 수비팀
  if (core.state === 'planted' && R.phase === 'planted') {
    if (Math.hypot(b.pos.x - core.pos.x, b.pos.z - core.pos.z) < 1.4) {
      b.moving = false; b.crouch = true; b.defuseT += dt; G.progress(b, 'defuse', b.defuseT / 7);
      if (b.defuseT >= 7) G.defuseCore(b);
      return;
    }
    // 해체하러 가기 전에 한 번 연막
    if (!R.smoked.def && Math.hypot(b.pos.x - core.pos.x, b.pos.z - core.pos.z) < 18) { R.smoked.def = true; G.addSmoke(new THREE.Vector3(core.pos.x + (core.pos.x < 0 ? 0 : 0), 1.8, core.pos.z + 7), b); }
    b.defuseT = 0; setGoal(G, b, core.pos.x, core.pos.z); moveAlong(G, b, dt, speed); return;
  }
  if (b.lastSeenT > 0) { b.lastSeenT -= dt; setGoal(G, b, b.lastSeen.x, b.lastSeen.z); moveAlong(G, b, dt, speed * 0.6); return; }
  if (R.alert && R.alert.site !== b.role && b.role !== 'mid' && !b.rotated && Math.random() < dt * 0.6) {
    b.rotated = true; const s = SITES[R.alert.site]; b.spot = randomNear(s.x, s.z + 6, 5);
  }
  setGoal(G, b, b.spot.x, b.spot.z);
  if (moveAlong(G, b, dt, speed * 0.85)) {
    const ch = CHOKES[b.role] || CHOKES.mid;
    lookAround(b, dt, ch[b.chokeI = ((b.chokeI ?? Math.floor(Math.random() * ch.length)) % ch.length)]);
    if (Math.random() < dt * 0.15) b.chokeI = (b.chokeI + 1) % ch.length;
  }
}

function lookAround(b, dt, toward) {
  b.lookT -= dt;
  if (b.lookT <= 0) { b.lookT = 1.2 + Math.random() * 2.2; const base = Math.atan2(-(toward.x - b.pos.x), -(toward.z - b.pos.z)); b.lookYaw = base + (Math.random() - 0.5) * 0.7; }
  b.yaw += angDiff(b.yaw, b.lookYaw ?? b.yaw) * Math.min(1, dt * 3);
}

function botFire(G, b, t) {
  const gun = b.gun, w = gun.w;
  if (gun.reloading > 0 || gun.cool > 0) return;
  if (gun.mag <= 0) { if (gun.reserve > 0) gun.reloading = w.reload; else if (b.gun !== b.sidearm) b.gun = b.sidearm; return; }
  gun.mag--; gun.cool = w.rate * (w.auto ? 1.45 : 1.35) + (w.auto ? 0 : Math.random() * 0.15);
  b.burst++;
  const dist = flat(b, t);
  let p = G.diff.acc * Math.max(0.25, 1 - dist / 85);
  if (t.moving) p *= 0.78;
  if (t.crouch) p *= 0.9;
  if (b.crouch) p *= 1.12;
  if (b.moving) p *= 0.8;
  if (b.burst > 5 && w.auto) p *= 0.65;
  if (w.id === 'longshot') p = Math.min(0.9, p * 1.25);
  const hit = Math.random() < p;
  const head = hit && Math.random() < G.diff.head;
  const from = eyeOf(b); from.y -= 0.3;
  const hy = t.crouch ? 1.12 : 1.62;
  const to = new THREE.Vector3(t.pos.x, t.pos.y + (head ? hy : hy - 0.6), t.pos.z);
  if (!hit) { to.x += (Math.random() - 0.5) * 2; to.y += (Math.random() - 0.3) * 1.2; to.z += (Math.random() - 0.5) * 2; }
  G.shotFx(b, from, to, w, !hit);
  if (hit) G.damage(b, t, w, head, to);
}
