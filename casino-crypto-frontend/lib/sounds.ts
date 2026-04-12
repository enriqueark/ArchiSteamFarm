let ctx: AudioContext | null = null;
const DEAL_SOUND_SRC = "/sounds/flipcard-91468.mp3";
const DEAL_POOL_SIZE = 8;
let dealPool: HTMLAudioElement[] | null = null;
let dealPoolIdx = 0;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function playDealSound() {
  try {
    if (typeof Audio === "undefined") return;
    if (!dealPool) {
      dealPool = [];
      for (let i = 0; i < DEAL_POOL_SIZE; i++) {
        const a = new Audio(DEAL_SOUND_SRC);
        a.preload = "auto";
        a.volume = 0.6;
        dealPool.push(a);
      }
    }
    const a = dealPool[dealPoolIdx];
    dealPoolIdx = (dealPoolIdx + 1) % DEAL_POOL_SIZE;
    a.currentTime = 0;
    a.play().catch(() => {
      // Fallback so there is always audible feedback if media play is blocked.
      try {
        const c = getCtx();
        const t = c.currentTime;
        const dur = 0.08;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(1800, t);
        osc.frequency.exponentialRampToValueAtTime(900, t + dur);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + dur);
      } catch {}
    });
  } catch {}
}

export function playWinSound() {
  try {
    const c = getCtx();
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.1);
      g.gain.linearRampToValueAtTime(0.1, t + i * 0.1 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.2);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t + i * 0.1);
      osc.stop(t + i * 0.1 + 0.25);
    });
  } catch {}
}

export function playLoseSound() {
  try {
    const c = getCtx();
    const t = c.currentTime;
    [350, 280, 220].forEach((f, i) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.15);
      g.gain.linearRampToValueAtTime(0.08, t + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.3);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.35);
    });
  } catch {}
}
