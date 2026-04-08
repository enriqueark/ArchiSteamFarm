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
  balanceCoins?: string;
  lockedAtomic: string;
  lockedCoins?: string;
  availableAtomic?: string;
  availableCoins?: string;
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

export interface RouletteBet {
  id: string;
  roundId: string;
  currency: string;
  betType: string;
  betValue: string | null;
  stakeAtomic: string;
  payoutAtomic: string | null;
  status: string;
  createdAt: string;
  settledAt: string | null;
}

export async function getMyRouletteBets(limit = 50): Promise<RouletteBet[]> {
  return request<RouletteBet[]>(`/roulette/bets/me?limit=${limit}`);
}

export async function getLedgerEntries(currency: string, limit = 50) {
  return request<unknown[]>(`/wallets/${currency}/entries?limit=${limit}`);
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

export interface SkinPreviewQuote {
  preview: {
    id: string;
    name: string;
    valueAtomic: string;
    imageUrl: string | null;
  } | null;
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

export async function getCases(): Promise<CaseListItem[]> {
  return request<CaseListItem[]>("/cases", {}, false);
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

export async function getSkinPreviewByAmountAtomic(amountAtomic: string): Promise<SkinPreviewQuote> {
  return request<SkinPreviewQuote>(`/cases/catalog/skin-preview?amountAtomic=${encodeURIComponent(amountAtomic)}`, {}, false);
}

// ── Battles ──────────────────────────────────────────────────────────────

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
  caseItemImageUrl?: string | null;
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
  modeFast: boolean;
  modePrivate: boolean;
  modeBorrow: boolean;
  totalCostAtomic: string;
  totalPayoutAtomic: string;
  winnerTeam: number | null;
  winnerUserId: string | null;
  jackpotRoll: number | null;
  jackpotWinnerSlotId: string | null;
  jackpotChances: Array<{
    slotId: string;
    seatIndex: number;
    displayName: string;
    chancePercent: number;
    weightAtomic: string;
  }> | null;
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
  modeFast?: boolean;
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

export interface CashierAddress {
  asset: string;
  network: string;
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

export async function getDepositAddresses(): Promise<{ addresses: CashierAddress[] }> {
  return request<{ addresses: CashierAddress[] }>("/cashier/deposit-addresses");
}

export async function createWithdrawal(input: {
  asset: "USDT";
  network: "erc20";
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

export async function getActiveMinesGame(): Promise<MinesGame | null> {
  return request<MinesGame | null>("/mines/games/active");
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

// ── Chat / Rain ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  userLevel: number;
  avatarUrl: string | null;
  message: string;
  createdAt: string;
}

export async function getChatMessages(limit = 60): Promise<ChatMessage[]> {
  return request<ChatMessage[]>(`/chat/messages?limit=${limit}`, {}, false);
}

export async function sendChatMessage(message: string): Promise<ChatMessage> {
  return request<ChatMessage>(
    "/chat/messages",
    { method: "POST", body: JSON.stringify({ message }) },
    true
  );
}

export interface RainState {
  roundId: string;
  startsAt: string;
  endsAt: string;
  baseAmountAtomic: string;
  tippedAmountAtomic: string;
  totalAmountAtomic: string;
  joinedCount: number;
  hasJoined: boolean;
}

export async function getRainState(): Promise<RainState> {
  return request<RainState>("/chat/rain/current");
}

export async function joinRain(): Promise<RainState> {
  return request<RainState>("/chat/rain/join", { method: "POST" }, true, true);
}

export async function tipRain(amountCoins: number): Promise<{ rain: RainState }> {
  return request<{ rain: RainState }>(
    "/chat/rain/tip",
    { method: "POST", body: JSON.stringify({ amountCoins }) },
    true,
    true
  );
}

// ── User ────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  publicId?: number | null;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  level?: number;
  levelXpAtomic?: string;
  levelXp?: string;
  progression?: {
    level: number;
    xpAtomic: string;
    xp?: string;
    currency?: string;
  };
}

export async function getMe(): Promise<User> {
  return request<User>("/users/me");
}

// ── Profile / Vault / History ───────────────────────────────────────────

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
    levelXp: string;
    createdAt: string;
    updatedAt: string;
  };
  wallet: {
    walletId: string | null;
    balanceAtomic: string;
    balanceCoins: string;
    lockedAtomic: string;
    lockedCoins: string;
    availableAtomic: string;
    availableCoins: string;
    currency: string;
    updatedAt: string | null;
  };
  totals: {
    depositsAtomic: string;
    depositsCoins: string;
    withdrawalsAtomic: string;
    withdrawalsCoins: string;
    withdrawalFeesAtomic: string;
    withdrawalFeesCoins: string;
    wageredAtomic: string;
    wageredCoins: string;
    payoutAtomic: string;
    payoutCoins: string;
    netGamingAtomic: string;
    netGamingCoins: string;
    bonusFromReferralAtomic: string;
    bonusFromReferralCoins: string;
    claimableAffiliateCommissionAtomic: string;
    claimableAffiliateCommissionCoins: string;
    claimedAffiliateCommissionAtomic: string;
    claimedAffiliateCommissionCoins: string;
    currency: string;
  };
  perGame: {
    mines: {
      wageredAtomic: string;
      wageredCoins: string;
      payoutAtomic: string;
      payoutCoins: string;
    };
    blackjack: {
      wageredAtomic: string;
      wageredCoins: string;
      payoutAtomic: string;
      payoutCoins: string;
    };
    roulette: {
      wageredAtomic: string;
      wageredCoins: string;
      payoutAtomic: string;
      payoutCoins: string;
    };
  };
}

export async function getProfileSummary(): Promise<ProfileSummary> {
  return request<ProfileSummary>("/users/profile/summary");
}

export interface VaultLock {
  id: string;
  amountAtomic: string;
  unlockAt: string;
  createdAt: string;
}

export interface VaultState {
  vaultId: string;
  balanceAtomic: string;
  availableAtomic: string;
  lockedAtomic: string;
  releasableAtomic: string;
  locks: VaultLock[];
}

export type VaultLockDuration = "1H" | "1D" | "3D" | "7D";

export async function getVaultState(): Promise<VaultState> {
  return request<VaultState>("/vault");
}

export async function depositVault(amountCoins: number, lockDuration?: VaultLockDuration): Promise<void> {
  await request(
    "/vault/deposit",
    {
      method: "POST",
      body: JSON.stringify({
        amountCoins,
        ...(lockDuration ? { lockDuration } : {})
      })
    },
    true,
    true
  );
}

export async function withdrawVault(amountCoins: number): Promise<void> {
  await request(
    "/vault/withdraw",
    {
      method: "POST",
      body: JSON.stringify({ amountCoins })
    },
    true,
    true
  );
}

export interface UserTransactionItem {
  id: string;
  kind: "DEPOSIT" | "WITHDRAWAL" | "ADMIN" | "TIP_SENT" | "TIP_RECEIVED" | "RAIN_TIP" | "RAIN_PAYOUT" | "GAME" | "VAULT" | "OTHER";
  direction: "CREDIT" | "DEBIT";
  reason: string;
  amountAtomic: string;
  amountCoins: string;
  balanceBeforeAtomic: string;
  balanceBeforeCoins: string;
  balanceAfterAtomic: string;
  balanceAfterCoins: string;
  referenceId: string | null;
  gameType: string | null;
  counterpartyFrom: {
    id: string;
    publicId: number | null;
    label: string;
  } | null;
  counterpartyTo: {
    id: string;
    publicId: number | null;
    label: string;
  } | null;
  metadata: unknown;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

export async function getMyTransactions(limit = 50, offset = 0): Promise<PaginatedResponse<UserTransactionItem>> {
  return request<PaginatedResponse<UserTransactionItem>>(`/users/me/transactions?limit=${limit}&offset=${offset}`);
}

export interface UserGameHistoryItem {
  id: string;
  gameMode: "MINES" | "BLACKJACK" | "ROULETTE" | "CASES" | "BATTLES";
  status: string;
  playedAt: string;
  wagerAtomic: string;
  wagerCoins: string;
  payoutAtomic: string;
  payoutCoins: string;
  profitAtomic: string;
  profitCoins: string;
  reference: string | null;
}

export async function getMyGameHistory(
  params: { limit?: number; offset?: number; mode?: "ALL" | "MINES" | "BLACKJACK" | "ROULETTE" | "CASES" | "BATTLES" } = {}
): Promise<PaginatedResponse<UserGameHistoryItem>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const mode = params.mode ?? "ALL";
  return request<PaginatedResponse<UserGameHistoryItem>>(
    `/users/me/game-history?limit=${limit}&offset=${offset}&mode=${mode}`
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
    bonusReceivedCoins: string;
    referrer: {
      publicId: number | null;
      userLabel: string;
    };
  } | null;
  stats: {
    referralCount: number;
    totalWageredAtomic: string;
    totalWageredCoins: string;
    totalCommissionAtomic: string;
    totalCommissionCoins: string;
    claimableCommissionAtomic: string;
    claimableCommissionCoins: string;
    claimedCommissionAtomic: string;
    claimedCommissionCoins: string;
    currency: string;
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
    totalWageredCoins: string;
    totalCommissionAtomic: string;
    totalCommissionCoins: string;
    claimableCommissionAtomic: string;
    claimableCommissionCoins: string;
    claimedCommissionAtomic: string;
    claimedCommissionCoins: string;
    bonusReceivedAtomic: string;
    bonusReceivedCoins: string;
    active: boolean;
  }>;
}

export async function getAffiliateDashboard(): Promise<AffiliateDashboard> {
  return request<AffiliateDashboard>("/affiliates/dashboard");
}

export function getApiUrl() {
  return getApi();
}

export function getWsUrl() {
  const base = getBaseUrl().replace(/^http/, "ws");
  return `${base}/api/v1/roulette/ws`;
}
