import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { getSmtpEmailSetting, publicSmtpSetting, sendSmtpEmail, upsertSmtpEmailSetting } from "../lib/smtp.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireCompany);

function tenantId(req: { auth?: { kind: string; tenantId?: string } }): string {
  return (req.auth as { tenantId: string }).tenantId;
}

settingsRouter.get("/", requirePermission("company_settings", "view"), async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: tenantId(req) },
    include: { _count: { select: { companyUsers: true } } },
  });
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  let smtpSettings = null;
  try {
    smtpSettings = await getSmtpEmailSetting(tenantId(req));
  } catch {
    smtpSettings = null;
  }
  res.json({ company, smtpSettings: publicSmtpSetting(smtpSettings) });
});

const settingsSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().optional(),
  logoUrl: z.string().optional(),
  country: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  fiscalYearStart: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .optional(),
  legalName: z.string().optional(),
  taxId: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  contactEmail: z.string().email().or(z.literal("")).optional(),
  contactPhone: z.string().optional(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
});

settingsRouter.patch("/", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const company = await prisma.company.update({
    where: { id: tid },
    data: { ...parsed.data, updatedBy: req.auth!.userId },
  });

  await recordAudit({
    actor: req.auth!,
    action: "company_settings.updated",
    tenantId: tid,
    targetType: "Company",
    targetId: tid,
    metadata: { changes: parsed.data },
  });

  let smtpSettings = null;
  try {
    smtpSettings = await getSmtpEmailSetting(tenantId(req));
  } catch {
    smtpSettings = null;
  }
  res.json({ company, smtpSettings: publicSmtpSetting(smtpSettings) });
});

const smtpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().max(255).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  security: z.enum(["TLS", "SSL", "NONE"]).default("TLS"),
  username: z.string().trim().max(255).nullable().optional(),
  password: z.string().max(500).nullable().optional(),
  senderEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  senderName: z.string().trim().max(120).nullable().optional(),
  defaultRecipients: z.array(z.string().trim().email()).default([]),
});

settingsRouter.patch("/smtp", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = smtpSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const data = parsed.data;
  const smtpSettings = await upsertSmtpEmailSetting(tenantId(req), {
    enabled: data.enabled,
    host: data.host?.trim() || null,
    port: data.port ?? null,
    security: data.security,
    username: data.username?.trim() || null,
    password: data.password === "" ? undefined : data.password,
    senderEmail: data.senderEmail?.trim() || null,
    senderName: data.senderName?.trim() || null,
    defaultRecipients: data.defaultRecipients,
  });

  await recordAudit({
    actor: req.auth!,
    action: "company_settings.smtp_updated",
    tenantId: tenantId(req),
    targetType: "Company",
    targetId: tenantId(req),
    metadata: { enabled: data.enabled, host: data.host, port: data.port, security: data.security, username: data.username, senderEmail: data.senderEmail, senderName: data.senderName, defaultRecipients: data.defaultRecipients.length },
  });

  res.json({ smtpSettings: publicSmtpSetting(smtpSettings) });
});

const smtpTestSchema = z.object({ recipientEmail: z.string().trim().email().optional() });

settingsRouter.post("/smtp/test", requirePermission("company_settings", "manage"), async (req, res) => {
  const parsed = smtpTestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const setting = await getSmtpEmailSetting(tid);
  if (!setting) {
    res.status(400).json({ error: "SMTP settings are not configured" });
    return;
  }
  const company = await prisma.company.findUnique({ where: { id: tid }, select: { name: true, contactEmail: true } });
  const to = parsed.data.recipientEmail || setting.defaultRecipients[0] || company?.contactEmail || setting.senderEmail;
  if (!to) {
    res.status(400).json({ error: "Add a test recipient or default recipient email" });
    return;
  }
  try {
    await sendSmtpEmail(setting, {
      to: [to],
      subject: `SMTP test from ${company?.name ?? "SCT PMS"}`,
      text: `SMTP email settings are working for ${company?.name ?? "your company"}.`,
      html: `<p>SMTP email settings are working for <strong>${company?.name ?? "your company"}</strong>.</p>`,
    });
    await prisma.$executeRawUnsafe('UPDATE "SmtpEmailSetting" SET "lastTestedAt" = CURRENT_TIMESTAMP, "lastTestStatus" = $2, "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = $1', tid, "success");
    const updated = await getSmtpEmailSetting(tid);
    res.json({ ok: true, smtpSettings: publicSmtpSetting(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP test failed";
    await prisma.$executeRawUnsafe('UPDATE "SmtpEmailSetting" SET "lastTestedAt" = CURRENT_TIMESTAMP, "lastTestStatus" = $2, "lastError" = $3, "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = $1', tid, "failed", message.slice(0, 1000));
    res.status(400).json({ error: message });
  }
});