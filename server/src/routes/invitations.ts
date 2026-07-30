import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { recordAudit } from "../lib/audit.js";

export const invitationsRouter = Router();

invitationsRouter.get("/:token", async (req, res) => {
  const token = req.params.token as string;
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: {
      company: { select: { name: true, logoUrl: true } },
      companyUser: { select: { name: true, email: true, accountStatus: true } },
    },
  });

  if (!invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  if (invitation.status === "accepted" || invitation.companyUser.accountStatus === "active") {
    res.status(409).json({ error: "This invitation has already been accepted", code: "INVITE_ACCEPTED" });
    return;
  }
  if (invitation.status === "revoked") {
    res.status(410).json({ error: "This invitation has been revoked", code: "INVITE_REVOKED" });
    return;
  }
  if (invitation.status === "expired" || invitation.expiresAt <= new Date()) {
    await prisma.$transaction([
      prisma.invitation.update({ where: { id: invitation.id }, data: { status: "expired" } }),
      prisma.companyUser.update({
        where: { id: invitation.companyUserId },
        data: { accountStatus: "invite_expired" },
      }),
    ]);
    res.status(410).json({ error: "This invitation has expired", code: "INVITE_EXPIRED" });
    return;
  }

  if (invitation.status === "sent") {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "opened" } });
  }

  res.json({
    invitation: {
      name: invitation.companyUser.name,
      email: invitation.companyUser.email,
      companyName: invitation.company.name,
      companyLogoUrl: invitation.company.logoUrl,
      message: invitation.message,
      expiresAt: invitation.expiresAt,
    },
  });
});

const acceptInvitationSchema = z.object({
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number"),
});

invitationsRouter.post("/:token/accept", async (req, res) => {
  const parsed = acceptInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(", ") });
    return;
  }

  const token = req.params.token as string;
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  try {
    const accepted = await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { token },
        include: { companyUser: true, company: { select: { status: true } } },
      });
      if (!invitation) throw new Error("INVITE_NOT_FOUND");
      if (invitation.status === "accepted" || invitation.companyUser.accountStatus === "active") {
        throw new Error("INVITE_ACCEPTED");
      }
      if (invitation.status === "revoked") throw new Error("INVITE_REVOKED");
      if (invitation.status === "expired" || invitation.expiresAt <= new Date()) throw new Error("INVITE_EXPIRED");
      if (invitation.company.status === "suspended" || invitation.company.status === "deactivated") {
        throw new Error("COMPANY_INACTIVE");
      }

      const claim = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: { in: ["sent", "opened"] },
          expiresAt: { gt: new Date() },
        },
        data: { status: "accepted" },
      });
      if (claim.count !== 1) throw new Error("INVITE_UNAVAILABLE");

      const user = await tx.companyUser.update({
        where: { id: invitation.companyUserId },
        data: {
          passwordHash,
          accountStatus: "active",
          updatedBy: invitation.companyUserId,
        },
        select: { id: true, tenantId: true, name: true, email: true, roles: true, accountStatus: true },
      });

      await tx.invitation.updateMany({
        where: {
          companyUserId: user.id,
          id: { not: invitation.id },
          status: { in: ["sent", "opened"] },
        },
        data: { status: "revoked" },
      });

      return user;
    });

    await recordAudit({
      actor: { kind: "company", userId: accepted.id, tenantId: accepted.tenantId },
      action: "company_user.invitation_accepted",
      tenantId: accepted.tenantId,
      targetType: "CompanyUser",
      targetId: accepted.id,
      metadata: { email: accepted.email },
    });

    res.json({ user: accepted });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVITE_UNAVAILABLE";
    const responses: Record<string, { status: number; message: string }> = {
      INVITE_NOT_FOUND: { status: 404, message: "Invitation not found" },
      INVITE_ACCEPTED: { status: 409, message: "This invitation has already been accepted" },
      INVITE_REVOKED: { status: 410, message: "This invitation has been revoked" },
      INVITE_EXPIRED: { status: 410, message: "This invitation has expired" },
      COMPANY_INACTIVE: { status: 403, message: "This company account is not active" },
      INVITE_UNAVAILABLE: { status: 409, message: "This invitation is no longer available" },
    };
    const response = responses[code] ?? responses.INVITE_UNAVAILABLE;
    res.status(response.status).json({ error: response.message, code });
  }
});
