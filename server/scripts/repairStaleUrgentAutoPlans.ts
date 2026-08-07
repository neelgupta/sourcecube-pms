/**
 * One-time repair for TaskDailyAllocation rows locked by either of the two "system-committed
 * allocation" mechanisms that can go stale after a task's dates are edited:
 *
 *  - autoPlanIfUrgentSameDay (note === "Auto-planned: urgent same-day task") — locks the task's
 *    full remaining estimate onto its single startDate=dueDate day.
 *  - carryForwardRemainingToDueDate (note === "Auto-planned: remaining hours carried to due
 *    date") — locks a leftover-hours row onto a task's due date after an earlier day's plan.
 *
 * Both mechanisms now clean up their own stale rows on every task edit (see
 * lib/urgentAutoPlan.ts), but any row written before that fix — or by a request that somehow
 * bypassed it — can still be sitting on a day that no longer matches the task's current
 * startDate/dueDate, silently consuming (and locking) a full day's hours under dates the task no
 * longer has.
 *
 * This script finds every row from either mechanism and deletes it unless it still sits on the
 * task's CURRENT correct day (its single startDate=dueDate day for urgent-auto-plan rows, or its
 * current dueDate for carry-forward rows).
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/repairStaleUrgentAutoPlans.ts            # dry run
 *   npx tsx scripts/repairStaleUrgentAutoPlans.ts --apply     # actually deletes stale rows
 */
import { prisma } from "../src/lib/prisma.js";

const APPLY = process.argv.includes("--apply");
const urgentAutoPlanNote = "Auto-planned: urgent same-day task";
const carryForwardNote = "Auto-planned: remaining hours carried to due date";

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
    where: { note: { in: [urgentAutoPlanNote, carryForwardNote] } },
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

    const stillCurrent = row.note === urgentAutoPlanNote
      ? Boolean(startKey && dueKey && startKey === dueKey && startKey === rowDateKey)
      : Boolean(dueKey && dueKey === rowDateKey);
    if (stillCurrent) continue;

    stale += 1;
    const kind = row.note === urgentAutoPlanNote ? "auto-plan" : "carry-forward";
    if (APPLY) {
      await prisma.taskDailyAllocation.delete({ where: { id: row.id } });
      console.log(`[applied] task ${row.task.code} "${row.task.name}": removed stale ${row.plannedMinutes}min ${kind} row on ${rowDateKey}`);
    } else {
      console.log(`[dry-run] task ${row.task.code} "${row.task.name}": would remove stale ${row.plannedMinutes}min ${kind} row on ${rowDateKey}`);
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run complete"}: ${stale} stale locked row(s) ${APPLY ? "removed" : "would be removed"}.`);
  if (!APPLY) console.log("Re-run with --apply to delete these rows.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
