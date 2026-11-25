// 코어 스트라이크 — 3D 1인칭 5대5 전술 슈팅 (원작, 무과금)
import * as THREE from 'three';
import { buildMap, BLOCKS, SITES, SPAWNS, BOUNDS, collide, groundAt, rayWorld, inSite, randomNear, lineClear } from './map.js';
import { WEAPONS, ARMOR, SMOKE_PRICE, MONEY, newGun, applyDamage } from './weapons.js';
import { makeBotMesh, botBuy, planRound, updateBot, eyeOf, TEAM_COLOR } from './bots.js';
import { initAudio, shot, sfx } from './audio.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('cs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('cs.' + k, JSON.stringify(v)); } catch { /* 무시 */ } } };

/* ---------- 화면 준비 ---------- */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9d4f0);
scene.fog = new THREE.Fog(0xa9d4f0, 60, 160);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6b6450, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
sun.position.set(-40, 70, 30); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 55, bottom: -55, near: 10, far: 200 });
scene.add(sun);
buildMap(scene);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

/* ---------- 손에 든 총 ---------- */
const view = new THREE.Group(); camera.add(view);
const vmMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, depthTest: false });
const vmDark = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.6, depthTest: false });
const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.5), vmMat);
const vmBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 8), vmDark); vmBarrel.rotation.x = Math.PI / 2; vmBarrel.position.set(0, 0.02, -0.38);
const vmGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), vmDark); vmGrip.position.set(0, -0.11, 0.1); vmGrip.rotation.x = 0.3;
const vmScope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), vmDark); vmScope.rotation.x = Math.PI / 2; vmScope.position.set(0, 0.1, -0.05);
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a, depthTest: false }));
flash.position.set(0, 0.02, -0.58); flash.visible = false;
const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), new THREE.MeshStandardMaterial({ color: 0xf1c9a5, depthTest: false })); hand.position.set(0, -0.09, 0.06);
view.add(vmBody, vmBarrel, vmGrip, vmScope, flash, hand);
view.traverse((m) => { m.renderOrder = 10; });
view.position.set(0.24, -0.22, -0.55); view.scale.setScalar(0.75);

/* ---------- 게임 상태 ---------- */
const NAMES_US = ['솔', '파도', '별빛', '모래'];
const NAMES_THEM = ['해치', '노을', '바위', '번개', '안개'];
const DIFF = { easy: { name: '쉬움', react: 0.8, acc: 0.3, head: 0.08 }, normal: { name: '보통', react: 0.5, acc: 0.44, head: 0.15 }, hard: { name: '어려움', react: 0.32, acc: 0.6, head: 0.25 } };
const WIN = 5, HALF = 4;
const settings = { sens: store.get('sens', 1), diff: store.get('diff', 'normal') };

const G = {
  units: [], player: null, smokes: [], fx: [], diff: DIFF[settings.diff],
  round: null, score: { us: 0, them: 0 }, ourSide: 'atk', played: 0, running: false, paused: false,
};
const coreMesh = (() => {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0x2a3140 }));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.42, 16), new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0xff3b1f, emissiveIntensity: 1.2 }));
  base.position.y = 0.11; glow.position.y = 0.3; glow.name = 'glow';
  g.add(base, glow); g.visible = false; scene.add(g); return g;
})();

function newUnit({ name, us, isPlayer }) {
  const u = {
    name, us, isPlayer, team: us ? G.ourSide : (G.ourSide === 'atk' ? 'def' : 'atk'),
    pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true,
    sidearm: newGun('spark'), primary: null, gun: null, credits: MONEY.start, kills: 0, deaths: 0,
    crouch: false, moving: false, path: [], goal: null, mesh: null, tag: null,
    scanT: 0, reactT: 0, burst: 0, strafeT: 0, strafe: 0, lastSeenT: 0, plantT: 0, defuseT: 0, lookT: 0, stuckT: 0, waitT: 0, spottedT: 0,
  };
  u.gun = u.sidearm;
  if (!isPlayer) { u.mesh = makeBotMesh(u.team); scene.add(u.mesh); if (us) { u.tag = nameTag(name); u.mesh.add(u.tag); } }
  return u;
}
function nameTag(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.font = 'bold 34px "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(text, 128, 32); g.fillStyle = '#fff'; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.2, 0.3, 1); s.position.y = 2.15; s.renderOrder = 5; return s;
}
function recolor(u) { if (!u.mesh) return; u.mesh.traverse((m) => { if (m.material && m.material.color && m.material.color.getHex() in { [TEAM_COLOR.atk]: 1, [TEAM_COLOR.def]: 1 }) m.material.color.setHex(TEAM_COLOR[u.team]); }); }

/* ---------- 게임 시작 ---------- */
function startGame() {
  for (const u of G.units) if (u.mesh) scene.remove(u.mesh);
  G.units = []; G.score = { us: 0, them: 0 }; G.played = 0; G.ourSide = 'atk'; G.diff = DIFF[settings.diff];
  G.player = newUnit({ name: '나', us: true, isPlayer: true });
  G.units.push(G.player);
  NAMES_US.forEach((n) => G.units.push(newUnit({ name: n, us: true })));
  NAMES_THEM.forEach((n) => G.units.push(newUnit({ name: n, us: false })));
  G.running = true;
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
  newRound(true);
}

function newRound(first = false) {
  const R = G.round = { n: G.played + 1, phase: 'buy', t: 20, alert: null, call: null, attackSite: null, core: { state: 'carried', carrier: null, pos: new THREE.Vector3(), t: 0, beepT: 0 } };
  for (const s of G.smokes) scene.remove(s.mesh); G.smokes = [];
  const sides = { atk: [], def: [] };
  for (const u of G.units) {
    u.team = u.us ? G.ourSide : (G.ourSide === 'atk' ? 'def' : 'atk');
    recolor(u);
    if (!u.alive || first) { u.primary = null; u.armor = 0; }
    u.sidearm = newGun('spark');
    if (u.primary) { u.primary.mag = u.primary.w.mag; u.primary.reserve = u.primary.w.reserve; u.primary.reloading = 0; }
    u.gun = u.primary || u.sidearm;
    u.hp = 100; u.alive = true; u.vy = 0; u.crouch = false; u.target = null; u.path = []; u.goal = null; u.lastSeenT = 0; u.plantT = 0; u.defuseT = 0; u.rotated = false; u.guard = null; u.spottedT = 0;
    sides[u.team].push(u);
  }
  for (const side of ['atk', 'def']) {
    const sp = SPAWNS[side];
    sides[side].forEach((u, i) => {
      const off = (i - 2) * 2.4;
      u.pos.set(sp.x + off, 0, sp.z + (i % 2) * 1.5 * (side === 'atk' ? 1 : -1));
      u.yaw = sp.yaw; u.pitch = 0;
      if (u.mesh) { u.mesh.visible = true; u.mesh.rotation.set(0, u.yaw, 0); u.mesh.position.copy(u.pos); }
    });
  }
  for (const u of G.units) if (!u.isPlayer) botBuy(u);
  // 코어는 공격팀이 든다 (내가 공격이면 내가)
  const atk = G.units.filter((u) => u.team === 'atk');
  R.core.carrier = atk.find((u) => u.isPlayer) || atk[Math.floor(Math.random() * atk.length)];
  coreMesh.visible = false;
  P.smokes = 1; P.dash = 1; P.scoped = false;
  refreshViewmodel();
  planRound(G);
  sfx.round();
  showMsg(`${R.n}라운드 · ${G.ourSide === 'atk' ? '공격' : '수비'}`, G.ourSide === 'atk' ? '코어를 A나 B 지점에 설치하세요' : '적이 코어를 설치하지 못하게 막으세요', 3);
  openBuy();
  updateHud(true);
}

/* ---------- 나(플레이어) ---------- */
const P = { smokes: 1, dash: 1, dashT: 0, dashDir: null, scoped: false, kick: 0, bob: 0, spectate: 0, fireHeld: false };
const keys = new Set();
let locked = false;
canvas.addEventListener('click', () => { if (G.running && !G.paused && $('buy').classList.contains('hidden') && !locked) lockPointer(); });
function lockPointer() { initAudio(); canvas.requestPointerLock?.(); }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && G.running && !G.paused && $('buy').classList.contains('hidden') && $('end').classList.contains('hidden')) pause(true);
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const k = 0.0022 * settings.sens * (P.scoped ? 0.4 : 1);
  G.player.yaw -= e.movementX * k;
  G.player.pitch = Math.max(-1.45, Math.min(1.45, G.player.pitch - e.movementY * k));
});
document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (G.running && !G.player.alive) { if (e.button === 0) P.spectate++; return; }
  if (e.button === 0) { P.fireHeld = true; tryFire(true); }
  if (e.button === 2 && G.player.gun.w.scope) { P.scoped = !P.scoped; }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) P.fireHeld = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (!G.running) return;
  const k = e.code; keys.add(k);
  if (k === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); drawScoreboard(); }
  if (k === 'KeyB') { if (G.round.phase === 'buy') { $('buy').classList.contains('hidden') ? openBuy() : closeBuy(); } }
  if (k === 'Escape' && !$('buy').classList.contains('hidden')) closeBuy();
  if (!G.player.alive) return;
  if (k === 'Digit1' && G.player.primary) switchGun(G.player.primary);
  if (k === 'Digit2') switchGun(G.player.sidearm);
  if (k === 'KeyR') startReload(G.player);
  if (k === 'KeyQ') throwSmoke();
  if (k === 'KeyE') dash();
  if (k === 'KeyZ' || k === 'KeyX') callSite(k === 'KeyZ' ? 'A' : 'B');
  if (k === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Tab') $('scoreboard').classList.add('hidden'); });
addEventListener('blur', () => keys.clear());

function switchGun(g) { const p = G.player; if (p.gun === g) return; p.gun = g; g.cool = Math.max(g.cool, 0.35); P.scoped = false; refreshViewmodel(); }
function startReload(u) { const g = u.gun; if (g.reloading > 0 || g.mag >= g.w.mag || g.reserve <= 0) return; g.reloading = g.w.reload; P.scoped = false; if (u.isPlayer) sfx.reload(); }
function refreshViewmodel() {
  if (!G.player) return;
  const w = G.player.gun.w;
  vmMat.color.setHex(w.color);
  const len = { spark: 0.28, burst: 0.42, lancer: 0.56, longshot: 0.72 }[w.id];
  vmBody.scale.set(1, 1, len / 0.5); vmBody.position.z = -0.05 - (len - 0.5) / 2;
  vmBarrel.position.z = -0.05 - len / 2 - 0.12; flash.position.z = vmBarrel.position.z - 0.18;
  vmScope.visible = !!w.scope;
}
function callSite(s) {
  if (G.ourSide !== 'atk') return;
  G.round.call = s; G.round.attackSite = s;
  for (const u of G.units) if (!u.isPlayer && u.team === 'atk') { const S = SITES[s]; u.spot = randomNear(S.x, S.z, 6); u.goal = null; u.path = []; }
  feed(`<b class="us">나</b>: "${s}로 가자!"`);
}

function throwSmoke() {
  if (P.smokes <= 0 || G.round.phase === 'buy') return;
  const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
  const r = rayWorld(o, d, 32);
  const at = o.clone().addScaledVector(d, Math.max(1, r.t - 1)); at.y = Math.max(1.6, Math.min(at.y, 2.2));
  P.smokes--; sfx.smoke(); addSmoke(at);
}
function addSmoke(at) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc7ccd6, transparent: true, opacity: 0, roughness: 1, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(2.2 + Math.random() * 1.2, 16, 12), mat);
    m.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.3) * 1.6, (Math.random() - 0.5) * 3); g.add(m);
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(4.1, 20, 14), mat); g.add(core);
  g.position.copy(at); scene.add(g);
  G.smokes.push({ pos: at.clone(), r: 4.1, t: 13, mesh: g, mat });
}
function dash() {
  if (P.dash <= 0 || G.round.phase === 'buy') return;
  P.dash--; sfx.dash();
  const f = new THREE.Vector3(-Math.sin(G.player.yaw), 0, -Math.cos(G.player.yaw));
  const mv = moveInput(); if (mv.lengthSq() > 0) f.copy(mv);
  P.dashDir = f.normalize(); P.dashT = 0.22;
}
function moveInput() {
  const p = G.player, f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const v = new THREE.Vector3();
  if (keys.has('KeyW')) v.add(f); if (keys.has('KeyS')) v.sub(f); if (keys.has('KeyD')) v.add(r); if (keys.has('KeyA')) v.sub(r);
  return v.lengthSq() ? v.normalize() : v;
}

function updatePlayer(dt) {
  const p = G.player, R = G.round;
  const g = p.gun;
  if (g.cool > 0) g.cool -= dt;
  g.heat = Math.max(0, (g.heat || 0) - dt * (P.fireHeld ? 0.02 : 0.25));
  if (g.reloading > 0) { g.reloading -= dt; if (g.reloading <= 0) { const take = Math.min(g.w.mag - g.mag, g.reserve); g.mag += take; g.reserve -= take; } }
  if (!p.alive) return;
  const frozen = R.phase === 'buy';
  p.crouch = keys.has('ControlLeft') || keys.has('KeyC');
  const walk = keys.has('ShiftLeft');
  let speed = p.crouch ? 2.4 : walk ? 3.3 : 6.4;
  if (P.scoped) speed *= 0.6;
  if (g.w.id === 'longshot') speed *= 0.92;
  const mv = frozen ? new THREE.Vector3() : moveInput();
  const ox = p.pos.x, oz = p.pos.z;
  if (P.dashT > 0) { P.dashT -= dt; mv.copy(P.dashDir); speed = 24; }
  p.pos.x += mv.x * speed * dt; p.pos.z += mv.z * speed * dt;
  collide(p.pos, 0.4, p.pos.y);
  const ground = groundAt(p.pos.x, p.pos.z, 0.4, p.pos.y);
  if (keys.has('Space') && p.pos.y <= ground + 0.01 && !frozen) p.vy = 7;
  p.vy -= 20 * dt; p.pos.y += p.vy * dt;
  if (p.pos.y <= ground) { p.pos.y = ground; p.vy = 0; }
  const moved = Math.hypot(p.pos.x - ox, p.pos.z - oz) / dt;
  p.moving = moved > 1;
  P.bob += moved * dt * 1.6;
  P.air = p.pos.y > ground + 0.05;

  // 코어 줍기
  if (R.core.state === 'dropped' && p.team === 'atk' && Math.hypot(p.pos.x - R.core.pos.x, p.pos.z - R.core.pos.z) < 1.3) { R.core.state = 'carried'; R.core.carrier = p; coreMesh.visible = false; feed('<b class="us">나</b>: 코어를 주웠습니다'); }
  // 설치·해체 (F 또는 4를 누르고 있기)
  const holding = keys.has('KeyF') || keys.has('Digit4');
  if (holding && !p.moving && !P.air && R.phase === 'live' && R.core.carrier === p && inSite(p.pos.x, p.pos.z)) {
    p.plantT += dt; progress(p, 'plant', p.plantT / 4); if (p.plantT >= 4) plantCore(p);
  } else if (holding && !p.moving && R.phase === 'planted' && p.team === 'def' && Math.hypot(p.pos.x - R.core.pos.x, p.pos.z - R.core.pos.z) < 1.6) {
    p.defuseT += dt; progress(p, 'defuse', p.defuseT / 7); if (p.defuseT >= 7) defuseCore(p);
  } else { if (p.plantT || p.defuseT) progress(p, null, 0); p.plantT = 0; p.defuseT = 0; }

  if (P.fireHeld && g.w.auto) tryFire(false);
  if (g.mag === 0 && g.reserve > 0 && g.reloading <= 0 && g.cool <= 0) startReload(p);
}

function tryFire(click) {
  const p = G.player, g = p.gun, w = g.w, R = G.round;
  if (!p.alive || R.phase === 'buy' || !locked || $('buy').classList.contains('hidden') === false) return;
  if (g.reloading > 0 || g.cool > 0) return;
  if (!click && !w.auto) return;
  if (g.mag <= 0) { if (click) sfx.empty(); return; }
  g.mag--; g.cool = w.rate;
  // 퍼짐
  let spread = w.spread + (p.moving ? w.move : 0) + (P.air ? 0.12 : 0) + g.heat;
  if (w.scope && !P.scoped) spread += 0.05;
  if (p.crouch) spread *= 0.75;
  if (w.auto) g.heat = Math.min(0.06, g.heat + 0.0045);
  const o = camera.getWorldPosition(new THREE.Vector3());
  const d = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(d, camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, d).normalize();
  const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread;
  d.addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr).normalize();
  // 맞힘 판정
  const wall = rayWorld(o, d, 200);
  let best = wall.t, victim = null, head = false;
  for (const u of G.units) {
    if (!u.alive || u.team === p.team) continue;
    const hc = new THREE.Vector3(u.pos.x, u.pos.y + 1.62, u.pos.z);
    const th = raySphere(o, d, hc, 0.25); if (th > 0 && th < best) { best = th; victim = u; head = true; }
    const tb = rayCylinder(o, d, u.pos, 0.38, u.pos.y + 0.0, u.pos.y + 1.42); if (tb > 0 && tb < best) { best = tb; victim = u; head = false; }
  }
  const end = o.clone().addScaledVector(d, best);
  const muzzle = flash.getWorldPosition(new THREE.Vector3());
  shotFx(p, muzzle, end, w, !victim && wall.hit);
  if (victim) damage(p, victim, w, head);
  // 반동
  P.kick = 1;
  p.pitch = Math.min(1.45, p.pitch + w.kick * (0.7 + Math.random() * 0.5) * (P.scoped ? 0.5 : 1));
  p.yaw += (Math.random() - 0.5) * w.kick * 0.6;
  if (w.scope) P.scoped = false;
  // 근처 적이 소리를 듣는다
  for (const u of G.units) if (!u.isPlayer && u.alive && u.team !== p.team && !u.target && Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z) < 32) { u.lastSeen = { x: p.pos.x, z: p.pos.z }; u.lastSeenT = 2.5; }
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z, b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
  if (disc < 0) return -1; return -b - Math.sqrt(disc);
}
function rayCylinder(o, d, base, r, y0, y1) {
  const ox = o.x - base.x, oz = o.z - base.z, a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return -1;
  const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r, disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a; if (t <= 0) return -1;
  const y = o.y + d.y * t; return y >= y0 && y <= y1 ? t : -1;
}

/* ---------- 맞히기·쓰러뜨리기 ---------- */
function damage(a, v, w, head) {
  if (!v.alive) return;
  const dealt = applyDamage(v, w, head);
  if (a.isPlayer) { hitMarker(head, v.hp <= 0); head ? sfx.head() : sfx.hit(); }
  if (v.isPlayer) { sfx.hurt(); hurtFlash(a, dealt); }
  if (!v.isPlayer && !v.target) { v.lastSeen = { x: a.pos.x, z: a.pos.z }; v.lastSeenT = 3; v.yaw = Math.atan2(-(a.pos.x - v.pos.x), -(a.pos.z - v.pos.z)); }
  if (v.hp <= 0) kill(a, v, w, head);
}
function kill(a, v, w, head) {
  v.alive = false; v.hp = 0; v.deaths++; a.kills++;
  a.credits = Math.min(MONEY.max, a.credits + MONEY.kill);
  v.plantT = 0; v.defuseT = 0; progress(v, null, 0);
  if (a.isPlayer) sfx.kill();
  feed(`<b class="${a.us ? 'us' : 'them'}">${a.name}</b> <span class="w">${w.name}${head ? ' ◎' : ''}</span> <b class="${v.us ? 'us' : 'them'}">${v.name}</b>`);
  if (v.mesh) { v.dieT = 0; }
  const R = G.round;
  if (R.core.carrier === v && R.core.state === 'carried') { R.core.state = 'dropped'; R.core.pos.set(v.pos.x, v.pos.y, v.pos.z); coreMesh.position.copy(R.core.pos); coreMesh.visible = true; feed('코어가 떨어졌습니다'); }
  if (v.isPlayer) { P.scoped = false; showMsg('쓰러졌습니다', '아군을 지켜봅니다 · 화면을 누르면 다른 아군', 2.5); }
  checkRoundEnd();
}

/* ---------- 코어 ---------- */
function progress(u, kind, f) {
  if (!u.isPlayer) return;
  const box = $('progress');
  if (!kind) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('progressText').textContent = kind === 'plant' ? '코어 설치 중…' : '코어 해체 중…';
  $('progressBar').style.width = `${Math.min(100, f * 100)}%`;
}
function plantCore(u) {
  const R = G.round;
  if (R.phase !== 'live') return; // 라운드가 끝난 뒤에는 설치할 수 없다
  R.phase = 'planted'; R.t = 40; R.core.state = 'planted'; R.core.carrier = null;
  R.core.pos.set(u.pos.x, u.pos.y, u.pos.z); coreMesh.position.copy(R.core.pos); coreMesh.visible = true;
  R.core.site = inSite(u.pos.x, u.pos.z);
  u.plantT = 0; progress(u, null, 0);
  for (const x of G.units) if (x.team === 'atk') x.credits = Math.min(MONEY.max, x.credits + MONEY.plant);
  feed(`<b class="${u.us ? 'us' : 'them'}">${u.name}</b>: ${R.core.site} 지점에 코어 설치!`);
  showMsg('코어 설치됨', G.ourSide === 'atk' ? '40초 동안 지키세요' : `${R.core.site} 지점으로 가서 해체하세요 (F 길게)`, 2.5);
  sfx.coreBeep(true);
  checkRoundEnd();
}
function defuseCore(u) {
  const R = G.round; if (R.phase !== 'planted') return; u.defuseT = 0; progress(u, null, 0);
  R.core.state = 'defused';
  feed(`<b class="${u.us ? 'us' : 'them'}">${u.name}</b>: 코어 해체!`);
  endRound('def', '코어 해체');
}

/* ---------- 라운드 ---------- */
function aliveOf(side) { return G.units.filter((u) => u.alive && u.team === side).length; }
function checkRoundEnd() {
  const R = G.round; if (R.phase !== 'live' && R.phase !== 'planted') return;
  const a = aliveOf('atk'), d = aliveOf('def');
  if (d === 0) return endRound('atk', '수비 전멸');
  if (a === 0 && R.phase === 'live') return endRound('def', '공격 전멸');
}
function endRound(side, why) {
  const R = G.round; if (R.phase === 'end') return;
  R.phase = 'end'; R.t = 5; R.winner = side;
  const weWon = side === G.ourSide;
  G.score[weWon ? 'us' : 'them']++;
  for (const u of G.units) u.credits = Math.min(MONEY.max, u.credits + (u.team === side ? MONEY.win : MONEY.lose));
  progress(G.player, null, 0);
  weWon ? sfx.win() : sfx.lose();
  showMsg(weWon ? '라운드 승리!' : '라운드 패배', why, 4, weWon ? 'win' : 'lose');
}
function afterRound() {
  G.played++;
  if (G.score.us >= WIN || G.score.them >= WIN) return gameOver();
  if (G.played === HALF) {
    G.ourSide = G.ourSide === 'atk' ? 'def' : 'atk';
    for (const u of G.units) { u.credits = MONEY.start; u.primary = null; u.armor = 0; u.alive = false; }
    showMsg('공수 교대', `이제 ${G.ourSide === 'atk' ? '공격' : '수비'}입니다`, 2.5);
  }
  newRound();
}
function gameOver() {
  G.running = false; document.exitPointerLock?.();
  const win = G.score.us > G.score.them;
  $('hud').classList.add('hidden'); $('buy').classList.add('hidden');
  $('endTitle').textContent = win ? '승리!' : '패배';
  $('endTitle').className = win ? 'win' : 'lose';
  $('endScore').textContent = `우리 ${G.score.us} : ${G.score.them} 상대`;
  const p = G.player; $('endStats').textContent = `내 기록: ${p.kills}명 쓰러뜨림 · ${p.deaths}번 쓰러짐`;
  $('end').classList.remove('hidden');
}

/* ---------- 효과 ---------- */
const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.9 });
const impactMat = new THREE.MeshBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.8 });
function shotFx(u, from, to, w, wallHit) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat.clone()); scene.add(line);
  G.fx.push({ obj: line, t: 0.07, fade: true });
  if (wallHit || (!u.isPlayer && Math.random() < 0.5)) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), impactMat); dot.position.copy(to); scene.add(dot);
    G.fx.push({ obj: dot, t: 4 });
  }
  const kind = { spark: 'pistol', burst: 'smg', lancer: 'rifle', longshot: 'sniper' }[w.id];
  shot(kind, u.isPlayer ? 0 : Math.hypot(u.pos.x - G.player.pos.x, u.pos.z - G.player.pos.z));
  if (u.isPlayer) { flash.visible = true; G.fx.push({ obj: flash, t: 0.04, hide: true }); }
  else if (u.mesh) u.flashT = 0.05;
}
G.shotFx = shotFx; G.damage = damage; G.plantCore = plantCore; G.defuseCore = defuseCore; G.progress = progress;

/* ---------- 화면 표시 ---------- */
let msgT = 0;
function showMsg(big, small = '', secs = 2, cls = '') {
  $('center-msg').innerHTML = `<b class="${cls}">${big}</b>${small ? `<small>${small}</small>` : ''}`;
  $('center-msg').classList.add('show'); msgT = secs;
}
function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html; $('feed').prepend(d);
  setTimeout(() => d.remove(), 6000);
  while ($('feed').children.length > 6) $('feed').lastChild.remove();
}
function hitMarker(head, killed) {
  const h = $('hitmark'); h.className = ''; void h.offsetWidth; h.className = `show${head ? ' head' : ''}${killed ? ' kill' : ''}`;
}
function hurtFlash(a, dealt) {
  const v = $('dmg'); v.style.opacity = Math.min(0.8, 0.25 + dealt / 80);
  const p = G.player;
  const ang = Math.atan2(-(a.pos.x - p.pos.x), -(a.pos.z - p.pos.z)) - p.yaw;
  $('dmgDir').style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`; $('dmgDir').style.opacity = 1;
}
const fmtT = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
let hudT = 0;
function updateHud(force) {
  const p = G.player, R = G.round;
  $('scoreUs').textContent = G.score.us; $('scoreThem').textContent = G.score.them;
  $('sideUs').textContent = G.ourSide === 'atk' ? '공격' : '수비'; $('sideThem').textContent = G.ourSide === 'atk' ? '수비' : '공격';
  $('timer').textContent = R.phase === 'buy' ? `구매 ${fmtT(R.t)}` : fmtT(R.t);
  $('timer').className = R.phase === 'planted' ? 'planted' : '';
  $('roundNo').textContent = `${R.n}라운드`;
  const us = G.units.filter((u) => u.us), them = G.units.filter((u) => !u.us);
  $('aliveUs').innerHTML = us.map((u) => `<i class="${u.alive ? 'on' : ''}"></i>`).join('');
  $('aliveThem').innerHTML = them.map((u) => `<i class="${u.alive ? 'on' : ''}"></i>`).join('');
  $('hp').textContent = Math.ceil(p.hp); $('armor').textContent = Math.ceil(p.armor);
  $('hpBar').style.width = `${p.hp}%`;
  const g = p.gun; $('wname').textContent = `${g.w.name} · ${g.w.kind}`;
  $('mag').textContent = g.reloading > 0 ? '…' : g.mag; $('reserve').textContent = g.reserve;
  $('credits').textContent = `⬡ ${p.credits}`;
  $('qn').textContent = P.smokes; $('en').textContent = P.dash;
  $('abQ').classList.toggle('off', P.smokes <= 0); $('abE').classList.toggle('off', P.dash <= 0);
  const hasCore = R.core.carrier === p && R.core.state === 'carried';
  $('abCore').classList.toggle('hidden', !hasCore && !(R.phase === 'planted' && p.team === 'def'));
  $('abCore').innerHTML = hasCore ? '<kbd>F</kbd> 길게: 코어 설치' : '<kbd>F</kbd> 길게: 코어 해체';
  $('scope').classList.toggle('show', P.scoped && p.alive);
  $('cross').classList.toggle('hidden', P.scoped || !p.alive);
  $('spec').classList.toggle('hidden', p.alive);
}

/* ---------- 작은 지도 ---------- */
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const W = 220, H = 170, sx = W / 124, sz = H / 96;
  const X = (x) => (x + 62) * sx, Z = (z) => (z + 48) * sz;
  mm.clearRect(0, 0, W, H);
  mm.fillStyle = 'rgba(20,28,38,.75)'; mm.fillRect(0, 0, W, H);
  for (const k in SITES) { const s = SITES[k]; mm.fillStyle = 'rgba(255,201,77,.25)'; mm.beginPath(); mm.arc(X(s.x), Z(s.z), s.r * sx, 0, 7); mm.fill(); mm.fillStyle = '#ffc94d'; mm.font = 'bold 12px sans-serif'; mm.fillText(k, X(s.x) - 4, Z(s.z) + 4); }
  mm.fillStyle = '#8b97a8';
  for (const b of BLOCKS) mm.fillRect(X(b.minX), Z(b.minZ), b.w * sx, b.d * sz);
  const R = G.round;
  if (R.core.state === 'dropped' || R.core.state === 'planted') { mm.fillStyle = '#ff5a3c'; mm.fillRect(X(R.core.pos.x) - 3, Z(R.core.pos.z) - 3, 6, 6); }
  for (const s of G.smokes) { mm.fillStyle = 'rgba(220,225,235,.6)'; mm.beginPath(); mm.arc(X(s.pos.x), Z(s.pos.z), s.r * sx, 0, 7); mm.fill(); }
  for (const u of G.units) {
    if (!u.alive) continue;
    if (!u.us && u.spottedT <= 0) continue;
    mm.fillStyle = u.isPlayer ? '#ffffff' : u.us ? '#4fd1c5' : '#ff6b6b';
    mm.beginPath(); mm.arc(X(u.pos.x), Z(u.pos.z), u.isPlayer ? 4 : 3.2, 0, 7); mm.fill();
    if (u.us) { mm.strokeStyle = mm.fillStyle; mm.lineWidth = 1.5; mm.beginPath(); mm.moveTo(X(u.pos.x), Z(u.pos.z)); mm.lineTo(X(u.pos.x - Math.sin(u.yaw) * 4), Z(u.pos.z - Math.cos(u.yaw) * 4)); mm.stroke(); }
  }
}

/* ---------- 점수판 ---------- */
function drawScoreboard() {
  const row = (u) => `<tr class="${u.isPlayer ? 'me' : ''} ${u.alive ? '' : 'dead'}"><td>${u.name}</td><td>${u.kills}</td><td>${u.deaths}</td><td>${u.us ? '⬡ ' + u.credits : ''}</td></tr>`;
  const t = (list, title, cls) => `<div class="sb ${cls}"><h3>${title}</h3><table><tr><th>이름</th><th>쓰러뜨림</th><th>쓰러짐</th><th>돈</th></tr>${list.map(row).join('')}</table></div>`;
  $('scoreboard').innerHTML = t(G.units.filter((u) => u.us), `우리 팀 · ${G.score.us}`, 'us') + t(G.units.filter((u) => !u.us), `상대 팀 · ${G.score.them}`, 'them');
}

/* ---------- 상점 ---------- */
function openBuy() {
  if (!G.running) return;
  document.exitPointerLock?.();
  renderBuy(); $('buy').classList.remove('hidden');
}
function closeBuy() { $('buy').classList.add('hidden'); lockPointer(); }
function renderBuy() {
  const p = G.player;
  const card = (id) => {
    const w = WEAPONS[id]; const own = (p.primary && p.primary.w.id === id) || (id === 'spark');
    const can = !own && p.credits >= w.price;
    return `<button class="item ${own ? 'own' : ''}" data-buy="${id}" ${can ? '' : 'disabled'}><b>${w.name}</b><small>${w.kind} · 피해 ${w.dmg}${w.auto ? ' · 연발' : ''}</small><span>${own ? '가지고 있음' : w.price ? '⬡ ' + w.price : '기본'}</span></button>`;
  };
  const arm = (k) => { const a = ARMOR[k]; const own = p.armor >= a.value; return `<button class="item ${own ? 'own' : ''}" data-armor="${k}" ${!own && p.credits >= a.price ? '' : 'disabled'}><b>${a.name}</b><small>피해를 최대 ${a.value}만큼 막음</small><span>${own ? '입고 있음' : '⬡ ' + a.price}</span></button>`; };
  $('buyBody').innerHTML = `
    <div class="col"><h4>무기</h4>${card('burst')}${card('lancer')}${card('longshot')}${card('spark')}</div>
    <div class="col"><h4>방어구</h4>${arm('light')}${arm('heavy')}
      <h4>능력 (블링크)</h4>
      <button class="item" data-smoke ${P.smokes < 2 && p.credits >= SMOKE_PRICE ? '' : 'disabled'}><b>연막 (Q)</b><small>12초 동안 시야를 가리는 연기 · 최대 2개</small><span>${P.smokes >= 2 ? '가득 참' : '⬡ ' + SMOKE_PRICE}</span></button>
      <div class="free"><b>돌진 (E)</b> 라운드마다 1번 무료</div>
      ${G.ourSide === 'atk' ? `<h4>작전 지시</h4><div class="calls"><button data-call="A" class="${G.round.call === 'A' ? 'on' : ''}">A로 가자 (Z)</button><button data-call="B" class="${G.round.call === 'B' ? 'on' : ''}">B로 가자 (X)</button></div>` : ''}
    </div>`;
  $('buyCredits').textContent = `⬡ ${p.credits}`;
}
$('buy').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const p = G.player;
  if (b.dataset.buy) { const w = WEAPONS[b.dataset.buy]; p.credits -= w.price; p.primary = newGun(w.id); p.gun = p.primary; refreshViewmodel(); sfx.buy(); }
  else if (b.dataset.armor) { const a = ARMOR[b.dataset.armor]; p.credits -= a.price; p.armor = a.value; sfx.buy(); }
  else if ('smoke' in b.dataset) { p.credits -= SMOKE_PRICE; P.smokes++; sfx.buy(); }
  else if (b.dataset.call) callSite(b.dataset.call);
  else if (b.id === 'buyClose') return closeBuy();
  renderBuy(); updateHud();
});

/* ---------- 메뉴 ---------- */
function pause(on) {
  G.paused = on;
  $('pause').classList.toggle('hidden', !on);
  if (on) { keys.clear(); P.fireHeld = false; $('sensP').value = settings.sens; $('sensPv').textContent = settings.sens.toFixed(1); }
}
$('resume').onclick = () => { pause(false); lockPointer(); };
$('toMenu').onclick = () => { pause(false); G.running = false; $('hud').classList.add('hidden'); $('buy').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('sensP').oninput = (e) => { settings.sens = Number(e.target.value); store.set('sens', settings.sens); $('sensPv').textContent = settings.sens.toFixed(1); };
document.querySelectorAll('[data-diff]').forEach((b) => {
  b.classList.toggle('on', b.dataset.diff === settings.diff);
  b.onclick = () => { settings.diff = b.dataset.diff; store.set('diff', settings.diff); document.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('on', x === b)); };
});
$('sens').value = settings.sens; $('sensV').textContent = settings.sens.toFixed(1);
$('sens').oninput = (e) => { settings.sens = Number(e.target.value); store.set('sens', settings.sens); $('sensV').textContent = settings.sens.toFixed(1); };
$('start').onclick = () => { initAudio(); startGame(); };
$('again').onclick = () => { initAudio(); startGame(); };
$('endMenu').onclick = () => { $('end').classList.add('hidden'); $('menu').classList.remove('hidden'); };

/* ---------- 매 프레임 ---------- */
const clock = new THREE.Clock();
let spotT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (G.running && !G.paused) step(dt);
  else if (!G.running) { // 메뉴 화면: 천천히 맵을 돈다
    const t = performance.now() / 9000;
    camera.position.set(Math.sin(t) * 55, 32, Math.cos(t) * 45); camera.lookAt(0, 0, -5);
  }
  renderer.render(scene, camera);
}
function step(dt) {
  const R = G.round, p = G.player;
  R.t -= dt;
  if (R.phase === 'buy' && R.t <= 0) { R.phase = 'live'; R.t = 100; $('buy').classList.add('hidden'); if (!locked) lockPointer(); showMsg('시작!', '', 1); }
  else if (R.phase === 'live' && R.t <= 0) endRound('def', '시간 종료');
  else if (R.phase === 'planted') {
    R.core.beepT -= dt;
    if (R.core.beepT <= 0) { R.core.beepT = Math.max(0.15, R.t / 40 * 1.1); sfx.coreBeep(R.t < 10); }
    if (R.t <= 0) { sfx.boom(); explode(); endRound('atk', '코어 폭발'); }
  } else if (R.phase === 'end' && R.t <= 0) return afterRound();
  if (R.alert) { R.alert.t -= dt; if (R.alert.t <= 0) R.alert = null; }

  updatePlayer(dt);
  for (const u of G.units) if (!u.isPlayer) updateBot(G, u, dt);
  // 봇이 떨어진 코어 줍기
  if (R.core.state === 'dropped') for (const u of G.units) if (!u.isPlayer && u.alive && u.team === 'atk' && Math.hypot(u.pos.x - R.core.pos.x, u.pos.z - R.core.pos.z) < 1.3) { R.core.state = 'carried'; R.core.carrier = u; coreMesh.visible = false; break; }
  // 적 발견 표시 (작은 지도)
  spotT -= dt;
  if (spotT <= 0) {
    spotT = 0.2;
    for (const e of G.units) {
      if (e.us || !e.alive) continue;
      if (G.units.some((a) => a.us && a.alive && (a.target === e || (a.isPlayer && lineClear(eyeOf(a), eyeOf(e), G.smokes) && Math.abs(angle(a, e)) < 1.1)))) e.spottedT = 1.5;
    }
  }
  for (const e of G.units) if (e.spottedT > 0) e.spottedT -= dt;

  // 봇 모습
  for (const u of G.units) {
    if (!u.mesh) continue;
    if (u.tag) u.tag.visible = u.alive;
    u.mesh.position.copy(u.pos);
    if (u.alive) { u.mesh.rotation.set(0, u.yaw, 0); u.mesh.position.y += u.moving ? Math.abs(Math.sin(performance.now() / 110)) * 0.05 : 0; }
    else if (u.dieT != null && u.dieT < 1) { u.dieT += dt * 3; u.mesh.rotation.x = -Math.min(1, u.dieT) * Math.PI / 2; u.mesh.position.y = 0.2; }
    const gun = u.mesh.getObjectByName('gun'); if (gun) gun.material.emissive?.setHex(u.flashT > 0 ? 0xffaa33 : 0); if (u.flashT > 0) u.flashT -= dt;
  }
  // 연막
  for (const s of G.smokes) { s.t -= dt; s.mat.opacity = Math.min(0.94, (13 - s.t) * 3, s.t * 0.9); if (s.t <= 0) scene.remove(s.mesh); }
  G.smokes = G.smokes.filter((s) => s.t > 0);
  // 코어 깜빡임
  if (coreMesh.visible) { const gl = coreMesh.getObjectByName('glow'); gl.material.emissiveIntensity = R.phase === 'planted' ? 0.6 + Math.abs(Math.sin(performance.now() / (R.t < 10 ? 80 : 250))) * 2 : 0.8; }
  // 효과 정리
  for (const f of G.fx) { f.t -= dt; if (f.fade && f.obj.material) f.obj.material.opacity = Math.max(0, f.t / 0.07); if (f.t <= 0) { if (f.hide) f.obj.visible = false; else { scene.remove(f.obj); f.obj.geometry?.dispose(); } } }
  G.fx = G.fx.filter((f) => f.t > 0);

  // 카메라
  if (p.alive) {
    const eyeH = p.crouch ? 1.1 : 1.6;
    camera.position.set(p.pos.x, p.pos.y + eyeH, p.pos.z);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    view.visible = !P.scoped;
    P.kick = Math.max(0, P.kick - dt * 10);
    const g = p.gun;
    view.position.set(0.24 + Math.sin(P.bob) * 0.01, -0.22 - Math.abs(Math.cos(P.bob)) * 0.01 - (g.reloading > 0 ? 0.15 : 0), -0.55 + P.kick * 0.05);
    view.rotation.x = P.kick * 0.12;
  } else {
    view.visible = false;
    const allies = G.units.filter((u) => u.us && u.alive && !u.isPlayer);
    if (allies.length) { const a = allies[P.spectate % allies.length]; const e = eyeOf(a); camera.position.set(e.x + Math.sin(a.yaw) * 2.2, e.y + 0.8, e.z + Math.cos(a.yaw) * 2.2); camera.rotation.set(-0.25, a.yaw, 0, 'YXZ'); $('specName').textContent = a.name; }
    else { camera.position.set(0, 70, 30); camera.lookAt(0, 0, -2); $('specName').textContent = '전체 보기'; }
  }
  camera.fov += ((P.scoped ? 28 : 75) - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix();

  // 화면 글자
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('center-msg').classList.remove('show'); }
  const dv = $('dmg'); dv.style.opacity = Math.max(0, Number(dv.style.opacity || 0) - dt * 1.5);
  const dd = $('dmgDir'); dd.style.opacity = Math.max(0, Number(dd.style.opacity || 0) - dt * 1.2);
  hudT -= dt; if (hudT <= 0) { hudT = 0.08; updateHud(); drawMinimap(); if (!$('scoreboard').classList.contains('hidden')) drawScoreboard(); }
}
const angle = (a, e) => { const want = Math.atan2(-(e.pos.x - a.pos.x), -(e.pos.z - a.pos.z)); let d = want - a.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
function explode() {
  const R = G.round, c = R.core.pos;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff7a3c, transparent: true, opacity: 0.8 }));
  ball.position.copy(c); scene.add(ball);
  const grow = { obj: ball, t: 1.2 }; G.fx.push(grow);
  const start = performance.now();
  (function anim() { const k = (performance.now() - start) / 1200; if (k >= 1) return; ball.scale.setScalar(1 + k * 14); ball.material.opacity = 0.8 * (1 - k); requestAnimationFrame(anim); })();
  for (const u of G.units) if (u.alive && Math.hypot(u.pos.x - c.x, u.pos.z - c.z) < 13) { u.alive = false; u.hp = 0; u.dieT = 0; }
  coreMesh.visible = false;
}
refreshViewmodel();
frame();
// 자동 점검용 (?test 일 때만)
if (new URLSearchParams(location.search).has('test')) window.__cs = { G, P, startGame, step, tryFire, render: () => renderer.render(scene, camera), setLocked: (v) => { locked = v; } };
