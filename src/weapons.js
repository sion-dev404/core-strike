// 무기·장비 (모두 게임 안의 돈으로만 산다 — 결제 없음)
// spread: 서서 첫 발 퍼짐, run: 뛰면서 더해지는 퍼짐, pattern: 연사할 때 튀는 모양 [옆, 위] (라디안)
const rise = (n, up, side = 0) => Array.from({ length: n }, (_, i) => [Math.sin(i * 0.9) * side * Math.min(1, i / 6), up * Math.min(i, 8) + up * 0.3 * Math.max(0, i - 8)]);
export const WEAPONS = {
  spark:    { id: 'spark',    name: '스파크',   kind: '권총',     cat: '권총',     price: 0,    dmg: 26,  head: 3,   rate: 0.2,   mag: 12, reserve: 36, reload: 1.6, spread: 0.004, run: 0.04,  kick: 0.012, auto: false, color: 0x5c6470, pattern: rise(12, 0.004) },
  hail:     { id: 'hail',     name: '헤일',     kind: '대구경 권총', cat: '권총',  price: 800,  dmg: 40,  head: 4,   rate: 0.35,  mag: 6,  reserve: 24, reload: 2.2, spread: 0.002, run: 0.06,  kick: 0.03,  auto: false, color: 0x8a6d3b, pattern: rise(6, 0.012) },
  sting:    { id: 'sting',    name: '스팅',     kind: '기관단총', cat: '기관단총', price: 950,  dmg: 22,  head: 2.5, rate: 0.06,  mag: 20, reserve: 60, reload: 2.2, spread: 0.012, run: 0.02,  kick: 0.005, auto: true,  color: 0x6b6f9e, pattern: rise(20, 0.0035, 0.004) },
  burst:    { id: 'burst',    name: '버스트',   kind: '기관단총', cat: '기관단총', price: 1600, dmg: 26,  head: 2.5, rate: 0.075, mag: 30, reserve: 90, reload: 2.2, spread: 0.008, run: 0.025, kick: 0.005, auto: true,  color: 0x2f7d6d, pattern: rise(30, 0.003, 0.005) },
  scatter:  { id: 'scatter',  name: '스캐터',   kind: '산탄총',   cat: '산탄총',   price: 1850, dmg: 14,  head: 2,   rate: 0.9,   mag: 5,  reserve: 15, reload: 2.6, spread: 0.06,  run: 0.02,  kick: 0.05,  auto: false, color: 0x7a4b2e, pellets: 12, pattern: rise(5, 0.02) },
  pulse:    { id: 'pulse',    name: '펄스',     kind: '반자동 소총', cat: '소총',  price: 2250, dmg: 35,  head: 3.5, rate: 0.18,  mag: 20, reserve: 60, reload: 2.4, spread: 0.002, run: 0.08,  kick: 0.012, auto: false, color: 0x5a7a3a, pattern: rise(20, 0.004) },
  lancer:   { id: 'lancer',   name: '랜서',     kind: '소총',     cat: '소총',     price: 2900, dmg: 39,  head: 4,   rate: 0.1,   mag: 25, reserve: 75, reload: 2.4, spread: 0.0025, run: 0.1,  kick: 0.007, auto: true,  color: 0x8a5a2b, pattern: rise(25, 0.0045, 0.012) },
  trident:  { id: 'trident',  name: '트라이던트', kind: '소총',   cat: '소총',     price: 2950, dmg: 40,  head: 4,   rate: 0.092, mag: 30, reserve: 90, reload: 2.5, spread: 0.0035, run: 0.1,  kick: 0.008, auto: true,  color: 0x4b5f8a, pattern: rise(30, 0.0055, 0.006) },
  hammer:   { id: 'hammer',   name: '해머',     kind: '기관총',   cat: '기관총',   price: 3200, dmg: 34,  head: 3,   rate: 0.08,  mag: 50, reserve: 100, reload: 4.2, spread: 0.01, run: 0.12,  kick: 0.006, auto: true,  color: 0x55595e, pattern: rise(50, 0.003, 0.01) },
  pin:      { id: 'pin',      name: '핀',       kind: '경저격총', cat: '저격총',   price: 1100, dmg: 75,  head: 2,   rate: 0.75,  mag: 5,  reserve: 15, reload: 2.8, spread: 0.0015, run: 0.12, kick: 0.035, auto: false, color: 0x3d6b6b, scope: true, pattern: rise(5, 0.02) },
  longshot: { id: 'longshot', name: '롱샷',     kind: '저격총',   cat: '저격총',   price: 4700, dmg: 150, head: 1.7, rate: 1.4,   mag: 5,  reserve: 10, reload: 3.4, spread: 0.001, run: 0.16,  kick: 0.05,  auto: false, color: 0x3b4a6b, scope: true, pattern: rise(5, 0.03) },
  // 궁극기 전용 (상점에 없음)
  blades:   { id: 'blades',   name: '폭풍 칼날', kind: '궁극기',  cat: '궁극기',   price: 0,    dmg: 50,  head: 3,   rate: 0.3,   mag: 5,  reserve: 0,  reload: 99,  spread: 0,     run: 0,     kick: 0.004, auto: false, color: 0xc7d2ff, pattern: rise(5, 0) },
};
export const SHOP = [['권총', ['spark', 'hail']], ['기관단총', ['sting', 'burst']], ['산탄총', ['scatter']], ['소총', ['pulse', 'lancer', 'trident']], ['저격총', ['pin', 'longshot']], ['기관총', ['hammer']]];
export const ARMOR = { light: { name: '가벼운 방어구', price: 400, value: 25 }, heavy: { name: '무거운 방어구', price: 1000, value: 50 } };
export const MONEY = { start: 800, win: 3000, lose: [1900, 2400, 2900], kill: 200, plant: 300, max: 9000 };

export function newGun(id) { const w = WEAPONS[id]; return { w, mag: w.mag, reserve: w.reserve, cool: 0, reloading: 0, heat: 0, spray: 0, sprayT: 0 }; }
export const isSidearm = (id) => WEAPONS[id].cat === '권총';

// 맞힌 곳에 따라 피해, 방어구가 2/3까지 막는다 (다리는 덜 아프다)
export function applyDamage(target, w, part) {
  let dmg = w.dmg * (part === 'head' ? w.head : part === 'leg' ? 0.85 : 1);
  if (target.armor > 0) { const take = Math.min(target.armor, dmg * 0.66); target.armor -= take; dmg -= take; }
  target.hp -= dmg;
  return dmg;
}
