let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function playDealSound() {
  try {
    const c = getCtx();
    const t = c.currentTime;
    const dur = 0.15;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const p = i / d.length;
      const env = p < 0.1 ? p / 0.1 : Math.exp(-(p - 0.1) * 8);
      d[i] = (Math.random() * 2 - 1) * env * 0.2;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(800, t + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.linearRampToValueAtTime(0.0, t + dur);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(c.destination);
    src.start(t);
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
