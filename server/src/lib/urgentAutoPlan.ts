import { prisma } from "./prisma.js";
import { recordAudit } from "./audit.js";
import type { AuthTokenPayload } from "./jwt.js";

const urgentAutoPlanNote = "Auto-planned: urgent same-day task";

/** Mirrors localDateKey in routes/resources.ts — a task's/day's date expressed as the company's
 *  own local calendar day (YYYY-MM-DD), not the server process's timezone. */
function localDateKey(value: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

/** A task's remaining plannable minutes — mirrors remainingMinutesFor in routes/resources.ts. */
function remainingMinutesFor(task: { estimatedMinutes: number; trackedSeconds: number }): number {
  return Math.max(0, task.estimatedMinutes - Math.round(task.trackedSeconds / 60));
}

/** A task whose startDate and dueDate are the same calendar day (in the company's own timezone)
 *  is a single, no-slack day by construction — whichever day that is, today, tomorrow, or any
 *  future date — there's no multi-day window for a human to spread it across. Rather than
 *  leaving it invisible until someone manually opens "Edit [that day]'s Plan," this immediately
 *  upserts that day's TaskDailyAllocation for the task's assignee with the task's full remaining
 *  estimate, bypassing the normal "day already fully planned" capacity lock (see the PUT
 *  /planner/.../allocations handler in routes/resources.ts) — a same-day task pushing that day
 *  over capacity is expected, not an error, and the existing capacity lock still correctly
 *  blocks any *other* task from being manually added to that now-full day afterward.
 *
 *  A same-day task whose single day has already passed is NOT auto-planned here — planning time
 *  onto a day that's already over would be meaningless; that case is left entirely to the
 *  existing overdue-review pipeline (flagNewlyOverdueTasks), which flags it for review instead.
 *
 *  This does NOT touch the task's priority — only its allocation. If the task is later
 *  rescheduled to no longer be single-day, or its estimate/tracked time changes, nothing here
 *  retroactively cleans up the row; whoever is planning the day can adjust or clear it manually
 *  like any other allocation.
 *
 *  Called from both task create and task update in routes/projects.ts, right after
 *  recordAudit for the create/update itself, so it only ever runs following an
 *  already-authorized tasks:create / tasks:edit action — no new permission surface. */
export async function autoPlanIfUrgentSameDay(
  tid: string,
  actor: AuthTokenPayload,
  task: { id: string; code: number; name: string; assigneeId: string | null; startDate: Date | null; dueDate: Date | null; estimatedMinutes: number; trackedSeconds: number },
): Promise<void> {
  if (!task.assigneeId) return;

  const company = await prisma.company.findUnique({ where: { id: tid }, select: { timezone: true } });
  if (!company) return;

  const startKey = task.startDate ? localDateKey(task.startDate, company.timezone) : null;
  const dueKey = task.dueDate ? localDateKey(task.dueDate, company.timezone) : null;
  const isSingleDay = Boolean(startKey && dueKey && startKey === dueKey);

  // A task can arrive here no longer qualifying as same-day-urgent (its dates were widened into
  // a multi-day span, cleared, or moved) even though an earlier call auto-planned and locked a
  // whole day for it under the old single-day dates. Left behind, that stale row would keep
  // consuming a full day's worth of hours under a task that's no longer urgent — clean up any
  // row this same mechanism previously wrote that ISN'T the task's current single day (if it
  // still has one), so editing a task's schedule always leaves its planner state consistent with
  // its current dates rather than accumulating orphaned auto-plans from earlier edits.
  await prisma.taskDailyAllocation.deleteMany({
    where: {
      tenantId: tid,
      taskId: task.id,
      userId: task.assigneeId,
      note: urgentAutoPlanNote,
      ...(isSingleDay ? { date: { not: new Date(`${startKey}T00:00:00.000Z`) } } : {}),
    },
  });

  if (!isSingleDay || !startKey) return;

  const todayKey = localDateKey(new Date(), company.timezone);
  if (startKey < todayKey) return; // its single day has already passed — let overdue-review handle it, not a backdated plan

  const plannedMinutes = remainingMinutesFor(task);
  if (plannedMinutes <= 0) return;

  const dateValue = new Date(`${startKey}T00:00:00.000Z`);
  await prisma.taskDailyAllocation.upsert({
    where: { taskId_userId_date: { taskId: task.id, userId: task.assigneeId, date: dateValue } },
    update: { plannedMinutes, note: urgentAutoPlanNote, updatedBy: actor.userId },
    create: {
      tenantId: tid,
      taskId: task.id,
      userId: task.assigneeId,
      date: dateValue,
      plannedMinutes,
      note: urgentAutoPlanNote,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    },
  });

  await recordAudit({
    actor,
    action: "task.autoplanned",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: task.id,
    metadata: { assigneeId: task.assigneeId, date: startKey, plannedMinutes, reason: "same_day_urgent" },
  });
}
