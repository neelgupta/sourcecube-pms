/**
 * One-time backfill for TaskDailyAllocation.
 *
 * Before the daily-allocation rework (commit 6fb0b50, 2026-08-05), "planned minutes" for a task
 * on a given day were never stored — they were computed on the fly by splitting
 * `estimatedMinutes` evenly across the working days between the task's startDate and dueDate,
 * and zeroed out for any day at/after `completedAt`. The new logic only ever reads real
 * TaskDailyAllocation rows and never synthesizes them, so any task worked on before the cutover
 * that never got an explicit row now shows 0 planned minutes for its historical days, and — if
 * done — can vanish entirely from "Edit Today's Plan" for that date (relevantTasks only includes
 * a done task if it has a logged time entry or an allocation row for that exact date).
 *
 * This script materializes what the old formula would have produced, but ONLY for days strictly
 * before today — today and future days are left untouched so users plan those explicitly under
 * the new system. It never touches a (task, user, date) that already has a stored row.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/backfillDailyAllocations.ts            # dry run — reports what it would write
 *   npx tsx scripts/backfillDailyAllocations.ts --apply     # actually writes the rows
 */
import { prisma } from "../src/lib/prisma.js";

const APPLY = process.argv.includes("--apply");

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00.000Z`);
}
function addDays(key: string, amount: number) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function keysBetween(start: string, end: string, limit = 1000) {
  const keys: string[] = [];
  let cursor = start;
  while (cursor <= end && keys.length < limit) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}
function localDateKey(value: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return value.toISOString().slice(0, 10);
  }
}
/** Mirrors taskDateSpan() as it existed in server/src/routes/resources.ts before 6fb0b50. */
function taskDateSpan(task: { startDate: Date | null; dueDate: Date | null }, workingDays: number[]) {
  const start = task.startDate ? localDateKey(task.startDate, "UTC") : task.dueDate ? localDateKey(task.dueDate, "UTC") : null;
  const end = task.dueDate ? localDateKey(task.dueDate, "UTC") : task.startDate ? localDateKey(task.startDate, "UTC") : null;
  if (!start || !end) return [];
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const dates = keysBetween(first, last, 740).filter((key) => workingDays.includes(dateFromKey(key).getUTCDay()));
  return dates.length ? dates : [last];
}

async function main() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const companies = await prisma.company.findMany({ select: { id: true, name: true, timezone: true } });

  let totalRowsToCreate = 0;
  let totalTasksAffected = 0;

  for (const company of companies) {
    const schedule = await prisma.workingSchedule.findFirst({ where: { tenantId: company.id }, orderBy: { createdAt: "asc" } });
    const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];

    // Only tasks that are assigned (an allocation always belongs to an assignee) and have a
    // date span to spread across. Tasks that already have at least one TaskDailyAllocation row
    // are skipped entirely — they were planned under the new (or a mix of old/new) regime and
    // should not be second-guessed by this script.
    const tasks = await prisma.projectTask.findMany({
      where: {
        tenantId: company.id,
        assigneeId: { not: null },
        estimatedMinutes: { gt: 0 },
        OR: [{ startDate: { not: null } }, { dueDate: { not: null } }],
        dailyAllocations: { none: {} },
      },
      select: {
        id: true, code: true, name: true, assigneeId: true, status: true,
        estimatedMinutes: true, startDate: true, dueDate: true, completedAt: true,
      },
    });

    for (const task of tasks) {
      if (!task.assigneeId) continue;
      const span = taskDateSpan(task, workingDays);
      if (!span.length) continue;

      const completedKey = task.status === "done" && task.completedAt ? localDateKey(task.completedAt, company.timezone) : null;
      const plannedPerDay = Math.round(task.estimatedMinutes / Math.max(1, span.length));
      if (plannedPerDay <= 0) continue;

      const rowsForTask: { date: string; plannedMinutes: number }[] = [];
      for (const dateKey of span) {
        if (dateKey >= todayKey) continue; // leave today/future for explicit planning
        if (completedKey && dateKey >= completedKey) continue; // old fallback zeroed these out
        rowsForTask.push({ date: dateKey, plannedMinutes: plannedPerDay });
      }
      if (!rowsForTask.length) continue;

      totalTasksAffected += 1;
      totalRowsToCreate += rowsForTask.length;

      if (APPLY) {
        await prisma.taskDailyAllocation.createMany({
          data: rowsForTask.map((row) => ({
            tenantId: company.id,
            taskId: task.id,
            userId: task.assigneeId as string,
            date: dateFromKey(row.date),
            plannedMinutes: row.plannedMinutes,
            note: "Backfilled from pre-2026-08-05 auto-split logic",
            createdBy: null,
            updatedBy: null,
          })),
          skipDuplicates: true,
        });
      } else {
        console.log(`[dry-run] ${company.name} — task ${task.code ?? task.id} "${task.name}": would create ${rowsForTask.length} row(s), ${plannedPerDay}min/day`);
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run complete"}: ${totalTasksAffected} task(s), ${totalRowsToCreate} allocation row(s) ${APPLY ? "created" : "would be created"}.`);
  if (!APPLY) console.log("Re-run with --apply to write these rows.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
