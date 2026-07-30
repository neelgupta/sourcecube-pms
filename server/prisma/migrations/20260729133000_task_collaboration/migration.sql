ALTER TABLE "ProjectTask" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE TABLE "TaskFollower" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "taskId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TaskFollower_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskFollower_taskId_userId_key" ON "TaskFollower"("taskId", "userId");
CREATE INDEX "TaskFollower_tenantId_userId_idx" ON "TaskFollower"("tenantId", "userId");
ALTER TABLE "TaskFollower" ADD CONSTRAINT "TaskFollower_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskFollower" ADD CONSTRAINT "TaskFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CompanyUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaskComment" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "taskId" TEXT NOT NULL, "authorId" TEXT NOT NULL, "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskComment_tenantId_taskId_createdAt_idx" ON "TaskComment"("tenantId", "taskId", "createdAt");
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "CompanyUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaskChecklistItem" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "taskId" TEXT NOT NULL, "text" TEXT NOT NULL, "completed" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0, "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskChecklistItem_tenantId_taskId_position_idx" ON "TaskChecklistItem"("tenantId", "taskId", "position");
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaskAttachment" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "taskId" TEXT NOT NULL, "name" TEXT NOT NULL, "url" TEXT NOT NULL, "mimeType" TEXT,
  "sizeBytes" INTEGER, "uploadedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskAttachment_tenantId_taskId_idx" ON "TaskAttachment"("tenantId", "taskId");
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaskDependency" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "taskId" TEXT NOT NULL, "dependsOnTaskId" TEXT NOT NULL, "type" TEXT NOT NULL DEFAULT 'blocked_by',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");
CREATE INDEX "TaskDependency_tenantId_dependsOnTaskId_idx" ON "TaskDependency"("tenantId", "dependsOnTaskId");
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;