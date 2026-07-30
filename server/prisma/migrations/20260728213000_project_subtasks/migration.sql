ALTER TABLE "ProjectTask" ADD COLUMN "parentTaskId" TEXT;
CREATE INDEX "ProjectTask_parentTaskId_idx" ON "ProjectTask"("parentTaskId");
ALTER TABLE "ProjectTask"
  ADD CONSTRAINT "ProjectTask_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "ProjectTask"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
