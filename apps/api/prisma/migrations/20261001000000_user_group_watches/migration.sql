CREATE TABLE "Watch" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Watch_userId_groupId_key" ON "Watch"("userId", "groupId");
CREATE INDEX "Watch_groupId_idx" ON "Watch"("groupId");

ALTER TABLE "Watch" ADD CONSTRAINT "Watch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
