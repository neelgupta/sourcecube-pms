-- AlterTable
ALTER TABLE "WorkingSchedule" ADD COLUMN     "breakEndTime" TEXT NOT NULL DEFAULT '14:30',
ADD COLUMN     "breakStartTime" TEXT NOT NULL DEFAULT '14:00';

