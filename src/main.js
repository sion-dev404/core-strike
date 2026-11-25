// 코어 스트라이크 — 3D 1인칭 5대5 전술 슈팅 (원작, 무과금)
import * as THREE from 'three';
import { buildMap, BLOCKS, SITES, SPAWNS, collide, groundAt, rayWorld, inSite, randomNear, lineClear } from './map.js';
import { WEAPONS, SHOP, ARMOR, MONEY, newGun, applyDamage } from './weapons.js';
import { makeBotMesh, botBuy, planRound, updateBot, eyeOf, angDiff, TEAM_COLOR } from './bots.js';
import { setSoldierTeam, animateSoldier, makeViewGun } from './models.js';
import { initFx, updateFx, impact, hitPuff, burst } from './fx.js';
import { initAudio, shot, step as footstep, sfx, setVolume } from './audio.js';
import { AGENTS, AGENT_IDS, KEYS, resetCharges, tickCharges, initAbilities, useAbility, updateAreas, updateWalls, clearTemp } from './agents.js';
import './style.css';
import './style-v3.css';

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
initAbilities(scene);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

/* ---------- 설정 ---------- */
const CROSS = { green: '#b6ff6b', white: '#ffffff', cyan: '#5ef2e0', pink: '#ff6bd6' };
const settings = { sens: store.get('sens', 1), diff: store.get('diff', 'normal'), fov: store.get('fov', 85), vol: store.get('vol', 0.6), cross: store.get('cross', 'green'), mode: store.get('mode', 'quick') };
function applySettings() {
  setVolume(settings.vol);
  document.documentElement.style.setProperty('--cross', CROSS[settings.cross] || CROSS.green);
  for (const s of ['', 'P']) {
    const set = (id, v, txt) => { const el = $(id + s); if (el) { el.value = v; const o = $(id + s + 'v'); if (o) o.textContent = txt; } };
    set('sens', settings.sens, Number(settings.sens).toFixed(1)); set('fov', settings.fov, settings.fov); set('vol', settings.vol, Math.round(settings.vol * 100) + '%');
  }
  document.querySelectorAll('[data-cross]').forEach((b) => b.classList.toggle('on', b.dataset.cross === settings.cross));
  document.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('on', b.dataset.diff === settings.diff));
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
}
for (const s of ['', 'P']) {
  const bind = (id, key) => { const el = $(id + s); if (el) el.addEventListener('input', () => { settings[key] = Number(el.value); store.set(key, settings[key]); applySettings(); }); };
  bind('sens', 'sens'); bind('fov', 'fov'); bind('vol', 'vol');
}
for (const [attr, key] of [['cross', 'cross'], ['diff', 'diff'], ['mode', 'mode']]) document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => { settings[key] = b.dataset[attr]; store.set(key, settings[key]); applySettings(); }));

/* ---------- 손에 든 총 ---------- */
const view = new THREE.Group(); camera.add(view);
let viewGuns = {};
const muzzleLight = new THREE.PointLight(0xffc56b, 0, 8, 2); camera.add(muzzleLight); muzzleLight.position.set(0.25, -0.15, -0.9);
let curView = null;
function refreshViewmodel(u) {
  if (!G.player || (u && u !== G.player)) return;
  const w = G.player.gun.w;
  if (curView) view.remove(curView);
  viewGuns[w.id] ||= makeViewGun(w.id, TEAM_COLOR[G.player.team], w.color);
  curView = viewGuns[w.id]; view.add(curView);
  P.switchT = 0.25; P.scoped = false;
}
const BASE_VIEW = new THREE.Vector3(0.16, -0.16, -0.32);
view.position.copy(BASE_VIEW); view.scale.setScalar(0.52);

/* ---------- 게임 상태 ---------- */
const NAMES_US = ['솔', '파도', '별빛', '모래'];
const NAMES_THEM = ['해치', '노을', '바윗돌', '번개', '안개'];
const DIFF = { easy: { name: '쉬움', react: 0.8, acc: 0.3, head: 0.08 }, normal: { name: '보통', react: 0.5, acc: 0.44, head: 0.15 }, hard: { name: '어려움', react: 0.3, acc: 0.6, head: 0.26 } };
const RULES = { quick: { win: 5, half: 4, buy: 20 }, full: { win: 13, half: 12, buy: 30 } };
const ROUND_TIME = 100, CORE_TIME = 45, PLANT_TIME = 4, DEFUSE_TIME = 7;
let rules = RULES.quick;

const G = { units: [], player: null, smokes: [], fx: [], areas: [], walls: [], diff: DIFF[settings.diff], round: null, score: { us: 0, them: 0 }, ourSide: 'atk', played: 0, running: false, paused: false, shake: 0, lossStreak: { us: 0, them: 0 } };
G.refreshViewmodel = refreshViewmodel;
const coreMesh = (() => {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.5, roughness: 0.4 }));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.46, 16), new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0xff3b1f, emissiveIntensity: 1.2 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), new THREE.MeshStandardMaterial({ color: 0xffc94d, emissive: 0xffa21f, emissiveIntensity: 0.8 }));
  base.position.y = 0.1; glow.position.y = 0.32; ring.position.y = 0.32; ring.rotation.x = Math.PI / 2; glow.name = 'glow'; ring.name = 'ring';
  const light = new THREE.PointLight(0xff4a2a, 0, 6, 2); light.position.y = 0.6; light.name = 'light';
  g.add(base, glow, ring, light); g.visible = false; scene.add(g); return g;
})();

function newUnit({ name, us, isPlayer, agent }) {
  const u = {
    name, us, isPlayer, agent, team: us ? G.ourSide : (G.ourSide === 'atk' ? 'def' : 'atk'),
    pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true, ult: 0,
    sidearm: newGun('spark'), primary: null, gun: null, credits: MONEY.start, kills: 0, deaths: 0, assists: 0, roundKills: 0, dmgRound: 0, hitBy: new Set(),
    crouch: false, moving: false, running: false, path: [], goal: null, mesh: null, tag: null,
    scanT: 0, reactT: 0, burst: 0, strafeT: 0, strafe: 0, lastSeenT: 0, plantT: 0, defuseT: 0, lookT: 0, stuckT: 0, waitT: 0, spottedT: 0, stepT: 0, flashT: 0,
    blindT: 0, slowT: 0, tagT: 0, revealT: 0, healLeft: 0,
  };
  u.gun = u.sidearm;
  resetCharges(u, false);
  if (!isPlayer) {
    u.mesh = makeBotMesh(u.team); scene.add(u.mesh);
    if (us) { u.tag = nameTag(`${name} · ${AGENTS[agent].name}`); u.mesh.add(u.tag); }
    // 탐지되면 벽 너머로 보이는 빨간 윤곽
    const rv = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 4, 10), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.45, depthTest: false }));
    rv.position.y = 0.95; rv.renderOrder = 6; rv.visible = false; u.mesh.add(rv); u.revealMesh = rv;
  }
  return u;
}
function nameTag(text) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 64;
  const g = c.getContext('2d'); g.font = 'bold 30px "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(text, 192, 32); g.fillStyle = '#7ff0e3'; g.fillText(text, 192, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.27, 1); s.position.y = 2.15; s.renderOrder = 5; return s;
}

/* ---------- 요원 선택 → 경기 시작 ---------- */
let pick = store.get('agent', 'blink');
function openSelect() {
  rules = RULES[settings.mode] || RULES.quick;
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('select').classList.remove('hidden');
  const card = (id) => { const a = AGENTS[id]; return `<button class="agent ${id === pick ? 'on' : ''}" data-agent="${id}" style="--ac:${a.color}"><span class="ico">${a.tag}</span><b>${a.name}</b><small>${a.role}</small></button>`; };
  $('agentGrid').innerHTML = AGENT_IDS.map(card).join('');
  showAgentInfo(pick);
}
function showAgentInfo(id) {
  const a = AGENTS[id];
  const row = (k) => `<li><kbd>${k}</kbd><b>${a[k].name}</b><span>${k === 'X' ? `궁극기 · 포인트 ${a[k].cost}` : a[k].free ? `라운드마다 ${a[k].free}개 무료` : `⬡ ${a[k].price} · 최대 ${a[k].max}`}</span></li>`;
  $('agentInfo').innerHTML = `<div class="big" style="--ac:${a.color}">${a.tag}</div><h2>${a.name}</h2><p class="role">${a.role} · ${a.desc}</p><ul>${['C', 'Q', 'E', 'X'].map(row).join('')}</ul>`;
}
$('agentGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-agent]'); if (!b) return; pick = b.dataset.agent; store.set('agent', pick); document.querySelectorAll('[data-agent]').forEach((x) => x.classList.toggle('on', x === b)); showAgentInfo(pick); sfx.buy(); });
$('lockIn').onclick = () => { initAudio(); $('select').classList.add('hidden'); startGame(pick); };

function startGame(agent) {
  for (const u of G.units) if (u.mesh) scene.remove(u.mesh);
  clearTemp(G);
  G.units = []; G.score = { us: 0, them: 0 }; G.played = 0; G.ourSide = 'atk'; G.diff = DIFF[settings.diff]; G.lossStreak = { us: 0, them: 0 };
  const left = AGENT_IDS.filter((x) => x !== agent).sort(() => Math.random() - 0.5);
  const them = [...AGENT_IDS].sort(() => Math.random() - 0.5);
  G.player = newUnit({ name: '나', us: true, isPlayer: true, agent });
  G.units.push(G.player);
  NAMES_US.forEach((n, i) => G.units.push(newUnit({ name: n, us: true, agent: left[i] })));
  NAMES_THEM.forEach((n, i) => G.units.push(newUnit({ name: n, us: false, agent: them[i] })));
  G.running = true; G.paused = false;
  viewGuns = {};
  $('hud').classList.remove('hidden');
  drawTeamBar();
  newRound(true);
}

function newRound(fresh = false) {
  const R = G.round = { n: G.played + 1, phase: 'buy', t: rules.buy, alert: null, call: null, attackSite: null, smoked: { atk: false, def: false }, core: { state: 'carried', carrier: null, pos: new THREE.Vector3(), beepT: 0, site: null, half: false } };
  for (const s of G.smokes) scene.remove(s.mesh); G.smokes = [];
  clearTemp(G);
  const sides = { atk: [], def: [] };
  const save = {};
  for (const side of ['us', 'them']) { const list = G.units.filter((u) => (side === 'us') === u.us && !u.isPlayer); save[side] = !fresh && list.reduce((s, u) => s + u.credits, 0) / list.length < 2400 && list.filter((u) => u.primary).length < 2; }
  for (const u of G.units) {
    u.team = u.us ? G.ourSide : (G.ourSide === 'atk' ? 'def' : 'atk');
    if (u.mesh) setSoldierTeam(u.mesh, TEAM_COLOR[u.team], u.team);
    const survived = u.alive && !fresh;
    if (!survived) { u.primary = null; u.armor = 0; u.sidearm = newGun('spark'); }
    for (const g of [u.primary, u.sidearm]) if (g) { g.mag = g.w.mag; g.reserve = g.w.reserve; g.reloading = 0; g.heat = 0; g.spray = 0; }
    u.gun = u.primary || u.sidearm; u.ultGun = null;
    resetCharges(u, survived);
    Object.assign(u, { hp: 100, alive: true, vy: 0, crouch: false, target: null, path: [], goal: null, lastSeenT: 0, plantT: 0, defuseT: 0, rotated: false, guard: null, spottedT: 0, roundKills: 0, dmgRound: 0, retreatT: undefined, dieT: null, blindT: 0, slowT: 0, tagT: 0, revealT: 0, healLeft: 0, diedRound: 0 });
    u.hitBy = new Set();
    sides[u.team].push(u);
  }
  for (const side of ['atk', 'def']) {
    const sp = SPAWNS[side];
    sides[side].forEach((u, i) => {
      u.pos.set(sp.x + (i - 2) * 2.4, 0, sp.z + (i % 2) * 1.5 * (side === 'atk' ? 1 : -1));
      u.yaw = sp.yaw; u.pitch = 0;
      if (u.mesh) { u.mesh.visible = true; u.mesh.rotation.set(0, u.yaw, 0); u.mesh.position.copy(u.pos); u.mesh.userData.body.position.y = 0; }
    });
  }
  for (const u of G.units) if (!u.isPlayer) botBuy(u, save[u.us ? 'us' : 'them']);
  const atk = G.units.filter((u) => u.team === 'atk');
  R.core.carrier = atk.find((u) => u.isPlayer) || atk[Math.floor(Math.random() * atk.length)];
  coreMesh.visible = false;
  P.scoped = false; P.dashT = 0; P.camY = null;
  viewGuns = {};
  refreshViewmodel();
  planRound(G);
  sfx.round();
  // 라운드 시작 팝업
  const mp = [G.score.us, G.score.them].some((s) => s === rules.win - 1);
  banner(`${R.n}라운드`, G.ourSide === 'atk' ? '공격' : '수비', G.ourSide === 'atk' ? 'atk' : 'def', mp ? '매치 포인트' : fresh && G.played === rules.half ? '공수 교대' : '');
  openBuy();
  drawTeamBar(); updateHud();
}

/* ---------- 나(플레이어) ---------- */
const P = { dashT: 0, dashDir: null, scoped: false, kick: 0, bob: 0, spectate: 0, fireHeld: false, switchT: 0, air: false, landT: 0, camY: null, recoilPitch: 0 };
const keys = new Set();
let locked = false;
canvas.addEventListener('click', () => { if (G.running && !G.paused && $('buy').classList.contains('hidden') && !locked) lockPointer(); });
$('clickPlay').addEventListener('click', () => lockPointer());
function lockPointer() { initAudio(); try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* 무시 */ } }
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (!locked) { keys.clear(); P.fireHeld = false; } });
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
document.addEventListener('wheel', () => { if (!locked || !G.player?.alive) return; const p = G.player; if (p.primary && p.gun.w.id !== 'blades') switchGun(p.gun === p.primary ? p.sidearm : p.primary); }, { passive: true });
document.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  if (!G.running) return;
  const k = e.code;
  if (k === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); drawScoreboard(); return; }
  if (k === 'Escape') { if (!$('buy').classList.contains('hidden')) closeBuy(); else if (!G.paused) pause(true); return; }
  if (k === 'KeyB') { if (G.round.phase === 'buy') { $('buy').classList.contains('hidden') ? openBuy() : closeBuy(); } return; }
  if (G.paused || !$('buy').classList.contains('hidden')) return;
  keys.add(k);
  const p = G.player;
  if (!p.alive || e.repeat) return;
  if (k === 'Digit1' && p.primary && p.gun.w.id !== 'blades') switchGun(p.primary);
  if (k === 'Digit2' && p.gun.w.id !== 'blades') switchGun(p.sidearm);
  if (k === 'KeyR') startReload(p);
  if (k === 'KeyC' || k === 'KeyQ' || k === 'KeyE' || k === 'KeyX') playerAbility(k.slice(3));
  if (k === 'KeyZ' || k === 'KeyV') callSite(k === 'KeyZ' ? 'A' : 'B');
  if (k === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Tab') $('scoreboard').classList.add('hidden'); });
addEventListener('blur', () => { keys.clear(); P.fireHeld = false; });

const lookDir = () => camera.getWorldDirection(new THREE.Vector3());
G.lookDir = lookDir;
function playerAbility(key) {
  const p = G.player;
  if (G.round.phase === 'buy' || G.round.phase === 'end') return;
  const ok = useAbility(G, p, key, { o: camera.getWorldPosition(new THREE.Vector3()), d: lookDir() });
  if (!ok) { sfx.empty(); if (key === 'X') toast(`궁극기 포인트 ${p.ult}/${G.ultCost(p)}`); }
  updateHud();
}
G.onAbility = (u, name, ult) => { if (ult) { sfx.ult(); if (u.us) feed(`<b class="${u.us ? 'us' : 'them'}">${u.name}</b> 궁극기: ${name}`); else { feed(`<b class="them">${u.name}</b> 궁극기: ${name}`); } } };
G.say = (u, txt) => { if (u.us && !u.isPlayer) feed(`<b class="us">${u.name}</b>: ${txt}`); };
G.sfx = (n) => sfx[n]?.();

function switchGun(g) { const p = G.player; if (p.gun === g) return; p.gun = g; g.cool = Math.max(g.cool, 0.3); refreshViewmodel(); }
function startReload(u) { const g = u.gun; if (g.reloading > 0 || g.mag >= g.w.mag || g.reserve <= 0) return; g.reloading = g.w.reload; P.scoped = false; if (u.isPlayer) sfx.reload(); }
function callSite(s) {
  if (G.ourSide !== 'atk') return;
  G.round.call = s; G.round.attackSite = s;
  for (const u of G.units) if (!u.isPlayer && u.team === 'atk') { const S = SITES[s]; u.spot = randomNear(S.x, S.z, 6); u.goal = null; u.path = []; }
  feed(`<b class="us">나</b>: "${s}로 가자!"`);
  if (!$('buy').classList.contains('hidden')) renderBuy();
}

function addSmoke(at, who, quiet) {
  if (!quiet) sfx.smoke();
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: who && who.team === 'atk' ? 0xd9c9c2 : 0xc6d3d8, transparent: true, opacity: 0, roughness: 1, depthWrite: false });
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 + Math.random() * 1.3, 1), mat);
    m.position.set((Math.random() - 0.5) * 3.6, (Math.random() - 0.35) * 2, (Math.random() - 0.5) * 3.6); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); g.add(m);
  }
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(4.1, 2), mat));
  g.position.copy(at); scene.add(g);
  G.smokes.push({ pos: at.clone(), r: 4.1, t: 14, mesh: g, mat });
}
G.addSmoke = addSmoke;
function dash() {
  sfx.dash();
  const f = new THREE.Vector3(-Math.sin(G.player.yaw), 0, -Math.cos(G.player.yaw));
  const mv = moveInput(); if (mv.lengthSq() > 0) f.copy(mv);
  P.dashDir = f.normalize(); P.dashT = 0.22;
}
G.dash = dash;
function moveInput() {
  const p = G.player, f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const v = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) v.add(f); if (keys.has('KeyS') || keys.has('ArrowDown')) v.sub(f);
  if (keys.has('KeyD') || keys.has('ArrowRight')) v.add(r); if (keys.has('KeyA') || keys.has('ArrowLeft')) v.sub(r);
  return v.lengthSq() ? v.normalize() : v;
}
const speedMul = (u) => (u.slowT > 0 ? 0.5 : 1) * (u.tagT > 0 ? 0.55 : 1);
G.speedMul = speedMul;
// 빠른 대전은 경기가 짧아 궁극기 포인트를 덜 모은다
G.ultCost = (u) => { const c = AGENTS[u.agent].X.cost; return rules === RULES.quick ? Math.ceil(c * 0.6) : c; };

function updatePlayer(dt) {
  const p = G.player, R = G.round, g = p.gun;
  if (g.cool > 0) g.cool -= dt;
  g.sprayT += dt; if (g.sprayT > 0.38) g.spray = Math.max(0, g.spray - dt * 30);
  if (g.reloading > 0) { g.reloading -= dt; if (g.reloading <= 0) { const take = Math.min(g.w.mag - g.mag, g.reserve); g.mag += take; g.reserve -= take; } }
  if (P.switchT > 0) P.switchT -= dt;
  // 반동 회복: 쏘지 않으면 조준이 천천히 돌아온다
  if (!P.fireHeld && P.recoilPitch > 0) { const back = Math.min(P.recoilPitch, dt * 0.35); p.pitch -= back; P.recoilPitch -= back; }
  if (!p.alive) return;
  const frozen = R.phase === 'buy';
  p.crouch = keys.has('ControlLeft');
  const walk = keys.has('ShiftLeft');
  let speed = (p.crouch ? 2.4 : walk ? 3.1 : 6.75) * speedMul(p);
  if (P.scoped) speed *= 0.55;
  if (g.w.cat === '저격총' || g.w.cat === '기관총') speed *= 0.92;
  const mv = frozen ? new THREE.Vector3() : moveInput();
  const ox = p.pos.x, oz = p.pos.z;
  if (P.dashT > 0) { P.dashT -= dt; mv.copy(P.dashDir); speed = 24; }
  p.pos.x += mv.x * speed * dt; p.pos.z += mv.z * speed * dt;
  collide(p.pos, 0.4, p.pos.y);
  const ground = groundAt(p.pos.x, p.pos.z, 0.4, p.pos.y);
  if (keys.has('Space') && p.pos.y <= ground + 0.01 && !frozen) p.vy = 7;
  p.vy -= 20 * dt; p.pos.y += p.vy * dt;
  const wasAir = P.air;
  if (p.pos.y <= ground) { p.pos.y = ground; p.vy = 0; }
  P.speed = Math.hypot(p.pos.x - ox, p.pos.z - oz) / dt;
  p.moving = P.speed > 1; p.running = P.speed > 4.5;
  P.bob += P.speed * dt * 1.5;
  P.air = p.pos.y > ground + 0.05;
  if (wasAir && !P.air) P.landT = 0.12;

  if (R.core.state === 'dropped' && p.team === 'atk' && Math.hypot(p.pos.x - R.core.pos.x, p.pos.z - R.core.pos.z) < 1.4) { R.core.state = 'carried'; R.core.carrier = p; coreMesh.visible = false; feed('<b class="us">나</b>: 코어를 주웠습니다'); sfx.buy(); }
  const holding = keys.has('KeyF') || keys.has('Digit4');
  const canPlant = R.phase === 'live' && R.core.carrier === p && R.core.state === 'carried' && inSite(p.pos.x, p.pos.z);
  const canDefuse = R.phase === 'planted' && p.team === 'def' && Math.hypot(p.pos.x - R.core.pos.x, p.pos.z - R.core.pos.z) < 1.8;
  P.canPlant = canPlant; P.canDefuse = canDefuse;
  if (holding && P.speed < 0.5 && !P.air && canPlant) {
    p.plantT += dt; p.crouch = true; progress(p, 'plant', p.plantT / PLANT_TIME); if (p.plantT >= PLANT_TIME) plantCore(p);
  } else if (holding && P.speed < 0.5 && canDefuse) {
    if (!p.defuseT && R.core.half) p.defuseT = DEFUSE_TIME / 2;
    p.defuseT += dt; p.crouch = true; if (p.defuseT >= DEFUSE_TIME / 2) R.core.half = true;
    progress(p, 'defuse', p.defuseT / DEFUSE_TIME); if (p.defuseT >= DEFUSE_TIME) defuseCore(p);
  } else { if (p.plantT || p.defuseT) progress(p, null, 0); p.plantT = 0; p.defuseT = 0; }

  if (P.fireHeld && g.w.auto) tryFire(false);
  if (g.mag === 0 && g.reloading <= 0 && g.cool <= 0) {
    if (g.w.id === 'blades') { p.gun = p.ultGun || p.primary || p.sidearm; p.ultGun = null; refreshViewmodel(); }
    else if (g.reserve > 0) startReload(p); else if (g !== p.sidearm) switchGun(p.sidearm);
  }
}

// 지금 퍼짐: 멈춰 있으면 정확, 뛰면 크게 퍼진다
function currentSpread() {
  const p = G.player, g = p.gun, w = g.w;
  const run = Math.min(1, (P.speed || 0) / 6.75);
  let s = w.spread + w.run * (run > 0.55 ? run : run * 0.35) + (P.air ? 0.2 : 0) + Math.min(0.03, g.spray * 0.0016) * (w.auto ? 1 : 0.3);
  if (w.scope && !P.scoped) s += 0.06;
  if (p.crouch) s *= 0.85;
  return s;
}
function tryFire(click) {
  const p = G.player, g = p.gun, w = g.w, R = G.round;
  if (!p.alive || R.phase === 'buy' || !locked || G.paused || !$('buy').classList.contains('hidden')) return;
  if (g.reloading > 0 || g.cool > 0 || P.switchT > 0 || p.plantT > 0 || p.defuseT > 0 || p.blindT > 1.2) return;
  if (!click && !w.auto) return;
  if (g.mag <= 0) { if (click) sfx.empty(); return; }
  g.mag--; g.cool = w.rate;
  const spread = currentSpread();
  // 반동 모양: 연사할수록 정해진 길로 튄다
  const pat = w.pattern[Math.min(Math.floor(g.spray), w.pattern.length - 1)] || [0, 0];
  g.spray++; g.sprayT = 0;
  const o = camera.getWorldPosition(new THREE.Vector3());
  const base = lookDir();
  const right = new THREE.Vector3().crossVectors(base, camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, base).normalize();
  const pellets = w.pellets || 1;
  const hits = new Map();
  let lastEnd = null, wallHitAny = false, dirOut = base;
  for (let k = 0; k < pellets; k++) {
    const d = base.clone();
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread;
    d.addScaledVector(right, Math.cos(a) * rr + pat[0]).addScaledVector(up, Math.sin(a) * rr + pat[1] * 0.6).normalize();
    const wall = rayWorld(o, d, 220);
    let best = wall.t, victim = null, part = 'body';
    for (const u of G.units) {
      if (!u.alive || u.team === p.team) continue;
      const hy = u.crouch ? 1.12 : 1.62, top = u.crouch ? 0.95 : 1.42;
      const th = raySphere(o, d, new THREE.Vector3(u.pos.x, u.pos.y + hy, u.pos.z), 0.25); if (th > 0 && th < best) { best = th; victim = u; part = 'head'; }
      const tb = rayCylinder(o, d, u.pos, 0.38, u.pos.y, u.pos.y + top); if (tb > 0 && tb < best) { best = tb; victim = u; part = o.y + d.y * tb < u.pos.y + 0.55 ? 'leg' : 'body'; }
    }
    if (pellets > 1 && best > 22) victim = null; // 산탄은 멀리 못 간다
    const end = o.clone().addScaledVector(d, Math.min(best, pellets > 1 ? 22 : best));
    if (victim) { const h = hits.get(victim) || []; h.push({ part, end }); hits.set(victim, h); }
    else if (wall.hit && (pellets === 1 || best < 22)) { wallHitAny = true; if (k < 4) impact(end, d.clone().negate()); }
    if (k === 0) { lastEnd = end; dirOut = d; }
  }
  const muzzle = curView.userData.flash.getWorldPosition(new THREE.Vector3());
  shotFx(p, muzzle, lastEnd, w, false, dirOut);
  for (const [v, list] of hits) for (const h of list) damage(p, v, w, h.part, h.end);
  P.kick = 1;
  // 화면도 반동의 일부만큼 들린다
  const climb = pat[1] * 0.35 + w.kick * 0.25 * (P.scoped ? 0.5 : 1);
  p.pitch = Math.min(1.45, p.pitch + climb); P.recoilPitch += climb;
  p.yaw += pat[0] * 0.3 + (Math.random() - 0.5) * w.kick * 0.15;
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
function damage(a, v, w, part, at) {
  if (!v.alive) return;
  const dealt = applyDamage(v, w, part);
  hurt(a, v, dealt, w, part === 'head', at);
}
function hurt(a, v, dealt, w, head, at) {
  a.dmgRound += dealt; v.hitBy.add(a);
  v.tagT = 0.3; // 맞으면 잠깐 느려진다
  if (at) hitPuff(at, TEAM_COLOR[v.team], head);
  if (a.isPlayer) { hitMarker(head, v.hp <= 0); head ? sfx.head() : sfx.hit(); dmgNumber(Math.round(dealt), head); }
  if (v.isPlayer) { sfx.hurt(); hurtFlash(a, dealt); G.shake = Math.min(0.6, G.shake + dealt / 120); }
  if (!v.isPlayer && !v.target) { v.lastSeen = { x: a.pos.x, z: a.pos.z }; v.lastSeenT = 3; v.yaw = Math.atan2(-(a.pos.x - v.pos.x), -(a.pos.z - v.pos.z)); }
  if (v.hp <= 0) kill(a, v, w, head);
}
G.damage = damage;
G.burn = (a, v, amount) => { if (!v.alive) return; v.hp -= amount; hurt(a, v, amount, { name: '불길' }, false, null); };
function kill(a, v, w, head) {
  v.alive = false; v.hp = 0; v.deaths++; v.diedRound = G.round.n;
  if (a !== v) { a.kills++; a.roundKills++; a.credits = Math.min(MONEY.max, a.credits + MONEY.kill); addUlt(a, 1); }
  for (const h of v.hitBy) if (h !== a && h.team !== v.team) h.assists++;
  v.plantT = 0; v.defuseT = 0; progress(v, null, 0);
  if (v.ultGun) { v.gun = v.ultGun; v.ultGun = null; }
  if (a.isPlayer) { sfx.kill(); killBanner(a.roundKills, head); }
  feed(`<b class="${a.us ? 'us' : 'them'}">${a.name}</b> <span class="w">${w.name}${head ? ' ◎' : ''}</span> <b class="${v.us ? 'us' : 'them'}">${v.name}</b>`);
  if (v.mesh) v.dieT = 0;
  for (const u of G.units) if (!u.isPlayer && u.alive && u.team === v.team && Math.hypot(u.pos.x - v.pos.x, u.pos.z - v.pos.z) < 26 && !u.target) { u.lastSeen = { x: a.pos.x, z: a.pos.z }; u.lastSeenT = 3.5; }
  const R = G.round;
  if (R.core.carrier === v && R.core.state === 'carried') { R.core.state = 'dropped'; R.core.pos.set(v.pos.x, v.pos.y, v.pos.z); coreMesh.position.copy(R.core.pos); coreMesh.visible = true; feed('코어가 떨어졌습니다'); }
  if (v.isPlayer) { P.scoped = false; toast('쓰러졌습니다 · 아군 시점으로 봅니다 (클릭하면 다른 아군)'); }
  // 마지막 한 명 알림
  const mine = G.units.filter((u) => u.us && u.alive);
  if (mine.length === 1 && mine[0].isPlayer && G.units.some((u) => !u.us && u.alive) && !R.lastAlive) { R.lastAlive = true; banner('마지막 생존자', `1 대 ${G.units.filter((u) => !u.us && u.alive).length}`, 'warn'); }
  drawTeamBar();
  checkRoundEnd();
}
function addUlt(u, n) {
  const cost = G.ultCost(u); const before = u.ult;
  u.ult = Math.min(cost, u.ult + n);
  if (u.isPlayer && before < cost && u.ult >= cost) { sfx.ready(); toast('궁극기 준비 완료! <kbd>X</kbd>'); }
}
G.revive = (u) => {
  u.alive = true; u.hp = 100; u.dieT = null; u.blindT = 0; u.target = null; u.path = []; u.goal = null;
  if (u.mesh) { u.mesh.rotation.set(0, u.yaw, 0); }
  burst(u.pos.clone().setY(1), 0x7fe9ff, 30, 4, 1);
  feed(`<b class="${u.us ? 'us' : 'them'}">${u.name}</b> 되살아남`); drawTeamBar();
  if (u.isPlayer) { toast('되살아났습니다!'); P.camY = null; }
};
G.rocket = (u, from, at) => {
  sfx.rocket();
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xff7a1f, emissiveIntensity: 1.5 }));
  const dir = at.clone().sub(from); const len = dir.length(); dir.normalize();
  m.position.copy(from); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); scene.add(m);
  const start = performance.now(), dur = Math.max(80, len / 60 * 1000);
  (function fly() {
    const k = (performance.now() - start) / dur;
    if (k < 1 && G.running) { m.position.copy(from).addScaledVector(dir, len * k); burst(m.position, 0xffc56b, 2, 1, 0.3); requestAnimationFrame(fly); return; }
    scene.remove(m); if (!G.running) return;
    boom(at, 5.5);
    for (const e of G.units) { if (!e.alive || e.team === u.team) continue; const d = e.pos.distanceTo(at); if (d < 5.5) { const dmg = 150 * (1 - d / 5.5 * 0.7); e.hp -= dmg; hurt(u, e, dmg, { name: '로켓' }, false, null); } }
  })();
};
G.flashBurst = (at) => {
  sfx.flashPop();
  const l = new THREE.PointLight(0xffffff, 60, 30, 1.5); l.position.copy(at); scene.add(l);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  ball.position.copy(at); scene.add(ball);
  const s = performance.now(); (function f() { const k = (performance.now() - s) / 350; if (k >= 1) { scene.remove(l); scene.remove(ball); return; } l.intensity = 60 * (1 - k); ball.scale.setScalar(1 + k * 3); ball.material.opacity = 1 - k; requestAnimationFrame(f); })();
};
G.ring = (p, r, color) => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.copy(p).setY(0.3); scene.add(m);
  const s = performance.now(); (function f() { const k = (performance.now() - s) / 900; if (k >= 1) { scene.remove(m); return; } m.scale.setScalar(1 + k * r); m.material.opacity = 0.8 * (1 - k); requestAnimationFrame(f); })();
};
G.flame = (pos, r) => { const a = Math.random() * 6.28, d = Math.random() * r; burst(new THREE.Vector3(pos.x + Math.cos(a) * d, 0.2, pos.z + Math.sin(a) * d), Math.random() < 0.5 ? 0xff7a2a : 0xffc04d, 1, 1.5, 0.5); };

/* ---------- 코어 ---------- */
function progress(u, kind, f) {
  if (!u.isPlayer) return;
  const box = $('progress');
  if (!kind) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('progressText').textContent = kind === 'plant' ? '코어 설치 중…' : `코어 해체 중…${G.round.core.half ? ' (절반 완료)' : ''}`;
  $('progressBar').style.width = `${Math.min(100, f * 100)}%`;
}
G.progress = (u, kind, f) => { if (kind === 'defuse' && u.defuseT >= DEFUSE_TIME / 2) G.round.core.half = true; progress(u, kind, f); };
function plantCore(u) {
  const R = G.round;
  if (R.phase !== 'live') return;
  R.phase = 'planted'; R.t = CORE_TIME; R.core.state = 'planted'; R.core.carrier = null;
  R.core.pos.set(u.pos.x, u.pos.y, u.pos.z); coreMesh.position.copy(R.core.pos); coreMesh.visible = true;
  R.core.site = inSite(u.pos.x, u.pos.z);
  u.plantT = 0; progress(u, null, 0); addUlt(u, 1);
  for (const x of G.units) if (x.team === 'atk') x.credits = Math.min(MONEY.max, x.credits + MONEY.plant);
  feed(`<b class="${u.us ? 'us' : 'them'}">${u.name}</b>: ${R.core.site} 지점에 코어 설치!`);
  banner('코어 설치됨', `${R.core.site} 지점 · ${CORE_TIME}초`, 'core');
  sfx.coreBeep(true);
  checkRoundEnd();
}
G.plantCore = plantCore;
function defuseCore(u) {
  const R = G.round; if (R.phase !== 'planted') return;
  u.defuseT = 0; progress(u, null, 0); addUlt(u, 1);
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
  R.phase = 'end'; R.t = 6; R.winner = side;
  const weWon = side === G.ourSide;
  G.score[weWon ? 'us' : 'them']++;
  G.lossStreak[weWon ? 'them' : 'us'] = Math.min(2, G.lossStreak[weWon ? 'them' : 'us'] + (R.n === rules.half ? 0 : 1));
  G.lossStreak[weWon ? 'us' : 'them'] = 0;
  for (const u of G.units) { const won = u.team === side; u.credits = Math.min(MONEY.max, u.credits + (won ? MONEY.win : MONEY.lose[G.lossStreak[u.us ? 'us' : 'them']])); }
  progress(G.player, null, 0);
  weWon ? sfx.win() : sfx.lose();
  // 특별한 승리: 에이스 · 클러치 · 무결점
  const winners = G.units.filter((u) => u.team === side);
  let tag = '';
  const ace = G.units.find((u) => u.roundKills >= 5);
  if (ace) tag = `에이스 · ${ace.name}`;
  else if (winners.filter((u) => u.alive).length === 1 && winners.every((u) => u.alive || u.diedRound === R.n) && winners.filter((u) => u.diedRound === R.n).length >= 3) tag = `클러치 · ${winners.find((u) => u.alive).name}`;
  else if (winners.every((u) => u.alive)) tag = '무결점 승리';
  const mvp = [...G.units].sort((x, y) => (y.roundKills * 100 + y.dmgRound) - (x.roundKills * 100 + x.dmgRound))[0];
  banner(weWon ? '라운드 승리' : '라운드 패배', `${why} · MVP ${mvp.name} (${mvp.roundKills}킬)`, weWon ? 'win' : 'lose', tag);
  drawTeamBar();
}
function afterRound() {
  G.played++;
  if (G.score.us >= rules.win || G.score.them >= rules.win) return gameOver();
  let fresh = false;
  if (G.played === rules.half) {
    G.ourSide = G.ourSide === 'atk' ? 'def' : 'atk'; fresh = true;
    for (const u of G.units) { u.credits = MONEY.start; u.primary = null; u.armor = 0; u.alive = false; u.ult = Math.min(u.ult, G.ultCost(u)); }
    G.lossStreak = { us: 0, them: 0 };
  }
  newRound(fresh);
}
function gameOver() {
  G.running = false; document.exitPointerLock?.();
  clearTemp(G);
  const win = G.score.us > G.score.them;
  $('hud').classList.add('hidden'); $('buy').classList.add('hidden');
  $('endTitle').textContent = win ? '승리' : '패배';
  $('endTitle').className = win ? 'win' : 'lose';
  $('endScore').textContent = `${G.score.us} : ${G.score.them}`;
  const p = G.player; const best = [...G.units].sort((x, y) => (y.kills * 3 + y.assists) - (x.kills * 3 + x.assists))[0];
  $('endStats').innerHTML = `<div class="kda">${AGENTS[p.agent].name} · <b>${p.kills}</b> / <b>${p.deaths}</b> / <b>${p.assists}</b> <small>킬 / 데스 / 도움</small></div>경기 MVP: <b class="${best.us ? 'us' : 'them'}">${best.name}</b> (${AGENTS[best.agent].name}, ${best.kills}킬)`;
  $('end').classList.remove('hidden');
  win ? sfx.win() : sfx.lose();
}

/* ---------- 효과 ---------- */
const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.9 });
const panOf = (pos) => { const p = G.player; const want = Math.atan2(-(pos.x - p.pos.x), -(pos.z - p.pos.z)); return -Math.sin(angDiff(p.yaw, want)); };
const SOUND = { spark: 'pistol', hail: 'pistol', sting: 'smg', burst: 'smg', scatter: 'sniper', pulse: 'rifle', lancer: 'rifle', trident: 'rifle', hammer: 'rifle', pin: 'sniper', longshot: 'sniper', blades: 'pistol' };
function shotFx(u, from, to, w, wallHit, dir) {
  if (!u.isPlayer && wallHit) { dir = to.clone().sub(from).normalize(); const r = rayWorld(from, dir, 90); to = from.clone().addScaledVector(dir, r.t); wallHit = !!r.hit; }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), tracerMat.clone()); scene.add(line);
  G.fx.push({ obj: line, t: 0.06, fade: true });
  if (wallHit) impact(to, dir ? dir.clone().negate() : null);
  const kind = SOUND[w.id] || 'rifle';
  if (u.isPlayer) { shot(kind, 0, 0); curView.userData.flash.visible = true; curView.userData.flash.rotation.z = Math.random() * 3; muzzleLight.intensity = 6; G.fx.push({ obj: curView.userData.flash, t: 0.045, hide: true }); }
  else { shot(kind, Math.hypot(u.pos.x - G.player.pos.x, u.pos.z - G.player.pos.z), panOf(u.pos)); u.flashT = 0.05; }
}
G.shotFx = shotFx;
function boom(c, r) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff8a4c, transparent: true, opacity: 0.85 }));
  ball.position.copy(c); scene.add(ball);
  const light = new THREE.PointLight(0xff7a3c, 40, 60, 1.5); light.position.copy(c).y += 2; scene.add(light);
  const start = performance.now();
  (function anim() { const k = (performance.now() - start) / 1100; if (k >= 1) { scene.remove(ball); scene.remove(light); return; } ball.scale.setScalar(1 + k * r * 2.2); ball.material.opacity = 0.85 * (1 - k); light.intensity = 40 * (1 - k); requestAnimationFrame(anim); })();
  burst(c.clone().setY(1), 0xffa04c, 50, 14, 1.1); burst(c.clone().setY(1), 0x555555, 30, 7, 1.5);
  G.shake = Math.max(G.shake, Math.max(0, 1 - G.player.pos.distanceTo(c) / 40));
  sfx.boom();
}
function explode() {
  const c = G.round.core.pos;
  boom(c, 6);
  for (const u of G.units) if (u.alive && Math.hypot(u.pos.x - c.x, u.pos.z - c.z) < 13) { u.alive = false; u.hp = 0; u.dieT = 0; u.diedRound = G.round.n; }
  coreMesh.visible = false;
}

/* ---------- 팝업과 화면 표시 ---------- */
let bannerT = 0;
function banner(big, small = '', cls = '', tag = '') {
  const b = $('banner');
  b.className = `show ${cls}`;
  b.innerHTML = `${tag ? `<div class="tag">${tag}</div>` : ''}<div class="bar"><b>${big}</b></div>${small ? `<small>${small}</small>` : ''}`;
  void b.offsetWidth; b.classList.add('in'); bannerT = cls === 'win' || cls === 'lose' ? 4.5 : 2.6;
}
let toastT = 0;
function toast(html) { const t = $('toast'); t.innerHTML = html; t.classList.add('show'); toastT = 2.6; }
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
  b.innerHTML = `<div class="icons">${'<i></i>'.repeat(Math.min(5, n))}</div><b>${['', '처치', '2연속 처치', '3연속 처치', '4연속 처치', '에이스'][Math.min(5, n)]}${head ? ' · 헤드샷' : ''}</b>`;
  b.className = ''; void b.offsetWidth; b.className = 'show';
}
function hurtFlash(a, dealt) {
  $('dmg').style.opacity = Math.min(0.8, 0.25 + dealt / 80);
  const ang = -angDiff(G.player.yaw, Math.atan2(-(a.pos.x - G.player.pos.x), -(a.pos.z - G.player.pos.z)));
  $('dmgDir').style.transform = `translate(-50%,-50%) rotate(${ang}rad)`; $('dmgDir').style.opacity = 1;
}
const fmtT = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function drawTeamBar() {
  const chip = (u) => `<i class="${u.alive ? '' : 'dead'} ${u.isPlayer ? 'me' : ''}" style="--ac:${AGENTS[u.agent].color}" title="${u.name}">${AGENTS[u.agent].tag}</i>`;
  $('aliveUs').innerHTML = G.units.filter((u) => u.us).map(chip).join('');
  $('aliveThem').innerHTML = G.units.filter((u) => !u.us).map(chip).join('');
}
const ICON = {
  flash: '<path d="M12 2l2 7h7l-6 4 2 8-5-5-5 5 2-8-6-4h7z"/>', dash: '<path d="M3 12h11M10 6l6 6-6 6M17 5v14"/>', smoke: '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="11" r="6"/>',
  molly: '<path d="M12 3c2 4 6 5 6 10a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-2-1-4 0-6z"/>', slow: '<path d="M4 16c3-4 5 4 8 0s5 4 8 0M4 10c3-4 5 4 8 0s5 4 8 0"/>',
  heal: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>', wall: '<path d="M3 20V8l4-3 4 3 4-3 4 3 2-1v13z"/>', recon: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  blades: '<path d="M4 20L18 4l1 4L7 21zM9 20l12-9-1 4-9 7z"/>', smokeWall: '<circle cx="5" cy="13" r="3"/><circle cx="12" cy="12" r="4"/><circle cx="19" cy="13" r="3"/>', revealAll: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  revive: '<path d="M12 21s-8-5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 6-8 11-8 11z"/>', rocket: '<path d="M12 2c4 3 5 8 4 13H8C7 10 8 5 12 2zM8 15l-3 4h4M16 15l3 4h-4"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${ICON[k] || ''}</svg>`;
function updateHud() {
  const p = G.player, R = G.round, a = AGENTS[p.agent];
  $('scoreUs').textContent = G.score.us; $('scoreThem').textContent = G.score.them;
  $('timer').innerHTML = R.phase === 'buy' ? `<small>구매</small>${fmtT(R.t)}` : R.phase === 'planted' ? `<span class="coreIco">◆</span>${fmtT(R.t)}` : fmtT(R.t);
  $('timer').className = R.phase === 'planted' ? 'planted' : R.phase === 'buy' ? 'buy' : '';
  $('roundNo').textContent = `${R.n}라운드 · ${rules.win}승제 · ${G.ourSide === 'atk' ? '공격' : '수비'}`;
  $('hp').textContent = Math.max(0, Math.ceil(p.hp)); $('armor').textContent = Math.ceil(p.armor);
  $('hpBar').style.width = `${Math.max(0, p.hp)}%`; $('hpBar').className = p.hp < 35 ? 'low' : '';
  $('armorBar').style.width = `${p.armor * 2}%`;
  const g = p.gun; $('wname').textContent = `${g.w.name} · ${g.w.kind}`;
  $('mag').textContent = g.reloading > 0 ? '장전' : g.mag; $('mag').className = g.mag <= Math.ceil(g.w.mag * 0.25) ? 'low' : '';
  $('reserve').textContent = g.reserve;
  $('credits').textContent = `⬡ ${p.credits}`;
  // 능력 칸
  $('abil').innerHTML = ['C', 'Q', 'E'].map((k) => {
    const d = a[k], s = p.ab[k];
    const pips = Array.from({ length: d.max }, (_, i) => `<i class="${i < s.n ? 'on' : ''}"></i>`).join('');
    const rc = d.recharge && s.n < d.free ? `<em style="--p:${s.t / d.recharge}"></em>` : '';
    return `<div class="ab ${s.n ? '' : 'off'}">${rc}<div class="ic">${icon(d.kind)}</div><kbd>${k}</kbd><span>${d.name}</span><div class="pips">${pips}</div></div>`;
  }).join('') + (() => {
    const d = a.X, cost = G.ultCost(p), ready = p.ult >= cost;
    const pips = Array.from({ length: cost }, (_, i) => `<i class="${i < p.ult ? 'on' : ''}"></i>`).join('');
    return `<div class="ab ult ${ready ? 'ready' : ''}"><div class="ic">${icon(d.kind)}</div><kbd>X</kbd><span>${d.name}</span><div class="pips">${pips}</div></div>`;
  })();
  let tip = '';
  if (p.alive) {
    if (P.canPlant) tip = '<kbd>F</kbd> 길게 눌러 <b>코어 설치</b>';
    else if (P.canDefuse) tip = `<kbd>F</kbd> 길게 눌러 <b>코어 해체</b>${R.core.half ? ' (절반부터)' : ''}`;
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
  for (const b of BLOCKS) { mm.fillStyle = b.temp ? '#9fdcff' : '#8b97a8'; mm.fillRect(X(b.minX), Z(b.minZ), b.w * sx, b.d * sz); }
  const R = G.round;
  for (const a of G.areas) { mm.fillStyle = a.kind === 'molly' ? 'rgba(255,106,42,.5)' : 'rgba(150,200,80,.45)'; mm.beginPath(); mm.arc(X(a.pos.x), Z(a.pos.z), a.r * sx, 0, 7); mm.fill(); }
  if (R.core.state === 'dropped' || R.core.state === 'planted') { mm.fillStyle = '#ff5a3c'; mm.beginPath(); mm.arc(X(R.core.pos.x), Z(R.core.pos.z), 4 + (R.phase === 'planted' ? Math.abs(Math.sin(performance.now() / 200)) * 2 : 0), 0, 7); mm.fill(); }
  for (const s of G.smokes) { mm.fillStyle = 'rgba(220,225,235,.55)'; mm.beginPath(); mm.arc(X(s.pos.x), Z(s.pos.z), s.r * sx, 0, 7); mm.fill(); }
  for (const u of G.units) {
    if (!u.alive || (!u.us && u.spottedT <= 0)) continue;
    const col = u.isPlayer ? '#ffffff' : u.us ? '#4fd1c5' : '#ff6b6b';
    mm.fillStyle = col; mm.strokeStyle = col; mm.lineWidth = 1.5;
    if (u.isPlayer) { mm.globalAlpha = 0.25; mm.beginPath(); mm.moveTo(X(u.pos.x), Z(u.pos.z)); mm.arc(X(u.pos.x), Z(u.pos.z), 22, -Math.PI / 2 - u.yaw - 0.6, -Math.PI / 2 - u.yaw + 0.6); mm.fill(); mm.globalAlpha = 1; }
    mm.beginPath(); mm.arc(X(u.pos.x), Z(u.pos.z), u.isPlayer ? 4 : 3.2, 0, 7); mm.fill();
    if (R.core.carrier === u && R.core.state === 'carried' && u.us) { mm.strokeStyle = '#ff5a3c'; mm.lineWidth = 2; mm.beginPath(); mm.arc(X(u.pos.x), Z(u.pos.z), 6, 0, 7); mm.stroke(); }
  }
}

/* ---------- 점수판 ---------- */
function drawScoreboard() {
  const row = (u) => `<tr class="${u.isPlayer ? 'me' : ''} ${u.alive ? '' : 'dead'}"><td><span class="tg" style="--ac:${AGENTS[u.agent].color}">${AGENTS[u.agent].tag}</span>${u.name}</td><td>${u.kills} / ${u.deaths} / ${u.assists}</td><td>${u.us ? '⬡ ' + u.credits : ''}</td><td>${u.ult}/${G.ultCost(u)}</td><td>${u.primary ? u.primary.w.name : u.sidearm.w.name}</td></tr>`;
  const t = (list, title, cls) => `<div class="sb ${cls}"><h3>${title}</h3><table><tr><th>요원</th><th>킬/데스/도움</th><th>돈</th><th>궁극기</th><th>무기</th></tr>${list.map(row).join('')}</table></div>`;
  $('scoreboard').innerHTML = t(G.units.filter((u) => u.us), `우리 팀 · ${G.score.us}`, 'us') + t(G.units.filter((u) => !u.us), `상대 팀 · ${G.score.them}`, 'them');
}

/* ---------- 상점 ---------- */
function openBuy() { if (!G.running) return; document.exitPointerLock?.(); renderBuy(); $('buy').classList.remove('hidden'); }
function closeBuy() { $('buy').classList.add('hidden'); lockPointer(); if (G.round.phase === 'buy' && G.round.t > 3) G.round.t = 3; }
function buyWeapon(p, id) {
  const w = WEAPONS[id];
  if (w.cat === '권총') { p.sidearm = newGun(id); if (!p.primary) p.gun = p.sidearm; }
  else { p.primary = newGun(id); p.gun = p.primary; }
  p.credits -= w.price; refreshViewmodel(); sfx.buy();
}
function autoBuy() {
  const p = G.player, c = () => p.credits;
  if (!p.primary) {
    if (c() >= 3900) buyWeapon(p, 'lancer');
    else if (c() >= 2650) buyWeapon(p, 'pulse');
    else if (c() >= 2000) buyWeapon(p, 'burst');
    else if (c() >= 1200 && p.sidearm.w.id === 'spark') buyWeapon(p, 'hail');
  }
  if (p.armor < 50 && c() >= ARMOR.heavy.price + 300) { p.credits -= ARMOR.heavy.price; p.armor = 50; }
  else if (p.armor < 25 && c() >= ARMOR.light.price) { p.credits -= ARMOR.light.price; p.armor = 25; }
  const a = AGENTS[p.agent];
  for (const k of KEYS) { const d = a[k]; while (p.ab[k].n < d.max && d.price && c() >= d.price + 100) { p.ab[k].n++; p.credits -= d.price; } }
  sfx.buy();
}
function renderBuy() {
  const p = G.player, a = AGENTS[p.agent];
  const card = (id) => {
    const w = WEAPONS[id]; const own = p.primary?.w.id === id || p.sidearm.w.id === id;
    const can = !own && p.credits >= w.price;
    const stat = (v, max) => `<span class="st"><i style="width:${Math.min(100, v / max * 100)}%"></i></span>`;
    return `<button class="wcard ${own ? 'own' : ''}" data-buy="${id}" ${can ? '' : 'disabled'}><b>${w.name}</b><em>${own ? '보유' : w.price ? '⬡ ' + w.price : '기본'}</em>
      <small>피해 ${w.dmg}${w.pellets ? '×' + w.pellets : ''} · 탄창 ${w.mag}${w.auto ? ' · 연사' : ''}${w.scope ? ' · 조준경' : ''}</small>${stat(w.dmg * (w.pellets || 1) / w.rate, 600)}</button>`;
  };
  const arm = (k) => { const x = ARMOR[k]; const own = p.armor >= x.value; return `<button class="wcard ${own ? 'own' : ''}" data-armor="${k}" ${!own && p.credits >= x.price ? '' : 'disabled'}><b>${x.name}</b><em>${own ? '입음' : '⬡ ' + x.price}</em><small>피해를 ${x.value}까지 막음</small></button>`; };
  const ab = (k) => { const d = a[k], s = p.ab[k]; const full = s.n >= d.max; return `<button class="wcard ab" data-ab="${k}" ${!full && d.price && p.credits >= d.price ? '' : 'disabled'}><b><kbd>${k}</kbd> ${d.name}</b><em>${d.price ? (full ? '가득' : '⬡ ' + d.price) : '무료'}</em><small>${s.n}/${d.max}${d.free ? ` · 라운드마다 ${d.free}개 무료` : ''}</small></button>`; };
  $('buyBody').innerHTML = SHOP.map(([cat, ids]) => `<div class="cat"><h4>${cat}</h4>${ids.map(card).join('')}</div>`).join('') +
    `<div class="cat"><h4>방어구</h4>${arm('light')}${arm('heavy')}</div>
     <div class="cat"><h4>능력 · ${a.name}</h4>${['C', 'Q', 'E'].map(ab).join('')}</div>
     ${G.ourSide === 'atk' ? `<div class="cat"><h4>작전 지시</h4><div class="calls"><button data-call="A" class="${G.round.call === 'A' ? 'on' : ''}">A로 가자</button><button data-call="B" class="${G.round.call === 'B' ? 'on' : ''}">B로 가자</button></div></div>` : ''}`;
  $('buyCredits').textContent = `⬡ ${p.credits}`;
  $('buyTeam').innerHTML = G.units.filter((u) => u.us).map((u) => `<span><i style="--ac:${AGENTS[u.agent].color}">${AGENTS[u.agent].tag}</i>${u.name} <b>${u.primary ? u.primary.w.name : u.sidearm.w.name}</b> ⬡${u.credits}</span>`).join('');
}
$('buy').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const p = G.player;
  if (b.id === 'buyClose') return closeBuy();
  if (b.id === 'buyAuto') { autoBuy(); renderBuy(); updateHud(); return closeBuy(); }
  if (b.dataset.buy) buyWeapon(p, b.dataset.buy);
  else if (b.dataset.armor) { const x = ARMOR[b.dataset.armor]; p.credits -= x.price; p.armor = x.value; sfx.buy(); }
  else if (b.dataset.ab) { const d = AGENTS[p.agent][b.dataset.ab]; p.credits -= d.price; p.ab[b.dataset.ab].n++; sfx.buy(); }
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
$('toMenu').onclick = () => { pause(false); G.running = false; clearTemp(G); $('hud').classList.add('hidden'); $('buy').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('start').onclick = () => { initAudio(); applySettings(); openSelect(); };
$('again').onclick = () => { initAudio(); openSelect(); };
$('endMenu').onclick = () => { $('end').classList.add('hidden'); $('menu').classList.remove('hidden'); };
applySettings();

/* ---------- 매 프레임 ---------- */
const clock = new THREE.Clock();
let spotT = 0, hudT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (G.running && !G.paused) step(dt);
  else if (!G.running) { const t = performance.now() / 12000; camera.position.set(Math.sin(t) * 52, 30, Math.cos(t) * 42); camera.lookAt(0, 0, -4); if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); } }
  renderer.render(scene, camera);
}
function step(dt) {
  const R = G.round, p = G.player;
  R.t -= dt;
  if (R.phase === 'buy' && R.t <= 0) { R.phase = 'live'; R.t = ROUND_TIME; if (!$('buy').classList.contains('hidden')) { $('buy').classList.add('hidden'); lockPointer(); } toast('라운드 시작!'); }
  else if (R.phase === 'live' && R.t <= 0) endRound('def', '시간 종료');
  else if (R.phase === 'planted') {
    R.core.beepT -= dt;
    if (R.core.beepT <= 0) { R.core.beepT = Math.max(0.14, R.t / CORE_TIME * 1.1); sfx.coreBeep(R.t < 10); coreMesh.getObjectByName('light').intensity = 3; }
    if (R.t <= 0) { explode(); endRound('atk', '코어 폭발'); }
  } else if (R.phase === 'end' && R.t <= 0) return afterRound();
  if (R.alert) { R.alert.t -= dt; if (R.alert.t <= 0) R.alert = null; }

  // 상태 시간 줄이기 (눈부심·늪·맞음·탐지·치유·능력 충전)
  for (const u of G.units) {
    for (const k of ['blindT', 'slowT', 'tagT', 'revealT']) if (u[k] > 0) u[k] -= dt;
    if (u.healLeft > 0 && u.alive) { const h = Math.min(u.healLeft, 20 * dt, 100 - u.hp); u.hp += h; u.healLeft -= 20 * dt; if (u.hp >= 100) u.healLeft = 0; }
    if (u.alive && R.phase !== 'buy') tickCharges(u, dt);
  }
  updatePlayer(dt);
  for (const u of G.units) if (!u.isPlayer) updateBot(G, u, dt);
  updateAreas(G, dt); updateWalls(G, dt);
  if (R.core.state === 'dropped') for (const u of G.units) if (!u.isPlayer && u.alive && u.team === 'atk' && Math.hypot(u.pos.x - R.core.pos.x, u.pos.z - R.core.pos.z) < 1.3) { R.core.state = 'carried'; R.core.carrier = u; coreMesh.visible = false; break; }
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
    if (!e.us && e.alive && e.running && p.alive) { e.stepT -= dt; if (e.stepT <= 0) { e.stepT = 0.34; footstep(Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z), panOf(e.pos)); } }
  }
  for (const u of G.units) {
    if (!u.mesh) continue;
    if (u.tag) u.tag.visible = u.alive;
    if (u.revealMesh) u.revealMesh.visible = u.alive && !u.us && u.revealT > 0;
    u.mesh.position.copy(u.pos);
    if (u.alive) { u.mesh.rotation.set(0, u.yaw, 0); animateSoldier(u.mesh, dt, u.moving, u.crouch, u.flashT > 0); }
    else if (u.dieT != null && u.dieT < 1) { u.dieT += dt * 2.5; const k = Math.min(1, u.dieT); u.mesh.rotation.x = -k * Math.PI / 2; u.mesh.position.y = u.pos.y + 0.25 * k; animateSoldier(u.mesh, dt, false, false, false); }
    else if (!u.alive) { u.mesh.rotation.x = -Math.PI / 2; u.mesh.position.y = u.pos.y + 0.25; }
    if (u.flashT > 0) u.flashT -= dt;
  }
  for (const s of G.smokes) { s.t -= dt; s.mat.opacity = Math.min(0.95, (14 - s.t) * 3, s.t * 0.9); s.mesh.rotation.y += dt * 0.05; if (s.t <= 0) scene.remove(s.mesh); }
  G.smokes = G.smokes.filter((s) => s.t > 0);
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
    const camY = p.pos.y + (p.crouch ? 1.1 : 1.6) - (P.landT > 0 ? 0.08 : 0);
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
    if (allies.length) { const a = allies[P.spectate % allies.length]; const e = eyeOf(a); camera.position.set(e.x + Math.sin(a.yaw) * 2.4, e.y + 0.9, e.z + Math.cos(a.yaw) * 2.4); camera.rotation.set(-0.25, a.yaw, 0, 'YXZ'); $('specName').textContent = `${a.name} · ${AGENTS[a.agent].name}`; }
    else { camera.position.set(0, 70, 30); camera.lookAt(0, 0, -2); $('specName').textContent = '전체 보기'; }
  }
  const fovT = P.scoped ? (p.gun.w.id === 'pin' ? 40 : 26) : settings.fov;
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
  if (p.alive) document.documentElement.style.setProperty('--gap', `${4 + Math.min(40, currentSpread() * 420)}px`);
  $('blind').style.opacity = Math.min(1, Math.max(0, p.blindT) * 1.1);

  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').className = ''; }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
  const dv = $('dmg'); dv.style.opacity = Math.max(0, Number(dv.style.opacity || 0) - dt * 1.5);
  const dd = $('dmgDir'); dd.style.opacity = Math.max(0, Number(dd.style.opacity || 0) - dt * 1.2);
  hudT -= dt; if (hudT <= 0) { hudT = 0.1; updateHud(); drawMinimap(); if (!$('scoreboard').classList.contains('hidden')) drawScoreboard(); }
}
frame();
// 자동 점검용 (?test 일 때만)
if (new URLSearchParams(location.search).has('test')) window.__cs = { G, P, newGun, refreshViewmodel, startGame, step, tryFire, playerAbility, render: () => renderer.render(scene, camera), setLocked: (v) => { locked = v; } };
