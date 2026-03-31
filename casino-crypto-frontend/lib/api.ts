import { emitAppToast } from "./toast";

function getBaseUrl(): string {
  const runtimeValue =
    typeof window !== "undefined" && window.__RUNTIME_CONFIG__?.NEXT_PUBLIC_API_URL
      ? window.__RUNTIME_CONFIG__.NEXT_PUBLIC_API_URL.trim()
      : "";
  const envValue = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  const configured = runtimeValue || envValue;

  if (configured) {
    // Safety guard: production clients must never target localhost/127.0.0.1.
    // If env/runtime was misconfigured, fallback to same-origin API host.
    if (
      typeof window !== "undefined" &&
      /(^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/i.test(configured)
    ) {
      return window.location.origin;
    }

    if (configured.startsWith("/") && typeof window !== "undefined") {
      return `${window.location.origin}${configured.replace(/\/$/, "")}`;
    }

    // Avoid mixed-content issues (https page trying to call http API).
    if (
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      configured.startsWith("http://")
    ) {
      return window.location.origin;
    }

    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
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
let suppressNextApiErrorToast = false;

let lastApiToastAtMs = 0;
const emitToastWithCooldown = (detail: { message: string; variant: "error" | "success" }): void => {
  const now = Date.now();
  if (now - lastApiToastAtMs < 5_000) {
    return;
  }
  lastApiToastAtMs = now;
  emitAppToast(detail);
};

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

export function suppressNextErrorToastOnce() {
  suppressNextApiErrorToast = true;
}

export async function validateSession(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  try {
    const res = await fetch(`${getApi()}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return true;
    // Keep session on transient server issues (e.g. temporary 5xx while deploy rolls out).
    if (res.status >= 500) {
      return true;
    }
    clearSession();
    return false;
  } catch {
    // Network issues should not force-log users out.
    return true;
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

  const res = await fetch(`${getApi()}${path}`, { ...options, headers }).catch((error) => {
    emitAppToast({
      variant: "error",
      message: `Network error: ${error instanceof Error ? error.message : "Request failed"}`
    });
    throw error;
  });

  if (!res.ok) {
    if (res.status === 401 && needsAuth) {
      clearSession();
    }
    const body = await res.json().catch(() => ({}));
    const message = body.message || body.error || `HTTP ${res.status}`;
    if (typeof window !== "undefined" && !suppressNextApiErrorToast) {
      emitAppToast({
        variant: "error",
        message
      });
    }
    suppressNextApiErrorToast = false;
    throw new Error(message);
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

// ── Auth ────────────────────────────────────────────────────────────────

export interface AuthResponse {
  user: {
    id: string;
    publicId: number | null;
    email: string;
    role: string;
    level: number;
    levelXpAtomic: string;
  };
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

// ── Chat ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  userId: string;
  userLabel: string;
  userLevel: number;
  avatarUrl: string | null;
  message: string;
  createdAt: string;
}

type ChatMessageApiPayload = {
  id: string;
  userId: string;
  username?: string;
  userLabel?: string;
  level?: number;
  userLevel?: number;
  avatarUrl: string | null;
  message: string;
  createdAt: string;
};

const normalizeChatMessage = (message: ChatMessageApiPayload): ChatMessage => ({
  id: message.id,
  userId: message.userId,
  userLabel: message.userLabel ?? message.username ?? `user_${message.userId.slice(0, 8)}`,
  userLevel: message.userLevel ?? message.level ?? 1,
  avatarUrl: message.avatarUrl ?? null,
  message: message.message,
  createdAt: message.createdAt
});

export async function getChatMessages(limit = 60): Promise<ChatMessage[]> {
  const data = await request<ChatMessageApiPayload[]>(`/chat/messages?limit=${limit}`, {}, false);
  return data.map(normalizeChatMessage);
}

export async function postChatMessage(message: string): Promise<ChatMessage> {
  const data = await request<ChatMessageApiPayload>(
    "/chat/messages",
    {
      method: "POST",
      body: JSON.stringify({ message })
    },
    true,
    true
  );
  return normalizeChatMessage(data);
}

// ── Cashier (OxaPay) ───────────────────────────────────────────────────────

export interface CashierDepositAddress {
  asset: "BTC" | "ETH" | "USDT" | "USDC" | "SOL";
  network: "bitcoin" | "erc20" | "solana";
  networkLabel: string;
  address: string;
  providerTrackId: string;
  qrCodeUrl: string | null;
}

export interface CashierWithdrawalResponse {
  id: string;
  status: string;
  amountAtomic: string;
  asset: string;
  network: string;
  destinationAddress: string;
  providerTrackId: string | null;
}

export async function getCashierDepositAddresses(): Promise<CashierDepositAddress[]> {
  const data = await request<{ addresses: CashierDepositAddress[] }>("/cashier/deposit-addresses", {}, true);
  return data.addresses;
}

export async function requestCashierWithdrawal(input: {
  asset: "BTC" | "ETH" | "USDT" | "USDC" | "SOL";
  network: "bitcoin" | "erc20" | "solana";
  amountCoins: string;
  destinationAddress: string;
}): Promise<CashierWithdrawalResponse> {
  return request<CashierWithdrawalResponse>(
    "/cashier/withdrawals",
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    true,
    true
  );
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

export interface RouletteResultHistoryItem {
  roundId: string;
  roundNumber: number;
  currency: string;
  winningNumber: number;
  winningColor: string;
  totalStakedAtomic: string;
  totalPayoutAtomic: string;
  settledAt: string;
}

export interface RouletteBetBreakdown {
  roundId: string;
  roundNumber: number;
  currency: string;
  totalsAtomic: {
    RED: string;
    BLACK: string;
    GREEN: string;
    BAIT: string;
  };
  entriesByType: {
    RED: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
    BLACK: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
    GREEN: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
    BAIT: Array<{ userId: string; userLabel: string; stakeAtomic: string }>;
  };
  totalStakedAtomic: string;
}

export async function getCurrentRound(currency = "USDT"): Promise<RouletteRound> {
  return request<RouletteRound>(`/roulette/rounds/current?currency=${currency}`, {}, false);
}

export async function getRouletteRecentResults(currency = "USDT", limit = 20): Promise<RouletteResultHistoryItem[]> {
  return request<RouletteResultHistoryItem[]>(`/roulette/results?currency=${currency}&limit=${limit}`, {}, false);
}

export async function getCurrentRouletteBetBreakdown(currency = "USDT"): Promise<RouletteBetBreakdown> {
  return request<RouletteBetBreakdown>(`/roulette/rounds/current/breakdown?currency=${currency}`, {}, false);
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

// ── Cases ────────────────────────────────────────────────────────────────

export interface CaseListItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  logoUrl: string | null;
  priceAtomic: string;
  currency: string;
  isActive: boolean;
  volatilityIndex: number;
  volatilityTier: "L" | "M" | "H" | "I";
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

export interface CaseItem {
  id: string;
  name: string;
  valueAtomic: string;
  dropRate: string;
  imageUrl: string | null;
  cs2SkinId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface CaseDetails {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  logoUrl: string | null;
  priceAtomic: string;
  currency: string;
  isActive: boolean;
  volatilityIndex: number;
  volatilityTier: "L" | "M" | "H" | "I";
  createdAt: string;
  updatedAt: string;
  items: CaseItem[];
}

export interface CaseOpeningResult {
  openingId: string;
  caseId: string;
  caseSlug: string;
  caseTitle: string;
  item: CaseItem;
  topTierEligible: boolean;
  topTierItems: CaseItem[];
  roll: number;
  payoutAtomic: string;
  profitAtomic: string;
  priceAtomic: string;
  currency: string;
  provablyFair: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
  wallet: {
    walletId: string;
    balanceAtomic: string;
    lockedAtomic: string;
    availableAtomic: string;
  };
  createdAt: string;
}

export interface CasesRtpSimulationResult {
  caseId: string;
  caseSlug: string;
  caseTitle: string;
  volatilityIndex: number;
  volatilityTier: "L" | "M" | "H" | "I";
  rounds: number;
  spentAtomic: string;
  payoutAtomic: string;
  profitAtomic: string;
  rtpPercent: number;
  hitTopTierCount: number;
}

export async function getCases(): Promise<CaseListItem[]> {
  return request<CaseListItem[]>("/cases", {}, false);
}

export type BattleTemplate =
  | "ONE_VS_ONE"
  | "TWO_VS_TWO"
  | "ONE_VS_ONE_VS_ONE"
  | "ONE_VS_ONE_VS_ONE_VS_ONE"
  | "ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE"
  | "TWO_VS_TWO_VS_TWO"
  | "THREE_VS_THREE";

export interface BattleCaseEntry {
  id: string;
  orderIndex: number;
  caseId: string;
  caseTitle: string;
  caseSlug: string;
  casePriceAtomic: string;
}

export interface BattleSlotEntry {
  id: string;
  seatIndex: number;
  teamIndex: number;
  state: "OPEN" | "JOINED" | "BOT_FILLED";
  userId: string | null;
  displayName: string;
  isBot: boolean;
  borrowPercent: number;
  paidAmountAtomic: string;
  payoutAtomic: string;
  winWeightAtomic: string;
  profitAtomic: string;
}

export interface BattleDropEntry {
  id: string;
  roundIndex: number;
  orderIndex: number;
  battleCaseId: string;
  battleSlotId: string;
  caseItemId: string;
  caseItemName: string;
  valueAtomic: string;
}

export interface BattleState {
  id: string;
  status: "OPEN" | "RUNNING" | "SETTLED" | "CANCELLED";
  template: BattleTemplate;
  modeCrazy: boolean;
  modeGroup: boolean;
  modeJackpot: boolean;
  modeTerminal: boolean;
  modePrivate: boolean;
  modeBorrow: boolean;
  totalCostAtomic: string;
  totalPayoutAtomic: string;
  winnerTeam: number | null;
  winnerUserId: string | null;
  jackpotRoll: number | null;
  jackpotWinnerSlotId: string | null;
  createdByUserId: string;
  createdAt: string;
  startedAt: string | null;
  settledAt: string | null;
  cases: BattleCaseEntry[];
  slots: BattleSlotEntry[];
  drops: BattleDropEntry[];
}

export async function listBattles(query?: {
  includePrivate?: boolean;
  status?: "OPEN" | "RUNNING" | "SETTLED" | "CANCELLED";
  limit?: number;
}): Promise<BattleState[]> {
  const params = new URLSearchParams();
  if (typeof query?.includePrivate === "boolean") params.set("includePrivate", String(query.includePrivate));
  if (query?.status) params.set("status", query.status);
  if (typeof query?.limit === "number") params.set("limit", String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<BattleState[]>(`/battles${suffix}`);
}

export async function getBattle(battleId: string): Promise<BattleState> {
  return request<BattleState>(`/battles/${battleId}`);
}

export async function createBattle(input: {
  template: BattleTemplate;
  caseIds: string[];
  modeCrazy?: boolean;
  modeGroup?: boolean;
  modeJackpot?: boolean;
  modeTerminal?: boolean;
  modePrivate?: boolean;
  modeBorrow?: boolean;
  borrowPercent?: number;
  currency?: string;
}): Promise<BattleState> {
  return request<BattleState>(
    "/battles",
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    true,
    true
  );
}

export async function joinBattle(input: {
  battleId: string;
  borrowPercent?: number;
  currency?: string;
}): Promise<BattleState> {
  return request<BattleState>(
    `/battles/${input.battleId}/join`,
    {
      method: "POST",
      body: JSON.stringify({
        borrowPercent: input.borrowPercent ?? 100,
        currency: input.currency ?? "USDT"
      })
    },
    true,
    true
  );
}

export async function callBattleBot(input: {
  battleId: string;
  seatIndex: number;
  currency?: string;
}): Promise<BattleState> {
  return request<BattleState>(
    `/battles/${input.battleId}/call-bot`,
    {
      method: "POST",
      body: JSON.stringify({
        seatIndex: input.seatIndex,
        currency: input.currency ?? "USDT"
      })
    },
    true,
    true
  );
}

export async function fillBattleBots(input: {
  battleId: string;
  currency?: string;
}): Promise<BattleState> {
  return request<BattleState>(
    `/battles/${input.battleId}/fill-bots`,
    {
      method: "POST",
      body: JSON.stringify({
        currency: input.currency ?? "USDT"
      })
    },
    true,
    true
  );
}

export async function getCaseDetails(caseId: string): Promise<CaseDetails> {
  return request<CaseDetails>(`/cases/${caseId}`, {}, false);
}

export async function openCase(caseId: string): Promise<CaseOpeningResult> {
  return request<CaseOpeningResult>(
    `/cases/${caseId}/open`,
    {
      method: "POST",
      body: JSON.stringify({})
    },
    true,
    true
  );
}

export async function getMyCaseOpenings(limit = 30): Promise<CaseOpeningResult[]> {
  return request<CaseOpeningResult[]>(`/cases/openings/me?limit=${limit}`);
}

export async function adminListCases(): Promise<CaseDetails[]> {
  return request<CaseDetails[]>("/cases/admin/cases");
}

export async function adminUpsertCase(input: {
  caseId?: string;
  slug: string;
  title: string;
  description?: string;
  priceAtomic: string;
  isActive?: boolean;
  items: Array<{
    name: string;
    valueAtomic: string;
    dropRate: string;
    imageUrl?: string;
    sortOrder?: number;
    isActive?: boolean;
  }>;
}): Promise<CaseDetails> {
  return request<CaseDetails>(
    "/cases/admin/cases",
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    true,
    true
  );
}

export async function adminSetCaseStatus(caseId: string, isActive: boolean): Promise<CaseDetails> {
  return request<CaseDetails>(
    `/cases/admin/cases/${caseId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ isActive })
    },
    true,
    true
  );
}

export async function adminSimulateCasesRtp(rounds = 100_000): Promise<CasesRtpSimulationResult[]> {
  return request<CasesRtpSimulationResult[]>(
    "/cases/admin/simulate-rtp",
    {
      method: "POST",
      body: JSON.stringify({ rounds })
    },
    true,
    true
  );
}

// ── Blackjack ─────────────────────────────────────────────────────────────

export type BlackjackAction = "HIT" | "STAND" | "DOUBLE" | "SPLIT" | "INSURANCE";

export interface BlackjackHandState {
  cards: string[];
  stakeAtomic: string;
  doubled: boolean;
  stood: boolean;
  busted: boolean;
  blackjack: boolean;
  value: number;
}

export interface BlackjackGame {
  gameId: string;
  status: "ACTIVE" | "WON" | "LOST" | "PUSH" | "CANCELLED";
  currency: string;
  initialBetAtomic: string;
  mainBetAtomic: string;
  sideBetPairsAtomic: string;
  sideBet21Plus3Atomic: string;
  insuranceBetAtomic: string | null;
  canSplit: boolean;
  canInsurance: boolean;
  activeHandIndex: number;
  dealerRevealed: boolean;
  playerHands: BlackjackHandState[];
  dealerCards: string[];
  dealerVisibleCards: string[];
  paytable: {
    pairsMultiplier: number;
    plus3Multiplier: number;
  };
  provablyFair: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
  payoutAtomic: string | null;
  createdAt: string;
  finishedAt: string | null;
  wallet: {
    walletId: string;
    balanceAtomic: string;
    lockedAtomic: string;
    availableAtomic: string;
  };
}

export async function startBlackjackGame(input: {
  currency: string;
  betAtomic: string;
  sideBetPairsAtomic?: string;
  sideBet21Plus3Atomic?: string;
}): Promise<BlackjackGame> {
  return request<BlackjackGame>(
    "/blackjack/games",
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    true,
    true
  );
}

export async function getActiveBlackjackGame(currency = "USDT"): Promise<BlackjackGame | null> {
  return request<BlackjackGame | null>(`/blackjack/games/active?currency=${currency}`, {}, true);
}

export async function getBlackjackGame(gameId: string): Promise<BlackjackGame> {
  return request<BlackjackGame>(`/blackjack/games/${gameId}`, {}, true);
}

export async function actBlackjack(gameId: string, action: BlackjackAction): Promise<BlackjackGame> {
  return request<BlackjackGame>(
    `/blackjack/games/${gameId}/action`,
    {
      method: "POST",
      body: JSON.stringify({ action })
    },
    true,
    true
  );
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

export async function getActiveMinesGame(): Promise<MinesGame | null> {
  return request<MinesGame | null>("/mines/games/active");
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
  publicId: number | null;
  email: string;
  role: string;
  status: string;
  profileVisible?: boolean;
  progression: {
    level: number;
    xpAtomic: string;
  };
  createdAt: string;
}

export async function getMe(): Promise<User> {
  return request<User>("/users/me");
}

export interface ProfileSummary {
  user: {
    id: string;
    publicId: number | null;
    email: string;
    role: string;
    status: string;
    profileVisible: boolean;
    level: number;
    levelXpAtomic: string;
    createdAt: string;
    updatedAt: string;
  };
  wallet: {
    walletId: string | null;
    balanceAtomic: string;
    lockedAtomic: string;
    availableAtomic: string;
    updatedAt: string | null;
  };
  totals: {
    depositsAtomic: string;
    withdrawalsAtomic: string;
    withdrawalFeesAtomic: string;
    wageredAtomic: string;
    payoutAtomic: string;
    netGamingAtomic: string;
    bonusFromReferralAtomic: string;
    claimableAffiliateCommissionAtomic: string;
    claimedAffiliateCommissionAtomic: string;
  };
  perGame: {
    mines: {
      wageredAtomic: string;
      payoutAtomic: string;
    };
    blackjack: {
      wageredAtomic: string;
      payoutAtomic: string;
    };
    roulette: {
      wageredAtomic: string;
      payoutAtomic: string;
    };
  };
}

export async function getProfileSummary(): Promise<ProfileSummary> {
  return request<ProfileSummary>("/profile/summary");
}

export async function setProfileVisibility(profileVisible: boolean): Promise<{ profileVisible: boolean; updatedAt: string }> {
  return request<{ profileVisible: boolean; updatedAt: string }>(
    "/profile/visibility",
    {
      method: "PATCH",
      body: JSON.stringify({ profileVisible })
    },
    true,
    true
  );
}

export interface AffiliateDashboard {
  myCode: {
    code: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  appliedCode: {
    code: string;
    createdAt: string;
    bonusReceivedAtomic: string;
    referrer: {
      publicId: number | null;
      userLabel: string;
    };
  } | null;
  stats: {
    referralCount: number;
    totalWageredAtomic: string;
    totalCommissionAtomic: string;
    claimableCommissionAtomic: string;
    claimedCommissionAtomic: string;
  };
  referrals: Array<{
    referralId: string;
    createdAt: string;
    user: {
      id: string;
      publicId: number | null;
      userLabel: string;
      createdAt: string;
    };
    totalWageredAtomic: string;
    totalCommissionAtomic: string;
    claimableCommissionAtomic: string;
    claimedCommissionAtomic: string;
    bonusReceivedAtomic: string;
    active: boolean;
  }>;
}

export async function getAffiliateDashboard(): Promise<AffiliateDashboard> {
  return request<AffiliateDashboard>("/affiliates/dashboard");
}

export async function saveAffiliateCode(code: string): Promise<{ code: string; createdAt: string; updatedAt: string }> {
  return request<{ code: string; createdAt: string; updatedAt: string }>(
    "/affiliates/code",
    {
      method: "PUT",
      body: JSON.stringify({ code })
    },
    true,
    true
  );
}

export async function applyAffiliateCode(code: string): Promise<{
  referralId: string;
  createdAt: string;
  code: string;
  referrer: { publicId: number | null; userLabel: string };
}> {
  return request<{
    referralId: string;
    createdAt: string;
    code: string;
    referrer: { publicId: number | null; userLabel: string };
  }>(
    "/affiliates/apply",
    {
      method: "POST",
      body: JSON.stringify({ code })
    },
    true,
    true
  );
}

export async function claimAffiliateCommission(): Promise<{
  claimedAtomic: string;
  balanceAtomic: string;
  claimedAt: string;
}> {
  return request<{ claimedAtomic: string; balanceAtomic: string; claimedAt: string }>(
    "/affiliates/claim",
    {
      method: "POST"
    },
    true,
    true
  );
}

export interface FairnessState {
  clientSeed: string;
  nonce: number;
  activeServerSeedHash: string;
  revealedSeeds: Array<{
    id: string;
    serverSeed: string;
    serverSeedHash: string;
    createdAt: string;
    revealedAt: string | null;
  }>;
}

export async function getFairnessState(): Promise<FairnessState> {
  return request<FairnessState>("/fairness");
}

export async function setFairnessClientSeed(clientSeed: string): Promise<{
  clientSeed: string;
  nonce: number;
  activeServerSeedHash: string;
}> {
  return request<{ clientSeed: string; nonce: number; activeServerSeedHash: string }>(
    "/fairness/client-seed",
    {
      method: "PUT",
      body: JSON.stringify({ clientSeed })
    },
    true,
    true
  );
}

export async function rotateFairnessServerSeed(): Promise<{
  revealedServerSeed: string;
  revealedServerSeedHash: string;
  newServerSeedHash: string;
  clientSeed: string;
  nonce: number;
}> {
  return request<{
    revealedServerSeed: string;
    revealedServerSeedHash: string;
    newServerSeedHash: string;
    clientSeed: string;
    nonce: number;
  }>(
    "/fairness/rotate",
    {
      method: "POST"
    },
    true,
    true
  );
}

export function getApiUrl() {
  return getApi();
}

export function getWsUrl() {
  const base = getBaseUrl().replace(/^http/, "ws");
  return `${base}/api/v1/roulette/ws`;
}
