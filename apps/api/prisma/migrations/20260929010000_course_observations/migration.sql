CREATE TYPE "GroupAvailabilityStatus" AS ENUM ('AVAILABLE', 'FULL', 'UNKNOWN');
CREATE TYPE "GroupStateEventKind" AS ENUM ('DISCOVERED', 'STATUS_CHANGED');

CREATE TABLE "Course" (
    "id" UUID NOT NULL,
    "btuCourseId" VARCHAR(255) NOT NULL,
    "name" VARCHAR(500),
    "lastObservedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Group" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "btuGroupId" VARCHAR(255) NOT NULL,
    "name" VARCHAR(500),
    "capacity" INTEGER,
    "status" "GroupAvailabilityStatus" NOT NULL,
    "chooseUrl" VARCHAR(2048),
    "firstObservedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastObservedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Group_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Group_capacity_check" CHECK ("capacity" IS NULL OR "capacity" >= 0)
);

CREATE TABLE "GroupStateChange" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "kind" "GroupStateEventKind" NOT NULL,
    "previousStatus" "GroupAvailabilityStatus",
    "status" "GroupAvailabilityStatus" NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupStateChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GroupStateChange_kind_check" CHECK (
        ("kind" = 'DISCOVERED' AND "previousStatus" IS NULL)
        OR ("kind" = 'STATUS_CHANGED' AND "previousStatus" IS NOT NULL AND "previousStatus" <> "status")
    )
);

CREATE UNIQUE INDEX "Course_btuCourseId_key" ON "Course"("btuCourseId");
CREATE UNIQUE INDEX "Group_courseId_btuGroupId_key" ON "Group"("courseId", "btuGroupId");
CREATE UNIQUE INDEX "GroupStateChange_groupId_observedAt_key" ON "GroupStateChange"("groupId", "observedAt");
CREATE INDEX "GroupStateChange_observedAt_idx" ON "GroupStateChange"("observedAt");

ALTER TABLE "Group" ADD CONSTRAINT "Group_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupStateChange" ADD CONSTRAINT "GroupStateChange_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
