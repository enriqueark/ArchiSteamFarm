const STORAGE_KEY = "gameAudioVolume";
const EVENT_NAME = "game-audio-volume-change";

let cachedVolume: number | null = null;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function readStoredVolume(): number {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return 1;
  const parsed = Number(raw);
  return clampVolume(parsed);
}

export function getGameVolume(): number {
  if (cachedVolume !== null) {
    return cachedVolume;
  }
  cachedVolume = readStoredVolume();
  return cachedVolume;
}

export function setGameVolume(nextVolume: number): number {
  const normalized = clampVolume(nextVolume);
  cachedVolume = normalized;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, String(normalized));
    window.dispatchEvent(new CustomEvent<number>(EVENT_NAME, { detail: normalized }));
  }
  return normalized;
}

export function subscribeGameVolume(handler: (volume: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const custom = event as CustomEvent<number>;
    handler(clampVolume(custom.detail));
  };
  window.addEventListener(EVENT_NAME, listener as EventListener);
  return () => {
    window.removeEventListener(EVENT_NAME, listener as EventListener);
  };
}

