// 무기·장비 (모두 게임 안의 돈으로만 산다 — 결제 없음)
export const WEAPONS = {
  spark:    { id: 'spark',    name: '스파크', kind: '권총',     price: 0,    dmg: 26,  head: 3,   rate: 0.2,   mag: 12, reserve: 36, reload: 1.4, spread: 0.004, move: 0.03, kick: 0.014, auto: false, slot: 2, color: 0x5c6470 },
  burst:    { id: 'burst',    name: '버스트', kind: '기관단총', price: 1600, dmg: 24,  head: 2.5, rate: 0.075, mag: 25, reserve: 75, reload: 2.0, spread: 0.012, move: 0.018, kick: 0.006, auto: true,  slot: 1, color: 0x2f7d6d },
  lancer:   { id: 'lancer',   name: '랜서',   kind: '소총',     price: 2900, dmg: 38,  head: 4,   rate: 0.105, mag: 25, reserve: 75, reload: 2.2, spread: 0.002, move: 0.06,  kick: 0.009, auto: true,  slot: 1, color: 0x8a5a2b },
  longshot: { id: 'longshot', name: '롱샷',   kind: '저격총',   price: 4500, dmg: 140, head: 1.8, rate: 1.3,   mag: 5,  reserve: 15, reload: 3.0, spread: 0.0015, move: 0.12, kick: 0.05,  auto: false, slot: 1, color: 0x3b4a6b, scope: true },
};
export const ARMOR = { light: { name: '가벼운 방어구', price: 400, value: 25 }, heavy: { name: '무거운 방어구', price: 1000, value: 50 } };
export const SMOKE_PRICE = 150;
export const MONEY = { start: 800, win: 3000, lose: 1900, kill: 200, plant: 300, max: 9000 };

export function newGun(id) { const w = WEAPONS[id]; return { w, mag: w.mag, reserve: w.reserve, cool: 0, reloading: 0, heat: 0 }; }

// 맞힌 곳에 따라 피해, 방어구가 절반까지 막는다
export function applyDamage(target, w, head) {
  let dmg = w.dmg * (head ? w.head : 1);
  if (target.armor > 0) { const take = Math.min(target.armor, dmg * 0.5); target.armor -= take; dmg -= take; }
  target.hp -= dmg;
  return dmg;
}
