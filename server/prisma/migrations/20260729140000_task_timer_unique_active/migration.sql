-- Enforce "one active timer per user" at the database level: Prisma's schema DSL can't
-- express a partial unique index, so this is added as raw SQL. Without this, two
-- near-simultaneous timer/start requests for the same user could both pass the
-- application-level findFirst-then-create check and insert two running entries.
CREATE UNIQUE INDEX "TaskTimeEntry_userId_active_unique" ON "TaskTimeEntry"("userId") WHERE "endedAt" IS NULL;
