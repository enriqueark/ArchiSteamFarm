import { getGameVolume } from "./gameAudio";

let ctx: AudioContext | null = null;
const DEAL_VARIANTS = [
  { baseHz: 1500, noiseGain: 0.075, clickGain: 0.06 },
  { baseHz: 1700, noiseGain: 0.085, clickGain: 0.055 },
  { baseHz: 1850, noiseGain: 0.07, clickGain: 0.065 },
] as const;
let lastDealVariant = -1;

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
    const volume = getGameVolume();
    if (volume <= 0) return;
    const c = getCtx();
    const t = c.currentTime;
    const variant = pickDealVariant();
    const dur = 0.075;

    // Short filtered noise burst to mimic a card sliding on felt.
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const p = i / d.length;
      const env = p < 0.08 ? p / 0.08 : Math.exp(-(p - 0.08) * 10);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const noise = c.createBufferSource();
    noise.buffer = buf;
    const noiseFilter = c.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(variant.baseHz + Math.random() * 180, t);
    noiseFilter.Q.value = 0.8;
    const noiseGain = c.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(variant.noiseGain * volume, t + 0.008);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(c.destination);
    noise.start(t);
    noise.stop(t + dur);

    // Tiny click/transient for card impact at the end.
    const click = c.createOscillator();
    click.type = "triangle";
    click.frequency.setValueAtTime(variant.baseHz * 0.9, t + 0.015);
    click.frequency.exponentialRampToValueAtTime(variant.baseHz * 0.45, t + 0.05);
    const clickGain = c.createGain();
    clickGain.gain.setValueAtTime(0.0001, t + 0.015);
    clickGain.gain.exponentialRampToValueAtTime(variant.clickGain * volume, t + 0.022);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    click.connect(clickGain);
    clickGain.connect(c.destination);
    click.start(t + 0.015);
    click.stop(t + 0.06);
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
    const volume = getGameVolume();
    if (volume <= 0) return;
    const c = getCtx();
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.1);
      g.gain.linearRampToValueAtTime(0.1 * volume, t + i * 0.1 + 0.02);
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
    const volume = getGameVolume();
    if (volume <= 0) return;
    const c = getCtx();
    const t = c.currentTime;
    [350, 280, 220].forEach((f, i) => {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.15);
      g.gain.linearRampToValueAtTime(0.08 * volume, t + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.3);
      osc.connect(g);
      g.connect(c.destination);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.35);
    });
  } catch {}
}
