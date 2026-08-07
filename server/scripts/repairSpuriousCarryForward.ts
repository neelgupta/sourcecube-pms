/**
 * One-time repair for carry-forward rows created before the fix in
 * carryForwardRemainingToDueDate (routes/resources.ts) that skipped the "was this task actually
 * given a nonzero plan on the day being saved?" check. Before the fix, saving ANY task's hours
 * for a day would resubmit every other own-task shown that day at whatever was in its hours
 * draft (often 0, since it was never touched) — and a submitted 0 was misread as "this task has
 * 0h planned today, so its ENTIRE remaining estimate is leftover," dumping the whole thing onto
 * the task's due date and locking it there, even for tasks with no real planning history before
 * that day.
 *
 * This script finds every TaskDailyAllocation row written by that mechanism (note ===
 * carryForwardNote) and checks whether the task has any OTHER allocation row (any day, any note)
 * with plannedMinutes > 0 that predates the carried-forward row's creation — i.e. genuine
 * evidence the person actually planned some of this task's time before the carry-forward fired.
 * If there's no such evidence, the row is spurious (a full-estimate dump from an untouched 0,
 * not a real leftover) and is deleted, unlocking the task on that day.
 *
 * Usage:
 *   cd server
 *   npx tsx scripts/repairSpuriousCarryForward.ts            # dry run
 *   npx tsx scripts/repairSpuriousCarryForward.ts --apply     # actually deletes spurious rows
 */
import { prisma } from "../src/lib/prisma.js";

const APPLY = process.argv.includes("--apply");
const carryForwardNote = "Auto-planned: remaining hours carried to due date";

async function main() {
  const carriedRows = await prisma.taskDailyAllocation.findMany({
    where: { note: carryForwardNote },
    include: { task: { select: { code: true, name: true, estimatedMinutes: true, trackedSeconds: true } } },
  });

  let spurious = 0;
  for (const row of carriedRows) {
    const priorRealAllocation = await prisma.taskDailyAllocation.findFirst({
      where: {
        taskId: row.taskId,
        userId: row.userId,
        id: { not: row.id },
        plannedMinutes: { gt: 0 },
        createdAt: { lt: row.createdAt },
        note: { not: carryForwardNote },
      },
      select: { id: true },
    });
    if (priorRealAllocation) continue; // genuine leftover from a real prior plan — leave it alone

    const remaining = Math.max(0, row.task.estimatedMinutes - Math.round(row.task.trackedSeconds / 60));
    const looksLikeFullDump = row.plannedMinutes >= remaining; // carried the whole remaining estimate, not a partial leftover
    if (!looksLikeFullDump) continue;

    spurious += 1;
    if (APPLY) {
      await prisma.taskDailyAllocation.delete({ where: { id: row.id } });
      console.log(`[applied] task ${row.task.code} "${row.task.name}": removed spurious ${row.plannedMinutes}min carry-forward on ${row.date.toISOString().slice(0, 10)}`);
    } else {
      console.log(`[dry-run] task ${row.task.code} "${row.task.name}": would remove spurious ${row.plannedMinutes}min carry-forward on ${row.date.toISOString().slice(0, 10)}`);
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run complete"}: ${spurious} spurious carry-forward row(s) ${APPLY ? "removed" : "would be removed"}.`);
  if (!APPLY) console.log("Re-run with --apply to delete these rows.");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
