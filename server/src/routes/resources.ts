import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import type { AuthTokenPayload } from "../lib/jwt.js";
import { createNotification } from "../lib/chat.js";
import { flagNewlyOverdueTasks, resolveOverdueApprover } from "../lib/overdueReview.js";
import { autoPlanIfUrgentSameDay, carryForwardNote } from "../lib/urgentAutoPlan.js";

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth, requireCompany);

function tenantId(req: { auth?: AuthTokenPayload }) {
  return (req.auth as { tenantId: string }).tenantId;
}
function userId(req: { auth?: AuthTokenPayload }) {
  return (req.auth as { userId: string }).userId;
}

/** Read-only working-hours lookup for anyone with resources:view (which every role including
 *  plain employee holds) — used by the manual work-log form's start-time picker to know which
 *  times are valid to offer, without requiring the company_super_admin access that the full
 *  onboarding schedule-management endpoints are gated behind. */
resourcesRouter.get("/working-hours", requirePermission("resources", "view"), async (req, res) => {
  const tid = tenantId(req);
  const schedule = await prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } });
  res.json({
    startTime: schedule?.startTime ?? "09:00",
    endTime: schedule?.endTime ?? "18:00",
    breakStartTime: schedule?.breakStartTime ?? "14:00",
    breakEndTime: schedule?.breakEndTime ?? "14:30",
  });
});

const elevatedRoles = new Set(["company_super_admin", "hr_admin", "auditor"]);

async function resourceUserScope(tid: string, uid: string): Promise<Prisma.CompanyUserWhereInput> {
  const current = await prisma.companyUser.findFirst({ where: { id: uid, tenantId: tid, accountStatus: "active" }, select: { roles: true } });
  const roles = current?.roles ?? [];
  if (roles.some((role) => elevatedRoles.has(role))) return { tenantId: tid, accountStatus: "active" };
  const access: Prisma.CompanyUserWhereInput[] = [{ id: uid }];
  if (roles.includes("team_lead")) access.push({ teamMemberships: { some: { team: { leadUserId: uid, tenantId: tid } } } });
  if (roles.includes("department_head")) access.push({ projectTasksAssigned: { some: { project: { department: { headUserId: uid } } } } });
  if (roles.includes("project_manager")) access.push({ projectTasksAssigned: { some: { project: { OR: [{ managerId: uid }, { ownerId: uid }] } } } });
  return { tenantId: tid, accountStatus: "active", OR: access };
}

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
function minutesBetween(startTime: string, endTime: string, breakMinutes: number) {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  return Math.max(0, toMinutes(endTime) - toMinutes(startTime) - breakMinutes);
}
function durationSeconds(entry: { durationSeconds: number; startedAt: Date; endedAt: Date | null }) {
  return entry.endedAt ? entry.durationSeconds : Math.max(entry.durationSeconds, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000));
}
/** A task's remaining plannable minutes: its estimate minus everything ever logged against it,
 *  live-recomputed and never stored. There is no per-day auto-split any more — a task simply has
 *  N minutes remaining, and the person decides day-by-day how much of that they're doing today
 *  via an explicit TaskDailyAllocation row. */
function remainingMinutesFor(task: { estimatedMinutes: number; trackedSeconds: number }) {
  return Math.max(0, task.estimatedMinutes - Math.round(task.trackedSeconds / 60));
}


const plannerQuery = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  search: z.string().trim().max(255).optional(),
  occupancy: z.enum(["all", "occupied", "unoccupied"]).default("all"),
  teamId: z.string().optional(),
  employeeIds: z.string().optional(),
});

resourcesRouter.get("/planner", requirePermission("resources", "view"), async (req, res) => {
  const parsed = plannerQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid planner date range is required" }); return; }
  const input = parsed.data;
  const rangeDays = keysBetween(input.start, input.end, 94);
  if (!rangeDays.length || rangeDays[rangeDays.length - 1] !== input.end) { res.status(400).json({ error: "Planner range must be between 1 and 93 days" }); return; }
  const tid = tenantId(req), uid = userId(req);
  const [company, schedule, holidays, scope, teams] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true, dateFormat: true } }),
    prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } }),
    prisma.holiday.findMany({ where: { tenantId: tid, date: { gte: new Date(`${input.start}T00:00:00.000Z`), lt: new Date(`${addDays(input.end, 1)}T00:00:00.000Z`) } }, orderBy: { date: "asc" } }),
    resourceUserScope(tid, uid),
    prisma.team.findMany({ where: { tenantId: tid, status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const employeeOptions = await prisma.companyUser.findMany({ where: scope, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
  const capacityMinutes = schedule ? minutesBetween(schedule.startTime, schedule.endTime, schedule.breakMinutes) : 480;
  const holidayByDate = new Map(holidays.map((holiday) => [localDateKey(holiday.date, company.timezone), holiday]));
  const where: Prisma.CompanyUserWhereInput = { AND: [scope] };
  if (input.search) {
    const employeeIdSearch = input.search.replace(/^EMP-/i, "");
    where.AND = [...(where.AND as Prisma.CompanyUserWhereInput[]), { OR: [{ name: { contains: input.search, mode: "insensitive" } }, { email: { contains: input.search, mode: "insensitive" } }, { id: { contains: employeeIdSearch, mode: "insensitive" } }] }];
  }
  if (input.teamId) where.AND = [...(where.AND as Prisma.CompanyUserWhereInput[]), { teamMemberships: { some: { teamId: input.teamId } } }];
  const employeeIds = input.employeeIds ? input.employeeIds.split(",").map((id) => id.trim()).filter(Boolean) : [];
  if (employeeIds.length) where.AND = [...(where.AND as Prisma.CompanyUserWhereInput[]), { id: { in: employeeIds } }];
  const users = await prisma.companyUser.findMany({
    where,
    select: {
      id: true, name: true, email: true,
      teamMemberships: { select: { team: { select: { id: true, name: true } } } },
      projectMemberships: { select: { projectId: true } },
      projectsOwned: { where: { isArchived: false }, select: { id: true } },
      projectsManaged: { where: { isArchived: false }, select: { id: true } },
    },
    orderBy: { name: "asc" },
  });
  const ids = users.map((user) => user.id);
  const extendedStart = addDays(input.start, -1), extendedEnd = addDays(input.end, 2);
  const [tasks, entries, allocations] = await Promise.all([
    prisma.projectTask.findMany({
      where: { tenantId: tid, assigneeId: { in: ids }, project: { isArchived: false } },
      select: { id: true, assigneeId: true, name: true, status: true, progress: true, estimatedMinutes: true, trackedSeconds: true, startDate: true, dueDate: true, completedAt: true, createdBy: true, overdueReviewStatus: true, project: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.taskTimeEntry.findMany({
      where: { tenantId: tid, userId: { in: ids }, startedAt: { gte: new Date(`${extendedStart}T00:00:00.000Z`), lt: new Date(`${extendedEnd}T00:00:00.000Z`) } },
      select: { id: true, userId: true, taskId: true, startedAt: true, endedAt: true, durationSeconds: true, billable: true },
    }),
    prisma.taskDailyAllocation.findMany({
      where: { tenantId: tid, userId: { in: ids }, date: { gte: new Date(`${input.start}T00:00:00.000Z`), lt: new Date(`${addDays(input.end, 1)}T00:00:00.000Z`) } },
      select: { userId: true, taskId: true, date: true, plannedMinutes: true },
    }),
  ]);
  await flagNewlyOverdueTasks(tid, company.timezone, tasks);
  const globalDays = rangeDays.map((date) => {
    const holiday = holidayByDate.get(date);
    const isWorkingDay = workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
    return { date, label: dateFromKey(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }), isWorkingDay, isWeekend: !workingDays.includes(dateFromKey(date).getUTCDay()), holidayName: holiday?.name ?? null, capacityMinutes: isWorkingDay ? capacityMinutes : 0 };
  });
  // Plannable = not done, not currently under overdue review, and has minutes remaining. A task
  // that's done or fully-logged or awaiting an overdue resolution simply isn't offered to plan
  // against any more — no auto-split guess is ever substituted for a day with no explicit
  // allocation.
  const plannableTasks = tasks.filter((task) => task.status !== "done" && task.overdueReviewStatus === null && remainingMinutesFor(task) > 0);
  const allocationByUserDateTask = new Map<string, number>();
  allocations.forEach((row) => allocationByUserDateTask.set(`${row.userId}|${localDateKey(row.date, company.timezone)}|${row.taskId}`, row.plannedMinutes));

  let employees = users.map((user) => {
    const userTasks = plannableTasks.filter((task) => task.assigneeId === user.id);
    // All of the user's tasks (not just currently-plannable ones) so a day's planned-hours total
    // reflects what was actually allocated that day, historically — marking a task done later
    // must not retroactively shrink a day's "planned" figure. plannableTasks (excludes done/
    // overdue-review/fully-logged tasks) still governs what's offered when planning *new* time.
    const allUserTasks = tasks.filter((task) => task.assigneeId === user.id);
    const incompleteTaskCount = tasks.filter((task) => task.assigneeId === user.id && task.status !== "done").length;
    const projectIds = new Set([...user.projectMemberships.map((item) => item.projectId), ...user.projectsOwned.map((item) => item.id), ...user.projectsManaged.map((item) => item.id), ...userTasks.map((task) => task.project.id)]);
    const dayValues = globalDays.map((day) => {
      const scheduledTasks = allUserTasks.filter((task) => (allocationByUserDateTask.get(`${user.id}|${day.date}|${task.id}`) ?? 0) > 0);
      const plannedMinutes = scheduledTasks.reduce((total, task) => total + (allocationByUserDateTask.get(`${user.id}|${day.date}|${task.id}`) ?? 0), 0);
      const dayEntries = entries.filter((entry) => entry.userId === user.id && localDateKey(entry.startedAt, company.timezone) === day.date);
      const trackedSeconds = dayEntries.reduce((total, entry) => total + durationSeconds(entry), 0);
      const completedTaskCount = tasks.filter((task) => task.assigneeId === user.id && task.completedAt && localDateKey(task.completedAt, company.timezone) === day.date).length;
      const plannedTrackedSeconds = Math.min(trackedSeconds, plannedMinutes * 60);
      return {
        date: day.date, taskCount: scheduledTasks.length, completedTaskCount, plannedMinutes, trackedSeconds,
        // Overrun is measured against the full working-day capacity, not just what was planned —
        // see buildDayDetail's identical fix for the same reasoning.
        plannedTrackedSeconds, extraPlannedSeconds: Math.max(0, trackedSeconds - day.capacityMinutes * 60),
        unplannedTrackedSeconds: plannedMinutes === 0 ? trackedSeconds : 0,
        remainingPlannedMinutes: Math.max(0, plannedMinutes - Math.floor(trackedSeconds / 60)),
      };
    });
    const totalCapacityMinutes = globalDays.reduce((total, day) => total + day.capacityMinutes, 0);
    const totalPlannedMinutes = dayValues.reduce((total, day) => total + day.plannedMinutes, 0);
    const totalTrackedSeconds = dayValues.reduce((total, day) => total + day.trackedSeconds, 0);
    return {
      id: user.id, name: user.name, email: user.email, employeeCode: `EMP-${user.id.slice(-6).toUpperCase()}`,
      teams: user.teamMemberships.map((item) => item.team), projectsCount: projectIds.size,
      taskCount: userTasks.length, incompleteTaskCount, hasTasks: incompleteTaskCount > 0,
      totalCapacityMinutes, totalPlannedMinutes, totalTrackedSeconds,
      utilisationPercent: totalCapacityMinutes ? Math.round((totalPlannedMinutes / totalCapacityMinutes) * 100) : 0,
      days: dayValues,
    };
  });
  if (input.occupancy === "occupied") employees = employees.filter((employee) => employee.hasTasks);
  if (input.occupancy === "unoccupied") employees = employees.filter((employee) => !employee.hasTasks);
  res.json({
    range: { start: input.start, end: input.end, timezone: company.timezone },
    schedule: { id: schedule?.id ?? null, name: schedule?.name ?? "Default", workingDays, startTime: schedule?.startTime ?? "09:00", endTime: schedule?.endTime ?? "18:00", breakMinutes: schedule?.breakMinutes ?? 60, dailyMinutes: capacityMinutes },
    days: globalDays, employees, filterOptions: { teams, employees: employeeOptions },
  });
});

async function buildDayDetail(tid: string, employee: { id: string; name: string; email: string }, date: string) {
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  const [company, schedule, holiday, entries, dayAllocations] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
    prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } }),
    prisma.holiday.findFirst({ where: { tenantId: tid, date: { gte: dateValue, lt: new Date(`${addDays(date, 1)}T00:00:00.000Z`) } } }),
    prisma.taskTimeEntry.findMany({ where: { tenantId: tid, userId: employee.id, startedAt: { gte: new Date(`${addDays(date, -1)}T00:00:00.000Z`), lt: new Date(`${addDays(date, 2)}T00:00:00.000Z`) } }, include: { task: { select: { id: true, code: true, name: true, status: true, progress: true } }, project: { select: { id: true, name: true, key: true } } }, orderBy: { startedAt: "asc" } }),
    prisma.taskDailyAllocation.findMany({ where: { tenantId: tid, userId: employee.id, date: dateValue }, select: { taskId: true, plannedMinutes: true, note: true } }),
  ]);
  // Tasks assigned to this employee, plus any task someone logged time against or explicitly
  // allocated for them today even if they're not the assignee (e.g. a collaborator pitching in on
  // someone else's task) — otherwise that work silently has nowhere to show up on their day panel.
  const loggedOrAllocatedTaskIds = new Set([...entries.map((entry) => entry.taskId), ...dayAllocations.map((row) => row.taskId)]);
  const tasks = await prisma.projectTask.findMany({
    where: { tenantId: tid, project: { isArchived: false }, OR: [{ assigneeId: employee.id }, { id: { in: [...loggedOrAllocatedTaskIds] } }] },
    select: { id: true, code: true, name: true, status: true, progress: true, estimatedMinutes: true, trackedSeconds: true, startDate: true, dueDate: true, completedAt: true, createdBy: true, assigneeId: true, overdueReviewStatus: true, project: { select: { id: true, name: true, key: true } } },
    orderBy: { dueDate: "asc" },
  });
  await flagNewlyOverdueTasks(tid, company.timezone, tasks);
  const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
  const dailyMinutes = schedule ? minutesBetween(schedule.startTime, schedule.endTime, schedule.breakMinutes) : 480;
  const relevantEntries = entries.filter((entry) => localDateKey(entry.startedAt, company.timezone) === date);
  const loggedTaskIds = new Set(relevantEntries.map((entry) => entry.taskId));
  const allocationByTaskId = new Map(dayAllocations.map((row) => [row.taskId, row]));
  // Any open, plannable task is offered on the day panel (not just ones with an existing log or
  // allocation today) so the person can pick from their full open workload — plus any task that
  // was actually logged/allocated today even if it's since gone overdue-under-review or done, so
  // history for this specific date doesn't disappear. Critically, a task with a due date is only
  // ever "open and plannable" on days up to and including its own due date — otherwise a
  // same-day-urgent task (or any task whose due date has come and gone) keeps reappearing as a
  // fresh, plannable row on every later day's panel forever, which both misrepresents its status
  // and lets someone re-plan hours for a task that should have gone to overdue review instead.
  // Tasks without an estimate still need to show up once their start date arrives so the user can
  // see and schedule them for the appropriate day.
  const relevantTasks = tasks.filter((task) => {
    const dueKey = task.dueDate ? localDateKey(task.dueDate, company.timezone) : null;
    const startKey = task.startDate ? localDateKey(task.startDate, company.timezone) : null;
    const isWithinDueWindow = !dueKey || dueKey >= date;
    const isWithinStartWindow = !startKey || startKey <= date;
    const isReasonablyVisible = isWithinDueWindow && isWithinStartWindow;
    const isUnestimatedStartTask = task.estimatedMinutes === 0 && Boolean(startKey) && isReasonablyVisible;
    return (task.status !== "done" && task.overdueReviewStatus === null && isReasonablyVisible && (remainingMinutesFor(task) > 0 || isUnestimatedStartTask)) ||
      loggedTaskIds.has(task.id) ||
      allocationByTaskId.has(task.id);
  });
  const tasksWithPlan = relevantTasks.map((task) => {
    const explicit = allocationByTaskId.get(task.id);
    // Today's own tracked time for this task, distinct from the lifetime trackedSeconds already
    // on the task row — lets the day panel show "worked 3h of 2h planned" (over) vs. "0h worked,
    // 2h planned" (not worked today) per task, instead of only ever showing the lifetime total.
    const todayTrackedSeconds = relevantEntries.filter((entry) => entry.taskId === task.id).reduce((total, entry) => total + durationSeconds(entry), 0);
    const plannedMinutes = explicit?.plannedMinutes ?? 0;
    // Compute sum of committed allocations for this task up to and including this date so
    // the UI can show a "remaining" figure that reflects what has already been planned
    // (not just what was actually tracked). This helps team leads distribute remaining
    // estimate across days: a planned allocation on an earlier day reduces the remaining
    // minutes shown on later days even if the employee hasn't logged the time yet.
    // NOTE: This is a display-only adjustment inside the day panel; it does not mutate
    // task estimates or affect carry-forward logic elsewhere which relies on tracked time.
    const allocatedBeforeOrOnThisDate = 0; // placeholder updated below
    // A task is "locked" on this day — shown with its planned hours, but not offered as an
    // editable input in "Edit Today's Plan" — in two cases: (1) it's an urgent same-day task
    // (startDate = dueDate = this date), auto-planned in full by autoPlanIfUrgentSameDay and not
    // meant to be second-guessed once the day is already committed to it; or (2) it's the
    // system-carried-forward leftover of a multi-day task's due date, written by
    // carryForwardRemainingToDueDate below — the person already decided how much to do today
    // when they saved that day's plan, so the due-date remainder is fixed, not re-editable.
    const startKey = task.startDate ? localDateKey(task.startDate, company.timezone) : null;
    const dueKey = task.dueDate ? localDateKey(task.dueDate, company.timezone) : null;
    // Locking is about an actual committed allocation, not just a date coincidence — a same-day
    // task with startDate = dueDate = this date is only "locked" if it actually has a nonzero
    // planned allocation on it (i.e. autoPlanIfUrgentSameDay succeeded). Without the explicit
    // check, a task that never got auto-planned (e.g. zero remaining minutes at the time, or its
    // allocation was later cleared) would still show as "0h planned today (locked)" — locked
    // with nothing to actually lock, which just blocks the person from planning it manually for
    // no reason.
    const isSameDayUrgent = startKey === date && dueKey === date && Boolean(explicit) && plannedMinutes > 0;
    const isCarriedForward = explicit?.note === carryForwardNote && plannedMinutes > 0;
    return {
      ...task,
      // Whether this task is actually assigned to the employee whose day this is — false for a
      // collaborator task that only shows up here because someone logged time/allocated it for
      // this employee (see loggedOrAllocatedTaskIds above). The PUT allocations endpoint only
      // accepts writes for tasks assigned to the employee, so the frontend must not offer this
      // task's row for editing or include it in a save — see ResourcesPage.tsx's isOwnTask.
      isOwnTask: task.assigneeId === employee.id,
      // remainingMinutes already reflects the *full* logged time against estimatedMinutes,
      // regardless of what was planned for today — working over-plan on a task still counts
      // fully toward shrinking its remaining hours, exactly like on-plan or unplanned work does.
      // Subtract any allocations already committed on or before this date from the
      // task's remaining minutes (which is estimate minus tracked minutes). Use the
      // pre-computed allocation sum map below (filled after mapping) when available.
      remainingMinutes: remainingMinutesFor(task),
      plannedMinutes,
      todayTrackedSeconds,
      // Per-task overrun: how much of today's tracked time on this task exceeded what was
      // planned for it today. Mirrors the day-level extraPlannedSeconds but scoped to one task,
      // so overrunning one task while staying on-plan on the rest is visible per task, not just
      // blended into the day's aggregate "extra" number. Only meaningful when there WAS a plan —
      // a task with 0h planned that gets worked on isn't "over plan," there's simply no plan to
      // be over, so it reports 0 extra rather than counting all of today's tracked time as
      // "overrun" (which would misleadingly read as an overrun badge on totally unplanned work).
      extraTrackedSeconds: plannedMinutes > 0 ? Math.max(0, todayTrackedSeconds - plannedMinutes * 60) : 0,
      hasExplicitAllocation: Boolean(explicit),
      allocationNote: explicit?.note ?? null,
      isLocked: isSameDayUrgent || isCarriedForward,
    };
  });
  // Fetch all allocations for the tasks shown on this panel so we can reduce the
  // displayed remainingMinutes by allocations already committed up to the current date.
  if (tasksWithPlan.length > 0) {
    const allocs = await prisma.taskDailyAllocation.findMany({
      where: { tenantId: tid, userId: employee.id, taskId: { in: tasksWithPlan.map((t) => t.id) } },
      select: { taskId: true, plannedMinutes: true, date: true },
    });
    const sumByTask: Record<string, number> = {};
    for (const a of allocs) {
      const keyDate = a.date.toISOString().slice(0, 10);
      if (keyDate <= date) sumByTask[a.taskId] = (sumByTask[a.taskId] ?? 0) + a.plannedMinutes;
    }
    for (const p of tasksWithPlan) {
      const already = sumByTask[p.id] ?? 0;
      // remainingMinutesFor(task) returns minutes remaining after tracked time; subtract
      // already-planned minutes to present the post-plan remaining figure.
      // Ensure non-negative.
      // eslint-disable-next-line no-param-reassign
      (p as any).remainingMinutes = Math.max(0, remainingMinutesFor(p) - already);
    }
  }
  const plannedMinutes = tasksWithPlan.reduce((total, task) => total + task.plannedMinutes, 0);
  const trackedSeconds = relevantEntries.reduce((total, entry) => total + durationSeconds(entry), 0);
  const isWorkingDay = workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
  const capacityMinutes = isWorkingDay ? dailyMinutes : 0;
  return {
    employee, date, holiday: holiday ? { name: holiday.name, optional: holiday.optional } : null,
    capacityMinutes, plannedMinutes, trackedSeconds,
    plannedTrackedSeconds: Math.min(trackedSeconds, plannedMinutes * 60),
    // "Extra / overrun" means logged beyond the whole working day, not beyond what was
    // specifically planned — working up to capacity (even on unplanned/over-planned tasks) is
    // still a normal working day, not an overrun. See extraTrackedSeconds on each task below for
    // the per-task "logged more than that task's own plan" figure, which is a separate concept.
    extraPlannedSeconds: Math.max(0, trackedSeconds - capacityMinutes * 60),
    unplannedTrackedSeconds: plannedMinutes === 0 ? trackedSeconds : 0,
    remainingPlannedMinutes: Math.max(0, plannedMinutes - Math.floor(trackedSeconds / 60)),
    tasks: tasksWithPlan,
    logs: relevantEntries.map((entry) => ({ ...entry, effectiveDurationSeconds: durationSeconds(entry) })),
  };
}

const dayQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
resourcesRouter.get("/planner/:employeeId/day", requirePermission("resources", "view"), async (req, res) => {
  const parsed = dayQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid date is required" }); return; }
  const tid = tenantId(req), uid = userId(req), employeeId = req.params.employeeId as string, date = parsed.data.date;
  const scope = await resourceUserScope(tid, uid);
  const employee = await prisma.companyUser.findFirst({ where: { AND: [scope, { id: employeeId }] }, select: { id: true, name: true, email: true } });
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json(await buildDayDetail(tid, employee, date));
});

const allocationsRangeQuery = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
resourcesRouter.get("/planner/:employeeId/allocations", requirePermission("resources", "view"), async (req, res) => {
  const parsed = allocationsRangeQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid date range is required" }); return; }
  const tid = tenantId(req), uid = userId(req), employeeId = req.params.employeeId as string;
  const scope = await resourceUserScope(tid, uid);
  const employee = await prisma.companyUser.findFirst({ where: { AND: [scope, { id: employeeId }] }, select: { id: true } });
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  const rows = await prisma.taskDailyAllocation.findMany({
    where: { tenantId: tid, userId: employeeId, date: { gte: new Date(`${parsed.data.start}T00:00:00.000Z`), lt: new Date(`${addDays(parsed.data.end, 1)}T00:00:00.000Z`) } },
    select: { taskId: true, date: true, plannedMinutes: true, note: true },
    orderBy: { date: "asc" },
  });
  res.json({ allocations: rows.map((row) => ({ taskId: row.taskId, date: row.date.toISOString().slice(0, 10), plannedMinutes: row.plannedMinutes, note: row.note })) });
});

/** After saving a day's plan, any task due on a later date that still has remaining minutes left
 *  over (its estimate minus tracked time minus what was just planned today) gets that leftover
 *  automatically booked onto its own due date — reserving the time it must be finished by,
 *  without the person having to separately go plan that future day themselves. Written with the
 *  carryForwardNote marker so buildDayDetail locks it from manual editing (see isLocked) — it
 *  represents "this must happen by the due date," not a discretionary plan. Only tasks actually
 *  submitted in this save (i.e. the ones the person just decided today's amount for) are
 *  considered; tasks left untouched this save aren't re-carried on every unrelated save. */
async function carryForwardRemainingToDueDate(
  tid: string,
  uid: string,
  employeeId: string,
  dateParam: string,
  timezone: string,
  allocations: { taskId: string; plannedMinutes: number }[],
  tasks: { id: string; estimatedMinutes: number; trackedSeconds: number; dueDate: Date | null }[],
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const row of allocations) {
    // The frontend resubmits every editable own-task shown for the day on every save, not just
    // the ones the person actually changed — so a task the person never intended to plan today
    // still arrives here with plannedMinutes: 0. Without this guard, that incidental 0 would read
    // as "0h planned today, so the ENTIRE remaining estimate is leftover," dumping and locking a
    // multi-day task's full estimate onto its due date the moment anyone edits a different task's
    // hours on any day before it. Only a task the person deliberately gave a nonzero plan today
    // can have a genuine "leftover after today" to carry forward.
    if (row.plannedMinutes <= 0) continue;
    const task = taskById.get(row.taskId);
    if (!task || !task.dueDate) continue;
    const dueKey = localDateKey(task.dueDate, timezone);
    if (dueKey <= dateParam) continue; // due today or already overdue — nothing to carry forward
    const leftover = Math.max(0, remainingMinutesFor(task) - row.plannedMinutes);
    if (leftover <= 0) continue;
    const dueDateValue = new Date(`${dueKey}T00:00:00.000Z`);
    // Never clobber a due-date row the person already set by hand — only ever create one, or
    // update one this same mechanism previously wrote (so re-saving today's plan keeps the
    // carried-forward figure in sync with the latest leftover instead of stacking duplicates).
    const existingDueRow = await prisma.taskDailyAllocation.findUnique({
      where: { taskId_userId_date: { taskId: task.id, userId: employeeId, date: dueDateValue } },
      select: { note: true },
    });
    if (existingDueRow && existingDueRow.note !== carryForwardNote) continue;
    await prisma.taskDailyAllocation.upsert({
      where: { taskId_userId_date: { taskId: task.id, userId: employeeId, date: dueDateValue } },
      update: { plannedMinutes: leftover, note: carryForwardNote, updatedBy: uid },
      create: { tenantId: tid, taskId: task.id, userId: employeeId, date: dueDateValue, plannedMinutes: leftover, note: carryForwardNote, createdBy: uid, updatedBy: uid },
    });
  }
}

const dayAllocationWriteSchema = z.object({
  allocations: z.array(z.object({
    taskId: z.string(),
    plannedMinutes: z.number().int().min(0),
    note: z.string().trim().max(500).nullable().optional(),
  })).max(200),
});
resourcesRouter.put("/planner/:employeeId/day/:date/allocations", requirePermission("resources", "edit"), async (req, res) => {
  const dateParam = req.params.date as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) { res.status(400).json({ error: "A valid date is required" }); return; }
  const parsed = dayAllocationWriteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") }); return; }
  const tid = tenantId(req), uid = userId(req), employeeId = req.params.employeeId as string;
  const scope = await resourceUserScope(tid, uid);
  const employee = await prisma.companyUser.findFirst({ where: { AND: [scope, { id: employeeId }] }, select: { id: true, name: true, email: true } });
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }

  const taskIds = [...new Set(parsed.data.allocations.map((row) => row.taskId))];
  const ownedTasks = taskIds.length
    ? await prisma.projectTask.findMany({
        where: { id: { in: taskIds }, tenantId: tid, assigneeId: employeeId },
        select: { id: true, estimatedMinutes: true, trackedSeconds: true, startDate: true, dueDate: true },
      })
    : [];
  const ownedTaskIds = new Set(ownedTasks.map((task) => task.id));
  const invalid = taskIds.filter((id) => !ownedTaskIds.has(id));
  if (invalid.length) { res.status(400).json({ error: "One or more tasks are not assigned to this employee" }); return; }

  // Reject any attempt to edit a locked task's allocation for this day — a same-day urgent task
  // (auto-planned by autoPlanIfUrgentSameDay) or a carried-forward due-date remainder
  // (autoPlanIfUrgentSameDay/carryForwardRemainingToDueDate below) is intentionally not
  // user-editable. Mirrors the frontend excluding isLocked tasks from the submitted payload —
  // this is the server-side backstop for that same rule.
  const company = await prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } });
  const existingForDay = await prisma.taskDailyAllocation.findMany({
    where: { tenantId: tid, userId: employeeId, date: new Date(`${dateParam}T00:00:00.000Z`), taskId: { in: taskIds } },
    select: { taskId: true, note: true, plannedMinutes: true },
  });
  const existingByTaskId = new Map(existingForDay.map((row) => [row.taskId, row]));
  // A task is only actually "locked" if it has a real, positive allocation from one of the
  // system-write paths — a same-day date match with no (or a zeroed-out) allocation isn't
  // locking anything, so it must not block a manual write either. Mirrors the identical fix in
  // buildDayDetail's isLocked computation.
  const lockedTaskIds = new Set(
    ownedTasks
      .filter((task) => {
        const existing = existingByTaskId.get(task.id);
        if (!existing || existing.plannedMinutes <= 0) return false;
        const startKey = task.startDate ? localDateKey(task.startDate, company.timezone) : null;
        const dueKey = task.dueDate ? localDateKey(task.dueDate, company.timezone) : null;
        return (startKey === dateParam && dueKey === dateParam) || existing.note === carryForwardNote;
      })
      .map((task) => task.id),
  );
  if (taskIds.some((id) => lockedTaskIds.has(id))) {
    res.status(400).json({ error: "One or more tasks are locked for this day and can't be edited manually" });
    return;
  }

  // A day already planned to full capacity is locked from further edits — mirrors the frontend's
  // "Day fully planned" lock. Checked against the day's current (pre-write) state so a write that
  // only reduces planned minutes (e.g. clearing an allocation after a task finishes early) is
  // still allowed even on an already-full day.
  const currentDetail = await buildDayDetail(tid, employee, dateParam);
  if (currentDetail.capacityMinutes > 0 && currentDetail.plannedMinutes >= currentDetail.capacityMinutes) {
    res.status(400).json({ error: "This day is already fully planned" });
    return;
  }

  const dateValue = new Date(`${dateParam}T00:00:00.000Z`);
  await prisma.$transaction(async (tx) => {
    for (const row of parsed.data.allocations) {
      if (row.plannedMinutes === 0) {
        await tx.taskDailyAllocation.deleteMany({ where: { tenantId: tid, taskId: row.taskId, userId: employeeId, date: dateValue } });
        continue;
      }
      await tx.taskDailyAllocation.upsert({
        where: { taskId_userId_date: { taskId: row.taskId, userId: employeeId, date: dateValue } },
        update: { plannedMinutes: row.plannedMinutes, note: row.note ?? null, updatedBy: uid },
        create: { tenantId: tid, taskId: row.taskId, userId: employeeId, date: dateValue, plannedMinutes: row.plannedMinutes, note: row.note ?? null, createdBy: uid, updatedBy: uid },
      });
    }
    const keepTaskIds = parsed.data.allocations.filter((row) => row.plannedMinutes > 0).map((row) => row.taskId);
    await tx.taskDailyAllocation.deleteMany({ where: { tenantId: tid, userId: employeeId, date: dateValue, taskId: { notIn: keepTaskIds.length ? keepTaskIds : ["__none__"] } } });
  });

  await carryForwardRemainingToDueDate(tid, uid, employeeId, dateParam, company.timezone, parsed.data.allocations, ownedTasks);

  res.json(await buildDayDetail(tid, employee, dateParam));
});

const overdueReasonSchema = z.object({ reason: z.string().trim().min(1).max(2000) });
resourcesRouter.post("/tasks/:taskId/overdue-reason", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = overdueReasonSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") }); return; }
  const tid = tenantId(req), uid = userId(req), taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, tenantId: tid }, select: { id: true, assigneeId: true, projectId: true } });
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (task.assigneeId !== uid) { res.status(403).json({ error: "Only the assignee can submit an overdue reason" }); return; }
  const review = await prisma.taskOverdueReview.findFirst({ where: { tenantId: tid, taskId, status: "pending_review", reason: null }, orderBy: { triggeredAt: "desc" } });
  if (!review) { res.status(400).json({ error: "No pending overdue review awaiting a reason for this task" }); return; }
  const updated = await prisma.taskOverdueReview.update({
    where: { id: review.id },
    data: { reason: parsed.data.reason, reasonSubmittedAt: new Date(), reasonSubmittedBy: uid },
  });
  await createNotification({ tenantId: tid, userId: review.approverId, type: "task_overdue_review", title: "An overdue task's reason was submitted for your review", taskId: task.id, projectId: task.projectId, actorId: uid });
  res.json({ review: updated });
});

resourcesRouter.get("/overdue-reviews", requirePermission("tasks", "approve"), async (req, res) => {
  const tid = tenantId(req), uid = userId(req);
  const reviews = await prisma.taskOverdueReview.findMany({
    where: { tenantId: tid, approverId: uid, status: "pending_review" },
    include: {
      task: {
        select: {
          id: true, code: true, name: true, estimatedMinutes: true, trackedSeconds: true, dueDate: true,
          assignee: { select: { id: true, name: true, email: true } },
          project: { select: { id: true, name: true, key: true } },
        },
      },
    },
    orderBy: { triggeredAt: "desc" },
  });
  res.json({ reviews });
});

const resolveReviewSchema = z.object({
  newEstimatedMinutes: z.number().int().positive().optional(),
  newDueDate: z.string().optional(),
  newAssigneeId: z.string().optional(),
  carryToNextWorkingDay: z.boolean().optional(),
}).refine((data) => data.newEstimatedMinutes !== undefined || data.newDueDate !== undefined || data.newAssigneeId !== undefined || data.carryToNextWorkingDay !== undefined, { message: "Provide a new estimate, a new due date, a new assignee, or a carryToNextWorkingDay flag" });
resourcesRouter.post("/overdue-reviews/:reviewId/resolve", requirePermission("tasks", "approve"), async (req, res) => {
  const parsed = resolveReviewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") }); return; }
  const tid = tenantId(req), uid = userId(req), reviewId = req.params.reviewId as string;
  const review = await prisma.taskOverdueReview.findFirst({
    where: { id: reviewId, tenantId: tid, status: "pending_review" },
    include: { task: { select: { id: true, assigneeId: true, trackedSeconds: true, projectId: true } } },
  });
  if (!review) { res.status(404).json({ error: "Pending overdue review not found" }); return; }
  // Routed approver OR anyone with tasks:approve (already enforced by requirePermission) can
  // resolve — the routed-approver check here is a no-op safety net per the plan, not an
  // additional restriction, since requirePermission already gates on tasks:approve.
  const { newEstimatedMinutes, newDueDate, newAssigneeId } = parsed.data;
  if (newEstimatedMinutes !== undefined) {
    const trackedMinutes = Math.round(review.task.trackedSeconds / 60);
    if (newEstimatedMinutes <= trackedMinutes) {
      res.status(400).json({ error: "New estimate must exceed time already logged on this task" });
      return;
    }
  }
  if (newAssigneeId !== undefined) {
    const newAssignee = await prisma.companyUser.findFirst({ where: { id: newAssigneeId, tenantId: tid, accountStatus: "active" }, select: { id: true } });
    if (!newAssignee) { res.status(400).json({ error: "New assignee must be an active employee in this company" }); return; }
  }
  const actions = [
    newAssigneeId !== undefined && "reassigned",
    newEstimatedMinutes !== undefined && "re_estimated",
    newDueDate !== undefined && "rescheduled",
  ].filter((value): value is string => Boolean(value));
  const [, updatedReview] = await prisma.$transaction([
    prisma.projectTask.update({
      where: { id: review.taskId },
      data: {
        ...(newEstimatedMinutes !== undefined ? { estimatedMinutes: newEstimatedMinutes } : {}),
        ...(newDueDate !== undefined ? { dueDate: new Date(newDueDate) } : {}),
        ...(newAssigneeId !== undefined ? { assigneeId: newAssigneeId } : {}),
        overdueReviewStatus: null,
      },
    }),
    prisma.taskOverdueReview.update({
      where: { id: review.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: uid,
        resolutionAction: actions.join("_and_"),
        newEstimatedMinutes: newEstimatedMinutes ?? null,
        newDueDate: newDueDate ? new Date(newDueDate) : null,
      },
    }),
  ]);
  // Notify whoever ends up owning the task after resolution — the original assignee if it wasn't
  // reassigned, or the new assignee if it was (they need to know it's now theirs and plannable).
  const notifyUserId = newAssigneeId ?? review.task.assigneeId;
  if (notifyUserId) {
    await createNotification({
      tenantId: tid,
      userId: notifyUserId,
      type: "task_review_resolved",
      title: newAssigneeId && newAssigneeId !== review.task.assigneeId
        ? "An overdue task was reassigned to you and is plannable"
        : "Your overdue task was reviewed and is plannable again",
      taskId: review.task.id,
      projectId: review.task.projectId,
      actorId: uid,
    });
  }
  // A resolution can reschedule/re-estimate/reassign a task into a fresh same-day-urgent state
  // (e.g. rescheduled to a new single day going forward) — re-check exactly like every other
  // estimate/date/assignee mutation does, rather than leaving this path as a silent exception.
  if (newEstimatedMinutes !== undefined || newDueDate !== undefined || newAssigneeId !== undefined) {
    const resolvedTask = await prisma.projectTask.findUnique({ where: { id: review.taskId } });
    if (resolvedTask) await autoPlanIfUrgentSameDay(tid, req.auth!, resolvedTask);
  }

  // If approver requested to carry leftover planned minutes from the missed/overdue date to
  // the next company working day, compute the unworked portion and create/update an
  // allocation on the next working day. This respects company schedule and holidays and
  // will not create allocations beyond the task's due date.
  try {
    if (parsed.data.carryToNextWorkingDay) {
      // Reload company schedule + holidays to compute working days
      const [company, schedule, holidays] = await Promise.all([
        prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
        prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } }),
        prisma.holiday.findMany({ where: { tenantId: tid } }),
      ]);
      const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
      const sourceDateKey = review.originalDueDate ? localDateKey(review.originalDueDate, company.timezone) : null;
      const taskAssigneeId = review.task.assigneeId;
      if (sourceDateKey && taskAssigneeId) {
        // find allocation that was planned on the source date
        const sourceAlloc = await prisma.taskDailyAllocation.findUnique({
          where: { taskId_userId_date: { taskId: review.task.id, userId: taskAssigneeId, date: new Date(`${sourceDateKey}T00:00:00.000Z`) } },
          select: { plannedMinutes: true },
        });
        if (sourceAlloc && sourceAlloc.plannedMinutes > 0) {
          // compute tracked seconds for that task on the source date
          const start = new Date(`${sourceDateKey}T00:00:00.000Z`);
          const end = new Date(`${addDays(sourceDateKey, 1)}T00:00:00.000Z`);
          const entries = await prisma.taskTimeEntry.findMany({ where: { tenantId: tid, userId: taskAssigneeId, taskId: review.task.id, startedAt: { gte: start, lt: end } }, select: { durationSeconds: true } });
          const trackedSeconds = entries.reduce((total, e) => total + (e.durationSeconds ?? 0), 0);
          const unworked = Math.max(0, sourceAlloc.plannedMinutes - Math.floor(trackedSeconds / 60));
          if (unworked > 0) {
            // find next working day after sourceDateKey
            let cursor = addDays(sourceDateKey, 1);
            const holidayByDate = new Map(holidays.map((h) => [localDateKey(h.date, company.timezone), h]));
            const maxLookAhead = 90; // safety
            let found = null;
            for (let i = 0; i < maxLookAhead; i++) {
              const holiday = holidayByDate.get(cursor);
              const isWorkingDay = workingDays.includes(dateFromKey(cursor).getUTCDay()) && (!holiday || holiday.optional);
              if (isWorkingDay) { found = cursor; break; }
              cursor = addDays(cursor, 1);
            }
            if (found) {
              // Ensure we don't place allocation beyond the task's (possibly updated) due date
              const updatedTask = await prisma.projectTask.findUnique({ where: { id: review.task.id }, select: { dueDate: true } });
              if (!updatedTask?.dueDate || localDateKey(updatedTask.dueDate, company.timezone) >= found) {
                const targetDateValue = new Date(`${found}T00:00:00.000Z`);
                await prisma.taskDailyAllocation.upsert({
                  where: { taskId_userId_date: { taskId: review.task.id, userId: taskAssigneeId, date: targetDateValue } },
                  update: { plannedMinutes: unworked, note: carryForwardNote, updatedBy: uid },
                  create: { tenantId: tid, taskId: review.task.id, userId: taskAssigneeId, date: targetDateValue, plannedMinutes: unworked, note: carryForwardNote, createdBy: uid, updatedBy: uid },
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    // don't fail the whole resolve if carry logic has an issue — log and continue
    console.error("Carry-to-next-working-day failed:", err);
  }
  res.json({ review: updatedReview });
});