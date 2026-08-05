import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import type { AuthTokenPayload } from "../lib/jwt.js";
import { createNotification } from "../lib/chat.js";
import { flagNewlyOverdueTasks, resolveOverdueApprover } from "../lib/overdueReview.js";

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
  // history for this specific date doesn't disappear.
  const relevantTasks = tasks.filter((task) =>
    (task.status !== "done" && task.overdueReviewStatus === null && remainingMinutesFor(task) > 0) ||
    loggedTaskIds.has(task.id) ||
    allocationByTaskId.has(task.id));
  const tasksWithPlan = relevantTasks.map((task) => {
    const explicit = allocationByTaskId.get(task.id);
    // Today's own tracked time for this task, distinct from the lifetime trackedSeconds already
    // on the task row — lets the day panel show "worked 3h of 2h planned" (over) vs. "0h worked,
    // 2h planned" (not worked today) per task, instead of only ever showing the lifetime total.
    const todayTrackedSeconds = relevantEntries.filter((entry) => entry.taskId === task.id).reduce((total, entry) => total + durationSeconds(entry), 0);
    const plannedMinutes = explicit?.plannedMinutes ?? 0;
    return {
      ...task,
      // remainingMinutes already reflects the *full* logged time against estimatedMinutes,
      // regardless of what was planned for today — working over-plan on a task still counts
      // fully toward shrinking its remaining hours, exactly like on-plan or unplanned work does.
      remainingMinutes: remainingMinutesFor(task),
      plannedMinutes,
      todayTrackedSeconds,
      // Per-task overrun: how much of today's tracked time on this task exceeded what was
      // planned for it today. Mirrors the day-level extraPlannedSeconds but scoped to one task,
      // so overrunning one task while staying on-plan on the rest is visible per task, not just
      // blended into the day's aggregate "extra" number.
      extraTrackedSeconds: Math.max(0, todayTrackedSeconds - plannedMinutes * 60),
      hasExplicitAllocation: Boolean(explicit),
      allocationNote: explicit?.note ?? null,
    };
  });
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
    ? await prisma.projectTask.findMany({ where: { id: { in: taskIds }, tenantId: tid, assigneeId: employeeId }, select: { id: true } })
    : [];
  const ownedTaskIds = new Set(ownedTasks.map((task) => task.id));
  const invalid = taskIds.filter((id) => !ownedTaskIds.has(id));
  if (invalid.length) { res.status(400).json({ error: "One or more tasks are not assigned to this employee" }); return; }

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
}).refine((data) => data.newEstimatedMinutes !== undefined || data.newDueDate !== undefined || data.newAssigneeId !== undefined, { message: "Provide a new estimate, a new due date, or a new assignee" });
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
  res.json({ review: updatedReview });
});