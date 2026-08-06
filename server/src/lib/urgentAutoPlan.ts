import { prisma } from "./prisma.js";
import { recordAudit } from "./audit.js";
import type { AuthTokenPayload } from "./jwt.js";

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

/** A task whose startDate and dueDate both land on "today" (in the company's own timezone) is
 *  urgent by construction — there's no window for a human to sit down and plan it in the
 *  Resource Planner before the day is over. Rather than leaving it invisible until someone
 *  manually opens "Edit Today's Plan," this immediately upserts today's TaskDailyAllocation for
 *  the task's assignee with the task's full remaining estimate, bypassing the normal "day
 *  already fully planned" capacity lock (see the PUT /planner/.../allocations handler in
 *  routes/resources.ts) — a same-day task pushing the day over capacity is expected, not an
 *  error, and the existing capacity lock still correctly blocks any *other* task from being
 *  manually added to that now-full day afterward.
 *
 *  This does NOT touch the task's priority — only its allocation. If the task is later
 *  rescheduled off today, or its estimate/tracked time changes, nothing here retroactively
 *  cleans up the row; whoever is planning the day can adjust or clear it manually like any
 *  other allocation. If the task goes unfinished past today, the existing overdue-review
 *  pipeline (flagNewlyOverdueTasks) picks it up on its own — no interaction needed here.
 *
 *  Called from both task create and task update in routes/projects.ts, right after
 *  recordAudit for the create/update itself, so it only ever runs following an
 *  already-authorized tasks:create / tasks:edit action — no new permission surface. */
export async function autoPlanIfUrgentSameDay(
  tid: string,
  actor: AuthTokenPayload,
  task: { id: string; code: number; name: string; assigneeId: string | null; startDate: Date | null; dueDate: Date | null; estimatedMinutes: number; trackedSeconds: number },
): Promise<void> {
  if (!task.assigneeId || !task.startDate || !task.dueDate) return;

  const company = await prisma.company.findUnique({ where: { id: tid }, select: { timezone: true } });
  if (!company) return;

  const todayKey = localDateKey(new Date(), company.timezone);
  const startKey = localDateKey(task.startDate, company.timezone);
  const dueKey = localDateKey(task.dueDate, company.timezone);
  if (startKey !== todayKey || dueKey !== todayKey) return;

  const plannedMinutes = remainingMinutesFor(task);
  if (plannedMinutes <= 0) return;

  const dateValue = new Date(`${todayKey}T00:00:00.000Z`);
  await prisma.taskDailyAllocation.upsert({
    where: { taskId_userId_date: { taskId: task.id, userId: task.assigneeId, date: dateValue } },
    update: { plannedMinutes, note: "Auto-planned: urgent same-day task", updatedBy: actor.userId },
    create: {
      tenantId: tid,
      taskId: task.id,
      userId: task.assigneeId,
      date: dateValue,
      plannedMinutes,
      note: "Auto-planned: urgent same-day task",
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
    metadata: { assigneeId: task.assigneeId, date: todayKey, plannedMinutes, reason: "same_day_urgent" },
  });
}
