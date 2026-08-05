import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireCompanySuperAdmin } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";

export const onboardingRouter = Router();
onboardingRouter.use(requireAuth, requireCompanySuperAdmin);

function tenantId(req: { auth?: { kind: string; tenantId?: string } }): string {
  return (req.auth as { tenantId: string }).tenantId;
}

const STEP_KEYS = ["profile", "schedule", "departments", "designations", "holidays", "leaveTypes"] as const;
type StepKey = (typeof STEP_KEYS)[number];

async function getOrCreateOnboarding(tid: string) {
  const existing = await prisma.onboardingState.findUnique({ where: { tenantId: tid } });
  if (existing) return existing;
  return prisma.onboardingState.create({ data: { tenantId: tid, steps: {} } });
}

async function markStepComplete(tid: string, step: StepKey) {
  const state = await getOrCreateOnboarding(tid);
  const steps = { ...(state.steps as Record<string, boolean>), [step]: true };
  const allDone = STEP_KEYS.every((k) => steps[k]);
  return prisma.onboardingState.update({
    where: { tenantId: tid },
    data: { steps, completedAt: allDone ? new Date() : null },
  });
}

// ── Progress ──────────────────────────────────────────────
onboardingRouter.get("/progress", async (req, res) => {
  const state = await getOrCreateOnboarding(tenantId(req));
  res.json({ state });
});

// ── Company profile (branding + regional) ────────────────
const profileSchema = z.object({
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
});

onboardingRouter.patch("/profile", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const company = await prisma.company.update({
    where: { id: tid },
    data: { ...parsed.data, updatedBy: req.auth!.userId },
  });
  await markStepComplete(tid, "profile");
  await recordAudit({ actor: req.auth!, action: "onboarding.profile_updated", tenantId: tid, targetType: "Company", targetId: tid });
  res.json({ company });
});

// ── Working schedule ──────────────────────────────────────
const scheduleSchema = z.object({
  name: z.string().min(1).default("Standard"),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.number().int().min(0),
  breakStartTime: z.string().regex(/^\d{2}:\d{2}$/).default("14:00"),
  breakEndTime: z.string().regex(/^\d{2}:\d{2}$/).default("14:30"),
});

onboardingRouter.get("/schedules", async (req, res) => {
  const schedules = await prisma.workingSchedule.findMany({ where: { tenantId: tenantId(req) } });
  res.json({ schedules });
});

onboardingRouter.post("/schedules", async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const schedule = await prisma.workingSchedule.upsert({
    where: { tenantId_name: { tenantId: tid, name: parsed.data.name } },
    update: { ...parsed.data, updatedBy: req.auth!.userId },
    create: { ...parsed.data, tenantId: tid, createdBy: req.auth!.userId, updatedBy: req.auth!.userId },
  });
  await markStepComplete(tid, "schedule");
  await recordAudit({ actor: req.auth!, action: "onboarding.schedule_saved", tenantId: tid, targetType: "WorkingSchedule", targetId: schedule.id });
  res.status(201).json({ schedule });
});

// ── Departments ────────────────────────────────────────────
onboardingRouter.get("/departments", async (req, res) => {
  const departments = await prisma.department.findMany({ where: { tenantId: tenantId(req) }, orderBy: { name: "asc" } });
  res.json({ departments });
});

onboardingRouter.post("/departments", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Department name is required" });
    return;
  }
  const tid = tenantId(req);
  const existing = await prisma.department.findUnique({ where: { tenantId_name: { tenantId: tid, name: parsed.data.name } } });
  if (existing) {
    res.status(409).json({ error: "Department already exists" });
    return;
  }
  const department = await prisma.department.create({
    data: { tenantId: tid, name: parsed.data.name, createdBy: req.auth!.userId, updatedBy: req.auth!.userId },
  });
  await markStepComplete(tid, "departments");
  await recordAudit({ actor: req.auth!, action: "onboarding.department_created", tenantId: tid, targetType: "Department", targetId: department.id });
  res.status(201).json({ department });
});

onboardingRouter.delete("/departments/:id", async (req, res) => {
  const tid = tenantId(req);
  const department = await prisma.department.findFirst({ where: { id: req.params.id, tenantId: tid } });
  if (!department) {
    res.status(404).json({ error: "Department not found" });
    return;
  }
  await prisma.department.delete({ where: { id: department.id } });
  await recordAudit({ actor: req.auth!, action: "onboarding.department_deleted", tenantId: tid, targetType: "Department", targetId: department.id });
  res.status(204).end();
});

// ── Designations ───────────────────────────────────────────
onboardingRouter.get("/designations", async (req, res) => {
  const designations = await prisma.designation.findMany({ where: { tenantId: tenantId(req) }, orderBy: { title: "asc" } });
  res.json({ designations });
});

onboardingRouter.post("/designations", async (req, res) => {
  const parsed = z.object({ title: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Designation title is required" });
    return;
  }
  const tid = tenantId(req);
  const existing = await prisma.designation.findUnique({ where: { tenantId_title: { tenantId: tid, title: parsed.data.title } } });
  if (existing) {
    res.status(409).json({ error: "Designation already exists" });
    return;
  }
  const designation = await prisma.designation.create({
    data: { tenantId: tid, title: parsed.data.title, createdBy: req.auth!.userId, updatedBy: req.auth!.userId },
  });
  await markStepComplete(tid, "designations");
  await recordAudit({ actor: req.auth!, action: "onboarding.designation_created", tenantId: tid, targetType: "Designation", targetId: designation.id });
  res.status(201).json({ designation });
});

onboardingRouter.delete("/designations/:id", async (req, res) => {
  const tid = tenantId(req);
  const designation = await prisma.designation.findFirst({ where: { id: req.params.id, tenantId: tid } });
  if (!designation) {
    res.status(404).json({ error: "Designation not found" });
    return;
  }
  await prisma.designation.delete({ where: { id: designation.id } });
  await recordAudit({ actor: req.auth!, action: "onboarding.designation_deleted", tenantId: tid, targetType: "Designation", targetId: designation.id });
  res.status(204).end();
});

// ── Holidays ───────────────────────────────────────────────
const holidaySchema = z.object({
  name: z.string().min(1),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  type: z.enum(["national", "regional", "company"]).default("company"),
  optional: z.boolean().default(false),
});

onboardingRouter.get("/holidays", async (req, res) => {
  const holidays = await prisma.holiday.findMany({ where: { tenantId: tenantId(req) }, orderBy: { date: "asc" } });
  res.json({ holidays });
});

onboardingRouter.post("/holidays", async (req, res) => {
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const holiday = await prisma.holiday.create({
    data: { tenantId: tid, name: parsed.data.name, date: new Date(parsed.data.date), type: parsed.data.type, optional: parsed.data.optional, createdBy: req.auth!.userId },
  });
  await markStepComplete(tid, "holidays");
  await recordAudit({ actor: req.auth!, action: "onboarding.holiday_created", tenantId: tid, targetType: "Holiday", targetId: holiday.id });
  res.status(201).json({ holiday });
});

onboardingRouter.delete("/holidays/:id", async (req, res) => {
  const tid = tenantId(req);
  const holiday = await prisma.holiday.findFirst({ where: { id: req.params.id, tenantId: tid } });
  if (!holiday) {
    res.status(404).json({ error: "Holiday not found" });
    return;
  }
  await prisma.holiday.delete({ where: { id: holiday.id } });
  await recordAudit({ actor: req.auth!, action: "onboarding.holiday_deleted", tenantId: tid, targetType: "Holiday", targetId: holiday.id });
  res.status(204).end();
});

// ── Leave types ────────────────────────────────────────────
const leaveTypeSchema = z.object({
  name: z.string().min(1),
  annualQuota: z.number().int().min(0),
  paid: z.boolean().default(true),
  carryForward: z.boolean().default(false),
});

onboardingRouter.get("/leave-types", async (req, res) => {
  const leaveTypes = await prisma.leaveType.findMany({ where: { tenantId: tenantId(req) }, orderBy: { name: "asc" } });
  res.json({ leaveTypes });
});

onboardingRouter.post("/leave-types", async (req, res) => {
  const parsed = leaveTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(", ") });
    return;
  }
  const tid = tenantId(req);
  const existing = await prisma.leaveType.findUnique({ where: { tenantId_name: { tenantId: tid, name: parsed.data.name } } });
  if (existing) {
    res.status(409).json({ error: "Leave type already exists" });
    return;
  }
  const leaveType = await prisma.leaveType.create({
    data: { tenantId: tid, ...parsed.data, createdBy: req.auth!.userId, updatedBy: req.auth!.userId },
  });
  await markStepComplete(tid, "leaveTypes");
  await recordAudit({ actor: req.auth!, action: "onboarding.leave_type_created", tenantId: tid, targetType: "LeaveType", targetId: leaveType.id });
  res.status(201).json({ leaveType });
});

onboardingRouter.delete("/leave-types/:id", async (req, res) => {
  const tid = tenantId(req);
  const leaveType = await prisma.leaveType.findFirst({ where: { id: req.params.id, tenantId: tid } });
  if (!leaveType) {
    res.status(404).json({ error: "Leave type not found" });
    return;
  }
  await prisma.leaveType.delete({ where: { id: leaveType.id } });
  await recordAudit({ actor: req.auth!, action: "onboarding.leave_type_deleted", tenantId: tid, targetType: "LeaveType", targetId: leaveType.id });
  res.status(204).end();
});
