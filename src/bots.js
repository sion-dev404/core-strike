// 컴퓨터 요원: 길 찾기, 보기·반응, 사격, 설치·해체
import * as THREE from 'three';
import { collide, groundAt, findPath, lineClear, randomNear, inSite, SITES, walkClear } from './map.js';
import { WEAPONS, newGun, ARMOR } from './weapons.js';

export const TEAM_COLOR = { atk: 0xff7a45, def: 0x2bb3a3 };
const EYE = 1.55;

export function makeBotMesh(team) {
  const g = new THREE.Group();
  const col = TEAM_COLOR[team];
  const suit = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1c9a5, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.62, 4, 10), suit); body.position.y = 0.95; body.castShadow = true;
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.6, 10), dark); legs.position.y = 0.32; legs.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), skin); head.position.y = 1.62; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.12), dark); visor.position.set(0, 1.66, -0.18);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 20), suit); band.rotation.x = Math.PI / 2; band.position.y = 1.72;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.7 })); gun.position.set(0.22, 1.22, -0.35); gun.name = 'gun';
  g.add(body, legs, head, visor, band, gun);
  return g;
}

// 라운드 시작 때 장비 사기
export function botBuy(b) {
  const c = b.credits;
  if (!b.primary || b.primary.w.id === 'burst') {
    if (c >= WEAPONS.lancer.price + ARMOR.light.price) { b.primary = newGun(Math.random() < 0.15 && c >= WEAPONS.longshot.price + 400 ? 'longshot' : 'lancer'); b.credits -= b.primary.w.price; }
    else if (!b.primary && c >= WEAPONS.burst.price) { b.primary = newGun('burst'); b.credits -= WEAPONS.burst.price; }
  }
  if (b.armor < 50 && b.credits >= ARMOR.heavy.price + 600) { b.armor = 50; b.credits -= ARMOR.heavy.price; }
  else if (b.armor < 25 && b.credits >= ARMOR.light.price) { b.armor = 25; b.credits -= ARMOR.light.price; }
  b.gun = b.primary || b.sidearm;
}

const forward = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export const eyeOf = (u) => new THREE.Vector3(u.pos.x, u.pos.y + (u.crouch ? 1.1 : (u.isPlayer ? 1.6 : EYE)), u.pos.z);

function canSee(G, b, e) {
  const d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
  if (d > 75) return false;
  if (d > 5) { // 등 뒤는 못 본다 (가까우면 느낌으로 안다)
    const want = Math.atan2(-(e.pos.x - b.pos.x), -(e.pos.z - b.pos.z));
    if (Math.abs(angDiff(b.yaw, want)) > 1.15) return false;
  }
  const a = eyeOf(b), t = eyeOf(e); t.y -= 0.15;
  return lineClear(a, t, G.smokes);
}

function setGoal(G, b, x, z) {
  if (b.goal && Math.hypot(b.goal.x - x, b.goal.z - z) < 1.5 && b.path.length) return;
  b.goal = { x, z }; b.path = findPath(b.pos.x, b.pos.z, x, z); b.stuckT = 0;
}

function moveAlong(G, b, dt, speed) {
  if (!b.path.length) { b.moving = false; return true; }
  // 다음다음 점이 바로 보이면 건너뛴다 (부드럽게)
  while (b.path.length > 1 && walkClear(b.pos.x, b.pos.z, b.path[1].x, b.path[1].z)) b.path.shift();
  const p = b.path[0]; const dx = p.x - b.pos.x, dz = p.z - b.pos.z; const d = Math.hypot(dx, dz);
  if (d < 0.5) { b.path.shift(); return !b.path.length; }
  const step = Math.min(d, speed * dt);
  const ox = b.pos.x, oz = b.pos.z;
  b.pos.x += dx / d * step; b.pos.z += dz / d * step;
  collide(b.pos, 0.38, b.pos.y);
  b.pos.y = groundAt(b.pos.x, b.pos.z, 0.38, b.pos.y);
  b.moving = true;
  const want = Math.atan2(-dx, -dz);
  b.yaw += angDiff(b.yaw, want) * Math.min(1, dt * 8);
  // 막혔으면 길을 다시 찾는다
  if (Math.hypot(b.pos.x - ox, b.pos.z - oz) < step * 0.3) { b.stuckT += dt; if (b.stuckT > 0.6 && b.goal) { b.path = findPath(b.pos.x, b.pos.z, b.goal.x, b.goal.z); b.stuckT = 0; if (b.path.length > 1) b.path.shift(); } }
  else b.stuckT = 0;
  return false;
}

// 라운드 시작: 역할 나누기
export function planRound(G) {
  const R = G.round;
  const atkBots = G.units.filter((u) => !u.isPlayer && u.team === 'atk');
  const defBots = G.units.filter((u) => !u.isPlayer && u.team === 'def');
  R.attackSite = R.call || (Math.random() < 0.5 ? 'A' : 'B');
  atkBots.forEach((b, i) => {
    const s = SITES[R.attackSite];
    // 한 명은 가운데 길로 돌아가 견제
    b.role = i === 3 ? 'lurk' : 'push';
    b.spot = randomNear(s.x, s.z, 6);
    b.waitT = i * 1.2 + Math.random() * 2; // 출발 시간을 조금씩 다르게
  });
  const order = ['A', 'A', 'B', 'B', 'mid'];
  defBots.forEach((b, i) => {
    const k = order[(i + R.n) % order.length];
    b.role = k;
    if (k === 'mid') b.spot = randomNear(0, -14, 4);
    else { const s = SITES[k]; b.spot = randomNear(s.x + (s.x < 0 ? 4 : -4), s.z + 3, 5); }
    b.waitT = Math.random() * 1.5;
  });
}

export function updateBot(G, b, dt) {
  if (!b.alive) return;
  const R = G.round;
  const gun = b.gun;
  if (gun.cool > 0) gun.cool -= dt;
  if (gun.reloading > 0) { gun.reloading -= dt; if (gun.reloading <= 0) { const need = gun.w.mag - gun.mag, take = Math.min(need, gun.reserve); gun.mag += take; gun.reserve -= take; } }
  if (R.phase === 'buy') return;

  // 보기 (0.12초마다)
  b.scanT -= dt;
  if (b.scanT <= 0) {
    b.scanT = 0.12;
    let best = null, bd = 1e9;
    for (const e of G.units) {
      if (!e.alive || e.team === b.team) continue;
      const d = (e.pos.x - b.pos.x) ** 2 + (e.pos.z - b.pos.z) ** 2;
      if (d < bd && canSee(G, b, e)) { bd = d; best = e; }
    }
    if (best && best !== b.target) { b.reactT = G.diff.react * (0.75 + Math.random() * 0.6); b.burst = 0; }
    b.target = best;
    if (best) { b.lastSeen = { x: best.pos.x, z: best.pos.z }; b.lastSeenT = 4; if (b.team === 'def') { const s = inSite(best.pos.x, best.pos.z) || (Math.abs(best.pos.x) > 18 && best.pos.z < 0 ? (best.pos.x < 0 ? 'A' : 'B') : null); if (s) R.alert = { site: s, t: 6 }; } }
  }

  // 싸우기
  if (b.target && b.target.alive) {
    b.plantT = 0; b.defuseT = 0;
    const t = b.target;
    const want = Math.atan2(-(t.pos.x - b.pos.x), -(t.pos.z - b.pos.z));
    b.yaw += angDiff(b.yaw, want) * Math.min(1, dt * 12);
    b.pitch = Math.atan2((t.pos.y + 1.3) - (b.pos.y + EYE), Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z));
    // 옆걸음
    b.strafeT -= dt; if (b.strafeT <= 0) { b.strafeT = 0.4 + Math.random() * 0.8; b.strafe = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1); }
    if (b.strafe) {
      const s = 2.2 * dt * b.strafe, ox = b.pos.x, oz = b.pos.z;
      b.pos.x += Math.cos(b.yaw) * s; b.pos.z += -Math.sin(b.yaw) * s;
      collide(b.pos, 0.38, b.pos.y);
      b.moving = Math.hypot(b.pos.x - ox, b.pos.z - oz) > 0.001;
    } else b.moving = false;
    b.reactT -= dt;
    if (b.reactT <= 0 && Math.abs(angDiff(b.yaw, want)) < 0.25) botFire(G, b, t);
    return;
  }
  b.target = null;
  if (gun.mag < gun.w.mag * 0.35 && gun.reloading <= 0 && gun.reserve > 0) { gun.reloading = gun.w.reload; }

  if (b.waitT > 0) { b.waitT -= dt; return; }
  const speed = 5.4;
  const core = R.core;

  // 공격팀
  if (b.team === 'atk') {
    if (core.state === 'dropped') {
      const mine = G.units.filter((u) => u.alive && u.team === 'atk' && !u.isPlayer).sort((a, c) => Math.hypot(a.pos.x - core.pos.x, a.pos.z - core.pos.z) - Math.hypot(c.pos.x - core.pos.x, c.pos.z - core.pos.z))[0];
      if (mine === b) { setGoal(G, b, core.pos.x, core.pos.z); moveAlong(G, b, dt, speed); return; }
    }
    if (core.state === 'carried' && core.carrier === b && R.phase === 'live') {
      const s = SITES[R.attackSite];
      if (inSite(b.pos.x, b.pos.z) && Math.hypot(b.pos.x - s.x, b.pos.z - s.z) < s.r - 2) {
        b.moving = false; b.plantT += dt; G.progress(b, 'plant', b.plantT / 4);
        if (b.plantT >= 4) G.plantCore(b);
        return;
      }
      setGoal(G, b, s.x, s.z); moveAlong(G, b, dt, speed); return;
    }
    if (core.state === 'planted') {
      if (!b.guard || Math.hypot(b.guard.x - core.pos.x, b.guard.z - core.pos.z) > 9) b.guard = randomNear(core.pos.x, core.pos.z, 7);
      setGoal(G, b, b.guard.x, b.guard.z); if (moveAlong(G, b, dt, speed)) lookAround(b, dt, core.pos);
      return;
    }
    if (b.lastSeenT > 0) { b.lastSeenT -= dt; setGoal(G, b, b.lastSeen.x, b.lastSeen.z); moveAlong(G, b, dt, speed * 0.8); return; }
    const s = SITES[R.attackSite];
    if (b.role === 'lurk' && R.t > 60) { setGoal(G, b, 0, -10); if (moveAlong(G, b, dt, speed * 0.7)) lookAround(b, dt, { x: s.x, z: s.z }); return; }
    setGoal(G, b, b.spot.x, b.spot.z);
    if (moveAlong(G, b, dt, speed)) lookAround(b, dt, { x: 0, z: -40 });
    return;
  }

  // 수비팀
  if (core.state === 'planted' && R.phase === 'planted') {
    if (Math.hypot(b.pos.x - core.pos.x, b.pos.z - core.pos.z) < 1.4) {
      b.moving = false; b.defuseT += dt; G.progress(b, 'defuse', b.defuseT / 7);
      if (b.defuseT >= 7) G.defuseCore(b);
      return;
    }
    b.defuseT = 0; setGoal(G, b, core.pos.x, core.pos.z); moveAlong(G, b, dt, speed); return;
  }
  if (b.lastSeenT > 0) { b.lastSeenT -= dt; setGoal(G, b, b.lastSeen.x, b.lastSeen.z); moveAlong(G, b, dt, speed * 0.7); return; }
  if (R.alert && R.alert.site !== b.role && b.role !== 'mid' && !b.rotated && Math.random() < dt * 0.6) {
    b.rotated = true; const s = SITES[R.alert.site]; b.spot = randomNear(s.x, s.z + 6, 5);
  }
  setGoal(G, b, b.spot.x, b.spot.z);
  if (moveAlong(G, b, dt, speed * 0.9)) lookAround(b, dt, { x: b.spot.x < -10 ? -38 : b.spot.x > 10 ? 38 : 0, z: 10 });
}

function lookAround(b, dt, toward) {
  b.lookT -= dt;
  if (b.lookT <= 0) { b.lookT = 1.5 + Math.random() * 2.5; const base = Math.atan2(-(toward.x - b.pos.x), -(toward.z - b.pos.z)); b.lookYaw = base + (Math.random() - 0.5) * 1.6; }
  b.yaw += angDiff(b.yaw, b.lookYaw ?? b.yaw) * Math.min(1, dt * 3);
}

function botFire(G, b, t) {
  const gun = b.gun, w = gun.w;
  if (gun.reloading > 0 || gun.cool > 0) return;
  if (gun.mag <= 0) { if (gun.reserve > 0) gun.reloading = w.reload; else if (b.gun !== b.sidearm) b.gun = b.sidearm; return; }
  gun.mag--; gun.cool = w.rate * (w.auto ? 1.5 : 1.4) + (w.auto ? 0 : Math.random() * 0.15);
  b.burst++;
  const dist = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
  let p = G.diff.acc * Math.max(0.25, 1 - dist / 85);
  if (t.moving) p *= 0.78;
  if (t.crouch) p *= 0.9;
  if (b.burst > 5 && w.auto) p *= 0.65;
  if (w.id === 'longshot') p = Math.min(0.9, p * 1.25);
  const hit = Math.random() < p;
  const head = hit && Math.random() < G.diff.head;
  const from = eyeOf(b); from.y -= 0.3;
  const to = new THREE.Vector3(t.pos.x, t.pos.y + (head ? 1.6 : 1.0), t.pos.z);
  if (!hit) { to.x += (Math.random() - 0.5) * 2; to.y += (Math.random() - 0.3) * 1.2; to.z += (Math.random() - 0.5) * 2; }
  G.shotFx(b, from, to, w);
  if (hit) G.damage(b, t, w, head);
}
