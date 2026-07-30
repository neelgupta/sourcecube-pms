import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import type { SystemRole } from "../lib/permissions.js";
import { invitationsRouter } from "./invitations.js";

export const companyUsersRouter = Router();
companyUsersRouter.use("/invitations", invitationsRouter);
companyUsersRouter.use(requireAuth, requireCompany);

const ROLES: SystemRole[] = ["company_super_admin", "hr_admin", "department_head", "team_lead", "project_manager", "employee", "auditor"];

function tenantId(req: { auth?: { kind: string; tenantId?: string } }): string {
  return (req.auth as { tenantId: string }).tenantId;
}

companyUsersRouter.get("/", requirePermission("company_users", "view"), async (req, res) => {
  const users = await prisma.companyUser.findMany({
    where: { tenantId: tenantId(req) },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      roles: true,
      accountStatus: true,
      teamMemberships: {
        select: {
          team: { select: { id: true, name: true, status: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

const createEmployeeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  roles: z.array(z.enum(ROLES as [SystemRole, ...SystemRole[]])).min(1).default(["employee"]),
  teamIds: z.array(z.string().min(1)).default([]),
  sendInvite: z.boolean().default(true),
  invitationMessage: z.string().trim().max(500).nullable().optional(),
});

companyUsersRouter.post("/", requirePermission("company_users", "create"), async (req, res) => {
  const parsed = createEmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }

  const tid = tenantId(req);
  const data = parsed.data;
  const email = data.email.toLowerCase();
  const uniqueTeamIds = [...new Set(data.teamIds)];

  const [company, existing, teams] = await Promise.all([
    prisma.company.findUnique({ where: { id: tid }, select: { employeeSeatLimit: true } }),
    prisma.companyUser.findFirst({ where: { tenantId: tid, email } }),
    uniqueTeamIds.length
      ? prisma.team.findMany({ where: { tenantId: tid, id: { in: uniqueTeamIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  if (existing) {
    res.status(409).json({ error: "An employee with this email already exists" });
    return;
  }
  if (teams.length !== uniqueTeamIds.length) {
    res.status(400).json({ error: "One or more selected teams do not belong to this company" });
    return;
  }
  if (company) {
    const employeeCount = await prisma.companyUser.count({ where: { tenantId: tid, accountStatus: { not: "deactivated" } } });
    if (employeeCount >= company.employeeSeatLimit) {
      res.status(409).json({ error: `Employee seat limit reached (${company.employeeSeatLimit})` });
      return;
    }
  }

  const inviteToken = data.sendInvite ? crypto.randomBytes(24).toString("hex") : null;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.companyUser.create({
      data: {
        tenantId: tid,
        name: data.name,
        email,
        roles: data.roles,
        accountStatus: data.sendInvite ? "invitation_pending" : "not_invited",
        createdBy: req.auth!.userId,
        updatedBy: req.auth!.userId,
      },
    });

    if (uniqueTeamIds.length) {
      await tx.teamMember.createMany({
        data: uniqueTeamIds.map((teamId) => ({ teamId, userId: created.id })),
      });
    }

    if (inviteToken) {
      await tx.invitation.create({
        data: {
          tenantId: tid,
          companyUserId: created.id,
          token: inviteToken,
          expiresAt,
          message: data.invitationMessage ?? null,
        },
      });
    }

    return tx.companyUser.findUniqueOrThrow({
      where: { id: created.id },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        roles: true,
        accountStatus: true,
        teamMemberships: {
          select: { team: { select: { id: true, name: true, status: true } } },
          orderBy: { joinedAt: "asc" },
        },
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  await recordAudit({
    actor: req.auth!,
    action: data.sendInvite ? "company_user.created_and_invited" : "company_user.created",
    tenantId: tid,
    targetType: "CompanyUser",
    targetId: user.id,
    metadata: { email: user.email, roles: user.roles, teamIds: uniqueTeamIds },
  });

  res.status(201).json({ user, inviteToken, inviteExpiresAt: inviteToken ? expiresAt : null });
});

companyUsersRouter.post("/:id/invite", requirePermission("company_users", "invite"), async (req, res) => {
  const tid = tenantId(req);
  const userId = req.params.id as string;
  const target = await prisma.companyUser.findFirst({ where: { id: userId, tenantId: tid } });
  if (!target) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  if (target.accountStatus === "active") {
    res.status(409).json({ error: "This employee has already joined" });
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.invitation.updateMany({
      where: { tenantId: tid, companyUserId: target.id, status: { in: ["sent", "opened"] } },
      data: { status: "revoked" },
    }),
    prisma.invitation.create({
      data: { tenantId: tid, companyUserId: target.id, token, expiresAt },
    }),
    prisma.companyUser.update({
      where: { id: target.id },
      data: { accountStatus: "invitation_pending", updatedBy: req.auth!.userId },
    }),
  ]);

  await recordAudit({
    actor: req.auth!,
    action: "company_user.invitation_sent",
    tenantId: tid,
    targetType: "CompanyUser",
    targetId: target.id,
    metadata: { email: target.email, expiresAt: expiresAt.toISOString() },
  });

  res.json({ token, expiresAt });
});

const updateRolesSchema = z.object({
  roles: z.array(z.enum(ROLES as [SystemRole, ...SystemRole[]])).min(1),
});

companyUsersRouter.patch("/:id/roles", requirePermission("company_users", "edit"), async (req, res) => {
  const parsed = updateRolesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "At least one valid role is required" });
    return;
  }

  const tid = tenantId(req);
  const userId = req.params.id as string;
  const target = await prisma.companyUser.findFirst({ where: { id: userId, tenantId: tid } });
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Protect company_super_admin from unauthorized removal: can't strip the role from
  // the last remaining super admin in the tenant.
  const losingSuperAdmin = target.roles.includes("company_super_admin") && !parsed.data.roles.includes("company_super_admin");
  if (losingSuperAdmin) {
    const tenantUsers = await prisma.companyUser.findMany({ where: { tenantId: tid }, select: { id: true, roles: true } });
    const otherSuperAdmins = tenantUsers.filter(
      (u) => u.id !== target.id && u.roles.includes("company_super_admin"),
    ).length;
    if (otherSuperAdmins === 0) {
      res.status(400).json({ error: "Cannot remove the last Company Super Admin" });
      return;
    }
  }

  const updated = await prisma.companyUser.update({
    where: { id: target.id },
    data: { roles: parsed.data.roles, updatedBy: req.auth!.userId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      roles: true,
      accountStatus: true,
      teamMemberships: {
        select: { team: { select: { id: true, name: true, status: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  await recordAudit({
    actor: req.auth!,
    action: "company_user.roles_changed",
    tenantId: tid,
    targetType: "CompanyUser",
    targetId: target.id,
    metadata: { from: target.roles, to: parsed.data.roles },
  });

  res.json({ user: updated });
});
