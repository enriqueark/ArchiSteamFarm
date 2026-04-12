let ctx: AudioContext | null = null;
const DEAL_SOUND_SRC = "/sounds/flipcard-91468.mp3";
const DEAL_POOL_SIZE = 8;
const DEAL_VARIANTS = [
  { rate: 0.97, offset: 0.0, volume: 0.58 },
  { rate: 1.0, offset: 0.012, volume: 0.62 },
  { rate: 1.035, offset: 0.022, volume: 0.56 },
] as const;
let lastDealVariant = -1;
let dealPool: HTMLAudioElement[] | null = null;
let dealPoolIdx = 0;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function pickDealVariant() {
  let next = Math.floor(Math.random() * DEAL_VARIANTS.length);
  if (next === lastDealVariant) next = (next + 1) % DEAL_VARIANTS.length;
  lastDealVariant = next;
  return DEAL_VARIANTS[next];
}

function playDealSoundNow() {
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

    const variant = pickDealVariant();
    const a = dealPool[dealPoolIdx];
    dealPoolIdx = (dealPoolIdx + 1) % DEAL_POOL_SIZE;
    a.pause();
    a.playbackRate = variant.rate;
    a.volume = Math.max(0.35, Math.min(0.8, variant.volume + (Math.random() - 0.5) * 0.05));
    a.currentTime = Math.min(0.035, variant.offset + Math.random() * 0.006);
    a.play().catch(() => {
      // Fallback so there is always audible feedback if media play is blocked.
      try {
        const c = getCtx();
        const t = c.currentTime;
        const dur = 0.08;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "square";
        const f = 1700 * variant.rate;
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.exponentialRampToValueAtTime(850 * variant.rate, t + dur);
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

export function playDealSound(options?: { delayMs?: number }) {
  const delayMs = options?.delayMs ?? 0;
  if (delayMs <= 0) {
    playDealSoundNow();
    return;
  }
  setTimeout(() => {
    playDealSoundNow();
  }, delayMs);
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
