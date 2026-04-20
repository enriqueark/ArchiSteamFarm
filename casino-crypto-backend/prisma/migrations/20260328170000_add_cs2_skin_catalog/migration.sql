CREATE TABLE IF NOT EXISTS "cs2_skin_catalog" (
  "id" TEXT NOT NULL,
  "sourceProvider" TEXT NOT NULL DEFAULT 'RAIN_GG',
  "sourceCaseSlug" TEXT,
  "sourceSkinKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "valueAtomic" BIGINT NOT NULL,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cs2_skin_catalog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "case_items"
ADD COLUMN IF NOT EXISTS "cs2SkinId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "cs2_skin_catalog_sourceProvider_sourceSkinKey_key"
ON "cs2_skin_catalog"("sourceProvider", "sourceSkinKey");

CREATE INDEX IF NOT EXISTS "cs2_skin_catalog_name_idx"
ON "cs2_skin_catalog"("name");

CREATE INDEX IF NOT EXISTS "cs2_skin_catalog_sourceCaseSlug_idx"
ON "cs2_skin_catalog"("sourceCaseSlug");

CREATE INDEX IF NOT EXISTS "case_items_cs2SkinId_idx"
ON "case_items"("cs2SkinId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cs2_skin_catalog_createdByUserId_fkey') THEN
    ALTER TABLE "cs2_skin_catalog"
    ADD CONSTRAINT "cs2_skin_catalog_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_items_cs2SkinId_fkey') THEN
    ALTER TABLE "case_items"
    ADD CONSTRAINT "case_items_cs2SkinId_fkey"
      FOREIGN KEY ("cs2SkinId") REFERENCES "cs2_skin_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
