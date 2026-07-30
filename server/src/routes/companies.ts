import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePlatform } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

export const companiesRouter = Router();
companiesRouter.use(requireAuth, requirePlatform);

const LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  provisioning: ["invitation_pending", "deactivated"],
  invitation_pending: ["trial", "active", "deactivated"],
  trial: ["active", "suspended", "deactivated"],
  active: ["suspended", "deactivated"],
  suspended: ["active", "deactivated"],
  deactivated: [],
};

companiesRouter.get("/", async (_req, res) => {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { companyUsers: true } } },
  });

  const stats = {
    total: companies.length,
    active: companies.filter((c) => c.status === "active").length,
    trial: companies.filter((c) => c.status === "trial").length,
    suspended: companies.filter((c) => c.status === "suspended").length,
    totalUsers: companies.reduce((sum, c) => sum + c._count.companyUsers, 0),
  };

  res.json({ companies, stats });
});

companiesRouter.get("/:id", async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: {
      companyUsers: {
        select: {
          id: true,
          tenantId: true,
          name: true,
          email: true,
          roles: true,
          accountStatus: true,
          createdBy: true,
          updatedBy: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  res.json({ company });
});

const createCompanySchema = z.object({
  name: z.string().min(1),
  code: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/, "Code must be uppercase letters/numbers"),
  domain: z.string().optional(),
  country: z.string().min(1),
  timezone: z.string().min(1),
  currency: z.string().min(1),
  fiscalYearStart: z.string().regex(/^\d{2}-\d{2}$/, "Use MM-DD format"),
  plan: z.enum(["starter", "growth", "enterprise"]),
  employeeSeatLimit: z.number().int().positive(),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
});

companiesRouter.post("/", async (req, res) => {
  const parsed = createCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const data = parsed.data;

  const existing = await prisma.company.findUnique({ where: { code: data.code } });
  if (existing) {
    res.status(409).json({ error: "Company code already in use" });
    return;
  }

  const company = await prisma.company.create({
    data: {
      name: data.name,
      code: data.code,
      domain: data.domain,
      country: data.country,
      timezone: data.timezone,
      currency: data.currency,
      fiscalYearStart: data.fiscalYearStart,
      plan: data.plan,
      employeeSeatLimit: data.employeeSeatLimit,
      status: "invitation_pending",
      enabledModules: ["projects", "resources", "tasks"],
      createdBy: req.auth!.userId,
      updatedBy: req.auth!.userId,
    },
  });

  // First Company Super Admin: created with a one-time invitation token, no password yet.
  const inviteToken = crypto.randomBytes(24).toString("hex");
  const tempPasswordHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);

  const adminUser = await prisma.companyUser.create({
    data: {
      tenantId: company.id,
      name: data.adminName,
      email: data.adminEmail,
      passwordHash: tempPasswordHash,
      roles: ["company_super_admin"],
      accountStatus: "invitation_pending",
      createdBy: req.auth!.userId,
      updatedBy: req.auth!.userId,
    },
  });

  await prisma.invitation.create({
    data: {
      tenantId: company.id,
      companyUserId: adminUser.id,
      token: inviteToken,
      status: "sent",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Every tenant gets one announcement channel automatically — readable by all active
  // employees (see chatRouter's channel-listing OR clause), postable only by a super admin.
  await prisma.chatChannel.create({
    data: { tenantId: company.id, type: "announcement", name: "Announcements", createdBy: req.auth!.userId },
  });

  await recordAudit({
    actor: req.auth!,
    action: "company.created",
    tenantId: company.id,
    targetType: "Company",
    targetId: company.id,
    metadata: { name: company.name, code: company.code, adminEmail: data.adminEmail },
  });

  const { passwordHash: _passwordHash, ...adminUserSafe } = adminUser;
  res.status(201).json({ company, adminUser: adminUserSafe, inviteToken });
});

const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().optional(),
  country: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  fiscalYearStart: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .optional(),
  plan: z.enum(["starter", "growth", "enterprise"]).optional(),
  employeeSeatLimit: z.number().int().positive().optional(),
  enabledModules: z.array(z.string()).optional(),
});

companiesRouter.patch("/:id", async (req, res) => {
  const parsed = updateCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  const updated = await prisma.company.update({
    where: { id: req.params.id },
    data: { ...parsed.data, updatedBy: req.auth!.userId },
  });

  await recordAudit({
    actor: req.auth!,
    action: "company.updated",
    tenantId: company.id,
    targetType: "Company",
    targetId: company.id,
    metadata: { changes: parsed.data },
  });

  res.json({ company: updated });
});

function generateStrongPassword(): string {
  // 16 chars, mixed alphanumeric + symbols, avoids ambiguous characters.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

companiesRouter.post("/:id/users/:userId/generate-password", async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  const companyUser = await prisma.companyUser.findFirst({
    where: { id: req.params.userId, tenantId: req.params.id },
  });
  if (!companyUser) {
    res.status(404).json({ error: "Company user not found" });
    return;
  }

  const password = generateStrongPassword();
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.companyUser.update({
    where: { id: companyUser.id },
    data: { passwordHash, accountStatus: "active", updatedBy: req.auth!.userId },
  });

  await prisma.invitation.updateMany({
    where: { companyUserId: companyUser.id, status: "sent" },
    data: { status: "accepted" },
  });

  await recordAudit({
    actor: req.auth!,
    action: "company_user.password_generated",
    tenantId: company.id,
    targetType: "CompanyUser",
    targetId: companyUser.id,
    metadata: { email: companyUser.email },
  });

  res.json({ email: companyUser.email, password });
});

const statusChangeSchema = z.object({ status: z.enum(["provisioning", "invitation_pending", "trial", "active", "suspended", "deactivated"]) });

companiesRouter.post("/:id/status", async (req, res) => {
  const parsed = statusChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  const allowed = LIFECYCLE_TRANSITIONS[company.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    res.status(400).json({ error: `Cannot transition from ${company.status} to ${parsed.data.status}` });
    return;
  }

  const updated = await prisma.company.update({
    where: { id: req.params.id },
    data: { status: parsed.data.status, updatedBy: req.auth!.userId },
  });

  await recordAudit({
    actor: req.auth!,
    action: `company.status_changed`,
    tenantId: company.id,
    targetType: "Company",
    targetId: company.id,
    metadata: { from: company.status, to: parsed.data.status },
  });

  res.json({ company: updated });
});
