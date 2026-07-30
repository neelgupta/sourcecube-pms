import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

export const teamsRouter = Router();
teamsRouter.use(requireAuth, requireCompany);

function tenantId(req: { auth?: { kind: string; tenantId?: string } }): string {
  return (req.auth as { tenantId: string }).tenantId;
}

const memberSelect = { id: true, name: true, email: true, accountStatus: true } as const;

teamsRouter.get("/", requirePermission("company_settings", "view"), async (req, res) => {
  const teams = await prisma.team.findMany({
    where: { tenantId: tenantId(req) },
    include: {
      leadUser: { select: memberSelect },
      _count: { select: { members: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json({ teams });
});

teamsRouter.get("/:id", requirePermission("company_settings", "view"), async (req, res) => {
  const tid = tenantId(req);
  const id = req.params.id as string;
  const team = await prisma.team.findFirst({
    where: { id, tenantId: tid },
    include: {
      leadUser: { select: memberSelect },
      members: { include: { user: { select: memberSelect } }, orderBy: { joinedAt: "asc" } },
    },
  });
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  res.json({ team });
});

const teamSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().nullable().optional(),
  leadUserId: z.string().nullable().optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

teamsRouter.post("/", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = teamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const data = parsed.data;
  const memberIds = [...new Set([...(data.memberIds ?? []), ...(data.leadUserId ? [data.leadUserId] : [])])];

  const existing = await prisma.team.findUnique({ where: { tenantId_name: { tenantId: tid, name: data.name } } });
  if (existing) {
    res.status(409).json({ error: "A team with this name already exists" });
    return;
  }

  if (data.leadUserId) {
    const lead = await prisma.companyUser.findFirst({ where: { id: data.leadUserId, tenantId: tid } });
    if (!lead) {
      res.status(400).json({ error: "Team lead not found" });
      return;
    }
  }
  if (memberIds.length) {
    const validMembers = await prisma.companyUser.count({ where: { id: { in: memberIds }, tenantId: tid } });
    if (validMembers !== memberIds.length) {
      res.status(400).json({ error: "One or more selected employees do not belong to this company" });
      return;
    }
  }

  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: {
        tenantId: tid,
        name: data.name,
        purpose: data.purpose ?? null,
        leadUserId: data.leadUserId ?? null,
        createdBy: req.auth!.userId,
        updatedBy: req.auth!.userId,
      },
    });
    if (memberIds.length) {
      await tx.teamMember.createMany({
        data: memberIds.map((userId) => ({ teamId: created.id, userId })),
      });
    }
    return tx.team.findUniqueOrThrow({
      where: { id: created.id },
      include: { leadUser: { select: memberSelect }, _count: { select: { members: true } } },
    });
  });

  await recordAudit({
    actor: req.auth!,
    action: "team.created",
    tenantId: tid,
    targetType: "Team",
    targetId: team.id,
    metadata: { name: team.name },
  });

  res.status(201).json({ team });
});

const updateSchema = teamSchema.omit({ memberIds: true }).partial().extend({ status: z.enum(["active", "inactive"]).optional() });

teamsRouter.patch("/:id", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const id = req.params.id as string;
  const data = parsed.data;

  const team = await prisma.team.findFirst({ where: { id, tenantId: tid } });
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  if (data.leadUserId) {
    const lead = await prisma.companyUser.findFirst({ where: { id: data.leadUserId, tenantId: tid } });
    if (!lead) {
      res.status(400).json({ error: "Team lead not found" });
      return;
    }
  }

  const updated = await prisma.team.update({
    where: { id },
    data: { ...data, updatedBy: req.auth!.userId },
    include: { leadUser: { select: memberSelect }, _count: { select: { members: true } } },
  });
  if (data.leadUserId) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: id, userId: data.leadUserId } },
      update: {},
      create: { teamId: id, userId: data.leadUserId },
    });
  }

  await recordAudit({
    actor: req.auth!,
    action: "team.updated",
    tenantId: tid,
    targetType: "Team",
    targetId: id,
    metadata: { changes: data },
  });

  res.json({ team: updated });
});

const memberSchema = z.object({ userId: z.string().min(1) });
const membersSchema = z.object({ userIds: z.array(z.string().min(1)) });

teamsRouter.put("/:id/members", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = membersSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "userIds must be an array" });
    return;
  }
  const tid = tenantId(req);
  const teamId = req.params.id as string;

  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId: tid } });
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const userIds = [...new Set([...parsed.data.userIds, ...(team.leadUserId ? [team.leadUserId] : [])])];
  if (userIds.length) {
    const validUsers = await prisma.companyUser.count({ where: { id: { in: userIds }, tenantId: tid } });
    if (validUsers !== userIds.length) {
      res.status(400).json({ error: "One or more selected employees do not belong to this company" });
      return;
    }
  }

  const previous = await prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } });
  const membershipChanges = [
    prisma.teamMember.deleteMany({ where: { teamId, userId: { notIn: userIds } } }),
    ...(userIds.length
      ? [prisma.teamMember.createMany({
          data: userIds.map((userId) => ({ teamId, userId })),
          skipDuplicates: true,
        })]
      : []),
  ];
  await prisma.$transaction(membershipChanges);

  const updated = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: {
      leadUser: { select: memberSelect },
      members: { include: { user: { select: memberSelect } }, orderBy: { joinedAt: "asc" } },
    },
  });

  await recordAudit({
    actor: req.auth!,
    action: "team.members_updated",
    tenantId: tid,
    targetType: "Team",
    targetId: teamId,
    metadata: { from: previous.map((member) => member.userId), to: userIds },
  });

  res.json({ team: updated });
});

teamsRouter.post("/:id/members", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const tid = tenantId(req);
  const teamId = req.params.id as string;

  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId: tid } });
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const user = await prisma.companyUser.findFirst({ where: { id: parsed.data.userId, tenantId: tid } });
  if (!user) {
    res.status(400).json({ error: "User not found in this company" });
    return;
  }

  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
  });
  if (existing) {
    res.status(409).json({ error: "User is already a member of this team" });
    return;
  }

  const member = await prisma.teamMember.create({
    data: { teamId, userId: user.id },
    include: { user: { select: memberSelect } },
  });

  await recordAudit({
    actor: req.auth!,
    action: "team.member_added",
    tenantId: tid,
    targetType: "Team",
    targetId: teamId,
    metadata: { userId: user.id, email: user.email },
  });

  res.status(201).json({ member });
});

teamsRouter.delete("/:id/members/:userId", requirePermission("company_settings", "manage"), async (req, res) => {
  const tid = tenantId(req);
  const teamId = req.params.id as string;
  const userId = req.params.userId as string;

  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId: tid } });
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
  if (!member) {
    res.status(404).json({ error: "Membership not found" });
    return;
  }

  await prisma.teamMember.delete({ where: { id: member.id } });

  await recordAudit({
    actor: req.auth!,
    action: "team.member_removed",
    tenantId: tid,
    targetType: "Team",
    targetId: teamId,
    metadata: { userId },
  });

  res.status(204).end();
});
