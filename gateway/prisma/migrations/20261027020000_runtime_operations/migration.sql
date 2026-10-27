-- Expand-only operation ledger. EXECUTING/UNCERTAIN never auto-replay effects.
CREATE TABLE "RuntimeOperation" (
 "id" TEXT NOT NULL, "operationKey" CHAR(64) NOT NULL, "kind" TEXT NOT NULL,
 "inputHash" CHAR(64) NOT NULL, "payload" JSONB NOT NULL, "authority" JSONB NOT NULL,
 "queueDispatchExhausted" BOOLEAN NOT NULL DEFAULT false,
 "status" TEXT NOT NULL DEFAULT 'PREPARED', "ownerToken" TEXT, "checkpoint" JSONB,
 "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RuntimeOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RuntimeOperation_operationKey_key" ON "RuntimeOperation"("operationKey");
CREATE INDEX "RuntimeOperation_kind_status_updatedAt_idx" ON "RuntimeOperation"("kind", "status", "updatedAt");

ALTER TABLE "MultichainRelayJob" ADD COLUMN "queueDispatchExhausted" BOOLEAN NOT NULL DEFAULT false;
