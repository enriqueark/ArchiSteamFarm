CREATE TABLE IF NOT EXISTS "cases" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priceAtomic" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'USDT',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "case_items" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "valueAtomic" BIGINT NOT NULL,
  "dropRate" DECIMAL(18,8) NOT NULL,
  "imageUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "case_openings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "caseItemId" TEXT NOT NULL,
  "currency" "Currency" NOT NULL,
  "priceAtomic" BIGINT NOT NULL,
  "payoutAtomic" BIGINT NOT NULL,
  "profitAtomic" BIGINT NOT NULL,
  "betReference" TEXT NOT NULL,
  "betReservationId" TEXT NOT NULL,
  "serverSeedId" TEXT NOT NULL,
  "serverSeedHash" TEXT NOT NULL,
  "clientSeed" TEXT NOT NULL,
  "nonce" INTEGER NOT NULL,
  "roll" DOUBLE PRECISION NOT NULL,
  "topTierEligible" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_openings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cases_slug_key" ON "cases"("slug");
CREATE INDEX IF NOT EXISTS "cases_isActive_createdAt_idx" ON "cases"("isActive", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "case_items_caseId_sortOrder_idx" ON "case_items"("caseId", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "case_openings_betReference_key" ON "case_openings"("betReference");
CREATE UNIQUE INDEX IF NOT EXISTS "case_openings_betReservationId_key" ON "case_openings"("betReservationId");
CREATE INDEX IF NOT EXISTS "case_openings_userId_createdAt_idx" ON "case_openings"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "case_openings_caseId_createdAt_idx" ON "case_openings"("caseId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cases_createdByUserId_fkey') THEN
    ALTER TABLE "cases"
    ADD CONSTRAINT "cases_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_items_caseId_fkey') THEN
    ALTER TABLE "case_items"
    ADD CONSTRAINT "case_items_caseId_fkey"
      FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_openings_userId_fkey') THEN
    ALTER TABLE "case_openings"
    ADD CONSTRAINT "case_openings_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_openings_caseId_fkey') THEN
    ALTER TABLE "case_openings"
    ADD CONSTRAINT "case_openings_caseId_fkey"
      FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_openings_caseItemId_fkey') THEN
    ALTER TABLE "case_openings"
    ADD CONSTRAINT "case_openings_caseItemId_fkey"
      FOREIGN KEY ("caseItemId") REFERENCES "case_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_openings_betReservationId_fkey') THEN
    ALTER TABLE "case_openings"
    ADD CONSTRAINT "case_openings_betReservationId_fkey"
      FOREIGN KEY ("betReservationId") REFERENCES "bet_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_openings_serverSeedId_fkey') THEN
    ALTER TABLE "case_openings"
    ADD CONSTRAINT "case_openings_serverSeedId_fkey"
      FOREIGN KEY ("serverSeedId") REFERENCES "provably_fair_seeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
