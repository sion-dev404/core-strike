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
  // 중앙 길 끝을 막아 출발하자마자 저격당하지 않게
  B(0, 24, 6, 1.6, 5, 'wall'), B(0, -35.5, 6, 1.6, 5, 'wall'),
  B(-40, -38, 3, 3, 1.3, 'crate'), B(40, -38, 3, 3, 1.3, 'crate'),
];

export const SITES = { A: { x: -38, z: -17, r: 9 }, B: { x: 38, z: -17, r: 9 } };
export const SPAWNS = { atk: { x: 0, z: 40, yaw: 0 }, def: { x: 0, z: -39, yaw: Math.PI } };
export const inSite = (x, z) => { for (const k in SITES) { const s = SITES[k]; if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return k; } return null; };

/* ---------- 그리기 ---------- */
function canvasTex(draw, w = 256, h = w) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
// 잔무늬(콘크리트 느낌)
function grain(g, w, h, base, amount, n = 2500) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const v = Math.random() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * amount})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
}
// 상자 크기에 맞춰 무늬 반복 (늘어나 보이지 않게)
function boxGeo(w, h, d, unit = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / unit, uv.getY(k) * dims[f][1] / unit); }
  return g;
}

const TEX = {};
function textures() {
  if (TEX.floor) return TEX;
  TEX.floor = canvasTex((g, w) => {
    grain(g, w, w, '#a9ada3', 0.08, 5000);
    g.strokeStyle = 'rgba(40,40,40,.25)'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, w - 2);
    g.fillStyle = 'rgba(0,0,0,.05)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * w, 10 + Math.random() * 30, 0, 7); g.fill(); }
  }, 256);
  TEX.wall = canvasTex((g, w, h) => {
    grain(g, w, h, '#ffffff', 0.07, 3000);
    g.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
    for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
  }, 256);
  TEX.metal = canvasTex((g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, 'rgba(0,0,0,.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(0,0,0,.18)'); g.fillStyle = gr; g.fillRect(x, 0, 16, h); }
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
  }, 128);
  TEX.wood = canvasTex((g, w) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, w);
    for (let y = 0; y < w; y += 32) { g.fillStyle = `rgba(90,50,20,${0.08 + Math.random() * 0.1})`; g.fillRect(0, y, w, 30); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y + 30, w, 2); }
    g.strokeStyle = 'rgba(60,30,10,.45)'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, w - 10);
    g.lineWidth = 8; g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, w - 10); g.stroke();
  }, 128);
  TEX.hazard = canvasTex((g, w) => {
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, w); g.fillStyle = '#2a2a2a';
    for (let i = -w; i < w * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - w, w); g.lineTo(i - w, w); g.fill(); }
  }, 64);
  return TEX;
}
const PAINT = { outer: 0x7d8a99, wall: 0xe2d6c1, bldg: [0x5f8fb0, 0xb5654a, 0x6f9a6b, 0xc9a24b], crate: 0xd09a5c, crate2: 0x4f7f92 };

function sign(text, w = 3, h = 1.1, bg = '#1f2a37', fg = '#ffc94d') {
  const t = canvasTex((g, cw, ch) => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch); g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, cw - 12, ch - 12);
    g.fillStyle = fg; g.font = `bold ${ch * 0.55}px "Malgun Gothic", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, ch / 2 + 4);
  }, 384, Math.round(384 * h / w));
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0x222222, emissiveMap: t }));
}

export function buildMap(scene) {
  const T = textures();
  // 하늘
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x3d8ed8) }, mid: { value: new THREE.Color(0xa9d6f5) }, low: { value: new THREE.Color(0xe9eef0) } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 p; void main(){ float h = p.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : low; gl_FragColor = vec4(c, 1.0); }',
  }));
  sky.renderOrder = -1; scene.add(sky);
  // 해
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }));
  sunDisc.position.set(-160, 260, 110); scene.add(sunDisc);

  // 바닥: 콘크리트 판
  const ft = T.floor.clone(); ft.needsUpdate = true; ft.repeat.set(31, 24);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(124, 96), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // 설치 지점: 칠한 바닥 + 글자
  for (const k in SITES) {
    const s = SITES[k];
    const pad = new THREE.Mesh(new THREE.CircleGeometry(s.r, 48), new THREE.MeshStandardMaterial({ color: 0xffc94d, transparent: true, opacity: 0.12, roughness: 1 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(s.x, 0.015, s.z); scene.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.4, s.r, 64), new THREE.MeshBasicMaterial({ map: T.hazard, transparent: true }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.02, s.z); scene.add(ring);
    const tex = canvasTex((g, n) => { g.clearRect(0, 0, n, n); g.fillStyle = 'rgba(255,201,77,.9)'; g.font = `bold ${n * 0.78}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, n / 2, n / 2 + n * 0.05); });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    label.rotation.x = -Math.PI / 2; label.position.set(s.x, 0.03, s.z); scene.add(label);
  }
  // 출발 구역 표시 줄
  for (const z of [33.5, -32.5]) {
    const st = T.hazard.clone(); st.needsUpdate = true; st.repeat.set(60, 1);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(120, 0.6), new THREE.MeshBasicMaterial({ map: st }));
    strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.02, z); scene.add(strip);
  }

  // 벽·건물·상자
  let bi = 0;
  for (const b of BLOCKS) {
    let mat;
    if (b.k === 'bldg') mat = new THREE.MeshStandardMaterial({ color: PAINT.bldg[bi++ % 4], map: T.metal, roughness: 0.55, metalness: 0.25 });
    else if (b.k === 'crate') mat = new THREE.MeshStandardMaterial({ color: PAINT.crate, map: T.wood, roughness: 0.85 });
    else if (b.k === 'crate2') mat = new THREE.MeshStandardMaterial({ color: PAINT.crate2, map: T.metal, roughness: 0.5, metalness: 0.35 });
    else mat = new THREE.MeshStandardMaterial({ color: PAINT[b.k], map: T.wall, roughness: 0.9 });
    const unit = b.k.startsWith('crate') ? Math.min(b.w, b.d, b.h) : b.k === 'bldg' ? 3 : 4;
    const m = new THREE.Mesh(boxGeo(b.w, b.h, b.d, unit), mat);
    m.position.set(b.x, b.h / 2, b.z); m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    if (b.h >= 5) { // 위 덮개와 아래 띠
      const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.16, 0.22, b.d + 0.16), new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.6 }));
      cap.position.set(b.x, b.h + 0.1, b.z); cap.castShadow = true; scene.add(cap);
      const base = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.06, 0.35, b.d + 0.06), new THREE.MeshStandardMaterial({ color: 0x4a525d, roughness: 0.9 }));
      base.position.set(b.x, 0.175, b.z); base.receiveShadow = true; scene.add(base);
    }
  }

  // 길 안내 표지판 (어디로 가야 할지 바로 보이게)
  const signs = [
    ['← A 지점', -11.5, 30.05, 0, 3.2], ['B 지점 →', 11.5, 30.05, 0, 3.2], ['↑ 중앙', -6.94, 24, Math.PI / 2, 2.6], ['↑ 중앙', 6.94, 24, -Math.PI / 2, 2.6],
    ['A ↑', -31, 20.05, 0, 2.2], ['B ↑', 31, 20.05, 0, 2.2],
    ['← A', -14.94, -20, Math.PI / 2, 2], ['B →', 14.94, -20, -Math.PI / 2, 2],
    ['A 지점 ↓', -49, -31.05, Math.PI, 3.2], ['B 지점 ↓', 49, -31.05, Math.PI, 3.2], ['중앙 ↓', -17, -31.05, Math.PI, 2.8],
  ];
  for (const [text, x, z, ry, w] of signs) { const s = sign(text, w, w * 0.34); s.position.set(x, 3, z); s.rotation.y = ry; scene.add(s); }

  // 가로등 (장식)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3742, roughness: 0.5, metalness: 0.5 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: 1.6 });
  for (const [x, z] of [[-58.6, -10], [58.6, -10], [-58.6, 36], [58.6, 36], [0, 44.6], [-24, -44.6], [24, -44.6]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.2, 8), poleMat); pole.position.set(x, 2.6, z); pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.9), poleMat); arm.position.set(x, 5.1, z + (z > 40 ? -0.45 : z < -40 ? 0.45 : 0));
    if (Math.abs(x) > 50) { arm.rotation.y = Math.PI / 2; arm.position.set(x + (x < 0 ? 0.45 : -0.45), 5.1, z); }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), bulbMat); bulb.position.copy(arm.position); bulb.position.y -= 0.12;
    if (Math.abs(x) > 50) bulb.position.x += x < 0 ? 0.4 : -0.4; else bulb.position.z += z > 0 ? -0.4 : 0.4;
    scene.add(pole, arm, bulb);
  }
  // 벽에 붙은 배관 (장식)
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x7c8a96, roughness: 0.4, metalness: 0.6 });
  for (const x of [-59.7, 59.7]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 90, 10), pipeMat); p.rotation.x = Math.PI / 2; p.position.set(x, 4.2, 0); scene.add(p); }
  for (const z of [-45.7, 45.7]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 118, 10), pipeMat); p.rotation.z = Math.PI / 2; p.position.set(0, 4.2, z); scene.add(p); }
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
