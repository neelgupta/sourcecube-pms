/**
 * One-time repair for TaskDailyAllocation rows written by autoPlanIfUrgentSameDay
 * (note === "Auto-planned: urgent same-day task") that are now stale because the task's dates
 * were later edited to no longer be a single day (startDate !== dueDate, or either date cleared)
 * — before the fix in lib/urgentAutoPlan.ts, editing a task's schedule away from same-day-urgent
 * never cleaned up the old day's allocation, so it kept consuming a full day's hours (often the
 * task's ENTIRE estimate) under a task that's no longer urgent.
 *
 * This script finds every such row and deletes it unless the task's CURRENT startDate/dueDate
 * still resolve to that exact same day in the company's timezone (i.e. it's still legitimately
 * that task's single urgent day).
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/repairStaleUrgentAutoPlans.ts            # dry run
 *   npx tsx scripts/repairStaleUrgentAutoPlans.ts --apply     # actually deletes stale rows
 */
import { prisma } from "../src/lib/prisma.js";

const APPLY = process.argv.includes("--apply");
const urgentAutoPlanNote = "Auto-planned: urgent same-day task";

function localDateKey(value: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

async function main() {
  const rows = await prisma.taskDailyAllocation.findMany({
    where: { note: urgentAutoPlanNote },
    include: { task: { select: { code: true, name: true, startDate: true, dueDate: true, tenantId: true } } },
  });

  const companyTimezoneById = new Map<string, string>();
  let stale = 0;
  for (const row of rows) {
    let timezone = companyTimezoneById.get(row.task.tenantId);
    if (!timezone) {
      const company = await prisma.company.findUnique({ where: { id: row.task.tenantId }, select: { timezone: true } });
      timezone = company?.timezone ?? "UTC";
      companyTimezoneById.set(row.task.tenantId, timezone);
    }
    const startKey = row.task.startDate ? localDateKey(row.task.startDate, timezone) : null;
    const dueKey = row.task.dueDate ? localDateKey(row.task.dueDate, timezone) : null;
    const rowDateKey = row.date.toISOString().slice(0, 10);
    const stillCurrent = Boolean(startKey && dueKey && startKey === dueKey && startKey === rowDateKey);
    if (stillCurrent) continue;

    stale += 1;
    if (APPLY) {
      await prisma.taskDailyAllocation.delete({ where: { id: row.id } });
      console.log(`[applied] task ${row.task.code} "${row.task.name}": removed stale ${row.plannedMinutes}min auto-plan on ${rowDateKey}`);
    } else {
      console.log(`[dry-run] task ${row.task.code} "${row.task.name}": would remove stale ${row.plannedMinutes}min auto-plan on ${rowDateKey}`);
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run complete"}: ${stale} stale auto-plan row(s) ${APPLY ? "removed" : "would be removed"}.`);
  if (!APPLY) console.log("Re-run with --apply to delete these rows.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
