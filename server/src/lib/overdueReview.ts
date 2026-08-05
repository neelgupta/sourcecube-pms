import { prisma } from "./prisma.js";
import { createNotification } from "./chat.js";

/** "Midnight today" in the company's own timezone, expressed as a UTC Date — used to decide
 *  whether a task's dueDate has actually passed from the company's point of view, not the
 *  server process's timezone (which may be UTC in production, unrelated to any tenant's
 *  configured timezone). A raw `new Date(); setUTCHours(0,0,0,0)` check would flag/unflag tasks
 *  up to ~12 hours off from what the company would consider "today," depending on their offset. */
function todayStartInTimezone(timezone: string): Date {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00.000Z`);
  } catch {
    const fallback = new Date(now);
    fallback.setUTCHours(0, 0, 0, 0);
    return fallback;
  }
}

/** Resolves who should review a task that's gone overdue: the task's creator (unless that's the
 *  assignee themselves, which wouldn't be a meaningful approval), falling back to the assignee's
 *  team lead, falling back to any active company_super_admin in the tenant. Mirrors the
 *  team-lead lookup pattern already used by canEditTaskForProject in routes/projects.ts. */
export async function resolveOverdueApprover(tid: string, task: { createdBy: string | null; assigneeId: string | null }): Promise<string | null> {
  if (task.createdBy && task.createdBy !== task.assigneeId) {
    const creator = await prisma.companyUser.findFirst({ where: { id: task.createdBy, tenantId: tid, accountStatus: "active" }, select: { id: true } });
    if (creator) return creator.id;
  }
  if (task.assigneeId) {
    const membership = await prisma.teamMember.findFirst({
      where: { userId: task.assigneeId, team: { tenantId: tid, leadUserId: { not: null } } },
      select: { team: { select: { leadUserId: true } } },
    });
    if (membership?.team.leadUserId) return membership.team.leadUserId;
  }
  const superAdmin = await prisma.companyUser.findFirst({ where: { tenantId: tid, accountStatus: "active", roles: { has: "company_super_admin" } }, select: { id: true } });
  return superAdmin?.id ?? null;
}

/** Lazily flags tasks that are overdue (past dueDate — measured in the company's own timezone,
 *  not the server's — and not done, and never previously flagged). There's no cron/job runner in
 *  this codebase, so this must be called from any route that loads a batch of a company's tasks
 *  where the assignee/creator would plausibly notice — not just the Resources Planner (which
 *  most people rarely open), but also the project workspace and "My Tasks" list. Idempotent: only
 *  tasks with overdueReviewStatus === null are considered, so a task already under review or
 *  already resolved-and-still-overdue isn't re-flagged/re-notified on every call. Mutates
 *  ProjectTask.overdueReviewStatus and creates the TaskOverdueReview row + notification for
 *  whichever ones just crossed the line. */
export async function flagNewlyOverdueTasks(
  tid: string,
  timezone: string,
  tasks: { id: string; dueDate: Date | null; status: string; createdBy: string | null; assigneeId: string | null; overdueReviewStatus: string | null }[],
) {
  const today = todayStartInTimezone(timezone);
  const candidates = tasks.filter((task) => task.overdueReviewStatus === null && task.status !== "done" && task.dueDate && task.dueDate < today);
  if (!candidates.length) return;
  for (const task of candidates) {
    const approverId = await resolveOverdueApprover(tid, task);
    if (!approverId) continue;
    const updated = await prisma.projectTask.updateMany({ where: { id: task.id, tenantId: tid, overdueReviewStatus: null }, data: { overdueReviewStatus: "pending_review" } });
    if (updated.count === 0) continue; // lost the race to a concurrent request; skip duplicate create/notify
    await prisma.taskOverdueReview.create({
      data: { tenantId: tid, taskId: task.id, originalDueDate: task.dueDate as Date, approverId, status: "pending_review" },
    });
    await createNotification({ tenantId: tid, userId: approverId, type: "task_overdue_review", title: "A task went overdue and needs review", channelId: undefined });
  }
}
