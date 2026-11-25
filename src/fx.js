// 튀는 불꽃·먼지·피격 효과 (작은 조각을 미리 만들어 돌려 쓴다)
import * as THREE from 'three';

const POOL = 260;
let scene = null; const parts = [];
const geo = new THREE.BoxGeometry(1, 1, 1);
export function initFx(s) {
  scene = s;
  for (let i = 0; i < POOL; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    m.visible = false; m.frustumCulled = false; scene.add(m);
    parts.push({ m, v: new THREE.Vector3(), t: 0, life: 1, g: 0, s0: 0.05 });
  }
}
let next = 0;
function spawn(pos, vel, color, size, life, grav) {
  const p = parts[next]; next = (next + 1) % POOL;
  p.m.position.copy(pos); p.v.copy(vel); p.t = life; p.life = life; p.g = grav; p.s0 = size;
  p.m.material.color.setHex(color); p.m.material.opacity = 1; p.m.scale.setScalar(size); p.m.visible = true;
}
const rnd = (k) => (Math.random() - 0.5) * k;
// 벽에 맞은 자리: 불꽃 + 먼지
export function impact(pos, normal) {
  const n = normal || new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 6; i++) spawn(pos, new THREE.Vector3(n.x * 3 + rnd(4), n.y * 3 + Math.random() * 3, n.z * 3 + rnd(4)), 0xffd27a, 0.03, 0.25, 12);
  for (let i = 0; i < 3; i++) spawn(pos, new THREE.Vector3(n.x * 0.8 + rnd(0.6), 0.6 + Math.random() * 0.5, n.z * 0.8 + rnd(0.6)), 0x9c958a, 0.09, 0.6, -0.5);
}
// 사람에 맞은 자리: 팀 색 조각 (잔인하지 않게)
export function hitPuff(pos, color, head) {
  for (let i = 0; i < (head ? 12 : 7); i++) spawn(pos, new THREE.Vector3(rnd(3), Math.random() * 2.5, rnd(3)), head ? 0xffffff : color, head ? 0.05 : 0.04, 0.35, 8);
}
export function burst(pos, color, n = 30, speed = 8, life = 0.8) {
  for (let i = 0; i < n; i++) spawn(pos, new THREE.Vector3(rnd(speed), Math.random() * speed * 0.7, rnd(speed)), color, 0.08 + Math.random() * 0.1, life, 6);
}
export function updateFx(dt) {
  for (const p of parts) {
    if (!p.m.visible) continue;
    p.t -= dt; if (p.t <= 0) { p.m.visible = false; continue; }
    p.v.y -= p.g * dt; p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.02) { p.m.position.y = 0.02; p.v.multiplyScalar(0.3); }
    const k = p.t / p.life; p.m.material.opacity = k; p.m.scale.setScalar(p.s0 * (p.g < 0 ? 2 - k : 0.6 + k * 0.4));
  }
}
