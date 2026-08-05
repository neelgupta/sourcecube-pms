-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'task_overdue_review';
ALTER TYPE "NotificationType" ADD VALUE 'task_review_resolved';

-- CreateEnum
CREATE TYPE "OverdueReviewStatus" AS ENUM ('pending_review', 'resolved');

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "overdueReviewStatus" "OverdueReviewStatus";

-- CreateTable
CREATE TABLE "TaskOverdueReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalDueDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "reasonSubmittedAt" TIMESTAMP(3),
    "reasonSubmittedBy" TEXT,
    "approverId" TEXT NOT NULL,
    "status" "OverdueReviewStatus" NOT NULL DEFAULT 'pending_review',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionAction" TEXT,
    "newEstimatedMinutes" INTEGER,
    "newDueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskOverdueReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskOverdueReview_tenantId_taskId_idx" ON "TaskOverdueReview"("tenantId", "taskId");

-- CreateIndex
CREATE INDEX "TaskOverdueReview_tenantId_approverId_status_idx" ON "TaskOverdueReview"("tenantId", "approverId", "status");

-- AddForeignKey
ALTER TABLE "TaskOverdueReview" ADD CONSTRAINT "TaskOverdueReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOverdueReview" ADD CONSTRAINT "TaskOverdueReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
