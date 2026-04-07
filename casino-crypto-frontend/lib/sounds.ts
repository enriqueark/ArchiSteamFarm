let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", vol = 0.15) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration);
  } catch {}
}

export function playDealSound() {
  try {
    const c = getCtx();
    const len = 0.12;
    const sr = c.sampleRate;
    const buf = c.createBuffer(1, sr * len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 40);
      data[i] = (Math.random() * 2 - 1) * env * 0.3;
      if (t > 0.02 && t < 0.06) {
        data[i] += Math.sin(t * 2000) * env * 0.15;
      }
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2000;
    src.connect(hp);
    hp.connect(c.destination);
    src.start();
  } catch {}
}

export function playWinSound() {
  playTone(523, 0.15, "sine", 0.12);
  setTimeout(() => playTone(659, 0.15, "sine", 0.12), 120);
  setTimeout(() => playTone(784, 0.2, "sine", 0.14), 240);
  setTimeout(() => playTone(1047, 0.3, "sine", 0.1), 380);
}

export function playLoseSound() {
  playTone(400, 0.2, "sawtooth", 0.08);
  setTimeout(() => playTone(300, 0.25, "sawtooth", 0.07), 180);
  setTimeout(() => playTone(200, 0.4, "sawtooth", 0.06), 360);
}
