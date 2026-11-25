// 요원과 능력 (모두 이 게임을 위해 새로 만든 원작)
import * as THREE from 'three';
import { BLOCKS, rayWorld, lineClear } from './map.js';
import { newGun } from './weapons.js';

// kind: 능력 종류 / free: 라운드마다 공짜 / max: 최대 / price: 하나 값 / recharge: 다 쓰면 다시 차는 시간(초)
export const AGENTS = {
  blink: {
    name: '블링크', role: '돌격', color: '#ff7a45', tag: 'BL',
    desc: '빠르게 파고들어 먼저 쏘는 요원',
    C: { kind: 'flash', name: '섬광', max: 2, price: 200, free: 0 },
    Q: { kind: 'dash', name: '돌진', max: 1, price: 0, free: 1, recharge: 0 },
    E: { kind: 'smoke', name: '연막', max: 2, price: 150, free: 1 },
    X: { kind: 'blades', name: '폭풍 칼날', cost: 7 },
  },
  haram: {
    name: '하람', role: '전략가', color: '#8f7cff', tag: 'HR',
    desc: '연막으로 길을 끊고 불길로 막는 요원',
    C: { kind: 'molly', name: '불길', max: 1, price: 250, free: 0 },
    Q: { kind: 'smoke', name: '연막', max: 3, price: 100, free: 2 },
    E: { kind: 'slow', name: '늪', max: 1, price: 200, free: 0 },
    X: { kind: 'smokeWall', name: '연기 장막', cost: 7 },
  },
  nuri: {
    name: '누리', role: '척후', color: '#3fd17a', tag: 'NR',
    desc: '숨은 적을 찾아내는 요원',
    C: { kind: 'flash', name: '섬광', max: 2, price: 250, free: 0 },
    Q: { kind: 'recon', name: '탐지 화살', max: 1, price: 0, free: 1, recharge: 40 },
    E: { kind: 'slow', name: '늪', max: 1, price: 150, free: 0 },
    X: { kind: 'revealAll', name: '천리안', cost: 8 },
  },
  sona: {
    name: '소나', role: '감시자', color: '#5ec8f2', tag: 'SN',
    desc: '팀을 살리고 길을 막는 요원',
    C: { kind: 'slow', name: '늪', max: 2, price: 200, free: 0 },
    Q: { kind: 'heal', name: '치유', max: 1, price: 0, free: 1, recharge: 45 },
    E: { kind: 'wall', name: '얼음벽', max: 1, price: 400, free: 0 },
    X: { kind: 'revive', name: '되살림', cost: 8 },
  },
  rock: {
    name: '바위', role: '돌격', color: '#ffb02e', tag: 'RK',
    desc: '폭발로 자리를 쓸어 내는 요원',
    C: { kind: 'molly', name: '불길', max: 1, price: 200, free: 0 },
    Q: { kind: 'flash', name: '섬광', max: 2, price: 250, free: 0 },
    E: { kind: 'dash', name: '돌진', max: 1, price: 0, free: 1 },
    X: { kind: 'rocket', name: '로켓', cost: 7 },
  },
};
export const AGENT_IDS = Object.keys(AGENTS);
export const KEYS = ['C', 'Q', 'E'];

export function resetCharges(u, keep) {
  const a = AGENTS[u.agent];
  u.ab ||= {};
  for (const k of KEYS) { const d = a[k]; const prev = keep ? (u.ab[k]?.n || 0) : 0; u.ab[k] = { n: Math.min(d.max, Math.max(prev, d.free)), t: 0 }; }
}
export function tickCharges(u, dt) {
  const a = AGENTS[u.agent];
  for (const k of KEYS) { const d = a[k], s = u.ab[k]; if (d.recharge && s.n < d.free) { s.t += dt; if (s.t >= d.recharge) { s.n++; s.t = 0; } } }
}

/* ---------- 효과 만들기 ---------- */
let scene = null;
export function initAbilities(s) { scene = s; }

// 조준한 곳: 벽이나 바닥에 닿는 점 (최대 dist)
function aimPoint(aim, dist) {
  const r = rayWorld(aim.o, aim.d, dist);
  return aim.o.clone().addScaledVector(aim.d, Math.max(0.5, r.t - 0.4));
}
function groundPoint(aim, dist) {
  const p = aimPoint(aim, dist); const r = rayWorld(p.clone().setY(p.y + 0.2), new THREE.Vector3(0, -1, 0), 20);
  return p.setY(Math.max(0, p.y + 0.2 - r.t));
}

function addArea(G, kind, pos, owner, r, t) {
  const color = kind === 'molly' ? 0xff6a2a : 0x6b8f3a;
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; g.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.15, r, 48), new THREE.MeshBasicMaterial({ color: kind === 'molly' ? 0xffd27a : 0xb6e36b, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  if (kind === 'molly') { const l = new THREE.PointLight(0xff7a3c, 6, 10, 2); l.position.y = 1; g.add(l); }
  g.position.copy(pos); scene.add(g);
  G.areas.push({ kind, pos: pos.clone(), r, t, owner, team: owner.team, mesh: g, flameT: 0 });
}

export function useAbility(G, u, key, aim) {
  const a = AGENTS[u.agent];
  if (key === 'X') {
    const d = a.X; if (u.ult < G.ultCost(u)) return false;
    if (!castUlt(G, u, d.kind, aim)) return false;
    u.ult = 0; G.onAbility?.(u, d.name, true); return true;
  }
  const d = a[key], s = u.ab[key];
  if (!s || s.n <= 0) return false;
  if (!cast(G, u, d.kind, aim)) return false;
  s.n--; G.onAbility?.(u, d.name, false);
  return true;
}

function cast(G, u, kind, aim) {
  switch (kind) {
    case 'smoke': G.addSmoke(aimPoint(aim, 34).setY(1.9), u); return true;
    case 'dash': if (!u.isPlayer) return false; G.dash(); return true;
    case 'flash': flash(G, u, aimPoint(aim, 9)); return true;
    case 'molly': addArea(G, 'molly', groundPoint(aim, 22), u, 3.5, 7); G.sfx('fire'); return true;
    case 'slow': addArea(G, 'slow', groundPoint(aim, 24), u, 4.5, 7); G.sfx('smoke'); return true;
    case 'heal': {
      let t = u;
      for (const x of G.units) if (x !== u && x.alive && x.team === u.team && x.hp < 100) { const to = new THREE.Vector3(x.pos.x, x.pos.y + 1.2, x.pos.z).sub(aim.o); const dist = to.length(); if (dist < 14 && to.normalize().dot(aim.d) > 0.94) { t = x; break; } }
      if (t.hp >= 100) return false;
      t.healLeft = 60; G.sfx('heal'); G.say?.(u, t === u ? '치유' : `${t.name} 치유`); return true;
    }
    case 'wall': {
      const p = groundPoint(aim, 14); const yaw = Math.atan2(aim.d.x, aim.d.z);
      addWall(G, p, yaw); G.sfx('wall'); return true;
    }
    case 'recon': {
      const p = aimPoint(aim, 45); p.y = Math.max(p.y, 1);
      const dart = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshBasicMaterial({ color: 0x3fd17a }));
      dart.position.copy(p); scene.add(dart);
      const pulse = (n) => {
        if (!G.running) return;
        G.ring(p, 25, 0x3fd17a);
        for (const e of G.units) if (e.alive && e.team !== u.team && e.pos.distanceTo(p) < 25 && lineClear(p, new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z), [])) { e.revealT = 2.5; e.spottedT = 2.5; }
        if (n > 1) setTimeout(() => pulse(n - 1), 1600); else setTimeout(() => scene.remove(dart), 1200);
      };
      setTimeout(() => pulse(2), 500); G.sfx('recon'); return true;
    }
  }
  return false;
}

function castUlt(G, u, kind, aim) {
  switch (kind) {
    case 'blades': u.ultGun = u.gun; u.gun = newGun('blades'); u.gun.reserve = 0; G.refreshViewmodel?.(u); return true;
    case 'smokeWall': {
      const flat = new THREE.Vector3(aim.d.x, 0, aim.d.z).normalize();
      for (let i = 1; i <= 5; i++) {
        const o = aim.o.clone(); const r = rayWorld(o, flat, i * 5.5); if (r.hit && r.t < i * 5.5 - 0.5) break;
        G.addSmoke(o.addScaledVector(flat, i * 5.5).setY(1.9), u, i > 1);
      }
      return true;
    }
    case 'revealAll': {
      let n = 3; const tick = () => { if (!G.running || n-- <= 0) return; G.sfx('recon'); for (const e of G.units) if (e.alive && e.team !== u.team) { e.revealT = 2; e.spottedT = 2; } setTimeout(tick, 2500); };
      tick(); return true;
    }
    case 'revive': {
      const dead = G.units.filter((x) => !x.alive && x.team === u.team && x !== u && x.diedRound === G.round.n).sort((a, b) => a.pos.distanceTo(u.pos) - b.pos.distanceTo(u.pos))[0];
      if (!dead) return false;
      G.revive(dead); G.say?.(u, `${dead.name} 되살림`); return true;
    }
    case 'rocket': {
      const r = rayWorld(aim.o, aim.d, 80);
      let best = r.t;
      for (const e of G.units) { if (!e.alive || e.team === u.team) continue; const t = closest(aim.o, aim.d, new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z)); if (t > 0 && t < best) best = t; }
      const at = aim.o.clone().addScaledVector(aim.d, best);
      G.rocket(u, aim.o.clone(), at); return true;
    }
  }
  return false;
}
function closest(o, d, c) { const t = c.clone().sub(o).dot(d); if (t <= 0) return -1; const p = o.clone().addScaledVector(d, t); return p.distanceTo(c) < 0.7 ? t : -1; }

// 섬광: 0.4초 뒤 터지고, 그쪽을 보고 있던 적은 눈이 부신다
function flash(G, u, at) {
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  orb.position.copy(at); scene.add(orb);
  G.sfx('flashThrow');
  setTimeout(() => {
    scene.remove(orb);
    if (!G.running) return;
    G.flashBurst(at);
    for (const e of G.units) {
      if (!e.alive || e.team === u.team) continue;
      const eye = new THREE.Vector3(e.pos.x, e.pos.y + (e.crouch ? 1.1 : 1.6), e.pos.z);
      if (eye.distanceTo(at) > 40 || !lineClear(eye, at, G.smokes)) continue;
      const to = at.clone().sub(eye).normalize();
      const fwd = e.isPlayer ? G.lookDir() : new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
      const facing = to.dot(fwd);
      if (facing > 0.35) e.blindT = Math.max(e.blindT || 0, 0.8 + facing * 1.3);
      else if (facing > -0.2) e.blindT = Math.max(e.blindT || 0, 0.4);
    }
  }, 420);
}

function addWall(G, pos, yaw) {
  // 바라보는 방향에 가로로 선다 (BLOCKS에 잠시 넣어 부딪힘·시야를 막는다)
  const along = Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw)) ? 'z' : 'x';
  const w = along === 'x' ? 9 : 0.9, d = along === 'x' ? 0.9 : 9, h = 3.4;
  const b = { x: pos.x, z: pos.z, w, d, h, k: 'ice', minX: pos.x - w / 2, maxX: pos.x + w / 2, minZ: pos.z - d / 2, maxZ: pos.z + d / 2, temp: true };
  BLOCKS.push(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0xbfe9ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x2a6f8f, emissiveIntensity: 0.25 }));
  m.position.set(pos.x, h / 2, pos.z); m.castShadow = true; scene.add(m);
  m.scale.y = 0.01;
  G.walls.push({ b, mesh: m, t: 14 });
}
export function updateWalls(G, dt) {
  for (const w of G.walls) {
    w.t -= dt; w.mesh.scale.y = Math.min(1, w.mesh.scale.y + dt * 4);
    if (w.t <= 0) { scene.remove(w.mesh); const i = BLOCKS.indexOf(w.b); if (i >= 0) BLOCKS.splice(i, 1); }
  }
  G.walls = G.walls.filter((w) => w.t > 0);
}
export function clearTemp(G) {
  for (const w of G.walls) { scene.remove(w.mesh); const i = BLOCKS.indexOf(w.b); if (i >= 0) BLOCKS.splice(i, 1); }
  G.walls = [];
  for (const a of G.areas) scene.remove(a.mesh);
  G.areas = [];
}
// 불길·늪: 안에 있는 적에게 피해·느려짐
export function updateAreas(G, dt) {
  for (const a of G.areas) {
    a.t -= dt;
    a.mesh.children[0].material.opacity = Math.min(0.45, a.t * 0.4);
    for (const e of G.units) {
      if (!e.alive || e.team === a.team) continue;
      if (Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) > a.r || e.pos.y > 1) continue;
      if (a.kind === 'molly') G.burn(a.owner, e, 45 * dt);
      else e.slowT = 0.25;
    }
    if (a.kind === 'molly') { a.flameT -= dt; if (a.flameT <= 0) { a.flameT = 0.06; G.flame(a.pos, a.r); } }
    if (a.t <= 0) scene.remove(a.mesh);
  }
  G.areas = G.areas.filter((a) => a.t > 0);
}
