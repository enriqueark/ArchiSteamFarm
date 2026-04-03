function getBaseUrl(): string {
  if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__?.NEXT_PUBLIC_API_URL) {
    return window.__RUNTIME_CONFIG__.NEXT_PUBLIC_API_URL;
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: { NEXT_PUBLIC_API_URL?: string };
  }
}

function getApi(): string {
  return `${getBaseUrl()}/api/v1`;
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    if (typeof window !== "undefined") localStorage.setItem("accessToken", token);
  } else {
    if (typeof window !== "undefined") localStorage.removeItem("accessToken");
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== "undefined") {
    accessToken = localStorage.getItem("accessToken");
  }
  return accessToken;
}

export function clearSession() {
  accessToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
  }
}

export async function validateSession(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${getApi()}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return true;
    clearSession();
    return false;
  } catch {
    clearSession();
    return false;
  }
}

function idempotencyKey(): string {
  return `fe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  needsAuth = true,
  needsIdempotency = false
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (needsAuth) {
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  if (needsIdempotency) {
    headers["Idempotency-Key"] = idempotencyKey();
  }

  const res = await fetch(`${getApi()}${path}`, { ...options, headers });

  if (!res.ok) {
    if (res.status === 401 && needsAuth) {
      clearSession();
    }
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

// ── Auth ────────────────────────────────────────────────────────────────

export interface AuthResponse {
  user: { id: string; email: string; role: string };
  tokens: { accessToken: string; refreshToken: string; sessionId: string };
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const data = await request<AuthResponse>(
    "/auth/register",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false
  );
  setAccessToken(data.tokens.accessToken);
  if (typeof window !== "undefined") {
    localStorage.setItem("refreshToken", data.tokens.refreshToken);
  }
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await request<AuthResponse>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false
  );
  setAccessToken(data.tokens.accessToken);
  if (typeof window !== "undefined") {
    localStorage.setItem("refreshToken", data.tokens.refreshToken);
  }
  return data;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/auth/logout", { method: "POST" }, true);
  } catch {
    // ignore — clear local session regardless
  }
  clearSession();
}

// ── Health ──────────────────────────────────────────────────────────────

export interface HealthLive {
  status: string;
  service: string;
  timestamp: string;
}

export interface HealthReady {
  status: string;
  checks: { postgres: boolean; redis: boolean };
  timestamp: string;
}

export async function getHealthLive(): Promise<HealthLive> {
  return request<HealthLive>("/health/live", {}, false);
}

export async function getHealthReady(): Promise<HealthReady> {
  return request<HealthReady>("/health/ready", {}, false);
}

// ── Wallets ─────────────────────────────────────────────────────────────

export interface Wallet {
  id: string;
  currency: string;
  balanceAtomic: string;
  lockedAtomic: string;
  updatedAt: string;
}

export async function getWallets(): Promise<Wallet[]> {
  return request<Wallet[]>("/wallets");
}

// ── Roulette ────────────────────────────────────────────────────────────

export interface RouletteRound {
  id: string;
  roundNumber: number;
  currency: string;
  status: string;
  openAt: string;
  betsCloseAt: string;
  spinStartsAt: string;
  settleAt: string;
  winningNumber: number | null;
  winningColor: string | null;
  totalStakedAtomic: string;
  totalPayoutAtomic: string;
}

export interface RouletteBetResponse {
  round: RouletteRound;
  bet: {
    id: string;
    betType: string;
    betValue: string | null;
    stakeAtomic: string;
    status: string;
  };
  wallet: Wallet;
}

export async function getCurrentRound(currency = "USDT"): Promise<RouletteRound> {
  return request<RouletteRound>(`/roulette/rounds/current?currency=${currency}`, {}, false);
}

export async function placeRouletteBet(
  currency: string,
  betType: string,
  stakeAtomic: string,
  betValue?: string
): Promise<RouletteBetResponse> {
  const body: Record<string, string> = { currency, betType, stakeAtomic };
  if (betValue) body.betValue = betValue;
  return request<RouletteBetResponse>(
    "/roulette/bets",
    { method: "POST", body: JSON.stringify(body) },
    true,
    true
  );
}

export async function getMyRouletteBets(limit = 50) {
  return request<unknown[]>(`/roulette/bets/me?limit=${limit}`);
}

// ── Mines ───────────────────────────────────────────────────────────────

export interface MinesGame {
  gameId: string;
  status: string;
  currency: string;
  betAtomic: string;
  mineCount: number;
  boardSize: number;
  safeReveals: number;
  revealedCells: number[];
  currentMultiplier: string;
  potentialPayoutAtomic: string;
  payoutAtomic: string | null;
  provablyFair: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
  wallet: Wallet;
  createdAt: string;
  finishedAt: string | null;
}

export interface MinesRevealResponse extends MinesGame {
  reveal: {
    cellIndex: number;
    hitMine: boolean;
    revealedNow: boolean;
    gameResolved: boolean;
  };
}

export async function startMinesGame(
  currency: string,
  betAtomic: string,
  mineCount: number
): Promise<MinesGame> {
  return request<MinesGame>(
    "/mines/games",
    {
      method: "POST",
      body: JSON.stringify({ currency, betAtomic, mineCount }),
    },
    true,
    true
  );
}

export async function getMinesGame(gameId: string): Promise<MinesGame> {
  return request<MinesGame>(`/mines/games/${gameId}`);
}

export async function revealMine(gameId: string, cellIndex: number): Promise<MinesRevealResponse> {
  return request<MinesRevealResponse>(
    `/mines/games/${gameId}/reveal`,
    { method: "POST", body: JSON.stringify({ cellIndex }) },
    true
  );
}

export async function cashoutMines(gameId: string): Promise<MinesGame> {
  return request<MinesGame>(
    `/mines/games/${gameId}/cashout`,
    { method: "POST" },
    true,
    true
  );
}

// ── User ────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

export async function getMe(): Promise<User> {
  return request<User>("/users/me");
}

export function getApiUrl() {
  return getApi();
}

export function getWsUrl() {
  const base = getBaseUrl().replace(/^http/, "ws");
  return `${base}/api/v1/roulette/ws`;
}
