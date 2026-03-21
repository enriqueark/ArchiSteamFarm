-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('BTC', 'ETH', 'USDT', 'USDC');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('ADMIN_ADJUSTMENT', 'DEPOSIT', 'WITHDRAWAL', 'WITHDRAWAL_FEE', 'BONUS', 'BET_HOLD', 'BET_RELEASE', 'BET_CAPTURE', 'BET_PAYOUT');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CONFIRMING', 'COMPLETED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'BROADCASTED', 'CONFIRMING', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BetReservationStatus" AS ENUM ('HELD', 'RELEASED', 'CAPTURED');

-- CreateEnum
CREATE TYPE "ProvablyFairSeedStatus" AS ENUM ('ACTIVE', 'REVEALED');

-- CreateEnum
CREATE TYPE "MinesGameStatus" AS ENUM ('ACTIVE', 'LOST', 'CASHED_OUT');

-- CreateEnum
CREATE TYPE "RouletteRoundStatus" AS ENUM ('OPEN', 'CLOSED', 'SPINNING', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RouletteBetType" AS ENUM ('STRAIGHT', 'RED', 'BLACK', 'EVEN', 'ODD', 'LOW', 'HIGH', 'DOZEN_1', 'DOZEN_2', 'DOZEN_3');

-- CreateEnum
CREATE TYPE "RouletteBetStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'VOID');

-- CreateEnum
CREATE TYPE "CasinoBetStatus" AS ENUM ('PENDING', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "GameResultOutcome" AS ENUM ('WON', 'LOST');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "balanceAtomic" BIGINT NOT NULL DEFAULT 0,
    "lockedAtomic" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chainIndex" BIGINT NOT NULL DEFAULT 0,
    "previousHash" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    "currentHash" TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    "direction" "LedgerDirection" NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "amountAtomic" BIGINT NOT NULL,
    "balanceBeforeAtomic" BIGINT NOT NULL,
    "balanceAfterAtomic" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "casino_bets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "gameType" TEXT NOT NULL,
    "roundReference" TEXT NOT NULL,
    "amountAtomic" BIGINT NOT NULL,
    "multiplier" DECIMAL(18,8) NOT NULL,
    "placeBalanceBeforeAtomic" BIGINT NOT NULL,
    "placeBalanceAfterAtomic" BIGINT NOT NULL,
    "placeLockedAfterAtomic" BIGINT NOT NULL,
    "payoutAtomic" BIGINT,
    "status" "CasinoBetStatus" NOT NULL DEFAULT 'PENDING',
    "placeIdempotencyKey" TEXT NOT NULL,
    "settleIdempotencyKey" TEXT,
    "captureTransactionId" TEXT,
    "payoutTransactionId" TEXT,
    "settleBalanceBeforeAtomic" BIGINT,
    "settleBalanceAfterAtomic" BIGINT,
    "settleLockedAfterAtomic" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "casino_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bet_game_results" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "gameResult" "GameResultOutcome" NOT NULL,
    "decisionNonce" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "signature" TEXT NOT NULL,
    "signatureVersion" TEXT NOT NULL DEFAULT 'ED25519_V1',
    "payloadHash" TEXT NOT NULL,
    "createdByServiceRole" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bet_game_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bet_reservations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "betReference" TEXT NOT NULL,
    "amountAtomic" BIGINT NOT NULL,
    "status" "BetReservationStatus" NOT NULL DEFAULT 'HELD',
    "holdIdempotencyKey" TEXT,
    "releaseIdempotencyKey" TEXT,
    "captureIdempotencyKey" TEXT,
    "holdTransactionId" TEXT NOT NULL,
    "releaseTransactionId" TEXT,
    "captureTransactionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),

    CONSTRAINT "bet_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provably_fair_seeds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "status" "ProvablyFairSeedStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revealedAt" TIMESTAMP(3),

    CONSTRAINT "provably_fair_seeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provably_fair_profiles" (
    "userId" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "activeSeedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provably_fair_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "mines_games" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "betAtomic" BIGINT NOT NULL,
    "mineCount" INTEGER NOT NULL,
    "boardSize" INTEGER NOT NULL DEFAULT 25,
    "status" "MinesGameStatus" NOT NULL DEFAULT 'ACTIVE',
    "serverSeedId" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "betReference" TEXT NOT NULL,
    "betReservationId" TEXT NOT NULL,
    "revealedCells" JSONB NOT NULL,
    "safeReveals" INTEGER NOT NULL DEFAULT 0,
    "currentMultiplier" DECIMAL(18,8) NOT NULL DEFAULT 1.0,
    "payoutAtomic" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "mines_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roulette_rounds" (
    "id" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "RouletteRoundStatus" NOT NULL DEFAULT 'OPEN',
    "openAt" TIMESTAMP(3) NOT NULL,
    "betsCloseAt" TIMESTAMP(3) NOT NULL,
    "spinStartsAt" TIMESTAMP(3) NOT NULL,
    "settleAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "spinningAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "winningNumber" INTEGER,
    "winningColor" TEXT,
    "totalStakedAtomic" BIGINT NOT NULL DEFAULT 0,
    "totalPayoutAtomic" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "roulette_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roulette_bets" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "betType" "RouletteBetType" NOT NULL,
    "betValue" INTEGER,
    "stakeAtomic" BIGINT NOT NULL,
    "payoutAtomic" BIGINT,
    "status" "RouletteBetStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "betReference" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "roulette_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'mainnet',
    "amountAtomic" BIGINT NOT NULL,
    "txHash" TEXT,
    "txVout" INTEGER,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "requiredConfirmations" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT,
    "creditedTransactionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'mainnet',
    "destinationAddress" TEXT NOT NULL,
    "amountAtomic" BIGINT NOT NULL,
    "feeAtomic" BIGINT NOT NULL DEFAULT 0,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "txHash" TEXT,
    "debitTransactionId" TEXT,
    "feeTransactionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "broadcastedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_currency_key" ON "wallets"("userId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_id_currency_key" ON "wallets"("id", "currency");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_chainIndex_idx" ON "wallet_transactions"("walletId", "chainIndex" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_currentHash_idx" ON "wallet_transactions"("currentHash");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_walletId_chainIndex_key" ON "wallet_transactions"("walletId", "chainIndex");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_walletId_idempotencyKey_key" ON "wallet_transactions"("walletId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "casino_bets_settleIdempotencyKey_key" ON "casino_bets"("settleIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "casino_bets_captureTransactionId_key" ON "casino_bets"("captureTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "casino_bets_payoutTransactionId_key" ON "casino_bets"("payoutTransactionId");

-- CreateIndex
CREATE INDEX "casino_bets_userId_status_createdAt_idx" ON "casino_bets"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "casino_bets_walletId_status_createdAt_idx" ON "casino_bets"("walletId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "casino_bets_gameType_roundReference_createdAt_idx" ON "casino_bets"("gameType", "roundReference", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "casino_bets_userId_placeIdempotencyKey_key" ON "casino_bets"("userId", "placeIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "bet_game_results_betId_key" ON "bet_game_results"("betId");

-- CreateIndex
CREATE UNIQUE INDEX "bet_game_results_decisionNonce_key" ON "bet_game_results"("decisionNonce");

-- CreateIndex
CREATE INDEX "bet_game_results_createdAt_idx" ON "bet_game_results"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "bet_game_results_decisionNonce_idx" ON "bet_game_results"("decisionNonce");

-- CreateIndex
CREATE UNIQUE INDEX "bet_reservations_holdTransactionId_key" ON "bet_reservations"("holdTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "bet_reservations_releaseTransactionId_key" ON "bet_reservations"("releaseTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "bet_reservations_captureTransactionId_key" ON "bet_reservations"("captureTransactionId");

-- CreateIndex
CREATE INDEX "bet_reservations_userId_status_createdAt_idx" ON "bet_reservations"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "bet_reservations_walletId_status_createdAt_idx" ON "bet_reservations"("walletId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bet_reservations_walletId_betReference_key" ON "bet_reservations"("walletId", "betReference");

-- CreateIndex
CREATE UNIQUE INDEX "bet_reservations_walletId_holdIdempotencyKey_key" ON "bet_reservations"("walletId", "holdIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "provably_fair_seeds_serverSeedHash_key" ON "provably_fair_seeds"("serverSeedHash");

-- CreateIndex
CREATE INDEX "provably_fair_seeds_userId_status_createdAt_idx" ON "provably_fair_seeds"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "provably_fair_profiles_activeSeedId_idx" ON "provably_fair_profiles"("activeSeedId");

-- CreateIndex
CREATE UNIQUE INDEX "mines_games_betReference_key" ON "mines_games"("betReference");

-- CreateIndex
CREATE UNIQUE INDEX "mines_games_betReservationId_key" ON "mines_games"("betReservationId");

-- CreateIndex
CREATE INDEX "mines_games_userId_status_createdAt_idx" ON "mines_games"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "mines_games_userId_createdAt_idx" ON "mines_games"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "roulette_rounds_currency_status_betsCloseAt_idx" ON "roulette_rounds"("currency", "status", "betsCloseAt");

-- CreateIndex
CREATE INDEX "roulette_rounds_status_settleAt_idx" ON "roulette_rounds"("status", "settleAt");

-- CreateIndex
CREATE UNIQUE INDEX "roulette_rounds_currency_roundNumber_key" ON "roulette_rounds"("currency", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "roulette_bets_betReference_key" ON "roulette_bets"("betReference");

-- CreateIndex
CREATE UNIQUE INDEX "roulette_bets_reservationId_key" ON "roulette_bets"("reservationId");

-- CreateIndex
CREATE INDEX "roulette_bets_roundId_status_createdAt_idx" ON "roulette_bets"("roundId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "roulette_bets_userId_createdAt_idx" ON "roulette_bets"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "roulette_bets_userId_idempotencyKey_key" ON "roulette_bets"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_creditedTransactionId_key" ON "deposits"("creditedTransactionId");

-- CreateIndex
CREATE INDEX "deposits_userId_status_createdAt_idx" ON "deposits"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "deposits_walletId_status_createdAt_idx" ON "deposits"("walletId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "deposits_network_txHash_idx" ON "deposits"("network", "txHash");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_walletId_idempotencyKey_key" ON "deposits"("walletId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_debitTransactionId_key" ON "withdrawals"("debitTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_feeTransactionId_key" ON "withdrawals"("feeTransactionId");

-- CreateIndex
CREATE INDEX "withdrawals_userId_status_createdAt_idx" ON "withdrawals"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "withdrawals_walletId_status_createdAt_idx" ON "withdrawals"("walletId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "withdrawals_network_txHash_idx" ON "withdrawals"("network", "txHash");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_walletId_idempotencyKey_key" ON "withdrawals"("walletId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_idx" ON "outbox_events"("publishedAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_walletId_currency_fkey" FOREIGN KEY ("walletId", "currency") REFERENCES "wallets"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_captureTransactionId_fkey" FOREIGN KEY ("captureTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "casino_bets" ADD CONSTRAINT "casino_bets_payoutTransactionId_fkey" FOREIGN KEY ("payoutTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bet_game_results" ADD CONSTRAINT "bet_game_results_betId_fkey" FOREIGN KEY ("betId") REFERENCES "casino_bets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bet_reservations" ADD CONSTRAINT "bet_reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bet_reservations" ADD CONSTRAINT "bet_reservations_walletId_currency_fkey" FOREIGN KEY ("walletId", "currency") REFERENCES "wallets"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bet_reservations" ADD CONSTRAINT "bet_reservations_holdTransactionId_fkey" FOREIGN KEY ("holdTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bet_reservations" ADD CONSTRAINT "bet_reservations_releaseTransactionId_fkey" FOREIGN KEY ("releaseTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bet_reservations" ADD CONSTRAINT "bet_reservations_captureTransactionId_fkey" FOREIGN KEY ("captureTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provably_fair_seeds" ADD CONSTRAINT "provably_fair_seeds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provably_fair_profiles" ADD CONSTRAINT "provably_fair_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provably_fair_profiles" ADD CONSTRAINT "provably_fair_profiles_activeSeedId_fkey" FOREIGN KEY ("activeSeedId") REFERENCES "provably_fair_seeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mines_games" ADD CONSTRAINT "mines_games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mines_games" ADD CONSTRAINT "mines_games_serverSeedId_fkey" FOREIGN KEY ("serverSeedId") REFERENCES "provably_fair_seeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mines_games" ADD CONSTRAINT "mines_games_betReservationId_fkey" FOREIGN KEY ("betReservationId") REFERENCES "bet_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roulette_rounds" ADD CONSTRAINT "roulette_rounds_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roulette_bets" ADD CONSTRAINT "roulette_bets_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "roulette_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roulette_bets" ADD CONSTRAINT "roulette_bets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roulette_bets" ADD CONSTRAINT "roulette_bets_walletId_currency_fkey" FOREIGN KEY ("walletId", "currency") REFERENCES "wallets"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roulette_bets" ADD CONSTRAINT "roulette_bets_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "bet_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_walletId_currency_fkey" FOREIGN KEY ("walletId", "currency") REFERENCES "wallets"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_creditedTransactionId_fkey" FOREIGN KEY ("creditedTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_walletId_currency_fkey" FOREIGN KEY ("walletId", "currency") REFERENCES "wallets"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_debitTransactionId_fkey" FOREIGN KEY ("debitTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_feeTransactionId_fkey" FOREIGN KEY ("feeTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
