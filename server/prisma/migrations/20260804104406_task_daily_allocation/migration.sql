-- CreateTable
CREATE TABLE "TaskDailyAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskDailyAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDailyAllocation_tenantId_userId_date_idx" ON "TaskDailyAllocation"("tenantId", "userId", "date");

-- CreateIndex
CREATE INDEX "TaskDailyAllocation_tenantId_taskId_idx" ON "TaskDailyAllocation"("tenantId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDailyAllocation_taskId_userId_date_key" ON "TaskDailyAllocation"("taskId", "userId", "date");

-- AddForeignKey
ALTER TABLE "TaskDailyAllocation" ADD CONSTRAINT "TaskDailyAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDailyAllocation" ADD CONSTRAINT "TaskDailyAllocation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDailyAllocation" ADD CONSTRAINT "TaskDailyAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "CompanyUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
