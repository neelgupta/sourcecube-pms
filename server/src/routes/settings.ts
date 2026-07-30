import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompany, requirePermission } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

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
  res.json({ company });
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

  res.json({ company });
});
