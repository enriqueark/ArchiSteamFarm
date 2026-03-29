ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "publicId" INTEGER;

CREATE SEQUENCE IF NOT EXISTS "users_publicId_seq";

ALTER SEQUENCE "users_publicId_seq"
OWNED BY "users"."publicId";

ALTER TABLE "users"
ALTER COLUMN "publicId" SET DEFAULT nextval('"users_publicId_seq"');

UPDATE "users"
SET "publicId" = nextval('"users_publicId_seq"')
WHERE "publicId" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "publicId" SET NOT NULL;

DO $$
DECLARE
  max_public_id INTEGER;
BEGIN
  SELECT MAX("publicId") INTO max_public_id FROM "users";
  IF max_public_id IS NULL OR max_public_id < 1 THEN
    PERFORM setval('"users_publicId_seq"', 1, false);
  ELSE
    PERFORM setval('"users_publicId_seq"', max_public_id, true);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "users_publicId_key"
ON "users"("publicId");
