// 맵 "항구 기지": 세 갈래 길(A·중앙·B), 설치 지점 A·B, 엄폐물
// 좌표: x 오른쪽, z 아래(공격 출발 +z, 수비 출발 -z), y 위. 단위 m.
import * as THREE from 'three';

export const BOUNDS = { minX: -60, maxX: 60, minZ: -46, maxZ: 46 };

// 상자: 가운데 x,z / 너비 w(x) / 깊이 d(z) / 높이 h / 색 종류 k
const B = (x, z, w, d, h, k = 'wall') => ({ x, z, w, d, h, k, minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
export const BLOCKS = [
  // 바깥 벽
  B(0, -47, 124, 2, 7, 'outer'), B(0, 47, 124, 2, 7, 'outer'), B(-61, 0, 2, 96, 7, 'outer'), B(61, 0, 2, 96, 7, 'outer'),
  // 수비 출발 구역 칸막이 (A·중앙·B 세 문)
  B(-49, -30, 22, 2, 5), B(-17, -30, 26, 2, 5), B(17, -30, 26, 2, 5), B(49, -30, 22, 2, 5),
  // 설치 지점과 가운데 마당 사이
  B(-16, -21, 2, 14, 5), B(16, -21, 2, 14, 5),
  // 아래쪽 세 갈래 길을 나누는 큰 건물
  B(-11.5, 12, 9, 36, 5, 'bldg'), B(11.5, 12, 9, 36, 5, 'bldg'),
  B(-53, 16, 14, 24, 5, 'bldg'), B(53, 16, 14, 24, 5, 'bldg'),
  B(-31, 14, 8, 12, 5, 'bldg'), B(31, 14, 8, 12, 5, 'bldg'),
  // 엄폐물 — A 지점
  B(-42, -20, 3, 3, 1.3, 'crate'), B(-30, -14, 2.5, 5, 2.4, 'crate2'), B(-50, -10, 3, 3, 1.3, 'crate'), B(-24, -24, 3, 2, 2.4, 'crate2'),
  // B 지점
  B(42, -20, 3, 3, 1.3, 'crate'), B(30, -14, 2.5, 5, 2.4, 'crate2'), B(50, -10, 3, 3, 1.3, 'crate'), B(24, -24, 3, 2, 2.4, 'crate2'),
  // 가운데 마당과 중앙 길
  B(0, -16, 4, 2, 1.3, 'crate'), B(-6, -8, 2, 2, 2.4, 'crate2'), B(5, -5, 2, 2, 1.3, 'crate'), B(2, 12, 3, 3, 1.3, 'crate'),
  // 양쪽 길과 출발 구역
  B(-40, 26, 3, 3, 1.3, 'crate'), B(40, 26, 3, 3, 1.3, 'crate'), B(-38, 2, 2, 4, 2.4, 'crate2'), B(38, 2, 2, 4, 2.4, 'crate2'),
  B(-10, 38, 3, 3, 1.3, 'crate'), B(10, 38, 3, 3, 1.3, 'crate'),
  B(-40, -38, 3, 3, 1.3, 'crate'), B(40, -38, 3, 3, 1.3, 'crate'),
];

export const SITES = { A: { x: -38, z: -17, r: 9 }, B: { x: 38, z: -17, r: 9 } };
export const SPAWNS = { atk: { x: 0, z: 40, yaw: 0 }, def: { x: 0, z: -39, yaw: Math.PI } };
export const inSite = (x, z) => { for (const k in SITES) { const s = SITES[k]; if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return k; } return null; };

/* ---------- 그리기 ---------- */
function canvasTex(draw, size = 256, rep = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const COLORS = { outer: 0x6d7b8c, wall: 0xd9cbb4, bldg: 0xb9c4cf, crate: 0xc9894a, crate2: 0x5f8f9e };

export function buildMap(scene) {
  // 바닥
  const floorTex = canvasTex((g, s) => {
    g.fillStyle = '#9aa39a'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * s / 4, 0); g.lineTo(i * s / 4, s); g.stroke(); g.beginPath(); g.moveTo(0, i * s / 4); g.lineTo(s, i * s / 4); g.stroke(); }
  }, 256, 1);
  floorTex.repeat.set(30, 23);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(124, 96), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // 설치 지점 표시
  for (const k in SITES) {
    const s = SITES[k];
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.35, s.r, 64), new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.02, s.z); scene.add(ring);
    const tex = canvasTex((g, n) => { g.clearRect(0, 0, n, n); g.fillStyle = 'rgba(255,201,77,.85)'; g.font = `bold ${n * 0.8}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, n / 2, n / 2 + n * 0.05); });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    label.rotation.x = -Math.PI / 2; label.position.set(s.x, 0.03, s.z); scene.add(label);
  }

  const mats = {};
  const wallTex = canvasTex((g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 3);
  }, 128, 1);
  const crateTex = canvasTex((g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 8; g.strokeRect(6, 6, s - 12, s - 12);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.moveTo(s - 10, 10); g.lineTo(10, s - 10); g.lineWidth = 6; g.stroke();
  }, 128, 1);
  for (const b of BLOCKS) {
    const crate = b.k.startsWith('crate');
    const key = b.k;
    mats[key] ||= new THREE.MeshStandardMaterial({ color: COLORS[key], map: crate ? crateTex : wallTex, roughness: 0.85 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mats[key]);
    m.position.set(b.x, b.h / 2, b.z); m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    // 높은 벽 위 띠
    if (b.h >= 5 && b.k !== 'outer') {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.1, 0.25, b.d + 0.1), new THREE.MeshStandardMaterial({ color: 0x3d4a5c }));
      trim.position.set(b.x, b.h - 0.12, b.z); scene.add(trim);
    }
  }
}

/* ---------- 부딪힘 ---------- */
const STEP = 0.35;
// 발 높이 feetY에서 서 있을 바닥 높이
export function groundAt(x, z, r, feetY) {
  let g = 0;
  for (const b of BLOCKS) {
    if (feetY < b.h - STEP) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < (r * 0.7) ** 2 && b.h > g) g = b.h;
  }
  return g;
}
// 원(반지름 r)을 상자 밖으로 밀어낸다
export function collide(p, r, feetY) {
  for (const b of BLOCKS) {
    if (feetY >= b.h - STEP) continue;
    const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
    let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
    else { // 상자 안에 들어가 있으면 가장 가까운 면으로
      const opts = [[b.minX - r - p.x, 0], [b.maxX + r - p.x, 0], [0, b.minZ - r - p.z], [0, b.maxZ + r - p.z]];
      opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
      p.x += opts[0][0]; p.z += opts[0][1];
    }
  }
  p.x = Math.max(BOUNDS.minX + r, Math.min(BOUNDS.maxX - r, p.x));
  p.z = Math.max(BOUNDS.minZ + r, Math.min(BOUNDS.maxZ - r, p.z));
}

// 3D 반직선과 상자·바닥의 가장 가까운 만남 (t는 거리)
export function rayWorld(o, d, maxT = 200) {
  let best = maxT, hit = null;
  if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < best) { best = t; hit = 'floor'; } }
  for (const b of BLOCKS) {
    let t0 = 0, t1 = best;
    const ax = [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, 0, b.h], [o.z, d.z, b.minZ, b.maxZ]];
    let ok = true;
    for (const [oo, dd, mn, mx] of ax) {
      if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) { ok = false; break; } continue; }
      let a = (mn - oo) / dd, c = (mx - oo) / dd; if (a > c) [a, c] = [c, a];
      if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 > 0 && t0 < best) { best = t0; hit = b; }
  }
  return { t: best, hit };
}

// 두 점 사이 시야가 트였는가 (벽·연막)
export function lineClear(a, b, smokes = []) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); d.divideScalar(len);
  if (rayWorld(a, d, len).hit) return false;
  for (const s of smokes) { if (segSphere(a, d, len, s.pos, s.r)) return false; }
  return true;
}
function segSphere(o, d, len, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const bq = ox * d.x + oy * d.y + oz * d.z, cq = ox * ox + oy * oy + oz * oz - r * r;
  if (cq < 0) return true; // 연막 안
  const disc = bq * bq - cq; if (disc < 0) return false;
  const t = -bq - Math.sqrt(disc); return t > 0 && t < len;
}

/* ---------- 길 찾기 (자동 격자) ---------- */
function seg2DClear(ax, az, bx, bz, pad) {
  for (const b of BLOCKS) {
    const mnX = b.minX - pad, mxX = b.maxX + pad, mnZ = b.minZ - pad, mxZ = b.maxZ + pad;
    let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az; let ok = true;
    for (const [o, dd, mn, mx] of [[ax, dx, mnX, mxX], [az, dz, mnZ, mxZ]]) {
      if (Math.abs(dd) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } continue; }
      let a = (mn - o) / dd, c = (mx - o) / dd; if (a > c) [a, c] = [c, a];
      if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) { ok = false; break; }
    }
    if (ok) return false;
  }
  return true;
}
export const walkClear = (ax, az, bx, bz) => seg2DClear(ax, az, bx, bz, 0.55);
const NODES = [];
(function buildNav() {
  const inside = (x, z, pad) => BLOCKS.some((b) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad);
  for (let x = -57; x <= 57; x += 3) for (let z = -43; z <= 43; z += 3) if (!inside(x, z, 0.9)) NODES.push({ x, z, n: [] });
  for (let i = 0; i < NODES.length; i++) for (let j = i + 1; j < NODES.length; j++) {
    const a = NODES[i], b = NODES[j]; const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < 4.4 && seg2DClear(a.x, a.z, b.x, b.z, 0.7)) { a.n.push([j, d]); b.n.push([i, d]); }
  }
})();
function nearestNode(x, z) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < NODES.length; i++) { const n = NODES[i]; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd && (d < 1 || seg2DClear(x, z, n.x, n.z, 0.4))) { bd = d; best = i; } }
  if (best < 0) for (let i = 0; i < NODES.length; i++) { const n = NODES[i]; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
// A* → [{x,z}, …] (끝점 포함)
export function findPath(fx, fz, tx, tz) {
  const s = nearestNode(fx, fz), g = nearestNode(tx, tz);
  if (s < 0 || g < 0) return [{ x: tx, z: tz }];
  const open = new Set([s]), came = new Map(), gs = new Map([[s, 0]]), fs = new Map([[s, 0]]);
  const h = (i) => Math.hypot(NODES[i].x - NODES[g].x, NODES[i].z - NODES[g].z);
  fs.set(s, h(s));
  while (open.size) {
    let cur = -1, bf = 1e9; for (const i of open) { const f = fs.get(i); if (f < bf) { bf = f; cur = i; } }
    if (cur === g) break;
    open.delete(cur);
    for (const [nb, d] of NODES[cur].n) {
      const ng = gs.get(cur) + d;
      if (ng < (gs.get(nb) ?? 1e9)) { came.set(nb, cur); gs.set(nb, ng); fs.set(nb, ng + h(nb)); open.add(nb); }
    }
  }
  const path = [{ x: tx, z: tz }]; let c = g;
  if (!came.has(g) && g !== s) return path;
  while (c !== s) { path.unshift({ x: NODES[c].x, z: NODES[c].z }); c = came.get(c); }
  return path;
}
// 걸어갈 수 있는 임의의 점 (중심 근처)
export function randomNear(x, z, r) {
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * r;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (!BLOCKS.some((b) => px > b.minX - 0.8 && px < b.maxX + 0.8 && pz > b.minZ - 0.8 && pz < b.maxZ + 0.8)) return { x: px, z: pz };
  }
  return { x, z };
}
