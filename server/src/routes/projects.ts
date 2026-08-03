import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { createNotification, ensureProjectChatMembers, extractMentionIds } from "../lib/chat.js";

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

  const rows = await Promise.all(projects.map(async (p) => ({
    ...p,
    favouritedBy: undefined,
    _count: undefined,
    favourite: p.favouritedBy.length > 0,
    currentUserAccess: await projectAccessLevel(tid, uid, p),
    taskCount: p._count.tasks,
    completedTaskCount: completedByProject.get(p.id) ?? 0,
  })));
  res.json({ projects: rows });
});

projectsRouter.get("/tasks/assigned", requirePermission("tasks", "view"), async (req, res) => {
  const tid = tenantId(req);
  const uid = userId(req);
  const roles = await getCompanyUserRoles(tid, uid);
  const assignments: Prisma.ProjectTaskWhereInput[] = [
    { assigneeId: uid },
    { followers: { some: { userId: uid } } },
    { project: { ownerId: uid } },
    { project: { managerId: uid } },
    { project: { members: { some: { userId: uid, access: { in: ["edit", "manage"] } } } } },
  ];
  if (roles.includes("department_head")) assignments.push({ project: { department: { headUserId: uid } } });
  if (roles.includes("team_lead")) assignments.push({ assignee: { teamMemberships: { some: { team: { leadUserId: uid } } } } });
  const taskScope: Prisma.ProjectTaskWhereInput = roles.some((role) => elevatedProjectReaders.has(role))
    ? { tenantId: tid }
    : { tenantId: tid, OR: assignments };
  const tasks = await prisma.projectTask.findMany({
    where: taskScope,
    include: {
      ...taskDetailInclude,
      project: { select: { id: true, name: true, key: true, status: true, priority: true } },
      section: { select: { id: true, name: true } },
    },
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    take: 500,
  });
  // ProjectTask.createdBy is a raw id with no Prisma relation, so the "assigner" (who created
  // the task) is resolved here via a single batch lookup rather than per-row.
  const assignerIds = [...new Set(tasks.map((task) => task.createdBy).filter((id): id is string => Boolean(id)))];
  const assigners = assignerIds.length
    ? await prisma.companyUser.findMany({ where: { id: { in: assignerIds }, tenantId: tid }, select: userSelect })
    : [];
  const assignerById = new Map(assigners.map((user) => [user.id, user]));
  const rows = tasks.map((task) => ({ ...task, assigner: task.createdBy ? assignerById.get(task.createdBy) ?? null : null }));
  res.json({ tasks: rows });
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
      sections: {
        include: {
          owner: { select: userSelect },
          tasks: {
            include: taskDetailInclude,

            orderBy: { position: "asc" },
          },
        },
        orderBy: { position: "asc" },
      },
      milestones: {
        include: { owner: { select: userSelect }, _count: { select: { tasks: true } } },
        orderBy: { releaseDate: "asc" },
      },
    },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { favouritedBy, sections, members, milestones, ...projectData } = project;
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
  const project = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, scope] }, select: { id: true } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const input = parsed.data;
  const filters: Prisma.ProjectTaskWhereInput[] = [];
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
  dueDate: z.string().nullable().optional(),
  taskType: z.string().nullable().optional(),
  billingType: z.enum(["billable", "non_billable"]).optional(),
  tags: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().nonnegative().optional(),
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
    include: { assignee: { select: userSelect } },
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

function taskDatesAreValid(startDate?: string | null, dueDate?: string | null) {
  if (!startDate || !dueDate) return true;
  return new Date(startDate).getTime() <= new Date(dueDate).getTime();
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
  // The self-assignee carve-out in canEditTaskForProject lets someone with no real project
  // access edit their own task's status/progress/etc — but reassigning it to somebody else
  // (or unassigning themselves) is a project-management action, not self-editing, so it must
  // require real project edit access even when the actor happens to be the current assignee.
  if (data.assigneeId !== undefined && data.assigneeId !== task.assigneeId) {
    const hasProjectAccess = await requireProjectAccess(tid, uid, projectId, "edit");
    if (!hasProjectAccess) {
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
      type: "message",
      title: `You were assigned to #${task.code} ${task.name}`,
      actorId: uid,
    });
  }
  res.json({ task: updated });
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

const timerSchema = z.object({
  activityType: z.string().min(1).max(100).optional(),
  billable: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
});
const stopTimerSchema = z.object({
  activityType: z.string().trim().min(1, "Activity is required").max(100),
  billable: z.boolean(),
  note: z.string().trim().min(1, "Description is required").max(500),
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
  const endedAt = new Date();
  const durationSeconds = Math.max(1, Math.floor((endedAt.getTime() - entry.startedAt.getTime()) / 1000));
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
const manualLogSchema = z.object({
  date: z.string().min(1, "Date is required"),
  durationMinutes: z.number().int().positive("Duration must be greater than 0"),
  activityType: z.string().trim().min(1, "Activity is required").max(100),
  billable: z.boolean(),
  note: z.string().trim().min(1, "Description is required").max(500),
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
  const startedAt = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(startedAt.getTime())) {
    res.status(400).json({ error: "Invalid date" });
    return;
  }
  const durationSeconds = parsed.data.durationMinutes * 60;
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

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
