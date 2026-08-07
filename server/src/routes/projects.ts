import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { createNotification, ensureProjectChatMembers, extractMentionIds } from "../lib/chat.js";
import { flagNewlyOverdueTasks } from "../lib/overdueReview.js";
import { autoPlanIfUrgentSameDay } from "../lib/urgentAutoPlan.js";
import { resolveApprover, resolveTeamLead } from "../lib/approvers.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth, requireCompany);

function tenantId(req: { auth?: { kind: string; tenantId?: string } }): string {
  return (req.auth as { tenantId: string }).tenantId;
}
function userId(req: { auth?: { kind: string; userId?: string } }): string {
  return (req.auth as { userId: string }).userId;
}

const userSelect = { id: true, name: true, email: true, accountStatus: true } as const;
const projectInclude = {
  manager: { select: userSelect },
  owner: { select: userSelect },
  department: { select: { id: true, name: true } },
  _count: { select: { tasks: true } },
} as const;
const taskDetailInclude = {
  assignee: { select: userSelect },
  followers: { include: { user: { select: userSelect } }, orderBy: { createdAt: "asc" as const } },
  comments: { include: { author: { select: userSelect } }, orderBy: { createdAt: "asc" as const } },
  checklistItems: { orderBy: { position: "asc" as const } },
  attachments: { orderBy: { createdAt: "asc" as const } },
  dependencies: {
    include: { dependsOnTask: { select: { id: true, code: true, name: true, status: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  timeEntries: {
    include: { user: { select: userSelect } },
    orderBy: { startedAt: "desc" as const },
    take: 100,
  },
} as const;

const elevatedProjectReaders = new Set(["company_super_admin", "hr_admin", "auditor"]);

export async function getCompanyUserRoles(tid: string, uid: string) {
  const user = await prisma.companyUser.findFirst({
    where: { id: uid, tenantId: tid, accountStatus: "active" },
    select: { roles: true },
  });
  return user?.roles ?? [];
}

async function projectReadScope(tid: string, uid: string): Promise<Prisma.ProjectWhereInput> {
  const roles = await getCompanyUserRoles(tid, uid);
  if (roles.some((role) => elevatedProjectReaders.has(role))) return { tenantId: tid };
  const assignments: Prisma.ProjectWhereInput[] = [
    { ownerId: uid },
    { managerId: uid },
    { members: { some: { userId: uid } } },
    { tasks: { some: { assigneeId: uid } } },
    { tasks: { some: { followers: { some: { userId: uid } } } } },
  ];
  if (roles.includes("department_head")) assignments.push({ department: { headUserId: uid } });
  if (roles.includes("team_lead")) {
    assignments.push({ tasks: { some: { assignee: { teamMemberships: { some: { team: { leadUserId: uid } } } } } } });
  }
  return { tenantId: tid, OR: assignments };
}

async function projectAccessLevel(
  tid: string,
  uid: string,
  project: { id: string; ownerId: string | null; managerId: string | null; departmentId: string | null },
): Promise<"view" | "edit" | "manage" | null> {
  const [roles, membership, headedDepartment] = await Promise.all([
    getCompanyUserRoles(tid, uid),
    prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: uid } },
      select: { access: true },
    }),
    project.departmentId
      ? prisma.department.findFirst({ where: { id: project.departmentId, tenantId: tid, headUserId: uid }, select: { id: true } })
      : null,
  ]);
  if (roles.includes("company_super_admin")) return "manage";
  if (project.ownerId === uid || project.managerId === uid) return "manage";
  if (membership) return membership.access;
  if (headedDepartment) return "edit";
  if (roles.some((role) => elevatedProjectReaders.has(role))) return "view";
  const connectedTask = await prisma.projectTask.findFirst({
    where: { projectId: project.id, tenantId: tid, OR: [{ assigneeId: uid }, { followers: { some: { userId: uid } } }] },
    select: { id: true },
  });
  return connectedTask ? "view" : null;
}
/** Plain employees (role set is exactly ["employee"], not the project's own owner/manager/
 *  department-head, and not a team lead of the assignee's team) only see tasks assigned to them
 *  or that they follow — never the full task list, and never other people's unassigned/assigned
 *  work. This intentionally ignores project-member "edit"/"manage" access for employee-role
 *  users: a manager granting an employee "edit" membership (e.g. so they can update task details
 *  on a project they're deeply involved in) must not incidentally expose the whole team's task
 *  list, mirroring canReassignTasks' role-overrides-membership rule for reassignment. Non-employee
 *  roles (TL/PM/department-head/admins) with real project access continue to see every task.
 *  Returns a Prisma filter to AND into a ProjectTask query, or null when no restriction applies. */
async function taskVisibilityScope(
  tid: string,
  uid: string,
  project: { id: string; ownerId: string | null; managerId: string | null; departmentId: string | null },
): Promise<Prisma.ProjectTaskWhereInput | null> {
  const [roles, membership] = await Promise.all([
    getCompanyUserRoles(tid, uid),
    prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: uid } },
      select: { access: true },
    }),
  ]);
  const isEmployeeOnly = roles.every((role) => role === "employee");
  if (roles.some((role) => elevatedProjectReaders.has(role))) return null;
  if (project.ownerId === uid || project.managerId === uid) return null;
  if (!isEmployeeOnly && membership && (membership.access === "edit" || membership.access === "manage")) return null;
  if (roles.includes("department_head") && project.departmentId) {
    const headed = await prisma.department.findFirst({ where: { id: project.departmentId, tenantId: tid, headUserId: uid }, select: { id: true } });
    if (headed) return null;
  }
  if (roles.includes("team_lead")) {
    const leadsTeam = await prisma.team.findFirst({ where: { tenantId: tid, leadUserId: uid }, select: { id: true } });
    if (leadsTeam) return null;
  }
  return { OR: [{ assigneeId: uid }, { followers: { some: { userId: uid } } }] };
}
async function requireProjectAccess(tid: string, uid: string, projectId: string, minimum: "view" | "edit" | "manage") {
  const project = await prisma.project.findFirst({
    where: { id: projectId, tenantId: tid },
    select: { id: true, ownerId: true, managerId: true, departmentId: true },
  });
  if (!project) return false;
  const access = await projectAccessLevel(tid, uid, project);
  const rank = { view: 1, edit: 2, manage: 3 } as const;
  return access != null && rank[access] >= rank[minimum];
}
projectsRouter.get("/", requirePermission("projects", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const includeArchived = req.query.includeArchived === "true";
  const scope = await projectReadScope(tid, uid);

  const projects = await prisma.project.findMany({
    where: { AND: [scope, ...(includeArchived ? [] : [{ isArchived: false }])] },
    include: {
      ...projectInclude,
      favouritedBy: { where: { userId: uid }, select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const completedCounts = await prisma.projectTask.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projects.map((p) => p.id) }, status: "done" },
    _count: { _all: true },
  });
  const completedByProject = new Map(completedCounts.map((row) => [row.projectId, row._count._all]));

  // "Worked on" recency: the most recent activity across a project and its children. A project
  // counts as recently worked on when anything happened in the last 7 days — a task created,
  // moved or edited, time logged, a milestone created, or a project event added. Gathering the
  // latest timestamps across each activity source lets us surface a `lastActivityAt` that the
  // frontend can use for an "inactive projects" filter.
  const projectIds = projects.map((p) => p.id);
  const activitySourceRows = await Promise.all([
    prisma.projectTask.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _max: { updatedAt: true, createdAt: true },
    }),
    prisma.taskTimeEntry.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _max: { createdAt: true, updatedAt: true },
    }),
    prisma.projectMilestone.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _max: { createdAt: true, updatedAt: true },
    }),
    prisma.projectEvent.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds } },
      _max: { createdAt: true, updatedAt: true },
    }),
  ]);
  const lastActiveByProject = new Map<string, Date>();
  const captureLatest = (projectId: string, values: Array<Date | null | undefined>) => {
    const latest = values
      .filter((value): value is Date => Boolean(value))
      .reduce<Date | null>((acc, value) => (acc === null || value > acc ? value : acc), null);
    if (latest && (lastActiveByProject.get(projectId) === undefined || latest > lastActiveByProject.get(projectId)!)) {
      lastActiveByProject.set(projectId, latest);
    }
  };
  for (const group of activitySourceRows[0]) captureLatest(group.projectId, [group._max.updatedAt, group._max.createdAt]);
  for (const group of activitySourceRows[1]) captureLatest(group.projectId, [group._max.createdAt, group._max.updatedAt]);
  for (const group of activitySourceRows[2]) captureLatest(group.projectId, [group._max.createdAt, group._max.updatedAt]);
  for (const group of activitySourceRows[3]) captureLatest(group.projectId, [group._max.createdAt, group._max.updatedAt]);

  const rows = await Promise.all(projects.map(async (p) => {
    const childLatest = lastActiveByProject.get(p.id);
    const selfLatest = [p.createdAt, p.updatedAt].filter((value): value is Date => Boolean(value))
      .reduce<Date | null>((acc, value) => (acc === null || value > acc ? value : acc), null);
    const lastActivityAt =
      childLatest == null ? selfLatest
      : selfLatest == null ? childLatest
      : childLatest > selfLatest ? childLatest
      : selfLatest;
    return {
      ...p,
      favouritedBy: undefined,
      _count: undefined,
      favourite: p.favouritedBy.length > 0,
      currentUserAccess: await projectAccessLevel(tid, uid, p),
      taskCount: p._count.tasks,
      completedTaskCount: completedByProject.get(p.id) ?? 0,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : p.createdAt.toISOString(),
    };
  }));
  res.json({ projects: rows });
});

const assignedTaskQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["new_request", "in_progress", "done"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
  dueFrom: z.string().optional(),
  dueTo: z.string().optional(),
  worklogUserId: z.string().optional(),
  worklog: z.enum(["with_logs", "without_logs", "billable", "non_billable"]).optional(),
  estimated: z.enum(["unestimated"]).optional(),
});

projectsRouter.get("/tasks/assigned", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const roles = await getCompanyUserRoles(tid, uid);
  const parsed = assignedTaskQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const input = parsed.data;
  // A plain employee (no elevated/managerial role at all) only ever sees their own assigned or
  // followed tasks here — never another employee's tasks, unassigned tasks, or tasks that merely
  // belong to a project they're a member of. This mirrors taskVisibilityScope's per-project
  // policy; without it, "My Tasks"/the dashboard's due-task widgets leaked every task in any
  // project the employee had edit/manage membership on, even tasks assigned to teammates.
  const isEmployeeOnly = roles.every((role) => role === "employee");
  const assignments: Prisma.ProjectTaskWhereInput[] = isEmployeeOnly
    ? [{ assigneeId: uid }, { followers: { some: { userId: uid } } }]
    : [
        { assigneeId: uid },
        { followers: { some: { userId: uid } } },
        { project: { ownerId: uid } },
        { project: { managerId: uid } },
        { project: { members: { some: { userId: uid, access: { in: ["edit", "manage"] } } } } },
      ];
  if (!isEmployeeOnly && roles.includes("department_head")) assignments.push({ project: { department: { headUserId: uid } } });
  if (!isEmployeeOnly && roles.includes("team_lead")) assignments.push({ assignee: { teamMemberships: { some: { team: { leadUserId: uid } } } } });
  const taskScope: Prisma.ProjectTaskWhereInput = !isEmployeeOnly && roles.some((role) => elevatedProjectReaders.has(role))
    ? { tenantId: tid }
    : { tenantId: tid, OR: assignments };

  const filters: Prisma.ProjectTaskWhereInput[] = [];
  if (input.search) {
    filters.push({
      OR: [
        { name: { contains: input.search, mode: "insensitive" } },
        { project: { name: { contains: input.search, mode: "insensitive" } } },
        { project: { key: { contains: input.search, mode: "insensitive" } } },
      ],
    });
  }
  if (input.status) filters.push({ status: input.status });
  if (input.priority) filters.push({ priority: input.priority });
  if (input.assigneeId) filters.push({ assigneeId: input.assigneeId === "unassigned" ? null : input.assigneeId });
  if (input.projectId) filters.push({ projectId: input.projectId });
  if (input.dueFrom || input.dueTo) {
    const dueDate: Prisma.DateTimeNullableFilter = {};
    if (input.dueFrom) dueDate.gte = new Date(`${input.dueFrom}T00:00:00.000Z`);
    if (input.dueTo) dueDate.lte = new Date(`${input.dueTo}T23:59:59.999Z`);
    filters.push({ dueDate });
  }
  if (input.worklogUserId) filters.push({ timeEntries: { some: { userId: input.worklogUserId } } });
  if (input.worklog === "with_logs") filters.push({ timeEntries: { some: {} } });
  if (input.worklog === "without_logs") filters.push({ timeEntries: { none: {} } });
  if (input.worklog === "billable") filters.push({ timeEntries: { some: { billable: true } } });
  if (input.worklog === "non_billable") filters.push({ timeEntries: { some: { billable: false } } });
  if (input.estimated === "unestimated") filters.push({ estimatedMinutes: 0, status: { not: "done" } });

  const where: Prisma.ProjectTaskWhereInput = filters.length ? { AND: [taskScope, ...filters] } : taskScope;

  const [tasks, optionRows] = await Promise.all([
    prisma.projectTask.findMany({
      where,
      include: {
        ...taskDetailInclude,
        project: { select: { id: true, name: true, key: true, status: true, priority: true } },
        section: { select: { id: true, name: true } },
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      take: 500,
    }),
    prisma.projectTask.findMany({
      where: taskScope,
      select: {
        project: { select: { id: true, name: true, key: true } },
        assignee: { select: userSelect },
        timeEntries: { select: { user: { select: userSelect } }, take: 100 },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 1000,
    }),
  ]);

  const company = await prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } });
  await flagNewlyOverdueTasks(tid, company.timezone, tasks);

  const assignerIds = [...new Set(tasks.map((task) => task.createdBy).filter((id): id is string => Boolean(id)))];
  const assigners = assignerIds.length
    ? await prisma.companyUser.findMany({ where: { id: { in: assignerIds }, tenantId: tid }, select: userSelect })
    : [];
  const assignerById = new Map(assigners.map((user) => [user.id, user]));
  const rows = tasks.map((task) => ({ ...task, assigner: task.createdBy ? assignerById.get(task.createdBy) ?? null : null }));

  const projects = new Map<string, { id: string; name: string; key: string }>();
  const assignees = new Map<string, { id: string; name: string; email: string; accountStatus: string }>();
  const worklogUsers = new Map<string, { id: string; name: string; email: string; accountStatus: string }>();
  for (const task of optionRows) {
    projects.set(task.project.id, task.project);
    if (task.assignee) assignees.set(task.assignee.id, task.assignee);
    for (const entry of task.timeEntries) worklogUsers.set(entry.user.id, entry.user);
  }

  res.json({
    tasks: rows,
    options: {
      projects: Array.from(projects.values()).sort((a, b) => a.name.localeCompare(b.name)),
      assignees: Array.from(assignees.values()).sort((a, b) => a.name.localeCompare(b.name)),
      worklogUsers: Array.from(worklogUsers.values()).sort((a, b) => a.name.localeCompare(b.name)),
    },
  });
});
const breakdownRoles = new Set(["company_super_admin", "hr_admin", "auditor", "team_lead", "department_head"]);

projectsRouter.get("/tasks/breakdown", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const roles = await getCompanyUserRoles(tid, uid);
  if (!roles.some((role) => breakdownRoles.has(role))) {
    res.status(403).json({ error: "You do not have access to the task breakdown" });
    return;
  }

  let employeeScope: Prisma.CompanyUserWhereInput = { tenantId: tid, accountStatus: "active" };
  if (!roles.some((role) => elevatedProjectReaders.has(role))) {
    const idSets = await Promise.all([
      roles.includes("team_lead")
        ? prisma.companyUser.findMany({
            where: { tenantId: tid, teamMemberships: { some: { team: { leadUserId: uid } } } },
            select: { id: true },
          })
        : [],
      roles.includes("department_head")
        ? prisma.companyUser.findMany({
            where: {
              tenantId: tid,
              OR: [
                { projectTasksAssigned: { some: { project: { department: { headUserId: uid } } } } },
                { projectsManaged: { some: { department: { headUserId: uid } } } },
                { projectsOwned: { some: { department: { headUserId: uid } } } },
              ],
            },
            select: { id: true },
          })
        : [],
    ]);
    const ids = new Set(idSets.flat().map((row) => row.id));
    if (ids.size === 0) {
      res.json({ employees: [] });
      return;
    }
    employeeScope = { tenantId: tid, accountStatus: "active", id: { in: Array.from(ids) } };
  }

  const employees = await prisma.companyUser.findMany({
    where: employeeScope,
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const employeeIds = employees.map((employee) => employee.id);

  const [assignedCounts, pendingCounts, overdueCounts, createdCounts, completedCounts] = await Promise.all([
    prisma.projectTask.groupBy({ by: ["assigneeId"], where: { tenantId: tid, assigneeId: { in: employeeIds } }, _count: { _all: true } }),
    prisma.projectTask.groupBy({ by: ["assigneeId"], where: { tenantId: tid, assigneeId: { in: employeeIds }, status: { not: "done" } }, _count: { _all: true } }),
    prisma.projectTask.groupBy({ by: ["assigneeId"], where: { tenantId: tid, assigneeId: { in: employeeIds }, status: { not: "done" }, dueDate: { lt: new Date() } }, _count: { _all: true } }),
    prisma.projectTask.groupBy({ by: ["createdBy"], where: { tenantId: tid, createdBy: { in: employeeIds } }, _count: { _all: true } }),
    prisma.projectTask.groupBy({ by: ["assigneeId"], where: { tenantId: tid, assigneeId: { in: employeeIds }, status: "done" }, _count: { _all: true } }),
  ]);

  function countFor(rows: { _count: { _all: number } }[], key: string, id: string) {
    const row = rows.find((r) => (r as unknown as Record<string, string | null>)[key] === id);
    return row?._count._all ?? 0;
  }

  const rows = employees.map((employee) => ({
    user: employee,
    totalAssigned: countFor(assignedCounts, "assigneeId", employee.id),
    pending: countFor(pendingCounts, "assigneeId", employee.id),
    overdue: countFor(overdueCounts, "assigneeId", employee.id),
    created: countFor(createdCounts, "createdBy", employee.id),
    completed: countFor(completedCounts, "assigneeId", employee.id),
  }));

  res.json({ employees: rows });
});

projectsRouter.get("/milestones/all", requirePermission("projects", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const scope = await projectReadScope(tid, uid);
  const milestones = await prisma.projectMilestone.findMany({
    where: { tenantId: tid, project: scope },
    include: {
      owner: { select: userSelect },
      project: { select: { id: true, name: true, key: true } },
      tasks: { select: { status: true, estimatedMinutes: true, trackedSeconds: true } },
    },
    orderBy: [{ project: { name: "asc" } }, { releaseDate: "asc" }],
  });
  const rows = milestones.map(({ tasks, ...milestone }) => ({
    ...milestone,
    taskCount: tasks.length,
    completedTaskCount: tasks.filter((task) => task.status === "done").length,
    estimatedMinutes: tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0),
    trackedSeconds: tasks.reduce((sum, task) => sum + task.trackedSeconds, 0),
  }));
  res.json({ milestones: rows });
});

// NOTE: these two routes have no :id segment and must stay registered before GET "/:id" below,
// otherwise Express would match "/reestimate-requests" as a project id lookup.
projectsRouter.get("/reestimate-requests", requirePermission("tasks", "approve"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const requests = await prisma.taskReestimateRequest.findMany({
    where: { tenantId: tid, approverId: uid, status: "pending_review" },
    orderBy: { createdAt: "asc" },
    include: {
      task: {
        select: {
          id: true, code: true, name: true, projectId: true, estimatedMinutes: true, trackedSeconds: true,
          project: { select: { id: true, name: true } },
          assignee: { select: userSelect },
        },
      },
    },
  });
  res.json({ requests });
});

const resolveReestimateSchema = z.object({
  action: z.enum(["approve", "reject"]),
  approvedMinutes: z.number().int().positive().optional(),
});

projectsRouter.post("/reestimate-requests/:requestId/resolve", requirePermission("tasks", "approve"), async (req, res) => {
  const parsed = resolveReestimateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const requestId = req.params.requestId as string;
  const request = await prisma.taskReestimateRequest.findFirst({ where: { id: requestId, tenantId: tid }, include: { task: true } });
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (request.approverId !== uid) {
    res.status(403).json({ error: "You are not the approver for this request" });
    return;
  }
  if (request.status !== "pending_review") {
    res.status(400).json({ error: "This request has already been resolved" });
    return;
  }
  const approvedMinutes = parsed.data.action === "approve" ? (parsed.data.approvedMinutes ?? request.requestedEstimatedMinutes) : null;
  await prisma.$transaction(async (tx) => {
    if (parsed.data.action === "approve" && approvedMinutes !== null) {
      await tx.projectTask.update({ where: { id: request.taskId }, data: { estimatedMinutes: approvedMinutes, updatedBy: uid } });
    }
    await tx.taskReestimateRequest.update({
      where: { id: requestId },
      data: { status: "resolved", resolvedAt: new Date(), resolvedBy: uid, approvedEstimatedMinutes: approvedMinutes },
    });
  });
  await recordAudit({
    actor: req.auth!, action: `task.reestimate_${parsed.data.action}d`, tenantId: tid, targetType: "ProjectTask", targetId: request.taskId,
    metadata: { projectId: request.task.projectId, requestId, approvedMinutes },
  });
  await createNotification({
    tenantId: tid, userId: request.requestedBy, type: "task_reestimate_resolved",
    title: parsed.data.action === "approve"
      ? `Your re-estimate request for #${request.task.code} ${request.task.name} was approved`
      : `Your re-estimate request for #${request.task.code} ${request.task.name} was rejected`,
    taskId: request.taskId, projectId: request.task.projectId, actorId: uid,
  });
  const updatedTask = parsed.data.action === "approve" ? await prisma.projectTask.findUnique({ where: { id: request.taskId } }) : null;
  // An approved re-estimate can change a task's remaining minutes on a day it's already
  // auto-planned/locked for (same-day-urgent) — without this, the locked allocation would stay
  // stuck at the pre-approval estimate (e.g. locked at 1h even though the task was just approved
  // for 4h), which is exactly what autoPlanIfUrgentSameDay's upsert exists to keep in sync.
  if (updatedTask) {
    await autoPlanIfUrgentSameDay(tid, req.auth!, updatedTask);
  }
  res.json({ request: await prisma.taskReestimateRequest.findUniqueOrThrow({ where: { id: requestId } }), task: updatedTask });
});

projectsRouter.get("/timelog-change-requests", requirePermission("tasks", "approve"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const requests = await prisma.taskTimeEntryChangeRequest.findMany({
    where: { tenantId: tid, approverId: uid, status: "pending_review" },
    orderBy: { createdAt: "asc" },
    include: {
      entry: {
        select: {
          id: true, taskId: true, projectId: true, userId: true, startedAt: true, endedAt: true,
          user: { select: userSelect },
          task: { select: { id: true, code: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      },
    },
  });
  res.json({ requests });
});

const resolveTimelogChangeSchema = z.object({ action: z.enum(["approve", "reject"]) });

projectsRouter.post("/timelog-change-requests/:requestId/resolve", requirePermission("tasks", "approve"), async (req, res) => {
  const parsed = resolveTimelogChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const requestId = req.params.requestId as string;
  const request = await prisma.taskTimeEntryChangeRequest.findFirst({ where: { id: requestId, tenantId: tid }, include: { entry: { include: { task: true } } } });
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (request.approverId !== uid) {
    res.status(403).json({ error: "You are not the approver for this request" });
    return;
  }
  if (request.status !== "pending_review") {
    res.status(400).json({ error: "This request has already been resolved" });
    return;
  }
  if (parsed.data.action === "approve") {
    const durationDelta = request.requestedDurationSeconds - request.previousDurationSeconds;
    await prisma.$transaction(async (tx) => {
      await tx.taskTimeEntry.update({
        where: { id: request.entryId },
        data: {
          durationSeconds: request.requestedDurationSeconds,
          activityType: request.requestedActivityType,
          billable: request.requestedBillable,
          note: request.requestedNote,
        },
      });
      await tx.projectTask.update({ where: { id: request.entry.taskId }, data: { trackedSeconds: { increment: durationDelta } } });
      await tx.project.update({ where: { id: request.entry.projectId }, data: { trackedSeconds: { increment: durationDelta } } });
      await tx.taskTimeEntryChangeRequest.update({ where: { id: requestId }, data: { status: "resolved", resolvedAt: new Date(), resolvedBy: uid } });
    });
  } else {
    await prisma.taskTimeEntryChangeRequest.update({ where: { id: requestId }, data: { status: "resolved", resolvedAt: new Date(), resolvedBy: uid } });
  }
  await recordAudit({
    actor: req.auth!, action: `task.timelog.change_${parsed.data.action}d`, tenantId: tid, targetType: "ProjectTask", targetId: request.entry.taskId,
    metadata: { projectId: request.entry.projectId, requestId, entryId: request.entryId },
  });
  await createNotification({
    tenantId: tid, userId: request.requestedBy, type: "task_timelog_change_resolved",
    title: parsed.data.action === "approve"
      ? `Your work log change request for #${request.entry.task.code} ${request.entry.task.name} was approved`
      : `Your work log change request for #${request.entry.task.code} ${request.entry.task.name} was rejected`,
    taskId: request.entry.taskId, projectId: request.entry.projectId, actorId: uid,
  });
  res.json({ request: await prisma.taskTimeEntryChangeRequest.findUniqueOrThrow({ where: { id: requestId } }) });
});

projectsRouter.get("/:id", requirePermission("projects", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const scope = await projectReadScope(tid, uid);

  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      ...projectInclude,
      favouritedBy: { where: { userId: uid }, select: { id: true } },
    },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const completedTaskCount = await prisma.projectTask.count({ where: { projectId: id, status: "done" } });
  res.json({
    project: {
      ...project,
      favouritedBy: undefined,
      _count: undefined,
      favourite: project.favouritedBy.length > 0,
      currentUserAccess: await projectAccessLevel(tid, uid, project),
      taskCount: project._count.tasks,
      completedTaskCount,
    },
  });
});

const projectSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1).max(10).regex(/^[A-Za-z0-9_-]+$/).optional(),
  logoUrl: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["new", "planning", "in_progress", "on_hold", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  methodology: z.enum(["agile", "waterfall", "kanban"]).optional(),
  type: z.enum(["internal", "client", "product", "support", "maintenance"]).optional(),
  visibility: z.enum(["public", "private", "restricted"]).optional(),
  category: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  actualStartDate: z.string().nullable().optional(),
  actualEndDate: z.string().nullable().optional(),
  estimatedHours: z.number().int().nonnegative().nullable().optional(),
  budget: z.number().nonnegative().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  remindersEnabled: z.boolean().optional(),
});

projectsRouter.post("/", requirePermission("projects", "create"), async (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const data = parsed.data;

  const existing = await prisma.project.findUnique({ where: { tenantId_name: { tenantId: tid, name: data.name } } });
  if (existing) {
    res.status(409).json({ error: "A project with this name already exists" });
    return;
  }

  const relatedUserIds = [data.managerId, data.ownerId].filter(Boolean) as string[];
  if (relatedUserIds.length) {
    const relatedUsers = await prisma.companyUser.count({ where: { id: { in: relatedUserIds }, tenantId: tid } });
    if (relatedUsers !== new Set(relatedUserIds).size) {
      res.status(400).json({ error: "Project owner or manager not found" });
      return;
    }
  }
  if (data.departmentId) {
    const department = await prisma.department.findFirst({ where: { id: data.departmentId, tenantId: tid } });
    if (!department) {
      res.status(400).json({ error: "Department not found" });
      return;
    }
  }

  const baseKey = (data.key ?? data.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)).toUpperCase() || "PRJ";
  let projectKey = baseKey;
  let suffix = 1;
  while (await prisma.project.findUnique({ where: { tenantId_key: { tenantId: tid, key: projectKey } } })) {
    const suffixText = String(suffix++);
    projectKey = `${baseKey.slice(0, 10 - suffixText.length)}${suffixText}`;
  }

  const project = await prisma.project.create({
    data: {
      tenantId: tid,
      name: data.name,
      key: projectKey,
      logoUrl: data.logoUrl ?? null,
      clientName: data.clientName ?? null,
      description: data.description ?? null,
      status: data.status ?? "new",
      priority: data.priority ?? "medium",
      methodology: data.methodology ?? "kanban",
      type: data.type ?? "internal",
      visibility: data.visibility ?? "private",
      category: data.category ?? null,
      tags: data.tags ?? [],
      startDate: data.startDate ? new Date(data.startDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      actualStartDate: data.actualStartDate ? new Date(data.actualStartDate) : null,
      actualEndDate: data.actualEndDate ? new Date(data.actualEndDate) : null,
      estimatedHours: data.estimatedHours ?? null,
      budget: data.budget ?? null,
      budgetStatus: data.budget ? "on_track" : "not_set",
      departmentId: data.departmentId ?? null,
      ownerId: data.ownerId ?? userId(req),
      managerId: data.managerId ?? null,
      remindersEnabled: data.remindersEnabled ?? true,
      createdBy: req.auth!.userId,
      updatedBy: req.auth!.userId,
      sections: {
        create: [
          { tenantId: tid, name: "New Request", status: "new_request", position: 0 },
          { tenantId: tid, name: "In Progress", status: "in_progress", position: 1 },
          { tenantId: tid, name: "Done", status: "done", position: 2 },
        ],
      },
      members: data.managerId
        ? {
            create: {
              tenantId: tid,
              userId: data.managerId,
              access: "manage",
            },
          }
        : undefined,
    },
    include: projectInclude,
  });

  await recordAudit({
    actor: req.auth!,
    action: "project.created",
    tenantId: tid,
    targetType: "Project",
    targetId: project.id,
    metadata: { name: project.name },
  });

  // Every project gets its own collaboration channel automatically — seeded with whichever
  // of owner/manager/creator are known at creation time; other members are added to the
  // channel when they're added as ProjectMembers (see POST /:id/members below).
  const channelMemberIds = [...new Set([userId(req), data.ownerId, data.managerId].filter(Boolean) as string[])];
  await prisma.chatChannel.create({
    data: {
      tenantId: tid,
      type: "project",
      name: project.name,
      projectId: project.id,
      createdBy: userId(req),
      members: { create: channelMemberIds.map((id) => ({ tenantId: tid, userId: id })) },
    },
  });

  res.status(201).json({ project: { ...project, _count: undefined, favourite: false, taskCount: 0, completedTaskCount: 0 } });
});

const updateSchema = projectSchema.partial();

projectsRouter.patch("/:id", requirePermission("projects", "edit"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "edit"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  const data = parsed.data;

  const project = await prisma.project.findFirst({ where: { id, tenantId: tid } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const relatedUserIds = [data.managerId, data.ownerId].filter(Boolean) as string[];
  if (relatedUserIds.length) {
    const relatedUsers = await prisma.companyUser.count({ where: { id: { in: relatedUserIds }, tenantId: tid } });
    if (relatedUsers !== new Set(relatedUserIds).size) {
      res.status(400).json({ error: "Project owner or manager not found" });
      return;
    }
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...data,
      key: data.key?.toUpperCase(),
      startDate: data.startDate !== undefined ? (data.startDate ? new Date(data.startDate) : null) : undefined,
      dueDate: data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : undefined,
      actualStartDate:
        data.actualStartDate !== undefined ? (data.actualStartDate ? new Date(data.actualStartDate) : null) : undefined,
      actualEndDate:
        data.actualEndDate !== undefined ? (data.actualEndDate ? new Date(data.actualEndDate) : null) : undefined,
      budgetStatus: data.budget !== undefined ? (data.budget ? "on_track" : "not_set") : undefined,
      updatedBy: req.auth!.userId,
    },
    include: projectInclude,
  });

  await recordAudit({
    actor: req.auth!,
    action: "project.updated",
    tenantId: tid,
    targetType: "Project",
    targetId: id,
    metadata: { changes: data },
  });

  const updatedCompletedTaskCount = await prisma.projectTask.count({ where: { projectId: id, status: "done" } });
  res.json({ project: { ...updated, _count: undefined, taskCount: updated._count.tasks, completedTaskCount: updatedCompletedTaskCount } });
});

const archiveSchema = z.object({ isArchived: z.boolean() });

projectsRouter.post("/:id/archive", requirePermission("projects", "deactivate"), async (req, res) => {
  const parsed = archiveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "isArchived must be a boolean" });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "manage"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }

  const project = await prisma.project.findFirst({ where: { id, tenantId: tid } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const updated = await prisma.project.update({
    where: { id },
    data: { isArchived: parsed.data.isArchived, updatedBy: req.auth!.userId },
    include: projectInclude,
  });

  await recordAudit({
    actor: req.auth!,
    action: parsed.data.isArchived ? "project.archived" : "project.unarchived",
    tenantId: tid,
    targetType: "Project",
    targetId: id,
  });

  const archivedCompletedTaskCount = await prisma.projectTask.count({ where: { projectId: id, status: "done" } });
  res.json({ project: { ...updated, _count: undefined, taskCount: updated._count.tasks, completedTaskCount: archivedCompletedTaskCount } });
});

projectsRouter.delete("/:id", requirePermission("projects", "deactivate"), async (req, res) => {
  const tid = tenantId(req);
  const id = req.params.id as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "manage"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }

  const project = await prisma.project.findFirst({ where: { id, tenantId: tid } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await prisma.project.delete({ where: { id } });

  await recordAudit({
    actor: req.auth!,
    action: "project.deleted",
    tenantId: tid,
    targetType: "Project",
    targetId: id,
    metadata: { name: project.name },
  });

  res.status(204).end();
});

projectsRouter.post("/:id/favourite", requirePermission("projects", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;

  const scope = await projectReadScope(tid, uid);
  const project = await prisma.project.findFirst({ where: { AND: [{ id }, scope] } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const existing = await prisma.projectFavourite.findUnique({ where: { projectId_userId: { projectId: id, userId: uid } } });
  if (existing) {
    await prisma.projectFavourite.delete({ where: { id: existing.id } });
    res.json({ favourite: false });
    return;
  }

  await prisma.projectFavourite.create({ data: { projectId: id, userId: uid } });
  res.json({ favourite: true });
});

async function getTenantProject(id: string, tid: string) {
  return prisma.project.findFirst({ where: { id, tenantId: tid } });
}

async function refreshProjectMetrics(projectId: string) {
  const [total, done, overdue] = await Promise.all([
    prisma.projectTask.count({ where: { projectId } }),
    prisma.projectTask.count({ where: { projectId, status: "done" } }),
    prisma.projectTask.count({
      where: { projectId, status: { not: "done" }, dueDate: { lt: new Date() } },
    }),
  ]);
  const completionPercent = total ? Math.round((done / total) * 100) : 0;
  const healthScore = total ? Math.max(0, 100 - overdue * 15) : null;
  const healthStatus =
    healthScore == null ? "unavailable" : healthScore >= 80 ? "healthy" : healthScore >= 60 ? "at_risk" : "critical";
  await prisma.project.update({
    where: { id: projectId },
    data: { completionPercent, healthScore, healthStatus },
  });
}

projectsRouter.get("/:id/eligible-users", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const scope = await projectReadScope(tid, uid);
  const project = await prisma.project.findFirst({ where: { AND: [{ id }, scope] }, select: { id: true } });
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const roles = await getCompanyUserRoles(tid, uid);
  const userScope: Prisma.CompanyUserWhereInput = roles.includes("company_super_admin") || roles.includes("project_manager")
    ? { tenantId: tid, accountStatus: "active" }
    : {
        tenantId: tid,
        accountStatus: "active",
        OR: [
          { id: uid },
          { projectMemberships: { some: { projectId: id } } },
          { projectsOwned: { some: { id } } },
          { projectsManaged: { some: { id } } },
          ...(roles.includes("team_lead") ? [{ teamMemberships: { some: { team: { leadUserId: uid } } } }] : []),
        ],
      };
  const users = await prisma.companyUser.findMany({
    where: userScope,
    select: { id: true, tenantId: true, name: true, email: true, roles: true, accountStatus: true, createdBy: true, updatedBy: true, createdAt: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
  res.json({ users });
});
projectsRouter.get("/:id/workspace", requirePermission("projects", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const scope = await projectReadScope(tid, uid);
  const project = await prisma.project.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      ...projectInclude,
      favouritedBy: { where: { userId: uid }, select: { id: true } },
      members: { include: { user: { select: userSelect } }, orderBy: { joinedAt: "asc" } },
    },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const taskScope = await taskVisibilityScope(tid, uid, project);
  const [sections, milestones, events] = await Promise.all([
    prisma.projectSection.findMany({
      where: { projectId: id },
      include: {
        owner: { select: userSelect },
        tasks: {
          where: taskScope ?? undefined,
          include: taskDetailInclude,
          orderBy: { position: "asc" },
        },
      },
      orderBy: { position: "asc" },
    }),
    prisma.projectMilestone.findMany({
      where: { projectId: id },
      include: { owner: { select: userSelect }, _count: { select: { tasks: true } } },
      orderBy: { releaseDate: "asc" },
    }),
    prisma.projectEvent.findMany({
      where: { projectId: id },
      include: { createdBy: { select: userSelect } },
      orderBy: { date: "asc" },
    }),
  ]);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } });
  await flagNewlyOverdueTasks(tid, company.timezone, sections.flatMap((section) => section.tasks));

  const { favouritedBy, members, ...projectData } = project;
  const activities = await prisma.auditLog.findMany({
    where: {
      tenantId: tid,
      OR: [
        { targetId: id },
        { metadata: { path: ["projectId"], equals: id } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({
    project: { ...projectData, favourite: favouritedBy.length > 0, currentUserAccess: await projectAccessLevel(tid, uid, projectData) },
    sections,
    members,
    milestones,
    events,
    activities,
  });
});

const projectTaskQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  incomplete: z.enum(["true", "false"]).optional(),
  assigneeId: z.string().optional(),
  tag: z.string().trim().max(100).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["new_request", "in_progress", "done"]).optional(),
  taskType: z.string().trim().max(100).optional(),
  milestoneId: z.string().optional(),
  due: z.enum(["overdue", "today", "this_week", "no_date"]).optional(),
  estimated: z.enum(["unestimated"]).optional(),
  parentTaskId: z.string().optional(),
});

projectsRouter.get("/:id/tasks/query", requirePermission("tasks", "view"), async (req, res) => {
  const parsed = projectTaskQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const projectId = req.params.id as string;
  const scope = await projectReadScope(tid, uid);
  const project = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, scope] }, select: { id: true, ownerId: true, managerId: true, departmentId: true } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const taskScope = await taskVisibilityScope(tid, uid, project);

  const input = parsed.data;
  const filters: Prisma.ProjectTaskWhereInput[] = [];
  if (taskScope) filters.push(taskScope);
  if (input.search) {
    const searchFilters: Prisma.ProjectTaskWhereInput[] = [
      { name: { contains: input.search, mode: "insensitive" } },
      { description: { contains: input.search, mode: "insensitive" } },
    ];
    if (Number.isInteger(Number(input.search))) searchFilters.push({ code: Number(input.search) });
    filters.push({ OR: searchFilters });
  }
  if (input.incomplete === "true") filters.push({ status: { not: "done" } });
  if (input.assigneeId) filters.push({ assigneeId: input.assigneeId === "unassigned" ? null : input.assigneeId });
  if (input.tag) filters.push({ tags: { has: input.tag } });
  if (input.priority) filters.push({ priority: input.priority });
  if (input.status) filters.push({ status: input.status });
  if (input.taskType) filters.push({ taskType: input.taskType });
  if (input.milestoneId) filters.push({ milestoneId: input.milestoneId === "none" ? null : input.milestoneId });
  if (input.parentTaskId) filters.push({ parentTaskId: input.parentTaskId });
  if (input.due) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(start);
    weekEnd.setDate(weekEnd.getDate() + 7);
    if (input.due === "overdue") filters.push({ dueDate: { lt: start }, status: { not: "done" } });
    if (input.due === "today") filters.push({ dueDate: { gte: start, lt: tomorrow } });
    if (input.due === "this_week") filters.push({ dueDate: { gte: start, lt: weekEnd } });
    if (input.due === "no_date") filters.push({ dueDate: null });
  }
  if (input.estimated === "unestimated") filters.push({ estimatedMinutes: 0 });
  const [tasks, optionRows] = await Promise.all([
    prisma.projectTask.findMany({
      where: { tenantId: tid, projectId, AND: filters },
      include: taskDetailInclude,
      orderBy: { position: "asc" },
      take: 1000,
    }),
    prisma.projectTask.findMany({ where: { tenantId: tid, projectId }, select: { tags: true, taskType: true }, take: 5000 }),
  ]);
  const tags = [...new Set(optionRows.flatMap((row) => row.tags))].sort((a, b) => a.localeCompare(b));
  const taskTypes = [...new Set(optionRows.map((row) => row.taskType).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
  res.json({ tasks, options: { tags, taskTypes } });
});
const taskSchema = z.object({
  name: z.string().min(1).max(255),
  sectionId: z.string(),
  parentTaskId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  taskType: z.string().nullable().optional(),
  billingType: z.enum(["billable", "non_billable"]).optional(),
  tags: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().nonnegative().optional(),
}).refine((data) => !data.startDate || !data.dueDate || new Date(data.startDate).getTime() <= new Date(data.dueDate).getTime(), {
  message: "Due date cannot be before start date",
  path: ["dueDate"],
});

projectsRouter.post("/:id/tasks", requirePermission("tasks", "create"), async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  const project = await getTenantProject(id, tid);
  const section = await prisma.projectSection.findFirst({
    where: { id: parsed.data.sectionId, projectId: id, tenantId: tid },
  });
  if (!project || !section) {
    res.status(404).json({ error: "Project or section not found" });
    return;
  }
  const creatorId = userId(req);
  if (!(await canEditTaskForProject(tid, creatorId, id))) {
    res.status(403).json({ error: "You do not have permission to create tasks in this project" });
    return;
  }
  if (parsed.data.parentTaskId) {
    const parent = await prisma.projectTask.findFirst({
      where: { id: parsed.data.parentTaskId, projectId: id, sectionId: section.id, tenantId: tid },
    });
    if (!parent) {
      res.status(400).json({ error: "Parent task must belong to the same project section" });
      return;
    }
  }
  if (parsed.data.assigneeId) {
    const assignee = await prisma.companyUser.findFirst({ where: { id: parsed.data.assigneeId, tenantId: tid } });
    if (!assignee) {
      res.status(400).json({ error: "Assignee not found" });
      return;
    }
  }
  const [lastCode, position] = await Promise.all([
    prisma.projectTask.aggregate({ where: { projectId: id }, _max: { code: true } }),
    prisma.projectTask.count({
      where: { sectionId: section.id, parentTaskId: parsed.data.parentTaskId ?? null },
    }),
  ]);
  const task = await prisma.projectTask.create({
    data: {
      tenantId: tid,
      projectId: id,
      sectionId: section.id,
      parentTaskId: parsed.data.parentTaskId ?? null,
      code: (lastCode._max.code ?? 0) + 1,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      status: section.status,
      priority: parsed.data.priority ?? "medium",
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      assigneeId: parsed.data.assigneeId ?? null,
      taskType: parsed.data.taskType ?? null,
      billingType: parsed.data.billingType ?? "non_billable",
      tags: parsed.data.tags ?? [],
      estimatedMinutes: parsed.data.estimatedMinutes ?? 0,
      position,
      createdBy: userId(req),
      updatedBy: userId(req),
    },
    include: taskDetailInclude,
  });
 await prisma.$transaction([
    prisma.taskFollower.create({ data: { tenantId: tid, taskId: task.id, userId: creatorId } }),
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: creatorId } },
      update: { isFollower: true },
      create: { tenantId: tid, projectId: id, userId: creatorId, access: "edit", isFollower: true },
    }),
    ...(parsed.data.assigneeId && parsed.data.assigneeId !== creatorId
      ? [prisma.projectMember.upsert({
          where: { projectId_userId: { projectId: id, userId: parsed.data.assigneeId } },
          update: {},
          create: { tenantId: tid, projectId: id, userId: parsed.data.assigneeId, access: "edit" },
        })]
      : []),
  ]);
  const createdTask = await prisma.projectTask.findUniqueOrThrow({ where: { id: task.id }, include: taskDetailInclude });
  await refreshProjectMetrics(id);
  await recordAudit({
    actor: req.auth!,
    action: "project.task.created",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: task.id,
    metadata: { projectId: id, name: task.name },
  });
  await ensureProjectChatMembers(tid, id, [creatorId, ...(parsed.data.assigneeId ? [parsed.data.assigneeId] : [])]);
  await autoPlanIfUrgentSameDay(tid, req.auth!, createdTask);
  res.status(201).json({ task: createdTask });
});

const moveTaskSchema = z.object({ sectionId: z.string() });

projectsRouter.patch("/:id/tasks/:taskId/move", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = moveTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "sectionId is required" });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const [task, section] = await Promise.all([
    prisma.projectTask.findFirst({ where: { id: taskId, projectId: id, tenantId: tid } }),
    prisma.projectSection.findFirst({ where: { id: parsed.data.sectionId, projectId: id, tenantId: tid } }),
  ]);
  if (!task || !section) {
    res.status(404).json({ error: "Task or destination section not found" });
    return;
  }
  if (!(await canEditTaskForProject(tid, userId(req), id, task.assigneeId))) {
    res.status(403).json({ error: "You do not have edit access to this task" });
    return;
  }
  const position = await prisma.projectTask.count({ where: { sectionId: section.id } });
  const updated = await prisma.projectTask.update({
    where: { id: task.id },
    data: { sectionId: section.id, status: section.status, position, updatedBy: userId(req) },
    include: taskDetailInclude,
  });
  const hierarchy = await prisma.projectTask.findMany({
    where: { projectId: id },
    select: { id: true, parentTaskId: true },
  });
  const descendantIds = new Set<string>([task.id]);
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const candidate of hierarchy) {
      if (candidate.parentTaskId && descendantIds.has(candidate.parentTaskId) && !descendantIds.has(candidate.id)) {
        descendantIds.add(candidate.id);
        discovered = true;
      }
    }
  }
  descendantIds.delete(task.id);
  await prisma.projectTask.updateMany({
    where: { id: { in: [...descendantIds] } },
    data: { sectionId: section.id, status: section.status, updatedBy: userId(req) },
  });
  await refreshProjectMetrics(id);
  await recordAudit({
    actor: req.auth!,
    action: "project.task.moved",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: task.id,
    metadata: { projectId: id, sectionId: section.id },
  });
  res.json({ task: updated });
});

const taskUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(24000).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  followerIds: z.array(z.string()).optional(),
  status: z.enum(["new_request", "in_progress", "done"]).optional(),
  sectionId: z.string().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  estimatedMinutes: z.number().int().nonnegative().optional(),
  taskType: z.string().max(100).nullable().optional(),
  billingType: z.enum(["billable", "non_billable"]).optional(),
  milestoneId: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  dependencyIds: z.array(z.string()).optional(),
});

async function canEditTaskForProject(tid: string, uid: string, projectId: string, assigneeId?: string | null) {
  const access = await requireProjectAccess(tid, uid, projectId, "edit");
  if (access || assigneeId === uid) return true;
  if (!assigneeId) return false;
  const roles = await getCompanyUserRoles(tid, uid);
  if (!roles.includes("team_lead")) return false;
  const teamMember = await prisma.teamMember.findFirst({
    where: { userId: assigneeId, team: { tenantId: tid, leadUserId: uid } },
    select: { id: true },
  });
  return Boolean(teamMember);
}

/** Reassigning a task (or unassigning it) is a project-management action, not task-editing —
 *  it must require real project edit access AND a non-"employee-only" company role. Without the
 *  role check, a manager granting a plain employee "edit" project-member access (e.g. to let them
 *  update task details on a project they're deeply involved in) would incidentally also hand them
 *  the ability to reassign anyone's tasks, which is a distinct, higher-trust capability. */
async function canReassignTasks(tid: string, uid: string, projectId: string): Promise<boolean> {
  const hasProjectAccess = await requireProjectAccess(tid, uid, projectId, "edit");
  if (!hasProjectAccess) return false;
  const roles = await getCompanyUserRoles(tid, uid);
  return roles.some((role) => role !== "employee");
}

function taskDatesAreValid(startDate?: string | null, dueDate?: string | null) {
  if (!startDate || !dueDate) return true;
  return new Date(startDate).getTime() <= new Date(dueDate).getTime();
}

/** A task is "fully scheduled" once it has an assignee, a positive estimate, and both dates —
 *  at that point a plain employee can no longer change the schedule directly (see the PATCH
 *  handler below) and must go through a TaskReestimateRequest instead for the estimate. */
function isFullyScheduled(task: { assigneeId: string | null; estimatedMinutes: number; startDate: Date | null; dueDate: Date | null }): boolean {
  return Boolean(task.assigneeId) && task.estimatedMinutes > 0 && Boolean(task.startDate) && Boolean(task.dueDate);
}

projectsRouter.patch("/:id/tasks/:taskId", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const projectId = req.params.id as string;
  const taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
if (!(await canEditTaskForProject(tid, uid, projectId, task.assigneeId))) {
    res.status(403).json({ error: "You do not have edit access to this task" });
    return;
  }
  const data = parsed.data;
  // A plain employee may only schedule a task they're assigned to up until it's fully scheduled
  // (estimate + start + due dates all set). Once every schedule field is populated, the schedule
  // is locked for them — changing the ETA hours or dates is a planning decision that belongs to
  // the project owner/manager. This mirrors canEditSchedule in ProjectDetailPage.tsx, which
  // renders the drawer's Schedule block read-only for employees on fully-scheduled tasks. The
  // check uses the task's *existing* schedule state (not the incoming payload) so an employee can
  // still fill in whichever fields are missing, but can't alter them once the task is complete.
  const isEmployeeOnly = (await getCompanyUserRoles(tid, uid)).every((role) => role === "employee");
  const taskIsFullyScheduled = isFullyScheduled(task);
  if (isEmployeeOnly && taskIsFullyScheduled && (data.estimatedMinutes !== undefined || data.dueDate !== undefined || data.startDate !== undefined)) {
    res.status(403).json({ error: "This task is already scheduled — only a project owner or manager can change its estimate or dates" });
    return;
  }
  // The self-assignee carve-out in canEditTaskForProject lets someone with no real project
  // access edit their own task's status/progress/etc — but reassigning it to somebody else
  // (or unassigning themselves) is a project-management action, not self-editing, so it must
  // require real project edit access even when the actor happens to be the current assignee.
  if (data.assigneeId !== undefined && data.assigneeId !== task.assigneeId) {
    if (!(await canReassignTasks(tid, uid, projectId))) {
      res.status(403).json({ error: "You do not have permission to reassign this task" });
      return;
    }
  }
  if (!taskDatesAreValid(data.startDate === undefined ? task.startDate?.toISOString() : data.startDate, data.dueDate === undefined ? task.dueDate?.toISOString() : data.dueDate)) {
    res.status(400).json({ error: "Due date cannot be before start date" });
    return;
  }

  const relatedUserIds = [...new Set([...(data.assigneeId ? [data.assigneeId] : []), ...(data.followerIds ?? [])])];
  if (relatedUserIds.length) {
    const validUsers = await prisma.companyUser.count({ where: { tenantId: tid, id: { in: relatedUserIds }, accountStatus: "active" } });
    if (validUsers !== relatedUserIds.length) {
      res.status(400).json({ error: "Assignee and followers must be active employees in this company" });
      return;
    }
  }
  if (data.milestoneId) {
    const milestone = await prisma.projectMilestone.findFirst({ where: { id: data.milestoneId, projectId, tenantId: tid } });
    if (!milestone) {
      res.status(400).json({ error: "Milestone not found in this project" });
      return;
    }
  }

  let destinationSectionId = data.sectionId;
  let destinationStatus = data.status;
  if (data.sectionId) {
    const section = await prisma.projectSection.findFirst({ where: { id: data.sectionId, projectId, tenantId: tid } });
    if (!section) {
      res.status(400).json({ error: "Task section not found" });
      return;
    }
    destinationStatus = section.status;
  } else if (data.status) {
    const section = await prisma.projectSection.findFirst({ where: { projectId, tenantId: tid, status: data.status }, orderBy: { position: "asc" } });
    if (!section) {
      res.status(400).json({ error: "No project section is configured for this status" });
      return;
    }
    destinationSectionId = section.id;
  }

  if (data.dependencyIds) {
    const dependencyIds = [...new Set(data.dependencyIds)];
    if (dependencyIds.includes(taskId)) {
      res.status(400).json({ error: "A task cannot depend on itself" });
      return;
    }
    const validDependencies = await prisma.projectTask.count({ where: { id: { in: dependencyIds }, projectId, tenantId: tid } });
    if (validDependencies !== dependencyIds.length) {
      res.status(400).json({ error: "Dependencies must belong to this project" });
      return;
    }
    const reverseDependency = await prisma.taskDependency.findFirst({
      where: { taskId: { in: dependencyIds }, dependsOnTaskId: taskId },
    });
    if (reverseDependency) {
      res.status(400).json({ error: "This dependency would create a circular relationship" });
      return;
    }
  }

  const updateData: Prisma.ProjectTaskUncheckedUpdateInput = { updatedBy: uid };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId;
  if (destinationSectionId !== undefined) updateData.sectionId = destinationSectionId;
  if (destinationStatus !== undefined) updateData.status = destinationStatus;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.estimatedMinutes !== undefined) updateData.estimatedMinutes = data.estimatedMinutes;
  if (data.taskType !== undefined) updateData.taskType = data.taskType;
  if (data.billingType !== undefined) updateData.billingType = data.billingType;
  if (data.milestoneId !== undefined) updateData.milestoneId = data.milestoneId;
  if (data.tags !== undefined) updateData.tags = [...new Set(data.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (data.progress !== undefined) updateData.progress = data.progress;
  if (destinationStatus === "done") {
    updateData.progress = 100;
    updateData.completedAt = task.completedAt ?? new Date();
  } else if (destinationStatus) {
    updateData.completedAt = null;
    if (data.progress === undefined && task.progress === 100) updateData.progress = 0;
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectTask.update({ where: { id: taskId }, data: updateData });
    if (relatedUserIds.length) {
      await tx.projectMember.createMany({
        data: relatedUserIds.map((employeeId) => ({ tenantId: tid, projectId, userId: employeeId, access: employeeId === data.assigneeId ? "edit" : "view", isFollower: data.followerIds?.includes(employeeId) ?? false })),
        skipDuplicates: true,
      });
    }
    if (data.followerIds !== undefined) {
      await tx.taskFollower.deleteMany({ where: { taskId, userId: { notIn: data.followerIds } } });
      if (data.followerIds.length) {
        await tx.taskFollower.createMany({ data: data.followerIds.map((employeeId) => ({ tenantId: tid, taskId, userId: employeeId })), skipDuplicates: true });
      }
    }
    if (data.dependencyIds !== undefined) {
      await tx.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId: { notIn: data.dependencyIds } } });
      if (data.dependencyIds.length) {
        await tx.taskDependency.createMany({ data: data.dependencyIds.map((dependsOnTaskId) => ({ tenantId: tid, taskId, dependsOnTaskId })), skipDuplicates: true });
      }
    }
  });

  await refreshProjectMetrics(projectId);
  const updated = await prisma.projectTask.findUniqueOrThrow({ where: { id: taskId }, include: taskDetailInclude });
  await recordAudit({
    actor: req.auth!, action: "project.task.updated", tenantId: tid, targetType: "ProjectTask", targetId: taskId,
    metadata: { projectId, changes: Object.keys(data) },
  });
  if (relatedUserIds.length) await ensureProjectChatMembers(tid, projectId, relatedUserIds);
  if (data.assigneeId !== undefined && data.assigneeId && data.assigneeId !== task.assigneeId && data.assigneeId !== uid) {
    await createNotification({
      tenantId: tid,
      userId: data.assigneeId,
      type: "task_assigned",
      title: `You were assigned to #${task.code} ${task.name}`,
      taskId: task.id,
      projectId,
      actorId: uid,
    });
  }
  // Re-evaluate the urgent-same-day auto-plan whenever any field that could make it newly
  // applicable changes — not just the dates/assignee, but the estimate too. A task can arrive at
  // "urgent and plannable" in either order: dates set first then an estimate added later (the
  // estimate was 0 when dates were saved, so the auto-plan bailed out with nothing to plan), or
  // the reverse. Without checking estimatedMinutes here, a task edited via a path that only sends
  // the estimate (e.g. an inline estimate cell, separate from a combined schedule save) would
  // never retroactively trigger the auto-plan even though it's now fully qualified.
  if (data.startDate !== undefined || data.dueDate !== undefined || data.assigneeId !== undefined || data.estimatedMinutes !== undefined) {
    await autoPlanIfUrgentSameDay(tid, req.auth!, updated);
  }
  res.json({ task: updated });
});

const reestimateRequestSchema = z.object({
  requestedMinutes: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
});

// Once a task is fully scheduled, only a project editor / the assignee's team lead can change
// its estimate directly (see the 403 in the PATCH handler above). This is the assignee's channel
// to ask for a change instead of being dead-ended — it routes to the same approver as an overdue
// review (creator, falling back to team lead, falling back to super admin) via resolveApprover.
projectsRouter.post("/:id/tasks/:taskId/reestimate-request", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = reestimateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const projectId = req.params.id as string;
  const taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (task.assigneeId !== uid) {
    res.status(403).json({ error: "Only the task's assignee can request a re-estimate" });
    return;
  }
  if (!isFullyScheduled(task)) {
    res.status(400).json({ error: "This task isn't fully scheduled yet — you can edit its estimate directly" });
    return;
  }
  const existingPending = await prisma.taskReestimateRequest.findFirst({ where: { taskId, tenantId: tid, status: "pending_review" } });
  if (existingPending) {
    res.status(400).json({ error: "A re-estimate request for this task is already pending" });
    return;
  }
  const approverId = await resolveApprover(tid, task);
  if (!approverId) {
    res.status(400).json({ error: "No approver could be found for this request — contact your admin" });
    return;
  }
  const request = await prisma.taskReestimateRequest.create({
    data: {
      tenantId: tid,
      taskId,
      requestedBy: uid,
      approverId,
      previousEstimatedMinutes: task.estimatedMinutes,
      requestedEstimatedMinutes: parsed.data.requestedMinutes,
      reason: parsed.data.reason,
    },
  });
  await recordAudit({
    actor: req.auth!, action: "task.reestimate_requested", tenantId: tid, targetType: "ProjectTask", targetId: taskId,
    metadata: { projectId, requestId: request.id, previousEstimatedMinutes: task.estimatedMinutes, requestedEstimatedMinutes: parsed.data.requestedMinutes },
  });
  await createNotification({
    tenantId: tid, userId: approverId, type: "task_reestimate_request",
    title: `Re-estimate requested for #${task.code} ${task.name}`, taskId, projectId, actorId: uid,
  });
  res.status(201).json({ request });
});

// Every resolved-or-pending re-estimate request for a task, newest first — powers the "was Xh,
// now Yh" history line shown under the Estimate field regardless of who's viewing it.
projectsRouter.get("/:id/tasks/:taskId/reestimate-requests", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const projectId = req.params.id as string;
  const taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const requests = await prisma.taskReestimateRequest.findMany({ where: { taskId, tenantId: tid }, orderBy: { createdAt: "desc" } });
  res.json({ requests });
});

// Every work-log change request across every time entry on this task, newest first — powers the
// task drawer's Approval tab, which shows both request types for the task in one place rather
// than requiring one call per individual work-log entry.
projectsRouter.get("/:id/tasks/:taskId/timelog-change-requests", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const projectId = req.params.id as string;
  const taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const requests = await prisma.taskTimeEntryChangeRequest.findMany({
    where: { tenantId: tid, entry: { taskId } },
    orderBy: { createdAt: "desc" },
    include: { entry: { select: { id: true, taskId: true, projectId: true, userId: true, startedAt: true, endedAt: true, user: { select: userSelect } } } },
  });
  res.json({ requests });
});

projectsRouter.delete("/:id/tasks/:taskId", requirePermission("tasks", "manage"), async (req, res) => {
  const tid = tenantId(req);
  const projectId = req.params.id as string;
  const taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  await prisma.projectTask.delete({ where: { id: taskId } });
  await refreshProjectMetrics(projectId);
  await recordAudit({
    actor: req.auth!, action: "project.task.deleted", tenantId: tid, targetType: "ProjectTask", targetId: taskId,
    metadata: { projectId, name: task.name },
  });
  res.status(204).end();
});

const commentSchema = z.object({ body: z.string().trim().min(1).max(24000) });
projectsRouter.post("/:id/tasks/:taskId/comments", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Comment is required and must be under 24,000 characters" });
    return;
  }
  const tid = tenantId(req), uid = userId(req), projectId = req.params.id as string, taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (!(await canEditTaskForProject(tid, uid, projectId, task.assigneeId))) { res.status(403).json({ error: "You do not have access to comment on this task" }); return; }
  const comment = await prisma.taskComment.create({ data: { tenantId: tid, taskId, authorId: uid, body: parsed.data.body }, include: { author: { select: userSelect } } });
  await recordAudit({ actor: req.auth!, action: "project.task.comment_added", tenantId: tid, targetType: "ProjectTask", targetId: taskId, metadata: { projectId, commentId: comment.id } });
  const mentionedIds = extractMentionIds(parsed.data.body).filter((mentionedId) => mentionedId !== uid);
  for (const mentionedId of mentionedIds) {
    await createNotification({
      tenantId: tid,
      userId: mentionedId,
      type: "mention",
      title: `Mentioned in a comment on #${task.code}`,
      body: parsed.data.body.slice(0, 140),
      actorId: uid,
    });
  }
  res.status(201).json({ comment });
});

projectsRouter.delete("/:id/tasks/:taskId/comments/:commentId", requirePermission("tasks", "edit"), async (req, res) => {
  const tid = tenantId(req), uid = userId(req), projectId = req.params.id as string, taskId = req.params.taskId as string;
  const comment = await prisma.taskComment.findFirst({ where: { id: req.params.commentId as string, taskId, tenantId: tid } });
  if (!comment) { res.status(404).json({ error: "Comment not found" }); return; }
  const canManage = await canEditTaskForProject(tid, uid, projectId);
  if (comment.authorId !== uid && !canManage) { res.status(403).json({ error: "You cannot delete this comment" }); return; }
  await prisma.taskComment.delete({ where: { id: comment.id } });
  res.status(204).end();
});

const checklistSchema = z.object({ text: z.string().trim().min(1).max(500) });
projectsRouter.post("/:id/tasks/:taskId/checklist", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = checklistSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Checklist text is required" }); return; }
  const tid = tenantId(req), uid = userId(req), projectId = req.params.id as string, taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (!(await canEditTaskForProject(tid, uid, projectId, task.assigneeId))) { res.status(403).json({ error: "You do not have edit access to this task" }); return; }
  const position = await prisma.taskChecklistItem.count({ where: { taskId } });
  const item = await prisma.taskChecklistItem.create({ data: { tenantId: tid, taskId, text: parsed.data.text, position, createdBy: uid } });
  await recordAudit({ actor: req.auth!, action: "project.task.checklist_added", tenantId: tid, targetType: "ProjectTask", targetId: taskId, metadata: { projectId, checklistItemId: item.id } });
  res.status(201).json({ item });
});

projectsRouter.patch("/:id/tasks/:taskId/checklist/:itemId", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(500).optional(), completed: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid checklist update" }); return; }
  const tid = tenantId(req), uid = userId(req), projectId = req.params.id as string, taskId = req.params.taskId as string;
  const [item, task] = await Promise.all([
    prisma.taskChecklistItem.findFirst({ where: { id: req.params.itemId as string, taskId, tenantId: tid } }),
    prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } }),
  ]);
  if (!item || !task) { res.status(404).json({ error: "Checklist item or task not found" }); return; }
  if (!(await canEditTaskForProject(tid, uid, projectId, task.assigneeId))) { res.status(403).json({ error: "You do not have edit access to this task" }); return; }
  const updated = await prisma.taskChecklistItem.update({ where: { id: item.id }, data: parsed.data });
  res.json({ item: updated });
});

projectsRouter.delete("/:id/tasks/:taskId/checklist/:itemId", requirePermission("tasks", "edit"), async (req, res) => {
  const tid = tenantId(req), uid = userId(req), projectId = req.params.id as string, taskId = req.params.taskId as string;
  const [item, task] = await Promise.all([
    prisma.taskChecklistItem.findFirst({ where: { id: req.params.itemId as string, taskId, tenantId: tid } }),
    prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } }),
  ]);
  if (!item || !task) { res.status(404).json({ error: "Checklist item or task not found" }); return; }
  if (!(await canEditTaskForProject(tid, uid, projectId, task.assigneeId))) { res.status(403).json({ error: "You do not have edit access to this task" }); return; }
  await prisma.taskChecklistItem.delete({ where: { id: item.id } });
  res.status(204).end();
});

const attachmentSchema = z.object({ name: z.string().trim().min(1).max(255), url: z.string().url().max(2000), mimeType: z.string().max(150).nullable().optional(), sizeBytes: z.number().int().nonnegative().nullable().optional() });
projectsRouter.post("/:id/tasks/:taskId/attachments", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = attachmentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid attachment name and URL are required" }); return; }
  const tid = tenantId(req), uid = userId(req), projectId = req.params.id as string, taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } });
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (!(await canEditTaskForProject(tid, uid, projectId, task.assigneeId))) { res.status(403).json({ error: "You do not have edit access to this task" }); return; }
  const attachment = await prisma.taskAttachment.create({ data: { tenantId: tid, taskId, uploadedBy: uid, ...parsed.data } });
  await recordAudit({ actor: req.auth!, action: "project.task.attachment_added", tenantId: tid, targetType: "ProjectTask", targetId: taskId, metadata: { projectId, attachmentId: attachment.id, name: attachment.name } });
  res.status(201).json({ attachment });
});

projectsRouter.delete("/:id/tasks/:taskId/attachments/:attachmentId", requirePermission("tasks", "edit"), async (req, res) => {
  const tid = tenantId(req), uid = userId(req), projectId = req.params.id as string, taskId = req.params.taskId as string;
  const [attachment, task] = await Promise.all([
    prisma.taskAttachment.findFirst({ where: { id: req.params.attachmentId as string, taskId, tenantId: tid } }),
    prisma.projectTask.findFirst({ where: { id: taskId, projectId, tenantId: tid } }),
  ]);
  if (!attachment || !task) { res.status(404).json({ error: "Attachment or task not found" }); return; }
  if (!(await canEditTaskForProject(tid, uid, projectId, task.assigneeId))) { res.status(403).json({ error: "You do not have edit access to this task" }); return; }
  await prisma.taskAttachment.delete({ where: { id: attachment.id } });
  await recordAudit({ actor: req.auth!, action: "project.task.attachment_removed", tenantId: tid, targetType: "ProjectTask", targetId: taskId, metadata: { projectId, attachmentId: attachment.id, name: attachment.name } });
  res.status(204).end();
});

const memberSchema = z.object({
  userId: z.string(),
  access: z.enum(["view", "edit", "manage"]).optional(),
  isFollower: z.boolean().optional(),
  allocationPercent: z.number().int().min(0).max(100).optional(),
});

projectsRouter.post("/:id/members", requirePermission("projects", "edit"), async (req, res) => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "manage"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  const [project, memberUser] = await Promise.all([
    getTenantProject(id, tid),
    prisma.companyUser.findFirst({ where: { id: parsed.data.userId, tenantId: tid } }),
  ]);
  if (!project || !memberUser) {
    res.status(404).json({ error: "Project or company user not found" });
    return;
  }
  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: id, userId: memberUser.id } },
    create: {
      tenantId: tid,
      projectId: id,
      userId: memberUser.id,
      access: parsed.data.access ?? "edit",
      isFollower: parsed.data.isFollower ?? false,
      allocationPercent: parsed.data.allocationPercent ?? 100,
    },
    update: {
      access: parsed.data.access,
      isFollower: parsed.data.isFollower,
      allocationPercent: parsed.data.allocationPercent,
    },
    include: { user: { select: userSelect } },
  });

  const channel = await prisma.chatChannel.findUnique({ where: { projectId: id } });
  if (channel) {
    await prisma.chatChannelMember.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: memberUser.id } },
      create: { tenantId: tid, channelId: channel.id, userId: memberUser.id },
      update: {},
    });
  }

  res.status(201).json({ member });
});

const sectionSchema = z.object({
  name: z.string().trim().min(1).max(255),
  status: z.enum(["new_request", "in_progress", "done"]).optional(),
});

projectsRouter.post("/:id/sections", requirePermission("projects", "edit"), async (req, res) => {
  const parsed = sectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const project = await getTenantProject(id, tid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // Intentionally narrower than general project edit access: only the project's own
  // owner/manager (or a super admin) may restructure its board. ProjectMembers, department
  // heads, and other edit-access roles can edit tasks but not add/remove sections.
  const roles = await getCompanyUserRoles(tid, uid);
  const isOwnerOrManager = project.ownerId === uid || project.managerId === uid || roles.includes("company_super_admin");
  if (!isOwnerOrManager) {
    res.status(403).json({ error: "Only the project owner or manager can add sections" });
    return;
  }
  const existing = await prisma.projectSection.findFirst({ where: { projectId: id, name: parsed.data.name } });
  if (existing) {
    res.status(409).json({ error: "A section with this name already exists" });
    return;
  }
  const position = await prisma.projectSection.count({ where: { projectId: id } });
  const section = await prisma.projectSection.create({
    data: {
      tenantId: tid,
      projectId: id,
      name: parsed.data.name,
      status: parsed.data.status ?? "new_request",
      position,
    },
    include: { owner: { select: userSelect } },
  });
  await recordAudit({
    actor: req.auth!,
    action: "project.section.created",
    tenantId: tid,
    targetType: "ProjectSection",
    targetId: section.id,
    metadata: { projectId: id, name: section.name },
  });
  res.status(201).json({ section: { ...section, tasks: [] } });
});

const milestoneSchema = z.object({
  name: z.string().min(1).max(255),
  ownerId: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

projectsRouter.post("/:id/milestones", requirePermission("projects", "edit"), async (req, res) => {
  const parsed = milestoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "edit"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  if (!(await getTenantProject(id, tid))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const milestone = await prisma.projectMilestone.create({
    data: {
      tenantId: tid,
      projectId: id,
      name: parsed.data.name,
      ownerId: parsed.data.ownerId ?? null,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      releaseDate: parsed.data.releaseDate ? new Date(parsed.data.releaseDate) : null,
      description: parsed.data.description ?? null,
      tags: parsed.data.tags ?? [],
    },
    include: { owner: { select: userSelect }, _count: { select: { tasks: true } } },
  });
  await recordAudit({ actor: req.auth!, action: "project.milestone.created", tenantId: tid, targetType: "ProjectMilestone", targetId: milestone.id, metadata: { projectId: id, name: milestone.name } });
  res.status(201).json({ milestone });
});

const milestoneUpdateSchema = milestoneSchema.partial();

projectsRouter.patch("/:id/milestones/:milestoneId", requirePermission("projects", "edit"), async (req, res) => {
  const parsed = milestoneUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  const milestoneId = req.params.milestoneId as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "edit"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  const existing = await prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: id, tenantId: tid } });
  if (!existing) {
    res.status(404).json({ error: "Milestone not found" });
    return;
  }
  const data = parsed.data;
  const milestone = await prisma.projectMilestone.update({
    where: { id: milestoneId },
    data: {
      name: data.name,
      ownerId: data.ownerId !== undefined ? data.ownerId : undefined,
      startDate: data.startDate !== undefined ? (data.startDate ? new Date(data.startDate) : null) : undefined,
      releaseDate: data.releaseDate !== undefined ? (data.releaseDate ? new Date(data.releaseDate) : null) : undefined,
      description: data.description !== undefined ? data.description : undefined,
      tags: data.tags,
    },
    include: { owner: { select: userSelect }, _count: { select: { tasks: true } } },
  });
  await recordAudit({ actor: req.auth!, action: "project.milestone.updated", tenantId: tid, targetType: "ProjectMilestone", targetId: milestoneId, metadata: { projectId: id, changes: Object.keys(data) } });
  res.json({ milestone });
});

projectsRouter.delete("/:id/milestones/:milestoneId", requirePermission("projects", "edit"), async (req, res) => {
  const tid = tenantId(req);
  const id = req.params.id as string;
  const milestoneId = req.params.milestoneId as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "edit"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  const existing = await prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: id, tenantId: tid } });
  if (!existing) {
    res.status(404).json({ error: "Milestone not found" });
    return;
  }
  await prisma.projectTask.updateMany({ where: { milestoneId }, data: { milestoneId: null } });
  await prisma.projectMilestone.delete({ where: { id: milestoneId } });
  await recordAudit({ actor: req.auth!, action: "project.milestone.deleted", tenantId: tid, targetType: "ProjectMilestone", targetId: milestoneId, metadata: { projectId: id, name: existing.name } });
  res.status(204).end();
});

const eventSchema = z.object({
  title: z.string().min(1).max(255),
  date: z.string().min(1),
  description: z.string().nullable().optional(),
});

projectsRouter.post("/:id/events", requirePermission("projects", "edit"), async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "edit"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  if (!(await getTenantProject(id, tid))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const event = await prisma.projectEvent.create({
    data: {
      tenantId: tid,
      projectId: id,
      title: parsed.data.title,
      date: new Date(parsed.data.date),
      description: parsed.data.description ?? null,
      createdById: userId(req),
    },
    include: { createdBy: { select: userSelect } },
  });
  await recordAudit({ actor: req.auth!, action: "project.event.created", tenantId: tid, targetType: "ProjectEvent", targetId: event.id, metadata: { projectId: id, title: event.title } });
  res.status(201).json({ event });
});

const eventUpdateSchema = eventSchema.partial();

projectsRouter.patch("/:id/events/:eventId", requirePermission("projects", "edit"), async (req, res) => {
  const parsed = eventUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  const eventId = req.params.eventId as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "edit"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  const existing = await prisma.projectEvent.findFirst({ where: { id: eventId, projectId: id, tenantId: tid } });
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const data = parsed.data;
  const event = await prisma.projectEvent.update({
    where: { id: eventId },
    data: {
      title: data.title,
      date: data.date !== undefined ? new Date(data.date) : undefined,
      description: data.description !== undefined ? data.description : undefined,
    },
    include: { createdBy: { select: userSelect } },
  });
  await recordAudit({ actor: req.auth!, action: "project.event.updated", tenantId: tid, targetType: "ProjectEvent", targetId: eventId, metadata: { projectId: id, changes: Object.keys(data) } });
  res.json({ event });
});

projectsRouter.delete("/:id/events/:eventId", requirePermission("projects", "edit"), async (req, res) => {
  const tid = tenantId(req);
  const id = req.params.id as string;
  const eventId = req.params.eventId as string;
  if (!(await requireProjectAccess(tid, userId(req), id, "edit"))) {
    res.status(403).json({ error: "You do not have sufficient access to this project" });
    return;
  }
  const existing = await prisma.projectEvent.findFirst({ where: { id: eventId, projectId: id, tenantId: tid } });
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  await prisma.projectEvent.delete({ where: { id: eventId } });
  await recordAudit({ actor: req.auth!, action: "project.event.deleted", tenantId: tid, targetType: "ProjectEvent", targetId: eventId, metadata: { projectId: id, title: existing.title } });
  res.status(204).end();
});

const timerSchema = z.object({
  activityType: z.string().min(1).max(100).optional(),
  billable: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
});
const stopTimerSchema = z.object({
  activityType: z.string().trim().min(1, "Activity is required").max(100),
  billable: z.boolean(),
  note: z.string().trim().min(1, "Description is required").max(2000),
  durationSeconds: z.number().int().positive("Duration must be greater than 0").max(7 * 24 * 60 * 60, "Duration cannot exceed 7 days").optional(),
});

projectsRouter.get("/:id/timer/active", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const entry = await prisma.taskTimeEntry.findFirst({
    where: { tenantId: tid, userId: uid, endedAt: null },
    include: {
      user: { select: userSelect },
      task: { select: { id: true, code: true, name: true, projectId: true } },
      project: { select: { id: true, name: true } },
    },
  });
  res.json({ entry });
});

projectsRouter.post("/:id/tasks/:taskId/timer/start", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = timerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId: id, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (!(await canEditTaskForProject(tid, uid, id, task.assigneeId))) {
    res.status(403).json({ error: "You do not have access to track time on this task" });
    return;
  }
  if (task.overdueReviewStatus === "pending_review") {
    res.status(400).json({ error: "This task is overdue and awaiting review — it can't be tracked until it's resolved" });
    return;
  }
  if (!task.estimatedMinutes) {
    res.status(400).json({ error: "Please add estimate hours" });
    return;
  }
  const active = await prisma.taskTimeEntry.findFirst({
    where: { tenantId: tid, userId: uid, endedAt: null },
    include: {
      user: { select: userSelect },
      task: { select: { id: true, code: true, name: true, projectId: true } },
      project: { select: { id: true, name: true } },
    },
  });
  if (active) {
    if (active.projectId === id && active.taskId === taskId) {
      res.json({ entry: active, alreadyRunning: true });
      return;
    }
    res.status(409).json({ error: "A timer is already running on another task", activeEntry: active });
    return;
  }
  let entry;
  try {
    entry = await prisma.taskTimeEntry.create({
      data: {
        tenantId: tid,
        projectId: id,
        taskId,
        userId: uid,
        activityType: parsed.data.activityType ?? "Work",
        billable: parsed.data.billable ?? task.billingType === "billable",
        note: parsed.data.note ?? null,
      },
      include: {
        user: { select: userSelect },
        task: { select: { id: true, code: true, name: true, projectId: true } },
        project: { select: { id: true, name: true } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const stillActive = await prisma.taskTimeEntry.findFirst({
        where: { tenantId: tid, userId: uid, endedAt: null },
        include: {
          user: { select: userSelect },
          task: { select: { id: true, code: true, name: true, projectId: true } },
          project: { select: { id: true, name: true } },
        },
      });
      res.status(409).json({ error: "A timer is already running on another task", activeEntry: stillActive });
      return;
    }
    throw err;
  }
  await recordAudit({
    actor: req.auth!,
    action: "project.task.timer.started",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: taskId,
    metadata: { projectId: id, timeEntryId: entry.id },
  });
  res.status(201).json({ entry });
});

projectsRouter.post("/:id/tasks/:taskId/timer/stop", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = stopTimerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const entry = await prisma.taskTimeEntry.findFirst({
    where: { tenantId: tid, projectId: id, taskId, userId: uid, endedAt: null },
  });
  if (!entry) {
    res.status(404).json({ error: "No active timer found for this task" });
    return;
  }
  const liveEndedAt = new Date();
  const liveDurationSeconds = Math.max(1, Math.floor((liveEndedAt.getTime() - entry.startedAt.getTime()) / 1000));
  const durationSeconds = parsed.data.durationSeconds ?? liveDurationSeconds;
  if (durationSeconds > liveDurationSeconds + 60) {
    res.status(400).json({ error: "Corrected duration cannot be greater than the running timer duration" });
    return;
  }
  const endedAt = new Date(entry.startedAt.getTime() + durationSeconds * 1000);
  const [updatedEntry, task, project] = await prisma.$transaction([
    prisma.taskTimeEntry.update({
      where: { id: entry.id },
      data: {
        endedAt,
        durationSeconds,
        activityType: parsed.data.activityType,
        billable: parsed.data.billable,
        note: parsed.data.note,
      },
      include: { user: { select: userSelect } },
    }),
    prisma.projectTask.update({
      where: { id: taskId },
      data: { trackedSeconds: { increment: durationSeconds }, updatedBy: uid },
    }),
    prisma.project.update({
      where: { id },
      data: { trackedSeconds: { increment: durationSeconds }, updatedBy: uid },
    }),
  ]);
  await recordAudit({
    actor: req.auth!,
    action: "project.task.timer.stopped",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: taskId,
    metadata: {
      projectId: id, timeEntryId: entry.id, durationSeconds,
      activityType: parsed.data.activityType, billable: parsed.data.billable,
    },
  });
  res.json({
    entry: updatedEntry,
    taskTrackedSeconds: task.trackedSeconds,
    projectTrackedSeconds: project.trackedSeconds,
  });
});
/** Resolves "midnight on this calendar date, in this timezone" to the correct UTC instant —
 *  used for manual work-log entries so a log dated "2026-08-10" for a New York-timezone company
 *  actually lands on Aug 10 when the resource planner buckets it back by company timezone,
 *  regardless of what timezone the server process itself happens to be running in. A naive
 *  `new Date(\`${date}T00:00:00\`)` uses the server's local wall-clock time instead, which only
 *  coincidentally matches the company's timezone and silently shifts entries to the wrong day
 *  (often invisible — they just vanish from that day's planner view) whenever it doesn't. */
function localMidnightUtc(dateKey: string, timezone: string): Date {
  const naiveUtc = new Date(`${dateKey}T00:00:00.000Z`);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(naiveUtc);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    // naiveUtc rendered in the target timezone tells us the offset: if the timezone is behind
    // UTC, this will show an earlier wall-clock time than naiveUtc's own 00:00:00.
    const shownAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const offsetMs = naiveUtc.getTime() - shownAsUtc;
    return new Date(naiveUtc.getTime() + offsetMs);
  } catch {
    return naiveUtc;
  }
}

/** Converts "HH:MM" (schedule field format) to minutes since local midnight. */
function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/** Places a manually-logged duration within the company's working hours for that day, instead of
 *  literally at midnight. If the caller supplies an explicit startMinutes (the person picked a
 *  start time in the form), that's used as-is — validated by the caller to fall within working
 *  hours and outside the lunch break before this is ever called. Otherwise falls back to
 *  auto-placement: starting from the schedule's startTime, stacked after any minutes already
 *  logged that day (so multiple manual logs the same day queue up one after another rather than
 *  overlapping), and skipping straight over the break window (e.g. 2:00-2:30 PM) if the slot
 *  would otherwise fall inside it. Purely a display/bookkeeping placement — the caller derives
 *  the real durationSeconds from the requested minutes directly, never from this slot, so a log
 *  that runs past endTime (e.g. a lot of hours logged in one day) just displays later in the
 *  evening rather than having its recorded time silently shortened. */
function placeManualLogSlot(
  dateKey: string,
  timezone: string,
  schedule: { startTime: string; breakStartTime: string; breakEndTime: string },
  minutesAlreadyLoggedToday: number,
  durationMinutes: number,
  explicitStartMinutes?: number,
): { startedAt: Date; endedAt: Date } {
  const dayStartMinutes = timeToMinutes(schedule.startTime);
  const breakStartMinutes = timeToMinutes(schedule.breakStartTime);
  const breakEndMinutes = timeToMinutes(schedule.breakEndTime);

  let slotStart: number;
  if (explicitStartMinutes !== undefined) {
    slotStart = explicitStartMinutes;
  } else {
    slotStart = dayStartMinutes + minutesAlreadyLoggedToday;
    // Skip the break: if the slot starts inside it, or would otherwise cross into it, hop to
    // right after breakEndTime — the already-logged minutes account for real placed time only,
    // never break time, so this only needs to check the start point once.
    if (slotStart >= breakStartMinutes && slotStart < breakEndMinutes) {
      slotStart = breakEndMinutes;
    } else if (slotStart < breakStartMinutes && slotStart + durationMinutes > breakStartMinutes) {
      slotStart = breakEndMinutes;
    }
  }
  // Never truncate the logged duration itself — a manual log's minutes are the actual time
  // worked and must be preserved exactly regardless of how they're displayed. If the slot would
  // run past endTime, let it spill past on the display side rather than silently shortening what
  // was recorded (this only affects a day already logged well beyond a normal working day).
  const slotEnd = slotStart + durationMinutes;

  const dayMidnightUtc = localMidnightUtc(dateKey, timezone);
  return {
    startedAt: new Date(dayMidnightUtc.getTime() + slotStart * 60 * 1000),
    endedAt: new Date(dayMidnightUtc.getTime() + slotEnd * 60 * 1000),
  };
}

const manualLogSchema = z.object({
  date: z.string().min(1, "Date is required"),
  durationMinutes: z.number().int().positive("Duration must be greater than 0"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  activityType: z.string().trim().min(1, "Activity is required").max(100),
  billable: z.boolean(),
  note: z.string().trim().min(1, "Description is required").max(2000),
});

projectsRouter.post("/:id/tasks/:taskId/timer/log", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = manualLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId: id, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (!(await canEditTaskForProject(tid, uid, id, task.assigneeId))) {
    res.status(403).json({ error: "You do not have access to log time on this task" });
    return;
  }
  if (task.overdueReviewStatus === "pending_review") {
    res.status(400).json({ error: "This task is overdue and awaiting review — it can't be tracked until it's resolved" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.data.date)) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  const [company, schedule] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: tid }, select: { timezone: true } }),
    prisma.workingSchedule.findFirst({ where: { tenantId: tid }, orderBy: { createdAt: "asc" } }),
  ]);
  const dayMidnightUtc = localMidnightUtc(parsed.data.date, company.timezone);
  if (Number.isNaN(dayMidnightUtc.getTime())) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  const nextDayUtc = new Date(dayMidnightUtc.getTime() + 24 * 60 * 60 * 1000);
  const priorEntriesToday = await prisma.taskTimeEntry.findMany({
    where: { tenantId: tid, userId: uid, startedAt: { gte: dayMidnightUtc, lt: nextDayUtc } },
    select: { durationSeconds: true },
  });
  const minutesAlreadyLoggedToday = Math.round(priorEntriesToday.reduce((total, entry) => total + entry.durationSeconds, 0) / 60);
  const durationSeconds = parsed.data.durationMinutes * 60;
  const scheduleTimes = {
    startTime: schedule?.startTime ?? "09:00",
    endTime: schedule?.endTime ?? "18:00",
    breakStartTime: schedule?.breakStartTime ?? "14:00",
    breakEndTime: schedule?.breakEndTime ?? "14:30",
  };

  let explicitStartMinutes: number | undefined;
  if (parsed.data.startTime) {
    explicitStartMinutes = timeToMinutes(parsed.data.startTime);
    const dayStartMinutes = timeToMinutes(scheduleTimes.startTime);
    const dayEndMinutes = timeToMinutes(scheduleTimes.endTime);
    const breakStartMinutes = timeToMinutes(scheduleTimes.breakStartTime);
    const breakEndMinutes = timeToMinutes(scheduleTimes.breakEndTime);
    if (explicitStartMinutes < dayStartMinutes || explicitStartMinutes >= dayEndMinutes) {
      res.status(400).json({ error: "Start time must fall within working hours" });
      return;
    }
    if (explicitStartMinutes >= breakStartMinutes && explicitStartMinutes < breakEndMinutes) {
      res.status(400).json({ error: "Start time cannot fall within the lunch break" });
      return;
    }
    if (explicitStartMinutes < breakStartMinutes && explicitStartMinutes + parsed.data.durationMinutes > breakStartMinutes) {
      res.status(400).json({ error: "This duration would run into the lunch break — choose a shorter duration or a start time after the break" });
      return;
    }
  }

  const { startedAt, endedAt } = placeManualLogSlot(
    parsed.data.date,
    company.timezone,
    scheduleTimes,
    minutesAlreadyLoggedToday,
    parsed.data.durationMinutes,
    explicitStartMinutes,
  );

  const [entry, updatedTask, updatedProject] = await prisma.$transaction([
    prisma.taskTimeEntry.create({
      data: {
        tenantId: tid,
        projectId: id,
        taskId,
        userId: uid,
        activityType: parsed.data.activityType,
        billable: parsed.data.billable,
        note: parsed.data.note,
        startedAt,
        endedAt,
        durationSeconds,
      },
      include: { user: { select: userSelect } },
    }),
    prisma.projectTask.update({
      where: { id: taskId },
      data: { trackedSeconds: { increment: durationSeconds }, updatedBy: uid },
    }),
    prisma.project.update({
      where: { id },
      data: { trackedSeconds: { increment: durationSeconds }, updatedBy: uid },
    }),
  ]);
  await recordAudit({
    actor: req.auth!,
    action: "project.task.timer.logged",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: taskId,
    metadata: { projectId: id, timeEntryId: entry.id, durationSeconds, date: parsed.data.date },
  });
  res.status(201).json({
    entry,
    taskTrackedSeconds: updatedTask.trackedSeconds,
    projectTrackedSeconds: updatedProject.trackedSeconds,
  });
});

const editTimeEntrySchema = z.object({
  durationMinutes: z.number().int().positive("Duration must be greater than 0"),
  activityType: z.string().trim().min(1, "Activity is required").max(100),
  billable: z.boolean(),
  note: z.string().trim().min(1, "Description is required").max(2000),
  reason: z.string().trim().max(2000).optional(),
});

/** Correcting someone ELSE's work log is a management action — a plain employee (role set is
 *  exactly ["employee"]) may not directly edit another employee's logged hours. Only team leads,
 *  project managers, department heads, and admins (any non-"employee"-only role) with task edit
 *  access may fix someone else's entry directly, exactly as before.
 *
 *  Correcting your OWN entry is different: everyone, employee or not, can now request a change
 *  to their own logged time (e.g. forgot to stop a timer), but it never writes directly — it
 *  always creates a TaskTimeEntryChangeRequest and routes to the entry owner's team lead for
 *  approval, so ProjectTask/Project.trackedSeconds (and therefore the Resource Planner's
 *  remainingMinutesFor) never move until someone with authority signs off. This keeps a clean,
 *  uniform audit trail — no self-approval loophole even for a TL editing their own log. */
projectsRouter.patch("/:id/tasks/:taskId/timer/:entryId", requirePermission("tasks", "edit"), async (req, res) => {
  const parsed = editTimeEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const entryId = req.params.entryId as string;
  const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId: id, tenantId: tid } });
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (!(await canEditTaskForProject(tid, uid, id, task.assigneeId))) {
    res.status(403).json({ error: "You do not have edit access to this task" });
    return;
  }
  const entry = await prisma.taskTimeEntry.findFirst({
    where: { id: entryId, taskId, projectId: id, tenantId: tid },
    include: { user: { select: userSelect } },
  });
  if (!entry) {
    res.status(404).json({ error: "Work log not found" });
    return;
  }
  if (!entry.endedAt) {
    res.status(400).json({ error: "A running timer cannot be edited — stop it first" });
    return;
  }
  const newDurationSeconds = parsed.data.durationMinutes * 60;
  const isOwnEntry = entry.userId === uid;

  if (isOwnEntry) {
    if (!parsed.data.reason) {
      res.status(400).json({ error: "A reason is required to request a change to your own work log" });
      return;
    }
    const existingPending = await prisma.taskTimeEntryChangeRequest.findFirst({ where: { entryId, tenantId: tid, status: "pending_review" } });
    if (existingPending) {
      res.status(400).json({ error: "A change request for this entry is already pending" });
      return;
    }
    const approverId = await resolveTeamLead(tid, entry.userId);
    if (!approverId) {
      res.status(400).json({ error: "No approver could be found for this request — contact your admin" });
      return;
    }
    const request = await prisma.taskTimeEntryChangeRequest.create({
      data: {
        tenantId: tid,
        entryId,
        requestedBy: uid,
        approverId,
        previousDurationSeconds: entry.durationSeconds,
        requestedDurationSeconds: newDurationSeconds,
        previousActivityType: entry.activityType,
        requestedActivityType: parsed.data.activityType,
        previousBillable: entry.billable,
        requestedBillable: parsed.data.billable,
        previousNote: entry.note,
        requestedNote: parsed.data.note,
        reason: parsed.data.reason,
      },
    });
    await recordAudit({
      actor: req.auth!, action: "task.timelog.change_requested", tenantId: tid, targetType: "ProjectTask", targetId: taskId,
      metadata: { projectId: id, timeEntryId: entry.id, requestId: request.id, previousDurationSeconds: entry.durationSeconds, requestedDurationSeconds: newDurationSeconds },
    });
    await createNotification({
      tenantId: tid, userId: approverId, type: "task_timelog_change_request",
      title: `${entry.user.name} requested a work log change on #${task.code} ${task.name}`, taskId, projectId: id, actorId: uid,
    });
    res.status(202).json({ request, pending: true });
    return;
  }

  const roles = await getCompanyUserRoles(tid, uid);
  if (roles.every((role) => role === "employee")) {
    res.status(403).json({ error: "Only team leads, project managers, and admins can edit another employee's work log" });
    return;
  }
  const durationDelta = newDurationSeconds - entry.durationSeconds;
  const [updatedEntry, updatedTask, updatedProject] = await prisma.$transaction([
    prisma.taskTimeEntry.update({
      where: { id: entry.id },
      data: {
        durationSeconds: newDurationSeconds,
        activityType: parsed.data.activityType,
        billable: parsed.data.billable,
        note: parsed.data.note,
      },
      include: { user: { select: userSelect } },
    }),
    prisma.projectTask.update({
      where: { id: taskId },
      data: { trackedSeconds: { increment: durationDelta }, updatedBy: uid },
    }),
    prisma.project.update({
      where: { id },
      data: { trackedSeconds: { increment: durationDelta }, updatedBy: uid },
    }),
  ]);
  await recordAudit({
    actor: req.auth!,
    action: "project.task.timer.updated",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: taskId,
    metadata: {
      projectId: id,
      timeEntryId: entry.id,
      previousDurationSeconds: entry.durationSeconds,
      newDurationSeconds,
      activityType: parsed.data.activityType,
      billable: parsed.data.billable,
    },
  });
  res.json({
    entry: updatedEntry,
    taskTrackedSeconds: updatedTask.trackedSeconds,
    projectTrackedSeconds: updatedProject.trackedSeconds,
    pending: false,
  });
});

// Every resolved-or-pending change request for a work log entry, newest first.
projectsRouter.get("/:id/tasks/:taskId/timer/:entryId/change-requests", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const entryId = req.params.entryId as string;
  const entry = await prisma.taskTimeEntry.findFirst({ where: { id: entryId, taskId, projectId: id, tenantId: tid } });
  if (!entry) {
    res.status(404).json({ error: "Work log not found" });
    return;
  }
  const requests = await prisma.taskTimeEntryChangeRequest.findMany({ where: { entryId, tenantId: tid }, orderBy: { createdAt: "desc" } });
  res.json({ requests });
});

projectsRouter.delete("/:id/tasks/:taskId/timer", requirePermission("tasks", "edit"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const id = req.params.id as string;
  const taskId = req.params.taskId as string;
  const entry = await prisma.taskTimeEntry.findFirst({
    where: { tenantId: tid, projectId: id, taskId, userId: uid, endedAt: null },
  });
  if (!entry) {
    res.status(404).json({ error: "No active timer found for this task" });
    return;
  }
  await prisma.taskTimeEntry.delete({ where: { id: entry.id } });
  await recordAudit({
    actor: req.auth!,
    action: "project.task.timer.discarded",
    tenantId: tid,
    targetType: "ProjectTask",
    targetId: taskId,
    metadata: { projectId: id, timeEntryId: entry.id },
  });
  res.status(204).send();
});
