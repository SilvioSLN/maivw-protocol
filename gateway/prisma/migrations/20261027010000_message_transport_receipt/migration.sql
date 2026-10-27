-- Expand-only: preserve existing messages and N-1 readers.
ALTER TABLE "Message" ADD COLUMN "transportProvider" TEXT;
ALTER TABLE "Message" ADD COLUMN "transportMessageId" TEXT;
