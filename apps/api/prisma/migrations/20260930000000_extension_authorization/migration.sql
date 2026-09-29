CREATE TABLE "ExtensionLinkRequest" (
    "id" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "extensionId" VARCHAR(32) NOT NULL,
    "challengeHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtensionLinkRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExtensionLinkRequest_challenge_check" CHECK ("challengeHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ExtensionLinkRequest_approval_check" CHECK (("approvedByUserId" IS NULL) = ("approvedAt" IS NULL)),
    CONSTRAINT "ExtensionLinkRequest_consumed_check" CHECK ("consumedAt" IS NULL OR "approvedAt" IS NOT NULL)
);

CREATE TABLE "ExtensionObservationCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "extensionId" VARCHAR(32) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtensionObservationCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExtensionObservationCredential_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "ExtensionLinkRequest_expiresAt_idx" ON "ExtensionLinkRequest"("expiresAt");
CREATE INDEX "ExtensionLinkRequest_approvedByUserId_idx" ON "ExtensionLinkRequest"("approvedByUserId");
CREATE UNIQUE INDEX "ExtensionObservationCredential_tokenHash_key" ON "ExtensionObservationCredential"("tokenHash");
CREATE INDEX "ExtensionObservationCredential_userId_revokedAt_idx" ON "ExtensionObservationCredential"("userId", "revokedAt");
CREATE INDEX "ExtensionObservationCredential_installationId_idx" ON "ExtensionObservationCredential"("installationId");
CREATE INDEX "ExtensionObservationCredential_expiresAt_idx" ON "ExtensionObservationCredential"("expiresAt");
CREATE UNIQUE INDEX "ExtensionObservationCredential_active_installation_key" ON "ExtensionObservationCredential"("installationId") WHERE "revokedAt" IS NULL;

ALTER TABLE "ExtensionLinkRequest" ADD CONSTRAINT "ExtensionLinkRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtensionObservationCredential" ADD CONSTRAINT "ExtensionObservationCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
