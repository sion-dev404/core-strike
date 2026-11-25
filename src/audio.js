// 효과음: 파일 없이 Web Audio로 만든다
let ctx = null, master = null, noiseBuf = null;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}
export function setVolume(v) { if (master) master.gain.value = v; }

// 소리가 오는 방향(pan: -1 왼쪽 ~ 1 오른쪽)
function out(pan = 0) {
  if (!pan || !ctx.createStereoPanner) return master;
  const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(master); return p;
}
// 발소리: 가까운 적이 뛰면 들린다
export function step(dist = 0, pan = 0) {
  if (!ctx) return;
  const vol = Math.max(0, 1 - dist / 22) * 0.35; if (vol <= 0.02) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380 + Math.random() * 120; f.Q.value = 1.4;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  s.connect(f); f.connect(g); g.connect(out(pan)); s.start(t); s.stop(t + 0.1);
}
// dist: 듣는 사람과의 거리(m). 멀수록 작게
export function shot(kind = 'rifle', dist = 0, pan = 0) {
  if (!ctx) return;
  const vol = Math.max(0, 1 - dist / 70); if (vol <= 0.02) return;
  const t = ctx.currentTime;
  const dest = out(pan);
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.value = { pistol: 2600, smg: 3200, rifle: 2000, sniper: 1200 }[kind] || 2000;
  const g = ctx.createGain();
  const len = { pistol: 0.12, smg: 0.08, rifle: 0.14, sniper: 0.4 }[kind] || 0.12;
  g.gain.setValueAtTime(0.9 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + len + 0.02);
  const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle';
  o.frequency.setValueAtTime(kind === 'sniper' ? 90 : 140, t); o.frequency.exponentialRampToValueAtTime(40, t + len);
  og.gain.setValueAtTime(0.5 * vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(og); og.connect(dest); o.start(t); o.stop(t + len + 0.02);
}
function beep(freq, len = 0.08, type = 'sine', vol = 0.3, at = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + len + 0.02);
}
export const sfx = {
  hit: () => beep(900, 0.05, 'square', 0.12),
  head: () => { beep(1500, 0.08, 'sine', 0.25); beep(2200, 0.1, 'sine', 0.15, 0.04); },
  kill: () => { beep(660, 0.1, 'triangle', 0.3); beep(990, 0.14, 'triangle', 0.3, 0.08); },
  hurt: () => beep(180, 0.15, 'sawtooth', 0.2),
  reload: () => { beep(400, 0.04, 'square', 0.1); beep(600, 0.04, 'square', 0.1, 0.25); },
  empty: () => beep(300, 0.03, 'square', 0.1),
  buy: () => beep(880, 0.06, 'sine', 0.2),
  plantTick: () => beep(1200, 0.06, 'square', 0.12),
  coreBeep: (fast) => beep(fast ? 1600 : 1300, 0.07, 'sine', 0.22),
  boom: () => { if (!ctx) return; shot('sniper', 0); beep(60, 1.2, 'sawtooth', 0.5); },
  smoke: () => { if (!ctx) return; const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; const g = ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 0.6); },
  dash: () => { if (!ctx) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(1200, t + 0.15); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2); },
  round: () => { beep(523, 0.12, 'triangle', 0.3); beep(784, 0.18, 'triangle', 0.3, 0.12); },
  win: () => { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.2, 'triangle', 0.3, i * 0.12)); },
  lose: () => { [392, 330, 262].forEach((f, i) => beep(f, 0.25, 'triangle', 0.3, i * 0.15)); },
};
