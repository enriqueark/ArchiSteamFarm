DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BattleTemplate') THEN
    CREATE TYPE "BattleTemplate" AS ENUM (
      'ONE_VS_ONE',
      'TWO_VS_TWO',
      'ONE_VS_ONE_VS_ONE',
      'ONE_VS_ONE_VS_ONE_VS_ONE',
      'ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE_VS_ONE',
      'TWO_VS_TWO_VS_TWO',
      'THREE_VS_THREE'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BattleStatus') THEN
    CREATE TYPE "BattleStatus" AS ENUM ('OPEN', 'RUNNING', 'SETTLED', 'CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BattleSlotState') THEN
    CREATE TYPE "BattleSlotState" AS ENUM ('OPEN', 'JOINED', 'BOT_FILLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "battles" (
  "id" TEXT NOT NULL,
  "status" "BattleStatus" NOT NULL DEFAULT 'OPEN',
  "template" "BattleTemplate" NOT NULL,
  "modeCrazy" BOOLEAN NOT NULL DEFAULT false,
  "modeGroup" BOOLEAN NOT NULL DEFAULT false,
  "modeJackpot" BOOLEAN NOT NULL DEFAULT false,
  "modeTerminal" BOOLEAN NOT NULL DEFAULT false,
  "modePrivate" BOOLEAN NOT NULL DEFAULT false,
  "modeBorrow" BOOLEAN NOT NULL DEFAULT false,
  "maxCases" INTEGER NOT NULL DEFAULT 50,
  "totalCostAtomic" BIGINT NOT NULL DEFAULT 0,
  "totalPayoutAtomic" BIGINT NOT NULL DEFAULT 0,
  "winnerTeam" INTEGER,
  "winnerUserId" TEXT,
  "jackpotWinnerSlotId" TEXT,
  "jackpotSeed" TEXT,
  "jackpotRoll" DOUBLE PRECISION,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "battles_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "battles"
  ADD COLUMN IF NOT EXISTS "modeBorrow" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "battle_cases" (
  "id" TEXT NOT NULL,
  "battleId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "priceAtomic" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "battle_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "battle_slots" (
  "id" TEXT NOT NULL,
  "battleId" TEXT NOT NULL,
  "seatIndex" INTEGER NOT NULL,
  "teamIndex" INTEGER NOT NULL,
  "state" "BattleSlotState" NOT NULL DEFAULT 'OPEN',
  "userId" TEXT,
  "displayName" TEXT NOT NULL,
  "isBot" BOOLEAN NOT NULL DEFAULT false,
  "borrowPercent" INTEGER NOT NULL DEFAULT 100,
  "paidAmountAtomic" BIGINT NOT NULL DEFAULT 0,
  "payoutAtomic" BIGINT NOT NULL DEFAULT 0,
  "winWeightAtomic" BIGINT NOT NULL DEFAULT 0,
  "profitAtomic" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "battle_slots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "battle_item_drops" (
  "id" TEXT NOT NULL,
  "battleId" TEXT NOT NULL,
  "battleCaseId" TEXT NOT NULL,
  "battleSlotId" TEXT NOT NULL,
  "roundIndex" INTEGER NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "caseItemId" TEXT NOT NULL,
  "valueAtomic" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "battle_item_drops_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "battles_status_createdAt_idx"
  ON "battles"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "battles_modePrivate_status_createdAt_idx"
  ON "battles"("modePrivate", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "battles_createdByUserId_createdAt_idx"
  ON "battles"("createdByUserId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "battle_cases_battleId_orderIndex_key"
  ON "battle_cases"("battleId", "orderIndex");
CREATE INDEX IF NOT EXISTS "battle_cases_battleId_idx"
  ON "battle_cases"("battleId");

CREATE UNIQUE INDEX IF NOT EXISTS "battle_slots_battleId_seatIndex_key"
  ON "battle_slots"("battleId", "seatIndex");
CREATE INDEX IF NOT EXISTS "battle_slots_battleId_teamIndex_idx"
  ON "battle_slots"("battleId", "teamIndex");
CREATE INDEX IF NOT EXISTS "battle_slots_battleId_state_idx"
  ON "battle_slots"("battleId", "state");
CREATE INDEX IF NOT EXISTS "battle_slots_userId_createdAt_idx"
  ON "battle_slots"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "battle_item_drops_battleId_roundIndex_orderIndex_idx"
  ON "battle_item_drops"("battleId", "roundIndex", "orderIndex");
CREATE INDEX IF NOT EXISTS "battle_item_drops_battleSlotId_createdAt_idx"
  ON "battle_item_drops"("battleSlotId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battles_createdByUserId_fkey') THEN
    ALTER TABLE "battles"
      ADD CONSTRAINT "battles_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battles_winnerUserId_fkey') THEN
    ALTER TABLE "battles"
      ADD CONSTRAINT "battles_winnerUserId_fkey"
      FOREIGN KEY ("winnerUserId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_cases_battleId_fkey') THEN
    ALTER TABLE "battle_cases"
      ADD CONSTRAINT "battle_cases_battleId_fkey"
      FOREIGN KEY ("battleId") REFERENCES "battles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_cases_caseId_fkey') THEN
    ALTER TABLE "battle_cases"
      ADD CONSTRAINT "battle_cases_caseId_fkey"
      FOREIGN KEY ("caseId") REFERENCES "cases"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_slots_battleId_fkey') THEN
    ALTER TABLE "battle_slots"
      ADD CONSTRAINT "battle_slots_battleId_fkey"
      FOREIGN KEY ("battleId") REFERENCES "battles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_slots_userId_fkey') THEN
    ALTER TABLE "battle_slots"
      ADD CONSTRAINT "battle_slots_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_item_drops_battleId_fkey') THEN
    ALTER TABLE "battle_item_drops"
      ADD CONSTRAINT "battle_item_drops_battleId_fkey"
      FOREIGN KEY ("battleId") REFERENCES "battles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_item_drops_battleCaseId_fkey') THEN
    ALTER TABLE "battle_item_drops"
      ADD CONSTRAINT "battle_item_drops_battleCaseId_fkey"
      FOREIGN KEY ("battleCaseId") REFERENCES "battle_cases"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_item_drops_battleSlotId_fkey') THEN
    ALTER TABLE "battle_item_drops"
      ADD CONSTRAINT "battle_item_drops_battleSlotId_fkey"
      FOREIGN KEY ("battleSlotId") REFERENCES "battle_slots"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_item_drops_caseItemId_fkey') THEN
    ALTER TABLE "battle_item_drops"
      ADD CONSTRAINT "battle_item_drops_caseItemId_fkey"
      FOREIGN KEY ("caseItemId") REFERENCES "case_items"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
