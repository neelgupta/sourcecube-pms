-- CreateTable
CREATE TABLE "TaskReestimateRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "previousEstimatedMinutes" INTEGER NOT NULL,
    "requestedEstimatedMinutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "OverdueReviewStatus" NOT NULL DEFAULT 'pending_review',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "approvedEstimatedMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskReestimateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTimeEntryChangeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "previousDurationSeconds" INTEGER NOT NULL,
    "requestedDurationSeconds" INTEGER NOT NULL,
    "previousActivityType" TEXT NOT NULL,
    "requestedActivityType" TEXT NOT NULL,
    "previousBillable" BOOLEAN NOT NULL,
    "requestedBillable" BOOLEAN NOT NULL,
    "previousNote" TEXT,
    "requestedNote" TEXT,
    "reason" TEXT NOT NULL,
    "status" "OverdueReviewStatus" NOT NULL DEFAULT 'pending_review',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTimeEntryChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskReestimateRequest_tenantId_taskId_idx" ON "TaskReestimateRequest"("tenantId", "taskId");

-- CreateIndex
CREATE INDEX "TaskReestimateRequest_tenantId_approverId_status_idx" ON "TaskReestimateRequest"("tenantId", "approverId", "status");

-- CreateIndex
CREATE INDEX "TaskTimeEntryChangeRequest_tenantId_entryId_idx" ON "TaskTimeEntryChangeRequest"("tenantId", "entryId");

-- CreateIndex
CREATE INDEX "TaskTimeEntryChangeRequest_tenantId_approverId_status_idx" ON "TaskTimeEntryChangeRequest"("tenantId", "approverId", "status");

-- AddForeignKey
ALTER TABLE "TaskReestimateRequest" ADD CONSTRAINT "TaskReestimateRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskReestimateRequest" ADD CONSTRAINT "TaskReestimateRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntryChangeRequest" ADD CONSTRAINT "TaskTimeEntryChangeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntryChangeRequest" ADD CONSTRAINT "TaskTimeEntryChangeRequest_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TaskTimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
