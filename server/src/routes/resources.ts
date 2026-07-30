import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import type { AuthTokenPayload } from "../lib/jwt.js";

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth, requireCompany);

function tenantId(req: { auth?: AuthTokenPayload }) {
  return (req.auth as { tenantId: string }).tenantId;
}
function userId(req: { auth?: AuthTokenPayload }) {
  return (req.auth as { userId: string }).userId;
}

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
function taskDateSpan(task: { startDate: Date | null; dueDate: Date | null }, timezone: string, workingDays: number[]) {
  const start = task.startDate ? localDateKey(task.startDate, timezone) : task.dueDate ? localDateKey(task.dueDate, timezone) : null;
  const end = task.dueDate ? localDateKey(task.dueDate, timezone) : task.startDate ? localDateKey(task.startDate, timezone) : null;
  if (!start || !end) return [];
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const dates = keysBetween(first, last, 740).filter((key) => workingDays.includes(dateFromKey(key).getUTCDay()));
  return dates.length ? dates : [last];
}

const plannerQuery = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  search: z.string().trim().max(255).optional(),
  occupancy: z.enum(["all", "occupied", "unoccupied"]).default("all"),
  teamId: z.string().optional(),
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
  const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
  const capacityMinutes = schedule ? minutesBetween(schedule.startTime, schedule.endTime, schedule.breakMinutes) : 480;
  const holidayByDate = new Map(holidays.map((holiday) => [localDateKey(holiday.date, company.timezone), holiday]));
  const where: Prisma.CompanyUserWhereInput = { AND: [scope] };
  if (input.search) {
    const employeeIdSearch = input.search.replace(/^EMP-/i, "");
    where.AND = [...(where.AND as Prisma.CompanyUserWhereInput[]), { OR: [{ name: { contains: input.search, mode: "insensitive" } }, { email: { contains: input.search, mode: "insensitive" } }, { id: { contains: employeeIdSearch, mode: "insensitive" } }] }];
  }
  if (input.teamId) where.AND = [...(where.AND as Prisma.CompanyUserWhereInput[]), { teamMemberships: { some: { teamId: input.teamId } } }];
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
  const [tasks, entries] = await Promise.all([
    prisma.projectTask.findMany({
      where: { tenantId: tid, assigneeId: { in: ids }, project: { isArchived: false } },
      select: { id: true, assigneeId: true, name: true, status: true, progress: true, estimatedMinutes: true, startDate: true, dueDate: true, completedAt: true, project: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.taskTimeEntry.findMany({
      where: { tenantId: tid, userId: { in: ids }, startedAt: { gte: new Date(`${extendedStart}T00:00:00.000Z`), lt: new Date(`${extendedEnd}T00:00:00.000Z`) } },
      select: { id: true, userId: true, taskId: true, startedAt: true, endedAt: true, durationSeconds: true, billable: true },
    }),
  ]);
  const globalDays = rangeDays.map((date) => {
    const holiday = holidayByDate.get(date);
    const isWorkingDay = workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
    return { date, label: dateFromKey(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }), isWorkingDay, isWeekend: !workingDays.includes(dateFromKey(date).getUTCDay()), holidayName: holiday?.name ?? null, capacityMinutes: isWorkingDay ? capacityMinutes : 0 };
  });
  const taskDays = new Map<string, string[]>();
  tasks.forEach((task) => taskDays.set(task.id, taskDateSpan(task, company.timezone, workingDays)));

  let employees = users.map((user) => {
    const userTasks = tasks.filter((task) => task.assigneeId === user.id);
    const incompleteTaskCount = userTasks.filter((task) => task.status !== "done").length;
    const projectIds = new Set([...user.projectMemberships.map((item) => item.projectId), ...user.projectsOwned.map((item) => item.id), ...user.projectsManaged.map((item) => item.id), ...userTasks.map((task) => task.project.id)]);
    const dayValues = globalDays.map((day) => {
      const scheduledTasks = userTasks.filter((task) => taskDays.get(task.id)?.includes(day.date));
      const plannedMinutes = scheduledTasks.reduce((total, task) => total + Math.round(task.estimatedMinutes / Math.max(1, taskDays.get(task.id)?.length ?? 1)), 0);
      const dayEntries = entries.filter((entry) => entry.userId === user.id && localDateKey(entry.startedAt, company.timezone) === day.date);
      const trackedSeconds = dayEntries.reduce((total, entry) => total + durationSeconds(entry), 0);
      const completedTaskCount = userTasks.filter((task) => task.completedAt && localDateKey(task.completedAt, company.timezone) === day.date).length;
      const plannedTrackedSeconds = Math.min(trackedSeconds, plannedMinutes * 60);
      return {
        date: day.date, taskCount: scheduledTasks.length, completedTaskCount, plannedMinutes, trackedSeconds,
        plannedTrackedSeconds, extraPlannedSeconds: Math.max(0, trackedSeconds - plannedMinutes * 60),
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
    days: globalDays, employees, filterOptions: { teams },
  });
});

const dayQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
resourcesRouter.get("/planner/:employeeId/day", requirePermission("resources", "view"), async (req, res) => {
  const parsed = dayQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid date is required" }); return; }
  const tid = tenantId(req), uid = userId(req), employeeId = req.params.employeeId as string, date = parsed.data.date;
  const scope = await resourceUserScope(tid, uid);
  const employee = await prisma.companyUser.findFirst({ where: { AND: [scope, { id: employeeId }] }, select: { id: true, name: true, email: true } });
  if (!employee) { res.status(404).json({ error: "Employee not found" }); return; }
  const [company, schedule, holiday, tasks, entries] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
    prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } }),
    prisma.holiday.findFirst({ where: { tenantId: tid, date: { gte: new Date(`${date}T00:00:00.000Z`), lt: new Date(`${addDays(date, 1)}T00:00:00.000Z`) } } }),
    prisma.projectTask.findMany({ where: { tenantId: tid, assigneeId: employeeId, project: { isArchived: false } }, select: { id: true, code: true, name: true, status: true, progress: true, estimatedMinutes: true, trackedSeconds: true, startDate: true, dueDate: true, completedAt: true, project: { select: { id: true, name: true, key: true } } }, orderBy: { dueDate: "asc" } }),
    prisma.taskTimeEntry.findMany({ where: { tenantId: tid, userId: employeeId, startedAt: { gte: new Date(`${addDays(date, -1)}T00:00:00.000Z`), lt: new Date(`${addDays(date, 2)}T00:00:00.000Z`) } }, include: { task: { select: { id: true, code: true, name: true, status: true, progress: true } }, project: { select: { id: true, name: true, key: true } } }, orderBy: { startedAt: "asc" } }),
  ]);
  const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
  const dailyMinutes = schedule ? minutesBetween(schedule.startTime, schedule.endTime, schedule.breakMinutes) : 480;
  const relevantEntries = entries.filter((entry) => localDateKey(entry.startedAt, company.timezone) === date);
  const loggedTaskIds = new Set(relevantEntries.map((entry) => entry.taskId));
  const relevantTasks = tasks.filter((task) => taskDateSpan(task, company.timezone, workingDays).includes(date) || loggedTaskIds.has(task.id) || (task.completedAt && localDateKey(task.completedAt, company.timezone) === date));
  const tasksWithPlan = relevantTasks.map((task) => {
    const span = taskDateSpan(task, company.timezone, workingDays);
    return { ...task, plannedMinutes: span.includes(date) ? Math.round(task.estimatedMinutes / Math.max(1, span.length)) : 0 };
  });
  const plannedMinutes = tasksWithPlan.reduce((total, task) => total + task.plannedMinutes, 0);
  const trackedSeconds = relevantEntries.reduce((total, entry) => total + durationSeconds(entry), 0);
  const isWorkingDay = workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
  res.json({
    employee, date, holiday: holiday ? { name: holiday.name, optional: holiday.optional } : null,
    capacityMinutes: isWorkingDay ? dailyMinutes : 0, plannedMinutes, trackedSeconds,
    plannedTrackedSeconds: Math.min(trackedSeconds, plannedMinutes * 60),
    extraPlannedSeconds: Math.max(0, trackedSeconds - plannedMinutes * 60),
    unplannedTrackedSeconds: plannedMinutes === 0 ? trackedSeconds : 0,
    remainingPlannedMinutes: Math.max(0, plannedMinutes - Math.floor(trackedSeconds / 60)),
    tasks: tasksWithPlan,
    logs: relevantEntries.map((entry) => ({ ...entry, effectiveDurationSeconds: durationSeconds(entry) })),
  });
});