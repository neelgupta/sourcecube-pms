/**
 * One-time repair for tasks that should have been auto-planned as "urgent same-day" but weren't,
 * due to a bug where PATCH /:id/tasks/:taskId only re-ran autoPlanIfUrgentSameDay when
 * startDate/dueDate/assigneeId changed, not when estimatedMinutes changed. A task whose dates
 * were set first (estimate still 0 at that moment, so the auto-plan bailed out with nothing to
 * plan) and then had its estimate filled in afterward, in a separate save, never retroactively
 * triggered the auto-plan even though it fully qualified — it shows as an ordinary editable task
 * on the Resource Planner with 0h planned, instead of a locked, auto-planned one.
 *
 * This script finds any tenant-scoped task with startDate = dueDate = "today" (in the company's
 * own timezone), a positive estimate, and an assignee, that has no TaskDailyAllocation row for
 * today yet, and runs the exact same autoPlanIfUrgentSameDay logic against it. Tasks that are
 * correctly not-yet-qualified (no estimate, no dates) or already fixed (allocation exists) are
 * left untouched — this only catches tasks stuck in the specific bad state described above.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/repairMissedUrgentAutoPlans.ts            # dry run
 *   npx tsx scripts/repairMissedUrgentAutoPlans.ts --apply     # actually writes allocations
 */
import { prisma } from "../src/lib/prisma.js";
import { autoPlanIfUrgentSameDay } from "../src/lib/urgentAutoPlan.js";

const APPLY = process.argv.includes("--apply");

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
  const companies = await prisma.company.findMany({ select: { id: true, name: true, timezone: true } });
  let fixed = 0;

  for (const company of companies) {
    const todayKey = localDateKey(new Date(), company.timezone);
    const todayValue = new Date(`${todayKey}T00:00:00.000Z`);
    const tomorrowValue = new Date(`${todayKey}T00:00:00.000Z`);
    tomorrowValue.setUTCDate(tomorrowValue.getUTCDate() + 1);

    const candidates = await prisma.projectTask.findMany({
      where: {
        tenantId: company.id,
        assigneeId: { not: null },
        estimatedMinutes: { gt: 0 },
        status: { not: "done" },
        startDate: { gte: todayValue, lt: tomorrowValue },
        dueDate: { gte: todayValue, lt: tomorrowValue },
        dailyAllocations: { none: { date: todayValue } },
      },
      select: { id: true, code: true, name: true, assigneeId: true, startDate: true, dueDate: true, estimatedMinutes: true, trackedSeconds: true },
    });

    for (const task of candidates) {
      // Re-confirm the same-day match in the company's own timezone (the query above used a UTC
      // day window as a coarse pre-filter; autoPlanIfUrgentSameDay does the precise check itself
      // and will simply no-op if it doesn't actually qualify).
      if (APPLY) {
        await autoPlanIfUrgentSameDay(
          company.id,
          { userId: task.assigneeId as string, kind: "company", tenantId: company.id } as Parameters<typeof autoPlanIfUrgentSameDay>[1],
          task,
        );
        fixed += 1;
        console.log(`[applied] ${company.name} — task ${task.code} "${task.name}"`);
      } else {
        console.log(`[dry-run] ${company.name} — task ${task.code} "${task.name}": would auto-plan ${task.estimatedMinutes}min`);
        fixed += 1;
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run complete"}: ${fixed} task(s) ${APPLY ? "auto-planned" : "would be checked/auto-planned"}.`);
  if (!APPLY) console.log("Re-run with --apply to write these allocations.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
