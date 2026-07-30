ALTER TYPE "ProjectStatus" RENAME VALUE 'not_started' TO 'new';
ALTER TYPE "ProjectStatus" RENAME VALUE 'overdue' TO 'cancelled';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'planning' BEFORE 'in_progress';
ALTER TYPE "ProjectPriority" RENAME VALUE 'urgent' TO 'critical';

CREATE TYPE "ProjectMethodology" AS ENUM ('agile', 'waterfall', 'kanban');
CREATE TYPE "ProjectType" AS ENUM ('internal', 'client', 'product', 'support', 'maintenance');
CREATE TYPE "ProjectVisibility" AS ENUM ('public', 'private', 'restricted');
CREATE TYPE "TaskStatus" AS ENUM ('new_request', 'in_progress', 'done');
CREATE TYPE "BudgetStatus" AS ENUM ('not_set', 'on_track', 'warning', 'over_budget', 'closed');
CREATE TYPE "HealthStatus" AS ENUM ('healthy', 'at_risk', 'critical', 'unavailable');
CREATE TYPE "ProjectMemberAccess" AS ENUM ('view', 'edit', 'manage');

ALTER TABLE "Project"
  ADD COLUMN "key" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "methodology" "ProjectMethodology" NOT NULL DEFAULT 'kanban',
  ADD COLUMN "type" "ProjectType" NOT NULL DEFAULT 'internal',
  ADD COLUMN "visibility" "ProjectVisibility" NOT NULL DEFAULT 'private',
  ADD COLUMN "category" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "actualStartDate" TIMESTAMP(3),
  ADD COLUMN "actualEndDate" TIMESTAMP(3),
  ADD COLUMN "budget" DECIMAL(14,2),
  ADD COLUMN "budgetSpent" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "budgetStatus" "BudgetStatus" NOT NULL DEFAULT 'not_set',
  ADD COLUMN "completionPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "healthScore" INTEGER,
  ADD COLUMN "healthStatus" "HealthStatus" NOT NULL DEFAULT 'unavailable',
  ADD COLUMN "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "departmentId" TEXT;

UPDATE "Project"
SET "key" = UPPER(SUBSTRING(REGEXP_REPLACE("name", '[^a-zA-Z0-9]', '', 'g') FROM 1 FOR 8)) || SUBSTRING("id" FROM 1 FOR 2);

ALTER TABLE "Project" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "Project_tenantId_key_key" ON "Project"("tenantId", "key");
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "CompanyUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectMember" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "access" "ProjectMemberAccess" NOT NULL DEFAULT 'edit',
  "isFollower" BOOLEAN NOT NULL DEFAULT false,
  "allocationPercent" INTEGER NOT NULL DEFAULT 100,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

CREATE TABLE "ProjectSection" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "TaskStatus" NOT NULL,
  "position" INTEGER NOT NULL,
  "ownerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectSection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectSection_projectId_name_key" ON "ProjectSection"("projectId", "name");

CREATE TABLE "ProjectMilestone" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "ownerId" TEXT,
  "startDate" TIMESTAMP(3),
  "releaseDate" TIMESTAMP(3),
  "progress" INTEGER NOT NULL DEFAULT 0,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectTask" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "code" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'new_request',
  "priority" "ProjectPriority" NOT NULL DEFAULT 'medium',
  "taskType" TEXT,
  "billingType" TEXT NOT NULL DEFAULT 'non_billable',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "startDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
  "trackedMinutes" INTEGER NOT NULL DEFAULT 0,
  "assigneeId" TEXT,
  "milestoneId" TEXT,
  "position" INTEGER NOT NULL,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectTask_projectId_code_key" ON "ProjectTask"("projectId", "code");

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CompanyUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSection" ADD CONSTRAINT "ProjectSection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSection" ADD CONSTRAINT "ProjectSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSection" ADD CONSTRAINT "ProjectSection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "CompanyUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "CompanyUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ProjectSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "CompanyUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ProjectSection" ("id", "tenantId", "projectId", "name", "status", "position", "updatedAt")
SELECT CONCAT("id", '-new'), "tenantId", "id", 'New Request', 'new_request', 0, CURRENT_TIMESTAMP FROM "Project";
INSERT INTO "ProjectSection" ("id", "tenantId", "projectId", "name", "status", "position", "updatedAt")
SELECT CONCAT("id", '-progress'), "tenantId", "id", 'In Progress', 'in_progress', 1, CURRENT_TIMESTAMP FROM "Project";
INSERT INTO "ProjectSection" ("id", "tenantId", "projectId", "name", "status", "position", "updatedAt")
SELECT CONCAT("id", '-done'), "tenantId", "id", 'Done', 'done', 2, CURRENT_TIMESTAMP FROM "Project";
