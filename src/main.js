// 코어 스트라이크 — 3D 1인칭 5대5 전술 슈팅 (원작, 무과금)
import * as THREE from 'three';
import { buildMap, BLOCKS, SITES, SPAWNS, collide, groundAt, rayWorld, inSite, randomNear, lineClear } from './map.js';
import { WEAPONS, ARMOR, SMOKE_PRICE, MONEY, newGun, applyDamage } from './weapons.js';
import { makeBotMesh, botBuy, planRound, updateBot, eyeOf, angDiff, TEAM_COLOR } from './bots.js';
import { setSoldierTeam, animateSoldier, makeViewGun } from './models.js';
import { initFx, updateFx, impact, hitPuff, burst } from './fx.js';
import { initAudio, shot, step as footstep, sfx, setVolume } from './audio.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('cs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('cs.' + k, JSON.stringify(v)); } catch { /* 무시 */ } } };

/* ---------- 화면 준비 ---------- */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdbe8f1, 70, 230);
const camera = new THREE.PerspectiveCamera(80, 1, 0.05, 900);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x6e6552, 1.15));
const sun = new THREE.DirectionalLight(0xfff0d4, 2.2);
sun.position.set(-48, 78, 34); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 56, bottom: -56, near: 10, far: 220 });
scene.add(sun);
buildMap(scene);
initFx(scene);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

/* ---------- 설정 ---------- */
const CROSS = { green: '#b6ff6b', white: '#ffffff', cyan: '#5ef2e0', pink: '#ff6bd6' };
const settings = { sens: store.get('sens', 1), diff: store.get('diff', 'normal'), fov: store.get('fov', 85), vol: store.get('vol', 0.6), cross: store.get('cross', 'green') };
function applySettings() {
  setVolume(settings.vol);
  document.documentElement.style.setProperty('--cross', CROSS[settings.cross] || CROSS.green);
  for (const s of ['', 'P']) {
    const set = (id, v, txt) => { const el = $(id + s); if (el) { el.value = v; const o = $(id + s + 'v'); if (o) o.textContent = txt; } };
    set('sens', settings.sens, Number(settings.sens).toFixed(1)); set('fov', settings.fov, settings.fov); set('vol', settings.vol, Math.round(settings.vol * 100) + '%');
  }
  document.querySelectorAll('[data-cross]').forEach((b) => b.classList.toggle('on', b.dataset.cross === settings.cross));
  document.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('on', b.dataset.diff === settings.diff));
}
for (const s of ['', 'P']) {
  const bind = (id, key, num = true) => { const el = $(id + s); if (el) el.addEventListener('input', () => { settings[key] = num ? Number(el.value) : el.value; store.set(key, settings[key]); applySettings(); }); };
  bind('sens', 'sens'); bind('fov', 'fov'); bind('vol', 'vol');
}
document.querySelectorAll('[data-cross]').forEach((b) => b.addEventListener('click', () => { settings.cross = b.dataset.cross; store.set('cross', settings.cross); applySettings(); }));
document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => { settings.diff = b.dataset.diff; store.set('diff', settings.diff); applySettings(); }));

/* ---------- 손에 든 총 ---------- */
const view = new THREE.Group(); camera.add(view);
const viewGuns = {};
const muzzleLight = new THREE.PointLight(0xffc56b, 0, 8, 2); camera.add(muzzleLight); muzzleLight.position.set(0.25, -0.15, -0.9);
let curView = null;
function refreshViewmodel() {
  if (!G.player) return;
  const id = G.player.gun.w.id;
  if (curView) view.remove(curView);
  viewGuns[id] ||= makeViewGun(id, TEAM_COLOR[G.player.team]);
  curView = viewGuns[id]; view.add(curView);
  P.switchT = 0.25;
}
const BASE_VIEW = new THREE.Vector3(0.15, -0.155, -0.3);
view.position.copy(BASE_VIEW); view.scale.setScalar(0.62);

/* ---------- 게임 상태 ---------- */
const NAMES_US = ['솔', '파도', '별빛', '모래'];
const NAMES_THEM = ['해치', '노을', '바위', '번개', '안개'];
const DIFF = { easy: { name: '쉬움', react: 0.8, acc: 0.3, head: 0.08 }, normal: { name: '보통', react: 0.5, acc: 0.44, head: 0.15 }, hard: { name: '어려움', react: 0.3, acc: 0.6, head: 0.26 } };
const WIN = 5, HALF = 4, BUY_TIME = 15;

const G = { units: [], player: null, smokes: [], fx: [], diff: DIFF[settings.diff], round: null, score: { us: 0, them: 0 }, ourSide: 'atk', played: 0, running: false, paused: false, shake: 0 };
const coreMesh = (() => {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.5, roughness: 0.4 }));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.46, 16), new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0xff3b1f, emissiveIntensity: 1.2 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), new THREE.MeshStandardMaterial({ color: 0xffc94d, emissive: 0xffa21f, emissiveIntensity: 0.8 }));
  base.position.y = 0.1; glow.position.y = 0.32; ring.position.y = 0.32; ring.rotation.x = Math.PI / 2; glow.name = 'glow'; ring.name = 'ring';
  const light = new THREE.PointLight(0xff4a2a, 0, 6, 2); light.position.y = 0.6; light.name = 'light';
  g.add(base, glow, ring, light); g.visible = false; scene.add(g); return g;
})();

function newUnit({ name, us, isPlayer }) {
  const u = {
    name, us, isPlayer, team: us ? G.ourSide : (G.ourSide === 'atk' ? 'def' : 'atk'),
    pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true,
    sidearm: newGun('spark'), primary: null, gun: null, credits: MONEY.start, kills: 0, deaths: 0, roundKills: 0, dmgRound: 0,
    crouch: false, moving: false, running: false, path: [], goal: null, mesh: null, tag: null,
    scanT: 0, reactT: 0, burst: 0, strafeT: 0, strafe: 0, lastSeenT: 0, plantT: 0, defuseT: 0, lookT: 0, stuckT: 0, waitT: 0, spottedT: 0, stepT: 0, flashT: 0,
  };
  u.gun = u.sidearm;
  if (!isPlayer) { u.mesh = makeBotMesh(u.team); scene.add(u.mesh); if (us) { u.tag = nameTag(name); u.mesh.add(u.tag); } }
  return u;
}
function nameTag(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.font = 'bold 32px "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(text, 128, 32); g.fillStyle = '#7ff0e3'; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.1, 0.28, 1); s.position.y = 2.15; s.renderOrder = 5; return s;
}

/* ---------- 게임 시작 ---------- */
function startGame() {
  for (const u of G.units) if (u.mesh) scene.remove(u.mesh);
  G.units = []; G.score = { us: 0, them: 0 }; G.played = 0; G.ourSide = 'atk'; G.diff = DIFF[settings.diff];
  G.player = newUnit({ name: '나', us: true, isPlayer: true });
  G.units.push(G.player);
  NAMES_US.forEach((n) => G.units.push(newUnit({ name: n, us: true })));
  NAMES_THEM.forEach((n) => G.units.push(newUnit({ name: n, us: false })));
  G.running = true; G.paused = false;
  for (const k in viewGuns) delete viewGuns[k];
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
  newRound(true);
}

function newRound(first = false) {
  const R = G.round = { n: G.played + 1, phase: 'buy', t: BUY_TIME, alert: null, call: null, attackSite: null, smoked: { atk: false, def: false }, core: { state: 'carried', carrier: null, pos: new THREE.Vector3(), beepT: 0, site: null } };
  for (const s of G.smokes) scene.remove(s.mesh); G.smokes = [];
  const sides = { atk: [], def: [] };
  // 팀 돈이 적으면 이번 라운드는 아낀다(봇)
  const save = {};
  for (const side of ['us', 'them']) { const list = G.units.filter((u) => (side === 'us') === u.us && !u.isPlayer); save[side] = !first && list.reduce((s, u) => s + u.credits, 0) / list.length < 2600 && list.filter((u) => u.primary).length < 2; }
  for (const u of G.units) {
    u.team = u.us ? G.ourSide : (G.ourSide === 'atk' ? 'def' : 'atk');
    if (u.mesh) setSoldierTeam(u.mesh, TEAM_COLOR[u.team], u.team);
    if (!u.alive || first) { u.primary = null; u.armor = 0; }
    u.sidearm = newGun('spark');
    if (u.primary) { u.primary.mag = u.primary.w.mag; u.primary.reserve = u.primary.w.reserve; u.primary.reloading = 0; u.primary.heat = 0; }
    u.gun = u.primary || u.sidearm;
    Object.assign(u, { hp: 100, alive: true, vy: 0, crouch: false, target: null, path: [], goal: null, lastSeenT: 0, plantT: 0, defuseT: 0, rotated: false, guard: null, spottedT: 0, roundKills: 0, dmgRound: 0, retreatT: undefined, dieT: null });
    sides[u.team].push(u);
  }
  for (const side of ['atk', 'def']) {
    const sp = SPAWNS[side];
    sides[side].forEach((u, i) => {
      u.pos.set(sp.x + (i - 2) * 2.4, 0, sp.z + (i % 2) * 1.5 * (side === 'atk' ? 1 : -1));
      u.yaw = sp.yaw; u.pitch = 0;
      if (u.mesh) { u.mesh.visible = true; u.mesh.rotation.set(0, u.yaw, 0); u.mesh.position.copy(u.pos); u.mesh.userData.body.position.y = 0; u.mesh.traverse((m) => { if (m.material && m.material.transparent === false && m.material.opacity !== undefined) m.material.opacity = 1; }); }
    });
  }
  for (const u of G.units) if (!u.isPlayer) botBuy(u, save[u.us ? 'us' : 'them']);
  const atk = G.units.filter((u) => u.team === 'atk');
  R.core.carrier = atk.find((u) => u.isPlayer) || atk[Math.floor(Math.random() * atk.length)];
  coreMesh.visible = false;
  P.smokes = 1; P.dash = 1; P.scoped = false; P.dashT = 0;
  for (const k in viewGuns) delete viewGuns[k]; // 소매 색이 팀 색을 따라가게
  refreshViewmodel();
  planRound(G);
  sfx.round();
  showMsg(`${R.n}라운드 · ${G.ourSide === 'atk' ? '공격' : '수비'}`, G.ourSide === 'atk' ? (R.core.carrier.isPlayer ? '코어를 들고 A나 B 지점에 설치하세요' : '아군과 함께 A나 B 지점을 공격하세요') : 'A·B 지점을 지키세요', 3);
  openBuy();
  updateHud();
}

/* ---------- 나(플레이어) ---------- */
const P = { smokes: 1, dash: 1, dashT: 0, dashDir: null, scoped: false, kick: 0, bob: 0, spectate: 0, fireHeld: false, switchT: 0, spread: 0, air: false, landT: 0 };
const keys = new Set();
let locked = false;
canvas.addEventListener('click', () => { if (G.running && !G.paused && $('buy').classList.contains('hidden') && !locked) lockPointer(); });
$('clickPlay').addEventListener('click', () => lockPointer());
function lockPointer() { initAudio(); try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* 무시 */ } }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { keys.clear(); P.fireHeld = false; }
});
document.addEventListener('mousemove', (e) => {
  if (!locked || !G.player) return;
  const k = 0.0022 * settings.sens * (P.scoped ? 0.35 : 1);
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
document.addEventListener('wheel', (e) => { if (!locked || !G.player?.alive) return; const p = G.player; if (p.primary) switchGun(p.gun === p.primary ? p.sidearm : p.primary); }, { passive: true });
document.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (!G.running) return;
  const k = e.code;
  if (k === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); drawScoreboard(); return; }
  if (k === 'Escape') { if (!$('buy').classList.contains('hidden')) closeBuy(); else if (!G.paused) pause(true); return; }
  if (k === 'KeyB') { if (G.round.phase === 'buy') { $('buy').classList.contains('hidden') ? openBuy() : closeBuy(); } return; }
  if (G.paused || !$('buy').classList.contains('hidden')) return;
  keys.add(k);
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
addEventListener('blur', () => { keys.clear(); P.fireHeld = false; });

function switchGun(g) { const p = G.player; if (p.gun === g) return; p.gun = g; g.cool = Math.max(g.cool, 0.3); P.scoped = false; refreshViewmodel(); }
function startReload(u) { const g = u.gun; if (g.reloading > 0 || g.mag >= g.w.mag || g.reserve <= 0) return; g.reloading = g.w.reload; P.scoped = false; if (u.isPlayer) sfx.reload(); }
function callSite(s) {
  if (G.ourSide !== 'atk') return;
  G.round.call = s; G.round.attackSite = s;
  for (const u of G.units) if (!u.isPlayer && u.team === 'atk') { const S = SITES[s]; u.spot = randomNear(S.x, S.z, 6); u.goal = null; u.path = []; }
  feed(`<b class="us">나</b>: "${s}로 가자!"`);
  if (!$('buy').classList.contains('hidden')) renderBuy();
}

function throwSmoke() {
  if (P.smokes <= 0 || G.round.phase === 'buy') return;
  const o = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3());
  const r = rayWorld(o, d, 32);
  const at = o.clone().addScaledVector(d, Math.max(1, r.t - 1.2)); at.y = Math.max(1.6, Math.min(at.y, 2.2));
  P.smokes--; addSmoke(at, G.player);
}
function addSmoke(at, who) {
  sfx.smoke();
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: who && who.team === 'atk' ? 0xd9c9c2 : 0xc6d3d8, transparent: true, opacity: 0, roughness: 1, depthWrite: false });
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 + Math.random() * 1.3, 1), mat);
    m.position.set((Math.random() - 0.5) * 3.6, (Math.random() - 0.35) * 2, (Math.random() - 0.5) * 3.6); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); g.add(m);
  }
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(4.1, 2), mat));
  g.position.copy(at); scene.add(g);
  G.smokes.push({ pos: at.clone(), r: 4.1, t: 13, mesh: g, mat });
}
G.addSmoke = addSmoke;
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
  if (keys.has('KeyW') || keys.has('ArrowUp')) v.add(f); if (keys.has('KeyS') || keys.has('ArrowDown')) v.sub(f);
  if (keys.has('KeyD') || keys.has('ArrowRight')) v.add(r); if (keys.has('KeyA') || keys.has('ArrowLeft')) v.sub(r);
  return v.lengthSq() ? v.normalize() : v;
}

function updatePlayer(dt) {
  const p = G.player, R = G.round, g = p.gun;
  if (g.cool > 0) g.cool -= dt;
  g.heat = Math.max(0, (g.heat || 0) - dt * (P.fireHeld ? 0.02 : 0.3));
  if (g.reloading > 0) { g.reloading -= dt; if (g.reloading <= 0) { const take = Math.min(g.w.mag - g.mag, g.reserve); g.mag += take; g.reserve -= take; } }
  if (P.switchT > 0) P.switchT -= dt;
  if (!p.alive) return;
  const frozen = R.phase === 'buy';
  p.crouch = keys.has('ControlLeft') || keys.has('KeyC');
  const walk = keys.has('ShiftLeft');
  let speed = p.crouch ? 2.4 : walk ? 3.2 : 6.6;
  if (P.scoped) speed *= 0.55;
  if (g.w.id === 'longshot') speed *= 0.92;
  const mv = frozen ? new THREE.Vector3() : moveInput();
  const ox = p.pos.x, oz = p.pos.z;
  if (P.dashT > 0) { P.dashT -= dt; mv.copy(P.dashDir); speed = 24; }
  p.pos.x += mv.x * speed * dt; p.pos.z += mv.z * speed * dt;
  collide(p.pos, 0.4, p.pos.y);
  const ground = groundAt(p.pos.x, p.pos.z, 0.4, p.pos.y);
  if (keys.has('Space') && p.pos.y <= ground + 0.01 && !frozen) { p.vy = 7; }
  p.vy -= 20 * dt; p.pos.y += p.vy * dt;
  const wasAir = P.air;
  if (p.pos.y <= ground) { p.pos.y = ground; if (p.vy < -4) P.landT = 0.15; p.vy = 0; }
  const moved = Math.hypot(p.pos.x - ox, p.pos.z - oz) / dt;
  p.moving = moved > 1; p.running = moved > 4.5;
  P.bob += moved * dt * 1.5;
  P.air = p.pos.y > ground + 0.05;
  if (wasAir && !P.air) P.landT = 0.12;

  // 코어 줍기
  if (R.core.state === 'dropped' && p.team === 'atk' && Math.hypot(p.pos.x - R.core.pos.x, p.pos.z - R.core.pos.z) < 1.4) { R.core.state = 'carried'; R.core.carrier = p; coreMesh.visible = false; feed('<b class="us">나</b>: 코어를 주웠습니다'); sfx.buy(); }
  // 설치·해체: F를 누르고 있기 (움직이면 멈춤)
  const holding = keys.has('KeyF') || keys.has('Digit4');
  const canPlant = R.phase === 'live' && R.core.carrier === p && R.core.state === 'carried' && inSite(p.pos.x, p.pos.z);
  const canDefuse = R.phase === 'planted' && p.team === 'def' && Math.hypot(p.pos.x - R.core.pos.x, p.pos.z - R.core.pos.z) < 1.8;
  P.canPlant = canPlant; P.canDefuse = canDefuse;
  if (holding && !p.moving && !P.air && canPlant) {
    p.plantT += dt; p.crouch = true; progress(p, 'plant', p.plantT / 4); if (p.plantT >= 4) plantCore(p);
  } else if (holding && !p.moving && canDefuse) {
    p.defuseT += dt; p.crouch = true; progress(p, 'defuse', p.defuseT / 7); if (p.defuseT >= 7) defuseCore(p);
  } else { if (p.plantT || p.defuseT) progress(p, null, 0); p.plantT = 0; p.defuseT = 0; }

  if (P.fireHeld && g.w.auto) tryFire(false);
  // 탄이 다 떨어지면 알아서 장전, 그마저 없으면 권총으로
  if (g.mag === 0 && g.reloading <= 0 && g.cool <= 0) { if (g.reserve > 0) startReload(p); else if (g !== p.sidearm) switchGun(p.sidearm); }
}

function currentSpread() {
  const p = G.player, g = p.gun, w = g.w;
  let s = w.spread + (p.moving ? w.move * (p.running ? 1 : 0.5) : 0) + (P.air ? 0.12 : 0) + (g.heat || 0);
  if (w.scope && !P.scoped) s += 0.05;
  if (p.crouch) s *= 0.75;
  return s;
}
function tryFire(click) {
  const p = G.player, g = p.gun, w = g.w, R = G.round;
  if (!p.alive || R.phase === 'buy' || !locked || G.paused || !$('buy').classList.contains('hidden')) return;
  if (g.reloading > 0 || g.cool > 0 || P.switchT > 0 || p.plantT > 0 || p.defuseT > 0) return;
  if (!click && !w.auto) return;
  if (g.mag <= 0) { if (click) sfx.empty(); return; }
  g.mag--; g.cool = w.rate;
  const spread = currentSpread();
  if (w.auto) g.heat = Math.min(0.06, (g.heat || 0) + 0.0045);
  const o = camera.getWorldPosition(new THREE.Vector3());
  const d = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(d, camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, d).normalize();
  const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread;
  d.addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr).normalize();
  const wall = rayWorld(o, d, 220);
  let best = wall.t, victim = null, head = false;
  for (const u of G.units) {
    if (!u.alive || u.team === p.team) continue;
    const hy = u.crouch ? 1.12 : 1.62, top = u.crouch ? 0.95 : 1.42;
    const th = raySphere(o, d, new THREE.Vector3(u.pos.x, u.pos.y + hy, u.pos.z), 0.25); if (th > 0 && th < best) { best = th; victim = u; head = true; }
    const tb = rayCylinder(o, d, u.pos, 0.38, u.pos.y, u.pos.y + top); if (tb > 0 && tb < best) { best = tb; victim = u; head = false; }
  }
  const end = o.clone().addScaledVector(d, best);
  const muzzle = curView.userData.flash.getWorldPosition(new THREE.Vector3());
  shotFx(p, muzzle, end, w, !victim && !!wall.hit, d);
  if (victim) damage(p, victim, w, head, end);
  P.kick = 1;
  p.pitch = Math.min(1.45, p.pitch + w.kick * (0.7 + Math.random() * 0.5) * (P.scoped ? 0.5 : 1));
  p.yaw += (Math.random() - 0.5) * w.kick * 0.6;
  if (w.scope) P.scoped = false;
  for (const u of G.units) if (!u.isPlayer && u.alive && u.team !== p.team && !u.target && Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z) < 34) { u.lastSeen = { x: p.pos.x, z: p.pos.z }; u.lastSeenT = 2.5; }
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
function damage(a, v, w, head, at) {
  if (!v.alive) return;
  const dealt = applyDamage(v, w, head);
  a.dmgRound += dealt;
  if (at) hitPuff(at, TEAM_COLOR[v.team], head);
  if (a.isPlayer) { hitMarker(head, v.hp <= 0); head ? sfx.head() : sfx.hit(); dmgNumber(Math.round(dealt), head); }
  if (v.isPlayer) { sfx.hurt(); hurtFlash(a, dealt); G.shake = Math.min(0.6, G.shake + dealt / 120); }
  if (!v.isPlayer && !v.target) { v.lastSeen = { x: a.pos.x, z: a.pos.z }; v.lastSeenT = 3; v.yaw = Math.atan2(-(a.pos.x - v.pos.x), -(a.pos.z - v.pos.z)); }
  if (v.hp <= 0) kill(a, v, w, head);
}
G.damage = damage;
function kill(a, v, w, head) {
  v.alive = false; v.hp = 0; v.deaths++; a.kills++; a.roundKills++;
  a.credits = Math.min(MONEY.max, a.credits + MONEY.kill);
  v.plantT = 0; v.defuseT = 0; progress(v, null, 0);
  if (a.isPlayer) { sfx.kill(); killBanner(a.roundKills, head); }
  feed(`<b class="${a.us ? 'us' : 'them'}">${a.name}</b> <span class="w">${w.name}${head ? ' ◎' : ''}</span> <b class="${v.us ? 'us' : 'them'}">${v.name}</b>`);
  if (v.mesh) v.dieT = 0;
  // 같은 편이 복수하러 간다
  for (const u of G.units) if (!u.isPlayer && u.alive && u.team === v.team && Math.hypot(u.pos.x - v.pos.x, u.pos.z - v.pos.z) < 26 && !u.target) { u.lastSeen = { x: a.pos.x, z: a.pos.z }; u.lastSeenT = 3.5; }
  const R = G.round;
  if (R.core.carrier === v && R.core.state === 'carried') { R.core.state = 'dropped'; R.core.pos.set(v.pos.x, v.pos.y, v.pos.z); coreMesh.position.copy(R.core.pos); coreMesh.visible = true; feed('코어가 떨어졌습니다'); }
  if (v.isPlayer) { P.scoped = false; showMsg('쓰러졌습니다', '아군 시점으로 봅니다 · 클릭하면 다른 아군', 2.5); }
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
G.progress = progress;
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
G.plantCore = plantCore;
function defuseCore(u) {
  const R = G.round; if (R.phase !== 'planted') return;
  u.defuseT = 0; progress(u, null, 0);
  R.core.state = 'defused';
  feed(`<b class="${u.us ? 'us' : 'them'}">${u.name}</b>: 코어 해체!`);
  endRound('def', '코어 해체');
}
G.defuseCore = defuseCore;

/* ---------- 라운드 ---------- */
const aliveOf = (side) => G.units.filter((u) => u.alive && u.team === side).length;
function checkRoundEnd() {
  const R = G.round; if (R.phase !== 'live' && R.phase !== 'planted') return;
  const a = aliveOf('atk'), d = aliveOf('def');
  if (d === 0) return endRound('atk', '수비 전멸');
  if (a === 0 && R.phase === 'live') return endRound('def', '공격 전멸');
}
function endRound(side, why) {
  const R = G.round; if (R.phase === 'end') return;
  R.phase = 'end'; R.t = 5.5; R.winner = side;
  const weWon = side === G.ourSide;
  G.score[weWon ? 'us' : 'them']++;
  for (const u of G.units) u.credits = Math.min(MONEY.max, u.credits + (u.team === side ? MONEY.win : MONEY.lose));
  progress(G.player, null, 0);
  weWon ? sfx.win() : sfx.lose();
  const mvp = [...G.units].sort((x, y) => (y.roundKills * 100 + y.dmgRound) - (x.roundKills * 100 + x.dmgRound))[0];
  showMsg(weWon ? '라운드 승리!' : '라운드 패배', `${why} · MVP <b class="${mvp.us ? 'us' : 'them'}">${mvp.name}</b> (${mvp.roundKills}명, 피해 ${Math.round(mvp.dmgRound)})`, 4.5, weWon ? 'win' : 'lose');
}
function afterRound() {
  G.played++;
  if (G.score.us >= WIN || G.score.them >= WIN) return gameOver();
  if (G.played === HALF) {
    G.ourSide = G.ourSide === 'atk' ? 'def' : 'atk';
    for (const u of G.units) { u.credits = MONEY.start; u.primary = null; u.armor = 0; u.alive = false; }
  }
  newRound(G.played === HALF);
  if (G.played === HALF) showMsg('공수 교대', `이제 ${G.ourSide === 'atk' ? '공격' : '수비'}입니다 · 돈이 800으로 돌아갑니다`, 3);
}
function gameOver() {
  G.running = false; document.exitPointerLock?.();
  const win = G.score.us > G.score.them;
  $('hud').classList.add('hidden'); $('buy').classList.add('hidden');
  $('endTitle').textContent = win ? '승리!' : '패배';
  $('endTitle').className = win ? 'win' : 'lose';
  $('endScore').textContent = `우리 ${G.score.us} : ${G.score.them} 상대`;
  const p = G.player; const best = [...G.units].sort((x, y) => y.kills - x.kills)[0];
  $('endStats').innerHTML = `내 기록: <b>${p.kills}</b>명 쓰러뜨림 · <b>${p.deaths}</b>번 쓰러짐<br>경기 MVP: <b class="${best.us ? 'us' : 'them'}">${best.name}</b> (${best.kills}명)`;
  $('end').classList.remove('hidden');
  win ? sfx.win() : sfx.lose();
}

/* ---------- 효과 ---------- */
const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.9 });
const panOf = (pos) => { const p = G.player; const want = Math.atan2(-(pos.x - p.pos.x), -(pos.z - p.pos.z)); return -Math.sin(angDiff(p.yaw, want)); };
function shotFx(u, from, to, w, wallHit, dir) {
  if (!u.isPlayer && wallHit) { // 빗나간 총알은 뒤쪽 벽까지 날아간다
    dir = to.clone().sub(from).normalize();
    const r = rayWorld(from, dir, 90); to = from.clone().addScaledVector(dir, r.t); wallHit = !!r.hit;
  }
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat.clone()); scene.add(line);
  G.fx.push({ obj: line, t: 0.06, fade: true });
  if (wallHit) impact(to, dir ? dir.clone().negate() : null);
  const kind = { spark: 'pistol', burst: 'smg', lancer: 'rifle', longshot: 'sniper' }[w.id];
  if (u.isPlayer) { shot(kind, 0, 0); curView.userData.flash.visible = true; curView.userData.flash.rotation.z = Math.random() * 3; muzzleLight.intensity = 6; G.fx.push({ obj: curView.userData.flash, t: 0.045, hide: true }); }
  else { shot(kind, Math.hypot(u.pos.x - G.player.pos.x, u.pos.z - G.player.pos.z), panOf(u.pos)); u.flashT = 0.05; }
}
G.shotFx = shotFx;
function explode() {
  const R = G.round, c = R.core.pos;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff8a4c, transparent: true, opacity: 0.85 }));
  ball.position.copy(c); scene.add(ball);
  const light = new THREE.PointLight(0xff7a3c, 40, 60, 1.5); light.position.copy(c).y += 2; scene.add(light);
  const start = performance.now();
  (function anim() { const k = (performance.now() - start) / 1300; if (k >= 1) { scene.remove(ball); scene.remove(light); return; } ball.scale.setScalar(1 + k * 15); ball.material.opacity = 0.85 * (1 - k); light.intensity = 40 * (1 - k); requestAnimationFrame(anim); })();
  burst(c.clone().setY(1), 0xffa04c, 60, 16, 1.2); burst(c.clone().setY(1), 0x555555, 40, 8, 1.6);
  for (const u of G.units) if (u.alive && Math.hypot(u.pos.x - c.x, u.pos.z - c.z) < 13) { u.alive = false; u.hp = 0; u.dieT = 0; }
  G.shake = 1.2;
  coreMesh.visible = false;
}

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
function hitMarker(head, killed) { const h = $('hitmark'); h.className = ''; void h.offsetWidth; h.className = `show${head ? ' head' : ''}${killed ? ' kill' : ''}`; }
function dmgNumber(n, head) {
  const d = document.createElement('div'); d.className = `dn${head ? ' head' : ''}`; d.textContent = n;
  d.style.left = `calc(50% + ${18 + Math.random() * 26}px)`; d.style.top = `calc(50% - ${14 + Math.random() * 20}px)`;
  $('hud').appendChild(d); setTimeout(() => d.remove(), 700);
}
function killBanner(n, head) {
  const b = $('killBanner');
  b.innerHTML = `<div class="icons">${'<i></i>'.repeat(Math.min(5, n))}</div><b>${['', '쓰러뜨림', '2연속!', '3연속!!', '4연속!!!', '에이스!'][Math.min(5, n)]}${head ? ' · 머리' : ''}</b>`;
  b.className = ''; void b.offsetWidth; b.className = 'show';
}
function hurtFlash(a, dealt) {
  $('dmg').style.opacity = Math.min(0.8, 0.25 + dealt / 80);
  const ang = -angDiff(G.player.yaw, Math.atan2(-(a.pos.x - G.player.pos.x), -(a.pos.z - G.player.pos.z)));
  $('dmgDir').style.transform = `translate(-50%,-50%) rotate(${ang}rad)`; $('dmgDir').style.opacity = 1;
}
const fmtT = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function updateHud() {
  const p = G.player, R = G.round;
  $('scoreUs').textContent = G.score.us; $('scoreThem').textContent = G.score.them;
  $('sideUs').textContent = G.ourSide === 'atk' ? '공격' : '수비'; $('sideThem').textContent = G.ourSide === 'atk' ? '수비' : '공격';
  $('timer').textContent = R.phase === 'buy' ? `구매 ${fmtT(R.t)}` : R.phase === 'planted' ? `◉ ${fmtT(R.t)}` : fmtT(R.t);
  $('timer').className = R.phase === 'planted' ? 'planted' : '';
  $('roundNo').textContent = `${R.n}라운드 · 먼저 ${WIN}승`;
  $('aliveUs').innerHTML = G.units.filter((u) => u.us).map((u) => `<i class="${u.alive ? 'on' : ''}"></i>`).join('');
  $('aliveThem').innerHTML = G.units.filter((u) => !u.us).map((u) => `<i class="${u.alive ? 'on' : ''}"></i>`).join('');
  $('hp').textContent = Math.ceil(p.hp); $('armor').textContent = Math.ceil(p.armor);
  $('hpBar').style.width = `${p.hp}%`; $('hpBar').className = p.hp < 35 ? 'low' : '';
  const g = p.gun; $('wname').textContent = `${g.w.name} · ${g.w.kind}`;
  $('mag').textContent = g.reloading > 0 ? '장전' : g.mag; $('mag').className = g.mag <= Math.ceil(g.w.mag * 0.25) ? 'low' : '';
  $('reserve').textContent = g.reserve;
  $('credits').textContent = `⬡ ${p.credits}`;
  $('qn').textContent = P.smokes; $('en').textContent = P.dash;
  $('abQ').classList.toggle('off', P.smokes <= 0); $('abE').classList.toggle('off', P.dash <= 0);
  // 지금 할 수 있는 일 안내
  let tip = '';
  if (p.alive) {
    if (P.canPlant) tip = '<kbd>F</kbd> 길게 눌러 <b>코어 설치</b>';
    else if (P.canDefuse) tip = '<kbd>F</kbd> 길게 눌러 <b>코어 해체</b>';
    else if (R.core.carrier === p && R.core.state === 'carried' && R.phase === 'live') tip = '코어를 들고 있어요 · <b>A</b>나 <b>B</b> 지점으로';
    else if (R.phase === 'planted' && p.team === 'def') tip = `<b>${R.core.site}</b> 지점의 코어를 해체하세요`;
    else if (R.core.state === 'dropped' && p.team === 'atk') tip = '떨어진 코어를 주우세요 (작은 지도의 빨간 점)';
  }
  $('prompt').innerHTML = tip; $('prompt').classList.toggle('hidden', !tip);
  $('scope').classList.toggle('show', P.scoped && p.alive);
  $('cross').classList.toggle('hidden', P.scoped || !p.alive);
  $('spec').classList.toggle('hidden', p.alive);
  $('clickPlay').classList.toggle('hidden', locked || !G.running || G.paused || !$('buy').classList.contains('hidden'));
}

/* ---------- 작은 지도 ---------- */
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const W = 220, H = 170, sx = W / 124, sz = H / 96;
  const X = (x) => (x + 62) * sx, Z = (z) => (z + 48) * sz;
  mm.clearRect(0, 0, W, H);
  mm.fillStyle = 'rgba(20,28,38,.78)'; mm.fillRect(0, 0, W, H);
  for (const k in SITES) { const s = SITES[k]; mm.fillStyle = 'rgba(255,201,77,.22)'; mm.beginPath(); mm.arc(X(s.x), Z(s.z), s.r * sx, 0, 7); mm.fill(); mm.fillStyle = '#ffc94d'; mm.font = 'bold 13px sans-serif'; mm.fillText(k, X(s.x) - 4, Z(s.z) + 5); }
  mm.fillStyle = '#8b97a8';
  for (const b of BLOCKS) mm.fillRect(X(b.minX), Z(b.minZ), b.w * sx, b.d * sz);
  const R = G.round;
  if (R.core.state === 'dropped' || R.core.state === 'planted') { mm.fillStyle = '#ff5a3c'; mm.beginPath(); mm.arc(X(R.core.pos.x), Z(R.core.pos.z), 4 + (R.phase === 'planted' ? Math.abs(Math.sin(performance.now() / 200)) * 2 : 0), 0, 7); mm.fill(); }
  for (const s of G.smokes) { mm.fillStyle = 'rgba(220,225,235,.55)'; mm.beginPath(); mm.arc(X(s.pos.x), Z(s.pos.z), s.r * sx, 0, 7); mm.fill(); }
  for (const u of G.units) {
    if (!u.alive || (!u.us && u.spottedT <= 0)) continue;
    const col = u.isPlayer ? '#ffffff' : u.us ? '#4fd1c5' : '#ff6b6b';
    mm.fillStyle = col; mm.strokeStyle = col; mm.lineWidth = 1.5;
    if (u.isPlayer) { // 내 위치는 바라보는 방향 부채꼴
      mm.globalAlpha = 0.25; mm.beginPath(); mm.moveTo(X(u.pos.x), Z(u.pos.z)); mm.arc(X(u.pos.x), Z(u.pos.z), 22, -Math.PI / 2 - u.yaw - 0.6, -Math.PI / 2 - u.yaw + 0.6); mm.fill(); mm.globalAlpha = 1;
    }
    mm.beginPath(); mm.arc(X(u.pos.x), Z(u.pos.z), u.isPlayer ? 4 : 3.2, 0, 7); mm.fill();
    if (R.core.carrier === u && R.core.state === 'carried' && u.us) { mm.strokeStyle = '#ff5a3c'; mm.lineWidth = 2; mm.beginPath(); mm.arc(X(u.pos.x), Z(u.pos.z), 6, 0, 7); mm.stroke(); }
  }
}

/* ---------- 점수판 ---------- */
function drawScoreboard() {
  const row = (u) => `<tr class="${u.isPlayer ? 'me' : ''} ${u.alive ? '' : 'dead'}"><td>${u.name}</td><td>${u.kills}</td><td>${u.deaths}</td><td>${u.us ? '⬡ ' + u.credits : ''}</td><td>${u.primary ? u.primary.w.name : '권총'}</td></tr>`;
  const t = (list, title, cls) => `<div class="sb ${cls}"><h3>${title}</h3><table><tr><th>이름</th><th>쓰러뜨림</th><th>쓰러짐</th><th>돈</th><th>무기</th></tr>${list.map(row).join('')}</table></div>`;
  $('scoreboard').innerHTML = t(G.units.filter((u) => u.us), `우리 팀 · ${G.score.us}`, 'us') + t(G.units.filter((u) => !u.us), `상대 팀 · ${G.score.them}`, 'them');
}

/* ---------- 상점 ---------- */
function openBuy() { if (!G.running) return; document.exitPointerLock?.(); renderBuy(); $('buy').classList.remove('hidden'); }
function closeBuy() { $('buy').classList.add('hidden'); lockPointer(); }
function autoBuy() {
  const p = G.player;
  const want = !p.primary ? (p.credits >= WEAPONS.lancer.price + ARMOR.light.price ? 'lancer' : p.credits >= WEAPONS.burst.price + ARMOR.light.price ? 'burst' : null) : null;
  if (want) { p.credits -= WEAPONS[want].price; p.primary = newGun(want); p.gun = p.primary; refreshViewmodel(); }
  if (p.armor < 50 && p.credits >= ARMOR.heavy.price + 300) { p.credits -= ARMOR.heavy.price; p.armor = 50; }
  else if (p.armor < 25 && p.credits >= ARMOR.light.price) { p.credits -= ARMOR.light.price; p.armor = 25; }
  while (P.smokes < 2 && p.credits >= SMOKE_PRICE + 100) { p.credits -= SMOKE_PRICE; P.smokes++; }
  sfx.buy();
}
function renderBuy() {
  const p = G.player;
  const card = (id) => {
    const w = WEAPONS[id]; const own = (p.primary && p.primary.w.id === id) || (id === 'spark' && !p.primary);
    const can = !own && p.credits >= w.price && id !== 'spark';
    return `<button class="item ${own ? 'own' : ''}" data-buy="${id}" ${can ? '' : 'disabled'}><b>${w.name}</b><small>${w.kind} · 피해 ${w.dmg}${w.auto ? ' · 연발' : ''}${w.scope ? ' · 조준경' : ''}</small><span>${own ? '가지고 있음' : w.price ? '⬡ ' + w.price : '기본'}</span></button>`;
  };
  const arm = (k) => { const a = ARMOR[k]; const own = p.armor >= a.value; return `<button class="item ${own ? 'own' : ''}" data-armor="${k}" ${!own && p.credits >= a.price ? '' : 'disabled'}><b>${a.name}</b><small>피해를 최대 ${a.value}만큼 막음</small><span>${own ? '입고 있음' : '⬡ ' + a.price}</span></button>`; };
  $('buyBody').innerHTML = `
    <div class="col"><h4>무기</h4>${card('burst')}${card('lancer')}${card('longshot')}${card('spark')}</div>
    <div class="col"><h4>방어구</h4>${arm('light')}${arm('heavy')}
      <h4>능력</h4>
      <button class="item" data-smoke ${P.smokes < 2 && p.credits >= SMOKE_PRICE ? '' : 'disabled'}><b>연막 (Q)</b><small>13초 동안 시야를 막는 연기 · 최대 2개</small><span>${P.smokes >= 2 ? '가득 참' : '⬡ ' + SMOKE_PRICE}</span></button>
      <div class="free"><b>돌진 (E)</b> 라운드마다 1번 무료</div>
      ${G.ourSide === 'atk' ? `<h4>작전 지시</h4><div class="calls"><button data-call="A" class="${G.round.call === 'A' ? 'on' : ''}">A로 가자</button><button data-call="B" class="${G.round.call === 'B' ? 'on' : ''}">B로 가자</button></div>` : ''}
    </div>`;
  $('buyCredits').textContent = `⬡ ${p.credits}`;
}
$('buy').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const p = G.player;
  if (b.id === 'buyClose') return closeBuy();
  if (b.id === 'buyAuto') { autoBuy(); renderBuy(); updateHud(); return closeBuy(); }
  if (b.dataset.buy) { const w = WEAPONS[b.dataset.buy]; p.credits -= w.price; p.primary = newGun(w.id); p.gun = p.primary; refreshViewmodel(); sfx.buy(); }
  else if (b.dataset.armor) { const a = ARMOR[b.dataset.armor]; p.credits -= a.price; p.armor = a.value; sfx.buy(); }
  else if ('smoke' in b.dataset) { p.credits -= SMOKE_PRICE; P.smokes++; sfx.buy(); }
  else if (b.dataset.call) callSite(b.dataset.call);
  renderBuy(); updateHud();
});

/* ---------- 메뉴 ---------- */
function pause(on) {
  G.paused = on;
  $('pause').classList.toggle('hidden', !on);
  if (on) { keys.clear(); P.fireHeld = false; document.exitPointerLock?.(); applySettings(); }
}
$('resume').onclick = () => { pause(false); lockPointer(); };
$('toMenu').onclick = () => { pause(false); G.running = false; $('hud').classList.add('hidden'); $('buy').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('start').onclick = () => { initAudio(); applySettings(); startGame(); };
$('again').onclick = () => { initAudio(); startGame(); };
$('endMenu').onclick = () => { $('end').classList.add('hidden'); $('menu').classList.remove('hidden'); };
applySettings();

/* ---------- 매 프레임 ---------- */
const clock = new THREE.Clock();
let spotT = 0, hudT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (G.running && !G.paused) step(dt);
  else if (!G.running) { const t = performance.now() / 12000; camera.position.set(Math.sin(t) * 52, 30, Math.cos(t) * 42); camera.lookAt(0, 0, -4); camera.fov = 60; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera);
}
function step(dt) {
  const R = G.round, p = G.player;
  R.t -= dt;
  if (R.phase === 'buy' && R.t <= 0) { R.phase = 'live'; R.t = 100; if (!$('buy').classList.contains('hidden')) { $('buy').classList.add('hidden'); lockPointer(); } showMsg('시작!', '', 1); }
  else if (R.phase === 'live' && R.t <= 0) endRound('def', '시간 종료');
  else if (R.phase === 'planted') {
    R.core.beepT -= dt;
    if (R.core.beepT <= 0) { R.core.beepT = Math.max(0.14, R.t / 40 * 1.1); sfx.coreBeep(R.t < 10); coreMesh.getObjectByName('light').intensity = 3; }
    if (R.t <= 0) { sfx.boom(); explode(); endRound('atk', '코어 폭발'); }
  } else if (R.phase === 'end' && R.t <= 0) return afterRound();
  if (R.alert) { R.alert.t -= dt; if (R.alert.t <= 0) R.alert = null; }

  updatePlayer(dt);
  for (const u of G.units) if (!u.isPlayer) updateBot(G, u, dt);
  if (R.core.state === 'dropped') for (const u of G.units) if (!u.isPlayer && u.alive && u.team === 'atk' && Math.hypot(u.pos.x - R.core.pos.x, u.pos.z - R.core.pos.z) < 1.3) { R.core.state = 'carried'; R.core.carrier = u; coreMesh.visible = false; break; }
  // 적 발견 표시
  spotT -= dt;
  if (spotT <= 0) {
    spotT = 0.2;
    for (const e of G.units) {
      if (e.us || !e.alive) continue;
      if (G.units.some((a) => a.us && a.alive && (a.target === e || (a.isPlayer && Math.abs(angDiff(a.yaw, Math.atan2(-(e.pos.x - a.pos.x), -(e.pos.z - a.pos.z)))) < 1.1 && lineClear(eyeOf(a), eyeOf(e), G.smokes))))) e.spottedT = 1.5;
    }
  }
  for (const e of G.units) {
    if (e.spottedT > 0) e.spottedT -= dt;
    // 적 발소리
    if (!e.us && e.alive && e.running && p.alive) { e.stepT -= dt; if (e.stepT <= 0) { e.stepT = 0.34; footstep(Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z), panOf(e.pos)); } }
  }
  // 요원 모습
  for (const u of G.units) {
    if (!u.mesh) continue;
    if (u.tag) u.tag.visible = u.alive;
    u.mesh.position.copy(u.pos);
    if (u.alive) { u.mesh.rotation.set(0, u.yaw, 0); animateSoldier(u.mesh, dt, u.moving, u.crouch, u.flashT > 0); }
    else if (u.dieT != null && u.dieT < 1) { u.dieT += dt * 2.5; const k = Math.min(1, u.dieT); u.mesh.rotation.x = -k * Math.PI / 2; u.mesh.position.y = u.pos.y + 0.25 * k; animateSoldier(u.mesh, dt, false, false, false); }
    if (u.flashT > 0) u.flashT -= dt;
  }
  // 연막
  for (const s of G.smokes) { s.t -= dt; s.mat.opacity = Math.min(0.95, (13 - s.t) * 3, s.t * 0.9); s.mesh.rotation.y += dt * 0.05; if (s.t <= 0) scene.remove(s.mesh); }
  G.smokes = G.smokes.filter((s) => s.t > 0);
  // 코어
  if (coreMesh.visible) {
    const gl = coreMesh.getObjectByName('glow'), lt = coreMesh.getObjectByName('light'), ring = coreMesh.getObjectByName('ring');
    gl.material.emissiveIntensity = R.phase === 'planted' ? 0.6 + Math.abs(Math.sin(performance.now() / (R.t < 10 ? 80 : 250))) * 2 : 0.8;
    lt.intensity = Math.max(0, lt.intensity - dt * 10); ring.rotation.z += dt * (R.phase === 'planted' ? 4 : 1);
  }
  updateFx(dt);
  for (const f of G.fx) { f.t -= dt; if (f.fade && f.obj.material) f.obj.material.opacity = Math.max(0, f.t / 0.06); if (f.t <= 0) { if (f.hide) f.obj.visible = false; else { scene.remove(f.obj); f.obj.geometry?.dispose(); } } }
  G.fx = G.fx.filter((f) => f.t > 0);
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 120);

  // 카메라
  G.shake = Math.max(0, G.shake - dt * 2.5);
  const sh = G.shake * 0.03;
  if (p.alive) {
    const eyeH = p.crouch ? 1.1 : 1.6;
    const camY = p.pos.y + eyeH - (P.landT > 0 ? 0.08 : 0);
    P.camY = P.camY == null ? camY : P.camY + (camY - P.camY) * Math.min(1, dt * 14);
    if (P.landT > 0) P.landT -= dt;
    camera.position.set(p.pos.x + (Math.random() - 0.5) * sh, P.camY + Math.sin(P.bob * 2) * 0.03 * (p.moving && !P.air ? 1 : 0) + (Math.random() - 0.5) * sh, p.pos.z);
    camera.rotation.set(p.pitch, p.yaw, Math.sin(P.bob) * 0.004, 'YXZ');
    view.visible = !P.scoped;
    P.kick = Math.max(0, P.kick - dt * 9);
    const g = p.gun;
    view.position.set(BASE_VIEW.x + Math.sin(P.bob) * 0.012, BASE_VIEW.y - Math.abs(Math.cos(P.bob)) * 0.01 - (g.reloading > 0 ? 0.14 : 0) - (P.switchT > 0 ? P.switchT * 0.6 : 0), BASE_VIEW.z + P.kick * 0.05);
    view.rotation.set(P.kick * 0.1 + (g.reloading > 0 ? 0.5 : 0), 0.06, g.reloading > 0 ? 0.25 : 0);
  } else {
    view.visible = false;
    const allies = G.units.filter((u) => u.us && u.alive && !u.isPlayer);
    if (allies.length) { const a = allies[P.spectate % allies.length]; const e = eyeOf(a); camera.position.set(e.x + Math.sin(a.yaw) * 2.4, e.y + 0.9, e.z + Math.cos(a.yaw) * 2.4); camera.rotation.set(-0.25, a.yaw, 0, 'YXZ'); $('specName').textContent = a.name; }
    else { camera.position.set(0, 70, 30); camera.lookAt(0, 0, -2); $('specName').textContent = '전체 보기'; }
  }
  const fovT = P.scoped ? 26 : settings.fov;
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
  // 조준선이 퍼짐에 따라 벌어진다
  if (p.alive) document.documentElement.style.setProperty('--gap', `${4 + Math.min(40, currentSpread() * 420)}px`);

  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('center-msg').classList.remove('show'); }
  const dv = $('dmg'); dv.style.opacity = Math.max(0, Number(dv.style.opacity || 0) - dt * 1.5);
  const dd = $('dmgDir'); dd.style.opacity = Math.max(0, Number(dd.style.opacity || 0) - dt * 1.2);
  hudT -= dt; if (hudT <= 0) { hudT = 0.08; updateHud(); drawMinimap(); if (!$('scoreboard').classList.contains('hidden')) drawScoreboard(); }
}
frame();
// 자동 점검용 (?test 일 때만)
if (new URLSearchParams(location.search).has('test')) window.__cs = { G, P, newGun, refreshViewmodel, startGame, step, tryFire, render: () => renderer.render(scene, camera), setLocked: (v) => { locked = v; } };
