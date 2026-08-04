import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import type { AuthTokenPayload } from "../lib/jwt.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireCompany);

const elevatedRoles = new Set(["company_super_admin", "hr_admin", "auditor"]);
const querySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teamId: z.string().optional(),
  search: z.string().trim().max(150).optional(),
});

function tenantId(req: { auth?: AuthTokenPayload }) { return (req.auth as { tenantId: string }).tenantId; }
function userId(req: { auth?: AuthTokenPayload }) { return (req.auth as { userId: string }).userId; }
function dateFromKey(key: string) { return new Date(`${key}T12:00:00.000Z`); }
function addDays(key: string, amount: number) { const date = dateFromKey(key); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function keysBetween(start: string, end: string, limit = 366) {
  const keys: string[] = [];
  for (let cursor = start; cursor <= end && keys.length < limit; cursor = addDays(cursor, 1)) keys.push(cursor);
  return keys;
}
function localDateKey(value: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { return value.toISOString().slice(0, 10); }
}
function effectiveDuration(entry: { durationSeconds: number; startedAt: Date; endedAt: Date | null }) {
  return entry.endedAt ? entry.durationSeconds : Math.max(entry.durationSeconds, Math.floor((Date.now() - entry.startedAt.getTime()) / 1000));
}
/** A plain average of task.progress treats a 5-minute task and a 3-week epic as equally
 *  significant, so whichever tasks happen to overlap a given day/range swings the number
 *  around even when no real work changed. Weighting by estimatedMinutes fixes that; tasks
 *  with no estimate (0) fall back to a 1-minute floor so they're still counted, just lightly. */
function weightedProgress(tasks: Array<{ progress: number; estimatedMinutes: number }>) {
  if (!tasks.length) return 0;
  const totalWeight = tasks.reduce((sum, task) => sum + Math.max(1, task.estimatedMinutes), 0);
  const weighted = tasks.reduce((sum, task) => sum + task.progress * Math.max(1, task.estimatedMinutes), 0);
  return Math.round(weighted / totalWeight);
}
/** A task with no startDate falls back to createdAt as its "start," but with no dueDate it has
 *  no defined end — treating that as "active every day until done" inflates allocatedTasks and
 *  skews productivity on days nobody touched it. A task only gets a real multi-day window once
 *  it has both dates; otherwise it's a single-day event on its start (or completion) day only. */
function hasDateWindow(task: { startDate: Date | null; dueDate: Date | null }) {
  return Boolean(task.startDate && task.dueDate);
}
function minutesBetween(startTime: string, endTime: string, breakMinutes: number) {
  const toMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
  return Math.max(0, toMinutes(endTime) - toMinutes(startTime) - breakMinutes);
}

async function accessibleTaskScope(tid: string, uid: string): Promise<{ scope: Prisma.ProjectTaskWhereInput; elevated: boolean }> {
  const user = await prisma.companyUser.findFirst({ where: { id: uid, tenantId: tid, accountStatus: "active" }, select: { roles: true } });
  const roles = user?.roles ?? [];
  if (roles.some((role) => elevatedRoles.has(role))) return { scope: { tenantId: tid }, elevated: true };
  const access: Prisma.ProjectTaskWhereInput[] = [{ assigneeId: uid }];
  if (roles.includes("team_lead")) access.push({ assignee: { teamMemberships: { some: { team: { tenantId: tid, leadUserId: uid } } } } });
  if (roles.includes("department_head")) access.push({ project: { department: { headUserId: uid } } });
  if (roles.includes("project_manager")) access.push({ project: { OR: [{ managerId: uid }, { ownerId: uid }] } });
  return { scope: { tenantId: tid, OR: access }, elevated: false };
}

/** Mirrors projects.ts's projectReadScope — kept as a local copy rather than a cross-file
 *  import since every route file in this codebase owns its own visibility scoping
 *  (see accessibleTaskScope above, resourceUserScope in resources.ts). */
async function accessibleProjectScope(tid: string, uid: string): Promise<{ scope: Prisma.ProjectWhereInput; elevated: boolean }> {
  const user = await prisma.companyUser.findFirst({ where: { id: uid, tenantId: tid, accountStatus: "active" }, select: { roles: true } });
  const roles = user?.roles ?? [];
  if (roles.some((role) => elevatedRoles.has(role))) return { scope: { tenantId: tid }, elevated: true };
  const access: Prisma.ProjectWhereInput[] = [
    { ownerId: uid },
    { managerId: uid },
    { members: { some: { userId: uid } } },
    { tasks: { some: { assigneeId: uid } } },
  ];
  if (roles.includes("department_head")) access.push({ department: { headUserId: uid } });
  if (roles.includes("team_lead")) access.push({ tasks: { some: { assignee: { teamMemberships: { some: { team: { leadUserId: uid } } } } } } });
  return { scope: { tenantId: tid, OR: access }, elevated: false };
}

reportsRouter.get("/team-productivity", requirePermission("resources", "view"), async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid report date range is required" }); return; }
  const input = parsed.data;
  const dates = keysBetween(input.start, input.end);
  if (!dates.length || dates[dates.length - 1] !== input.end) { res.status(400).json({ error: "Report range must be between 1 and 366 days" }); return; }
  const tid = tenantId(req), uid = userId(req);
  const [{ scope, elevated }, company, teams] = await Promise.all([
    accessibleTaskScope(tid, uid),
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
    prisma.team.findMany({
      where: { tenantId: tid, status: "active" },
      select: { id: true, name: true, leadUserId: true, leadUser: { select: { id: true, name: true } }, members: { select: { userId: true, user: { select: { id: true, name: true } } } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const taskWhere: Prisma.ProjectTaskWhereInput = { AND: [scope, { project: { isArchived: false } }] };
  if (input.teamId) taskWhere.AND = [...(taskWhere.AND as Prisma.ProjectTaskWhereInput[]), { assignee: { teamMemberships: { some: { teamId: input.teamId } } } }];
  const allTasks = await prisma.projectTask.findMany({
    where: taskWhere,
    select: {
      id: true, code: true, name: true, status: true, progress: true, estimatedMinutes: true,
      startDate: true, dueDate: true, completedAt: true, createdAt: true, assigneeId: true,
      assignee: { select: { id: true, name: true, teamMemberships: { select: { teamId: true } } } },
      project: { select: { id: true, name: true, key: true } },
    },
  });

  const inRange = allTasks.filter((task) => {
    if (task.completedAt) return localDateKey(task.completedAt, company.timezone) >= input.start && localDateKey(task.completedAt, company.timezone) <= input.end;
    if (hasDateWindow(task)) {
      const startKey = localDateKey(task.startDate!, company.timezone);
      const endKey = localDateKey(task.dueDate!, company.timezone);
      return startKey <= input.end && endKey >= input.start;
    }
    const createdKey = localDateKey(task.startDate ?? task.createdAt, company.timezone);
    return createdKey >= input.start && createdKey <= input.end;
  });
  const visibleTasks = input.search
    ? inRange.filter((task) => `${task.name} ${task.project.name} ${task.project.key} ${task.assignee?.name ?? ""}`.toLowerCase().includes(input.search!.toLowerCase()))
    : inRange;
  const taskIds = visibleTasks.map((task) => task.id);
  const entries = await prisma.taskTimeEntry.findMany({
    where: { tenantId: tid, taskId: { in: taskIds }, startedAt: { gte: new Date(`${addDays(input.start, -1)}T00:00:00.000Z`), lt: new Date(`${addDays(input.end, 2)}T00:00:00.000Z`) } },
    select: { id: true, taskId: true, userId: true, startedAt: true, endedAt: true, durationSeconds: true, billable: true },
  });
  const rangeEntries = entries.filter((entry) => { const key = localDateKey(entry.startedAt, company.timezone); return key >= input.start && key <= input.end; });
  const contributingTeamIds = new Set<string>();
  visibleTasks.forEach((task) => task.assignee?.teamMemberships.forEach((membership) => contributingTeamIds.add(membership.teamId)));
  const allowedTeams = teams.filter((team) => elevated || team.leadUserId === uid || team.members.some((member) => member.userId === uid) || contributingTeamIds.has(team.id));

  const buildMetrics = (teamId: string | null) => {
    const tasks = visibleTasks.filter((task) => {
      const ids = task.assignee?.teamMemberships.map((membership) => membership.teamId) ?? [];
      return teamId ? ids.includes(teamId) : ids.length === 0;
    });
    const ids = new Set(tasks.map((task) => task.id));
    const logs = rangeEntries.filter((entry) => ids.has(entry.taskId));
    const completed = tasks.filter((task) => task.completedAt && localDateKey(task.completedAt, company.timezone) >= input.start && localDateKey(task.completedAt, company.timezone) <= input.end).length;
    return {
      tasks,
      allocatedTasks: tasks.length,
      newTasks: tasks.filter((task) => task.status === "new_request").length,
      inProgressTasks: tasks.filter((task) => task.status === "in_progress").length,
      completedTasks: completed,
      overdueTasks: tasks.filter((task) => task.status !== "done" && task.dueDate && localDateKey(task.dueDate, company.timezone) < input.end).length,
      projectsCount: new Set(tasks.map((task) => task.project.id)).size,
      plannedMinutes: tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0),
      trackedSeconds: logs.reduce((sum, entry) => sum + effectiveDuration(entry), 0),
      billableSeconds: logs.filter((entry) => entry.billable).reduce((sum, entry) => sum + effectiveDuration(entry), 0),
      completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
      productivityPercent: weightedProgress(tasks),
    };
  };

  let teamRows = allowedTeams.map((team) => {
    const metrics = buildMetrics(team.id);
    const visibleMemberIds = new Set(metrics.tasks.map((task) => task.assigneeId).filter(Boolean));
    const members = team.members.filter((member) => elevated || team.leadUserId === uid || member.userId === uid || visibleMemberIds.has(member.userId)).map((member) => member.user);
    return { id: team.id, name: team.name, lead: team.leadUser, memberCount: team.members.length, members, ...metrics, tasks: undefined };
  });
  const unassigned = buildMetrics(null);
  if (!input.teamId && unassigned.allocatedTasks && (elevated || allowedTeams.length === 0)) {
    teamRows.push({ id: "unassigned", name: "Unassigned", lead: null, memberCount: 0, members: [], ...unassigned, tasks: undefined });
  }
  teamRows = teamRows.filter((team) => elevated || team.allocatedTasks > 0 || team.id !== "unassigned");

  const overallCompleted = visibleTasks.filter((task) => task.completedAt && localDateKey(task.completedAt, company.timezone) >= input.start && localDateKey(task.completedAt, company.timezone) <= input.end).length;
  const overall = {
    teamsCount: teamRows.filter((team) => team.id !== "unassigned").length,
    projectsCount: new Set(visibleTasks.map((task) => task.project.id)).size,
    allocatedTasks: visibleTasks.length,
    newTasks: visibleTasks.filter((task) => task.status === "new_request").length,
    inProgressTasks: visibleTasks.filter((task) => task.status === "in_progress").length,
    completedTasks: overallCompleted,
    overdueTasks: visibleTasks.filter((task) => task.status !== "done" && task.dueDate && localDateKey(task.dueDate, company.timezone) < input.end).length,
    plannedMinutes: visibleTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0),
    trackedSeconds: rangeEntries.reduce((sum, entry) => sum + effectiveDuration(entry), 0),
    completionRate: visibleTasks.length ? Math.round((overallCompleted / visibleTasks.length) * 100) : 0,
    productivityPercent: weightedProgress(visibleTasks),
  };

  const daily = dates.map((date) => {
    const tasks = visibleTasks.filter((task) => {
      if (task.completedAt) return localDateKey(task.completedAt, company.timezone) === date;
      if (hasDateWindow(task)) {
        const startKey = localDateKey(task.startDate!, company.timezone);
        const endKey = localDateKey(task.dueDate!, company.timezone);
        return startKey <= date && endKey >= date;
      }
      return localDateKey(task.startDate ?? task.createdAt, company.timezone) === date;
    });
    const logs = rangeEntries.filter((entry) => localDateKey(entry.startedAt, company.timezone) === date);
    return {
      date,
      allocatedTasks: tasks.length,
      inProgressTasks: tasks.filter((task) => task.status === "in_progress").length,
      completedTasks: visibleTasks.filter((task) => task.completedAt && localDateKey(task.completedAt, company.timezone) === date).length,
      trackedSeconds: logs.reduce((sum, entry) => sum + effectiveDuration(entry), 0),
      productivityPercent: weightedProgress(tasks),
    };
  });

  res.json({
    range: { start: input.start, end: input.end, timezone: company.timezone },
    overall,
    teams: teamRows,
    daily,
    filterOptions: { teams: allowedTeams.map((team) => ({ id: team.id, name: team.name })) },
    methodology: "Productivity is the estimated-hours-weighted average progress of allocated tasks, so larger tasks influence the number more than quick ones. A task only counts on a given day/range if it has both a start and due date overlapping it, or on its creation/completion day otherwise — undated tasks no longer count on every day of the report. Multi-team employees contribute to each team they belong to; company totals deduplicate tasks and logs.",
  });
});
reportsRouter.get("/team-productivity/:teamId/members", requirePermission("resources", "view"), async (req, res) => {
  const parsed = querySchema.omit({ teamId: true }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid report date range is required" }); return; }
  const input = parsed.data;
  const dates = keysBetween(input.start, input.end);
  if (!dates.length || dates[dates.length - 1] !== input.end) { res.status(400).json({ error: "Report range must be between 1 and 366 days" }); return; }
  const tid = tenantId(req), uid = userId(req), teamId = req.params.teamId as string;
  const [{ scope, elevated }, company, schedule, holidays, team] = await Promise.all([
    accessibleTaskScope(tid, uid),
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
    prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } }),
    prisma.holiday.findMany({ where: { tenantId: tid, date: { gte: new Date(`${input.start}T00:00:00.000Z`), lt: new Date(`${addDays(input.end, 1)}T00:00:00.000Z`) } }, select: { date: true, optional: true } }),
    prisma.team.findFirst({
      where: { id: teamId, tenantId: tid, status: "active" },
      select: {
        id: true, name: true, purpose: true, leadUserId: true,
        leadUser: { select: { id: true, name: true } },
        members: { where: { user: { accountStatus: "active" } }, select: { joinedAt: true, userId: true, user: { select: { id: true, name: true } } }, orderBy: { joinedAt: "asc" } },
      },
    }),
  ]);
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }

  const allTasks = await prisma.projectTask.findMany({
    where: { AND: [scope, { project: { isArchived: false } }, { assignee: { teamMemberships: { some: { teamId } } } }] },
    select: {
      id: true, name: true, status: true, progress: true, estimatedMinutes: true, startDate: true, dueDate: true,
      completedAt: true, createdAt: true, assigneeId: true,
      project: { select: { id: true, name: true, key: true } },
    },
  });
  const rangeTasks = allTasks.filter((task) => {
    if (task.completedAt) return localDateKey(task.completedAt, company.timezone) >= input.start && localDateKey(task.completedAt, company.timezone) <= input.end;
    if (hasDateWindow(task)) {
      const startKey = localDateKey(task.startDate!, company.timezone);
      const endKey = localDateKey(task.dueDate!, company.timezone);
      return startKey <= input.end && endKey >= input.start;
    }
    const createdKey = localDateKey(task.startDate ?? task.createdAt, company.timezone);
    return createdKey >= input.start && createdKey <= input.end;
  });
  const accessibleAssigneeIds = new Set(rangeTasks.map((task) => task.assigneeId).filter((id): id is string => Boolean(id)));
  const canSeeWholeTeam = elevated || team.leadUserId === uid;
  const visibleMembers = team.members.filter((member) => canSeeWholeTeam || member.userId === uid || accessibleAssigneeIds.has(member.userId));
  if (!canSeeWholeTeam && !team.members.some((member) => member.userId === uid) && visibleMembers.length === 0) {
    res.status(404).json({ error: "Team report not found" }); return;
  }

  const memberIds = visibleMembers.map((member) => member.userId);
  const taskIds = rangeTasks.map((task) => task.id);
  const entries = await prisma.taskTimeEntry.findMany({
    where: {
      tenantId: tid, taskId: { in: taskIds }, userId: { in: memberIds },
      startedAt: { gte: new Date(`${addDays(input.start, -1)}T00:00:00.000Z`), lt: new Date(`${addDays(input.end, 2)}T00:00:00.000Z`) },
    },
    select: { taskId: true, userId: true, startedAt: true, endedAt: true, durationSeconds: true, billable: true },
  });
  const rangeEntries = entries.filter((entry) => { const key = localDateKey(entry.startedAt, company.timezone); return key >= input.start && key <= input.end; });
  const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
  const dailyMinutes = schedule ? minutesBetween(schedule.startTime, schedule.endTime, schedule.breakMinutes) : 480;
  const holidayByDate = new Map(holidays.map((holiday) => [localDateKey(holiday.date, company.timezone), holiday]));
  const capacityMinutes = dates.reduce((total, date) => {
    const holiday = holidayByDate.get(date);
    const working = workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
    return total + (working ? dailyMinutes : 0);
  }, 0);
  const search = input.search?.toLowerCase();

  const reportedTaskIds = new Set<string>();
  const allRangeTaskIds = new Set(rangeTasks.map((task) => task.id));
  const searchMatchedTaskIds = new Set(rangeTasks.filter((task) => !search || `${task.name} ${task.project.name} ${task.project.key}`.toLowerCase().includes(search)).map((task) => task.id));
  let members = visibleMembers.map((membership) => {
    const nameMatches = search ? membership.user.name.toLowerCase().includes(search) : false;
    const assigned = rangeTasks.filter((task) => task.assigneeId === membership.userId);
    const tasks = !search || nameMatches ? assigned : assigned.filter((task) => `${task.name} ${task.project.name} ${task.project.key}`.toLowerCase().includes(search));
    const relevantTaskIds = new Set(tasks.map((task) => task.id));
    relevantTaskIds.forEach((taskId) => reportedTaskIds.add(taskId));
    const logTaskIds = !search || nameMatches ? allRangeTaskIds : searchMatchedTaskIds;
    const logs = rangeEntries.filter((entry) => entry.userId === membership.userId && logTaskIds.has(entry.taskId));
    const completedTasks = tasks.filter((task) => task.completedAt && localDateKey(task.completedAt, company.timezone) >= input.start && localDateKey(task.completedAt, company.timezone) <= input.end).length;
    const trackedSeconds = logs.reduce((total, entry) => total + effectiveDuration(entry), 0);
    const productivityPercent = weightedProgress(tasks);
    return {
      id: membership.userId, name: membership.user.name, joinedAt: membership.joinedAt,
      isLead: team.leadUserId === membership.userId,
      projectsCount: new Set(tasks.map((task) => task.project.id)).size,
      assignedTasks: tasks.length,
      newTasks: tasks.filter((task) => task.status === "new_request").length,
      inProgressTasks: tasks.filter((task) => task.status === "in_progress").length,
      completedTasks,
      overdueTasks: tasks.filter((task) => task.status !== "done" && task.dueDate && localDateKey(task.dueDate, company.timezone) < input.end).length,
      plannedMinutes: tasks.reduce((total, task) => total + task.estimatedMinutes, 0),
      trackedSeconds,
      billableSeconds: logs.filter((entry) => entry.billable).reduce((total, entry) => total + effectiveDuration(entry), 0),
      capacityMinutes,
      utilizationPercent: capacityMinutes ? Math.round((trackedSeconds / 60 / capacityMinutes) * 100) : 0,
      completionRate: tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0,
      productivityPercent,
    };
  });
  if (search) members = members.filter((member) => member.name.toLowerCase().includes(search) || member.assignedTasks > 0 || member.trackedSeconds > 0);
  members.sort((a, b) => b.productivityPercent - a.productivityPercent || b.completedTasks - a.completedTasks || a.overdueTasks - b.overdueTasks || b.trackedSeconds - a.trackedSeconds || a.name.localeCompare(b.name));
  members = members.map((member, index) => ({ ...member, rank: index + 1 }));
  const activeMembers = members.filter((member) => member.assignedTasks > 0 || member.trackedSeconds > 0);
  const ranking = activeMembers.slice(0, 3);
  const uniqueTasks = new Map(rangeTasks.filter((task) => reportedTaskIds.has(task.id)).map((task) => [task.id, task]));
  const completedTasks = [...uniqueTasks.values()].filter((task) => task.completedAt && localDateKey(task.completedAt, company.timezone) >= input.start && localDateKey(task.completedAt, company.timezone) <= input.end).length;
  const totalTrackedSeconds = members.reduce((total, member) => total + member.trackedSeconds, 0);

  res.json({
    range: { start: input.start, end: input.end, timezone: company.timezone },
    schedule: { name: schedule?.name ?? "Default", workingDays, startTime: schedule?.startTime ?? "09:00", endTime: schedule?.endTime ?? "18:00", breakMinutes: schedule?.breakMinutes ?? 60, dailyMinutes },
    team: { id: team.id, name: team.name, purpose: team.purpose, lead: team.leadUser, memberCount: team.members.length, visibleMemberCount: members.length },
    summary: {
      membersCount: members.length,
      projectsCount: new Set([...uniqueTasks.values()].map((task) => task.project.id)).size,
      assignedTasks: uniqueTasks.size,
      inProgressTasks: [...uniqueTasks.values()].filter((task) => task.status === "in_progress").length,
      completedTasks,
      overdueTasks: [...uniqueTasks.values()].filter((task) => task.status !== "done" && task.dueDate && localDateKey(task.dueDate, company.timezone) < input.end).length,
      plannedMinutes: [...uniqueTasks.values()].reduce((total, task) => total + task.estimatedMinutes, 0),
      trackedSeconds: totalTrackedSeconds,
      capacityMinutes: capacityMinutes * members.length,
      productivityPercent: members.length ? Math.round(members.reduce((total, member) => total + member.productivityPercent, 0) / members.length) : 0,
      utilizationPercent: capacityMinutes && members.length ? Math.round((totalTrackedSeconds / 60 / (capacityMinutes * members.length)) * 100) : 0,
    },
    ranking,
    members,
    methodology: "Ranking uses estimated-hours-weighted task progress first, then completed tasks, fewer overdue tasks and tracked time. Capacity follows company working days, holidays, shift hours and break policy. Time is counted from saved work logs on tasks allocated to this team.",
  });
});

// ---- Project Performance ----
reportsRouter.get("/project-performance", requirePermission("projects", "view"), async (req, res) => {
  const parsed = querySchema.omit({ teamId: true }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid report date range is required" }); return; }
  const input = parsed.data;
  const tid = tenantId(req), uid = userId(req);
  const [{ scope }, company] = await Promise.all([
    accessibleProjectScope(tid, uid),
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
  ]);

  const projects = await prisma.project.findMany({
    where: { AND: [scope, { isArchived: false }] },
    select: {
      id: true, name: true, key: true, clientName: true, status: true, priority: true,
      startDate: true, dueDate: true, actualStartDate: true, actualEndDate: true,
      completionPercent: true, healthScore: true, healthStatus: true,
      budget: true, budgetSpent: true, budgetStatus: true, trackedSeconds: true,
      estimatedHours: true, createdAt: true,
      manager: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      _count: { select: { tasks: true, milestones: true } },
      tasks: { select: { status: true } },
      milestones: { select: { progress: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const search = input.search?.toLowerCase();
  const visible = search
    ? projects.filter((project) => `${project.name} ${project.key} ${project.clientName ?? ""} ${project.manager?.name ?? ""}`.toLowerCase().includes(search))
    : projects;

  const today = new Date();
  const rows = visible.map((project) => {
    const doneTasks = project.tasks.filter((task) => task.status === "done").length;
    const isOverdue = project.status !== "completed" && project.status !== "cancelled" && project.dueDate != null && project.dueDate < today;
    const daysRemaining = project.dueDate ? Math.ceil((project.dueDate.getTime() - today.getTime()) / 86400000) : null;
    const milestoneProgress = project.milestones.length
      ? Math.round(project.milestones.reduce((sum, milestone) => sum + milestone.progress, 0) / project.milestones.length)
      : null;
    const budgetNumber = project.budget != null ? Number(project.budget) : null;
    const spentNumber = Number(project.budgetSpent);
    return {
      id: project.id, name: project.name, key: project.key, clientName: project.clientName,
      status: project.status, priority: project.priority,
      manager: project.manager, owner: project.owner,
      startDate: project.startDate, dueDate: project.dueDate,
      actualStartDate: project.actualStartDate, actualEndDate: project.actualEndDate,
      completionPercent: project.completionPercent,
      healthScore: project.healthScore, healthStatus: project.healthStatus,
      budget: budgetNumber, budgetSpent: spentNumber, budgetStatus: project.budgetStatus,
      budgetUtilizationPercent: budgetNumber ? Math.round((spentNumber / budgetNumber) * 100) : null,
      estimatedHours: project.estimatedHours,
      trackedSeconds: project.trackedSeconds,
      totalTasks: project._count.tasks, completedTasks: doneTasks,
      milestonesCount: project._count.milestones, milestoneProgress,
      isOverdue, daysRemaining,
    };
  });

  const inRange = rows.filter((row) => {
    const createdKey = row.startDate ? localDateKey(row.startDate, company.timezone) : null;
    const completedKey = row.actualEndDate ? localDateKey(row.actualEndDate, company.timezone) : null;
    if (completedKey) return completedKey >= input.start && completedKey <= input.end;
    if (createdKey) return createdKey <= input.end;
    return true;
  });

  const overall = {
    totalProjects: rows.length,
    activeProjects: rows.filter((row) => row.status === "in_progress" || row.status === "planning").length,
    completedProjects: rows.filter((row) => row.status === "completed").length,
    onHoldProjects: rows.filter((row) => row.status === "on_hold").length,
    overdueProjects: rows.filter((row) => row.isOverdue).length,
    atRiskProjects: rows.filter((row) => row.healthStatus === "at_risk" || row.healthStatus === "critical").length,
    avgCompletionPercent: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.completionPercent, 0) / rows.length) : 0,
    avgHealthScore: (() => {
      const scored = rows.filter((row) => row.healthScore != null);
      return scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.healthScore ?? 0), 0) / scored.length) : null;
    })(),
    totalBudget: rows.reduce((sum, row) => sum + (row.budget ?? 0), 0),
    totalBudgetSpent: rows.reduce((sum, row) => sum + row.budgetSpent, 0),
    totalTrackedSeconds: rows.reduce((sum, row) => sum + row.trackedSeconds, 0),
  };

  const statusBreakdown = (["new", "planning", "in_progress", "on_hold", "completed", "cancelled"] as const)
    .map((status) => ({ status, count: rows.filter((row) => row.status === status).length }))
    .filter((entry) => entry.count > 0);

  const dates = keysBetween(input.start, input.end);
  const completionTrend = dates.map((date) => ({
    date,
    completed: rows.filter((row) => row.actualEndDate && localDateKey(row.actualEndDate, company.timezone) === date).length,
  }));

  res.json({
    range: { start: input.start, end: input.end },
    overall,
    statusBreakdown,
    completionTrend,
    projects: inRange.sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity)),
    methodology: "Health score and completion percentage are computed server-side whenever a task changes and stored on the project. Budget utilisation compares logged spend against the set budget. The trend counts projects whose actual end date falls inside the selected range.",
  });
});

// ---- Time & Utilisation ----
const timeUtilisationQuery = querySchema.extend({ billable: z.enum(["all", "billable", "non_billable"]).optional() });

reportsRouter.get("/time-utilisation", requirePermission("resources", "view"), async (req, res) => {
  const parsed = timeUtilisationQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "A valid report date range is required" }); return; }
  const input = parsed.data;
  const dates = keysBetween(input.start, input.end);
  if (!dates.length || dates[dates.length - 1] !== input.end) { res.status(400).json({ error: "Report range must be between 1 and 366 days" }); return; }
  const tid = tenantId(req), uid = userId(req);
  const [{ scope, elevated }, company, schedule, holidays, teams] = await Promise.all([
    accessibleTaskScope(tid, uid),
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
    prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } }),
    prisma.holiday.findMany({ where: { tenantId: tid, date: { gte: new Date(`${input.start}T00:00:00.000Z`), lt: new Date(`${addDays(input.end, 1)}T00:00:00.000Z`) } }, select: { date: true, optional: true } }),
    // Not scoped by role yet — filtered below into visibleTeams for non-elevated callers, since
    // an employee shouldn't see every team in the company in this report's "Team" filter, only
    // ones relevant to them (their own team, or a team whose member's tracked time they can see).
    prisma.team.findMany({ where: { tenantId: tid, status: "active" }, select: { id: true, name: true, leadUserId: true, members: { select: { userId: true } } } }),
  ]);

  const employeeWhere: Prisma.CompanyUserWhereInput = elevated
    ? { tenantId: tid, accountStatus: "active" }
    : { tenantId: tid, accountStatus: "active", OR: [{ id: uid }, { projectTasksAssigned: { some: scope } }] };
  const employees = await prisma.companyUser.findMany({
    where: input.teamId ? { AND: [employeeWhere, { teamMemberships: { some: { teamId: input.teamId } } }] } : employeeWhere,
    select: { id: true, name: true, email: true, teamMemberships: { select: { team: { select: { id: true, name: true } } } } },
    orderBy: { name: "asc" },
  });
  const search = input.search?.toLowerCase();
  const visibleEmployees = search ? employees.filter((employee) => employee.name.toLowerCase().includes(search)) : employees;
  const employeeIds = visibleEmployees.map((employee) => employee.id);
  const visibleTeams = elevated
    ? teams
    : teams.filter((team) => team.leadUserId === uid || team.members.some((member) => member.userId === uid || employeeIds.includes(member.userId)));

  const entries = await prisma.taskTimeEntry.findMany({
    where: {
      tenantId: tid, userId: { in: employeeIds },
      startedAt: { gte: new Date(`${addDays(input.start, -1)}T00:00:00.000Z`), lt: new Date(`${addDays(input.end, 2)}T00:00:00.000Z`) },
    },
    select: { userId: true, startedAt: true, endedAt: true, durationSeconds: true, billable: true },
  });
  const rangeEntries = entries.filter((entry) => { const key = localDateKey(entry.startedAt, company.timezone); return key >= input.start && key <= input.end; });

  const workingDays = schedule?.workingDays ?? [1, 2, 3, 4, 5];
  const dailyMinutes = schedule ? minutesBetween(schedule.startTime, schedule.endTime, schedule.breakMinutes) : 480;
  const holidayByDate = new Map(holidays.map((holiday) => [localDateKey(holiday.date, company.timezone), holiday]));
  const capacityMinutes = dates.reduce((total, date) => {
    const holiday = holidayByDate.get(date);
    const working = workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
    return total + (working ? dailyMinutes : 0);
  }, 0);
  const workingDayCount = dates.filter((date) => {
    const holiday = holidayByDate.get(date);
    return workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
  }).length;

  let members = visibleEmployees.map((employee) => {
    const logs = rangeEntries.filter((entry) => entry.userId === employee.id);
    const trackedSeconds = logs.reduce((total, entry) => total + effectiveDuration(entry), 0);
    const billableSeconds = logs.filter((entry) => entry.billable).reduce((total, entry) => total + effectiveDuration(entry), 0);
    const nonBillableSeconds = trackedSeconds - billableSeconds;
    const activeDays = new Set(logs.map((entry) => localDateKey(entry.startedAt, company.timezone))).size;
    return {
      id: employee.id, name: employee.name, email: employee.email,
      teams: employee.teamMemberships.map((membership) => membership.team),
      capacityMinutes, workingDayCount, activeDays, idleDays: Math.max(0, workingDayCount - activeDays),
      trackedSeconds, billableSeconds, nonBillableSeconds,
      billablePercent: trackedSeconds ? Math.round((billableSeconds / trackedSeconds) * 100) : 0,
      utilizationPercent: capacityMinutes ? Math.round((trackedSeconds / 60 / capacityMinutes) * 100) : 0,
      overtimeMinutes: Math.max(0, Math.round(trackedSeconds / 60) - capacityMinutes),
    };
  });
  if (input.billable === "billable") members = members.filter((member) => member.billableSeconds > 0);
  if (input.billable === "non_billable") members = members.filter((member) => member.nonBillableSeconds > 0);
  members.sort((a, b) => b.trackedSeconds - a.trackedSeconds || a.name.localeCompare(b.name));

  const totalTrackedSeconds = members.reduce((sum, member) => sum + member.trackedSeconds, 0);
  const totalBillableSeconds = members.reduce((sum, member) => sum + member.billableSeconds, 0);
  const totalCapacityMinutes = capacityMinutes * members.length;

  const daily = dates.map((date) => {
    const logs = rangeEntries.filter((entry) => localDateKey(entry.startedAt, company.timezone) === date);
    const trackedSeconds = logs.reduce((sum, entry) => sum + effectiveDuration(entry), 0);
    const billableSeconds = logs.filter((entry) => entry.billable).reduce((sum, entry) => sum + effectiveDuration(entry), 0);
    const holiday = holidayByDate.get(date);
    const isWorkingDay = workingDays.includes(dateFromKey(date).getUTCDay()) && (!holiday || holiday.optional);
    const dayCapacityMinutes = isWorkingDay ? dailyMinutes * members.length : 0;
    return {
      date, trackedSeconds, billableSeconds,
      utilizationPercent: dayCapacityMinutes ? Math.round((trackedSeconds / 60 / dayCapacityMinutes) * 100) : 0,
    };
  });

  res.json({
    range: { start: input.start, end: input.end, timezone: company.timezone },
    schedule: { name: schedule?.name ?? "Default", workingDays, startTime: schedule?.startTime ?? "09:00", endTime: schedule?.endTime ?? "18:00", breakMinutes: schedule?.breakMinutes ?? 60, dailyMinutes },
    overall: {
      employeesCount: members.length,
      workingDayCount,
      totalCapacityMinutes,
      totalTrackedSeconds,
      totalBillableSeconds,
      totalNonBillableSeconds: totalTrackedSeconds - totalBillableSeconds,
      billablePercent: totalTrackedSeconds ? Math.round((totalBillableSeconds / totalTrackedSeconds) * 100) : 0,
      utilizationPercent: totalCapacityMinutes ? Math.round((totalTrackedSeconds / 60 / totalCapacityMinutes) * 100) : 0,
    },
    daily,
    members,
    filterOptions: { teams: visibleTeams.map((team) => ({ id: team.id, name: team.name })) },
    methodology: "Capacity follows the company working schedule (working days, shift hours, break policy) minus non-optional holidays, multiplied by the number of employees in view. Tracked and billable time comes from saved work logs on tasks the viewer can access.",
  });
});