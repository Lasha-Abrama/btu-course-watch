ALTER TABLE "EmailDelivery" ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "EmailDeliveryRecovery" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "operator" VARCHAR(80) NOT NULL,
    "ticket" VARCHAR(80) NOT NULL,
    "previousAttempts" INTEGER NOT NULL,
    "previousFailure" "EmailDeliveryFailure",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailDeliveryRecovery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDeliveryRecovery_deliveryId_ticket_key" ON "EmailDeliveryRecovery"("deliveryId", "ticket");
CREATE INDEX "EmailDeliveryRecovery_createdAt_idx" ON "EmailDeliveryRecovery"("createdAt");
ALTER TABLE "EmailDeliveryRecovery" ADD CONSTRAINT "EmailDeliveryRecovery_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "EmailDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmailDeliveryWorkerHealth" (
    "id" VARCHAR(20) NOT NULL,
    "lastStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastCycleCompletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "EmailDeliveryWorkerHealth_pkey" PRIMARY KEY ("id")
);
