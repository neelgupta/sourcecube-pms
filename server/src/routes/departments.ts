import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

export const departmentsRouter = Router();
departmentsRouter.use(requireAuth, requireCompany);

function tenantId(req: { auth?: { kind: string; tenantId?: string } }): string {
  return (req.auth as { tenantId: string }).tenantId;
}

departmentsRouter.get("/", requirePermission("company_settings", "view"), async (req, res) => {
  const tid = tenantId(req);
  const departments = await prisma.department.findMany({
    where: { tenantId: tid },
    include: {
      headUser: { select: { id: true, name: true, email: true } },
      _count: { select: { children: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json({ departments });
});

const departmentSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().nullable().optional(),
  headUserId: z.string().nullable().optional(),
  costCenter: z.string().nullable().optional(),
  budget: z.number().nonnegative().nullable().optional(),
});

/** Walks the parent chain from `candidateParentId` to ensure `departmentId` never appears — prevents cycles. */
async function wouldCreateCycle(tid: string, departmentId: string, candidateParentId: string): Promise<boolean> {
  let currentId: string | null = candidateParentId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === departmentId) return true;
    if (visited.has(currentId)) return true; // defensive: existing corrupt cycle
    visited.add(currentId);
    const current: { parentId: string | null } | null = await prisma.department.findFirst({
      where: { id: currentId, tenantId: tid },
      select: { parentId: true },
    });
    currentId = current?.parentId ?? null;
  }
  return false;
}

departmentsRouter.post("/", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = departmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const data = parsed.data;

  const existing = await prisma.department.findUnique({ where: { tenantId_name: { tenantId: tid, name: data.name } } });
  if (existing) {
    res.status(409).json({ error: "A department with this name already exists" });
    return;
  }

  if (data.parentId) {
    const parent = await prisma.department.findFirst({ where: { id: data.parentId, tenantId: tid } });
    if (!parent) {
      res.status(400).json({ error: "Parent department not found" });
      return;
    }
  }

  if (data.headUserId) {
    const head = await prisma.companyUser.findFirst({ where: { id: data.headUserId, tenantId: tid } });
    if (!head) {
      res.status(400).json({ error: "Department head not found" });
      return;
    }
  }

  const department = await prisma.department.create({
    data: {
      tenantId: tid,
      name: data.name,
      parentId: data.parentId ?? null,
      headUserId: data.headUserId ?? null,
      costCenter: data.costCenter ?? null,
      budget: data.budget ?? null,
      createdBy: req.auth!.userId,
      updatedBy: req.auth!.userId,
    },
    include: { headUser: { select: { id: true, name: true, email: true } } },
  });

  await recordAudit({
    actor: req.auth!,
    action: "department.created",
    tenantId: tid,
    targetType: "Department",
    targetId: department.id,
    metadata: { name: department.name },
  });

  res.status(201).json({ department });
});

const updateSchema = departmentSchema.partial();

departmentsRouter.patch("/:id", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  const data = parsed.data;

  const department = await prisma.department.findFirst({ where: { id, tenantId: tid } });
  if (!department) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  if (data.parentId) {
    if (data.parentId === id) {
      res.status(400).json({ error: "A department cannot be its own parent" });
      return;
    }
    const parent = await prisma.department.findFirst({ where: { id: data.parentId, tenantId: tid } });
    if (!parent) {
      res.status(400).json({ error: "Parent department not found" });
      return;
    }
    if (await wouldCreateCycle(tid, id, data.parentId)) {
      res.status(400).json({ error: "This would create a circular department hierarchy" });
      return;
    }
  }

  if (data.headUserId) {
    const head = await prisma.companyUser.findFirst({ where: { id: data.headUserId, tenantId: tid } });
    if (!head) {
      res.status(400).json({ error: "Department head not found" });
      return;
    }
  }

  const updated = await prisma.department.update({
    where: { id },
    data: { ...data, updatedBy: req.auth!.userId },
    include: { headUser: { select: { id: true, name: true, email: true } } },
  });

  await recordAudit({
    actor: req.auth!,
    action: "department.updated",
    tenantId: tid,
    targetType: "Department",
    targetId: id,
    metadata: { changes: data },
  });

  res.json({ department: updated });
});

departmentsRouter.post("/:id/status", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  const department = await prisma.department.findFirst({ where: { id, tenantId: tid } });
  if (!department) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const updated = await prisma.department.update({
    where: { id },
    data: { isActive: parsed.data.isActive, updatedBy: req.auth!.userId },
  });

  await recordAudit({
    actor: req.auth!,
    action: parsed.data.isActive ? "department.activated" : "department.deactivated",
    tenantId: tid,
    targetType: "Department",
    targetId: id,
  });

  res.json({ department: updated });
});
