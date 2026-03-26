-- Blackjack game mode with persisted active sessions
CREATE TYPE "BlackjackGameStatus" AS ENUM ('ACTIVE', 'WON', 'LOST', 'PUSH', 'CANCELLED');

CREATE TABLE "blackjack_games" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currency" "Currency" NOT NULL,
  "initialBetAtomic" BIGINT NOT NULL,
  "mainBetAtomic" BIGINT NOT NULL,
  "sideBetPairsAtomic" BIGINT NOT NULL DEFAULT 0,
  "sideBet21Plus3Atomic" BIGINT NOT NULL DEFAULT 0,
  "insuranceBetAtomic" BIGINT,
  "status" "BlackjackGameStatus" NOT NULL DEFAULT 'ACTIVE',
  "outcome" TEXT,
  "betReference" TEXT NOT NULL,
  "betReservationId" TEXT NOT NULL,
  "playerHands" JSONB NOT NULL,
  "dealerCards" JSONB NOT NULL,
  "deck" JSONB NOT NULL,
  "activeHandIndex" INTEGER NOT NULL DEFAULT 0,
  "dealerRevealed" BOOLEAN NOT NULL DEFAULT false,
  "canSplit" BOOLEAN NOT NULL DEFAULT false,
  "canInsurance" BOOLEAN NOT NULL DEFAULT false,
  "mainPayoutAtomic" BIGINT,
  "sidePayoutAtomic" BIGINT,
  "insurancePayoutAtomic" BIGINT,
  "payoutAtomic" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),

  CONSTRAINT "blackjack_games_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blackjack_games_betReference_key" ON "blackjack_games"("betReference");
CREATE UNIQUE INDEX "blackjack_games_betReservationId_key" ON "blackjack_games"("betReservationId");
CREATE INDEX "blackjack_games_userId_status_createdAt_idx"
  ON "blackjack_games"("userId", "status", "createdAt" DESC);
CREATE INDEX "blackjack_games_userId_createdAt_idx"
  ON "blackjack_games"("userId", "createdAt" DESC);

ALTER TABLE "blackjack_games"
  ADD CONSTRAINT "blackjack_games_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "blackjack_games"
  ADD CONSTRAINT "blackjack_games_betReservationId_fkey"
  FOREIGN KEY ("betReservationId") REFERENCES "bet_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
