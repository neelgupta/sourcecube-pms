ALTER TABLE "Project" ADD COLUMN "trackedSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD COLUMN "trackedSeconds" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TaskTimeEntry" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activityType" TEXT NOT NULL DEFAULT 'Work',
  "billable" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskTimeEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskTimeEntry_tenantId_projectId_taskId_idx" ON "TaskTimeEntry"("tenantId", "projectId", "taskId");
CREATE INDEX "TaskTimeEntry_userId_endedAt_idx" ON "TaskTimeEntry"("userId", "endedAt");
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CompanyUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
