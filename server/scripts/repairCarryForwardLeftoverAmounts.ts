/**
 * One-time repair for carry-forward rows (note === carryForwardNote) whose plannedMinutes was
 * computed with the old, buggy formula: estimate minus ONLY the single day's allocation that
 * triggered the carry-forward, instead of estimate minus everything already planned across every
 * day up to and including the due date. For a task planned across several days before its due
 * date, each save recomputed and overwrote the due-date row using just that save's day, so the
 * final value ended up far too high (e.g. a 42h task planned 4h/5h/6h/6h across four days should
 * carry forward 42-21=21h, but the old formula left 42-6=36h sitting on the due date instead).
 *
 * This script finds every carry-forward row and recomputes its correct value: the task's
 * estimatedMinutes minus trackedSeconds minus the sum of every OTHER allocation on record for
 * that task/employee (excluding the carry-forward row itself). Updates the row if it differs,
 * or deletes it if the corrected leftover is <= 0.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/repairCarryForwardLeftoverAmounts.ts            # dry run
 *   npx tsx scripts/repairCarryForwardLeftoverAmounts.ts --apply     # actually fixes rows
 */
import { prisma } from "../src/lib/prisma.js";

const APPLY = process.argv.includes("--apply");
const carryForwardNote = "Auto-planned: remaining hours carried to due date";

async function main() {
  const rows = await prisma.taskDailyAllocation.findMany({
    where: { note: carryForwardNote },
    include: { task: { select: { code: true, name: true, estimatedMinutes: true, trackedSeconds: true } } },
  });

  let fixed = 0;
  for (const row of rows) {
    // OR'd with { note: null } because Prisma's `note: { not: carryForwardNote } }` alone
    // excludes NULL-note rows too (SQL: NULL != 'x' is NULL, not true) — a normal manually-planned
    // day has note: null, so without this it would be silently dropped from the sum.
    const otherAllocations = await prisma.taskDailyAllocation.aggregate({
      where: { tenantId: row.tenantId, taskId: row.taskId, userId: row.userId, id: { not: row.id }, OR: [{ note: null }, { note: { not: carryForwardNote } }] },
      _sum: { plannedMinutes: true },
    });
    const plannedElsewhere = otherAllocations._sum.plannedMinutes ?? 0;
    const remaining = Math.max(0, row.task.estimatedMinutes - Math.round(row.task.trackedSeconds / 60));
    const correctLeftover = Math.max(0, remaining - plannedElsewhere);

    if (correctLeftover === row.plannedMinutes) continue;

    fixed += 1;
    const rowDateKey = row.date.toISOString().slice(0, 10);
    if (correctLeftover <= 0) {
      if (APPLY) {
        await prisma.taskDailyAllocation.delete({ where: { id: row.id } });
        console.log(`[applied] task ${row.task.code} "${row.task.name}": removed carry-forward row on ${rowDateKey} (was ${row.plannedMinutes}min, correct leftover is 0)`);
      } else {
        console.log(`[dry-run] task ${row.task.code} "${row.task.name}": would remove carry-forward row on ${rowDateKey} (was ${row.plannedMinutes}min, correct leftover is 0)`);
      }
    } else {
      if (APPLY) {
        await prisma.taskDailyAllocation.update({ where: { id: row.id }, data: { plannedMinutes: correctLeftover } });
        console.log(`[applied] task ${row.task.code} "${row.task.name}": corrected carry-forward on ${rowDateKey} from ${row.plannedMinutes}min to ${correctLeftover}min`);
      } else {
        console.log(`[dry-run] task ${row.task.code} "${row.task.name}": would correct carry-forward on ${rowDateKey} from ${row.plannedMinutes}min to ${correctLeftover}min`);
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run complete"}: ${fixed} carry-forward row(s) ${APPLY ? "corrected" : "would be corrected"}.`);
  if (!APPLY) console.log("Re-run with --apply to write these corrections.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
