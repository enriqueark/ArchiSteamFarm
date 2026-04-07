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
    const bufferSize = 4096;
    const noise = c.createScriptProcessor(bufferSize, 1, 1);
    const gain = c.createGain();
    gain.gain.value = 0.08;
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
    let samples = 0;
    noise.onaudioprocess = (e) => {
      const output = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
        samples++;
      }
      if (samples > 4096 * 3) { noise.disconnect(); gain.disconnect(); }
    };
    noise.connect(gain);
    gain.connect(c.destination);
    setTimeout(() => { try { noise.disconnect(); gain.disconnect(); } catch {} }, 80);
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
