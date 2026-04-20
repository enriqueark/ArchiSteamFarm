-- Realtime public chat messages
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'GLOBAL',
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "channel" TEXT;

UPDATE "chat_messages"
SET "channel" = COALESCE("channel", 'GLOBAL')
WHERE "channel" IS NULL;

ALTER TABLE "chat_messages"
  ALTER COLUMN "channel" SET DEFAULT 'GLOBAL';

CREATE INDEX IF NOT EXISTS "chat_messages_channel_createdAt_idx"
  ON "chat_messages"("channel", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "chat_messages_userId_createdAt_idx"
  ON "chat_messages"("userId", "createdAt" DESC);
