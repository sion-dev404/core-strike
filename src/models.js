// 사람 모양 요원과 무기 모델 (모두 도형으로 직접 만든 원작)
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });

/* ---------- 요원 ---------- */
// 맞힘 판정과 같은 높이: 머리 가운데 1.62(앉으면 1.12), 몸통 0~1.42
export function makeSoldier(team, teamColor) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body); // 앉으면 이 묶음이 내려간다
  const suit = std(0x30394a), vest = std(teamColor, { roughness: 0.45 }), skin = std(0xe9bf98, { roughness: 0.8 });
  const dark = std(0x1d222b), glow = new THREE.MeshStandardMaterial({ color: team === 'atk' ? 0xffb347 : 0x5ef2e0, emissive: team === 'atk' ? 0xff8a1f : 0x22d3c0, emissiveIntensity: 1.4 });

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.26), suit); hips.position.y = 0.92;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.3), suit); torso.position.y = 1.24;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 0.34), vest); plate.position.y = 1.26;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.14), dark); pack.position.set(0, 1.26, 0.22);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), skin); neck.position.y = 1.53;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), skin); head.position.y = 1.64;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), vest); helmet.position.y = 1.66;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.1), glow); visor.position.set(0, 1.66, -0.16);
  body.add(hips, torso, plate, pack, neck, head, helmet, visor);

  const limb = (len, r, mat) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat); m.position.y = -len / 2 - r * 0.5; g.add(m); return g; };
  const legL = limb(0.36, 0.09, suit), legR = limb(0.36, 0.09, suit);
  legL.position.set(-0.12, 0.88, 0); legR.position.set(0.12, 0.88, 0);
  const shinL = limb(0.34, 0.08, dark), shinR = limb(0.34, 0.08, dark);
  shinL.position.y = -0.46; shinR.position.y = -0.46; legL.add(shinL); legR.add(shinR);
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.24), dark), bootR = bootL.clone();
  bootL.position.set(0, -0.44, -0.04); bootR.position.set(0, -0.44, -0.04); shinL.add(bootL); shinR.add(bootR);
  body.add(legL, legR);

  // 팔은 총을 앞으로 들고 있다
  const armR = limb(0.26, 0.075, vest), armL = limb(0.26, 0.075, vest);
  armR.position.set(0.3, 1.44, 0); armL.position.set(-0.3, 1.44, 0);
  armR.rotation.set(-1.2, 0, 0.15); armL.rotation.set(-1.25, 0, -0.55);
  body.add(armR, armL);
  const gun = new THREE.Group(); gun.name = 'gun';
  const gb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.62), std(0x262b33, { metalness: 0.4 })); gb.position.z = -0.1;
  const gm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), dark); gm.position.set(0, -0.1, -0.12);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a })); muzzle.position.z = -0.46; muzzle.visible = false; muzzle.name = 'muzzle';
  gun.add(gb, gm, muzzle); gun.position.set(0.16, 1.28, -0.38);
  body.add(gun);

  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  muzzle.castShadow = false;
  root.userData = { body, legL, legR, shinL, shinR, armL, armR, gun, muzzle, vest, glow, phase: 0 };
  return root;
}

export function setSoldierTeam(root, teamColor, team) {
  const u = root.userData; u.vest.color.setHex(teamColor);
  u.glow.color.setHex(team === 'atk' ? 0xffb347 : 0x5ef2e0); u.glow.emissive.setHex(team === 'atk' ? 0xff8a1f : 0x22d3c0);
}

// 걷기·앉기 움직임
export function animateSoldier(root, dt, moving, crouch, flashOn) {
  const u = root.userData;
  u.phase += dt * (moving ? 9 : 0);
  const s = moving ? Math.sin(u.phase) : 0;
  const target = crouch ? -0.45 : 0;
  u.body.position.y += (target - u.body.position.y) * Math.min(1, dt * 12);
  const bend = crouch ? 1 : 0;
  u.legL.rotation.x = s * 0.6 - bend * 0.9; u.legR.rotation.x = -s * 0.6 - bend * 0.9;
  u.shinL.rotation.x = Math.max(0, -s) * 0.7 + bend * 1.6; u.shinR.rotation.x = Math.max(0, s) * 0.7 + bend * 1.6;
  u.body.rotation.z = moving ? Math.sin(u.phase * 0.5) * 0.02 : 0;
  u.muzzle.visible = !!flashOn;
}

/* ---------- 손에 든 총 (1인칭) ---------- */
const vm = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, depthTest: false, ...o });
const SHAPE = { spark: 'spark', hail: 'spark', sting: 'burst', burst: 'burst', scatter: 'lancer', pulse: 'lancer', lancer: 'lancer', trident: 'lancer', hammer: 'lancer', pin: 'longshot', longshot: 'longshot', blades: 'blades' };
export function makeViewGun(wid, sleeveColor, accentColor = 0xff7a45) {
  const id = SHAPE[wid] || 'lancer';
  const g = new THREE.Group();
  const metal = vm(0x2b3038), metal2 = vm(0x434a55), accent = vm(accentColor), skin = vm(0xe9bf98, { metalness: 0 }), sleeve = vm(sleeveColor, { metalness: 0 });
  const box = (w, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; g.add(b); return b; };
  const cyl = (r, l, m, x, y, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); g.add(c); return c; };
  let muzzleZ = -0.5;
  if (id === 'spark') {
    box(0.06, 0.07, 0.26, metal2, 0, 0.03, -0.12); box(0.055, 0.03, 0.24, accent, 0, 0.075, -0.12);
    box(0.05, 0.13, 0.07, metal, 0, -0.06, 0.0, 0.25); cyl(0.012, 0.04, metal, 0, 0.035, -0.27); muzzleZ = -0.3;
  } else if (id === 'burst') {
    box(0.07, 0.1, 0.36, metal, 0, 0.02, -0.15); box(0.072, 0.03, 0.3, accent, 0, 0.08, -0.14);
    box(0.045, 0.18, 0.06, metal2, 0, -0.1, -0.2, 0.15); box(0.05, 0.12, 0.06, metal, 0, -0.08, 0.0, 0.3);
    cyl(0.018, 0.14, metal2, 0, 0.03, -0.4); box(0.04, 0.05, 0.16, metal2, 0, 0.0, 0.1); muzzleZ = -0.48;
  } else if (id === 'lancer') {
    box(0.07, 0.11, 0.5, metal, 0, 0.02, -0.2); box(0.075, 0.05, 0.3, accent, 0, -0.01, -0.36);
    box(0.05, 0.2, 0.08, metal2, 0, -0.12, -0.12, 0.35); box(0.05, 0.12, 0.06, metal, 0, -0.08, 0.04, 0.3);
    box(0.06, 0.1, 0.22, accent, 0, 0.0, 0.16); cyl(0.02, 0.26, metal2, 0, 0.03, -0.58); box(0.03, 0.04, 0.12, metal2, 0, 0.095, -0.1);
    muzzleZ = -0.72;
  } else if (id === 'blades') {
    const glow = vm(0xc7d2ff, { emissive: 0x7f95ff, emissiveIntensity: 1.2 });
    for (let i = 0; i < 3; i++) { const k = box(0.012, 0.05 - i * 0.008, 0.26, glow, -0.03 + i * 0.03, 0.02 + i * 0.01, -0.12 - i * 0.02); k.rotation.y = (i - 1) * 0.15; }
    box(0.04, 0.06, 0.08, metal, 0, -0.02, 0.02); muzzleZ = -0.28;
  } else { // longshot
    box(0.075, 0.12, 0.58, metal, 0, 0.02, -0.22); box(0.08, 0.06, 0.24, accent, 0, -0.02, -0.38);
    box(0.06, 0.13, 0.08, metal, 0, -0.09, 0.03, 0.3); box(0.07, 0.12, 0.28, accent, 0, 0.0, 0.2);
    cyl(0.022, 0.42, metal2, 0, 0.03, -0.72); cyl(0.045, 0.3, metal2, 0, 0.125, -0.12); cyl(0.05, 0.03, accent, 0, 0.125, -0.28);
    box(0.04, 0.16, 0.05, metal2, 0, -0.08, -0.18, 0.1); muzzleZ = -0.95;
  }
  // 손과 소매
  box(0.07, 0.07, 0.09, skin, 0.0, -0.06, 0.02, 0.3);
  const arm = box(0.08, 0.08, 0.26, sleeve, 0.03, -0.13, 0.16, 0.55);
  if (id !== 'spark') { box(0.07, 0.06, 0.09, skin, -0.01, -0.03, -0.3, 0.1); const arm2 = box(0.075, 0.075, 0.3, sleeve, -0.1, -0.1, -0.12, 0.3); arm2.rotation.y = 0.6; }
  else { box(0.07, 0.07, 0.08, skin, -0.035, -0.07, 0.0, 0.3); }
  const flash = new THREE.Group(); flash.position.set(0, 0.03, muzzleZ); flash.visible = false;
  const fm = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.95, depthTest: false });
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), fm); p.rotation.x = -Math.PI / 2; p.rotation.z = i * 1.05; flash.add(p); }
  g.add(flash);
  g.traverse((m) => { m.renderOrder = 10; });
  g.userData = { flash, muzzleZ };
  return g;
}
