import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { permissionsForRoles, type SystemRole } from "../lib/permissions.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000,
};

const NON_LOGINABLE_STATUSES = new Set(["not_invited", "invitation_pending", "invite_expired", "suspended", "deactivated"]);

authRouter.post("/login/platform", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password format" });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.platformUser.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken({ kind: "platform", userId: user.id });
  res.cookie("token", token, COOKIE_OPTS);
  res.json({ user: { id: user.id, name: user.name, email: user.email, kind: "platform", role: user.role } });
});

authRouter.post("/login/company", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password format" });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.companyUser.findFirst({ where: { email }, include: { company: true } });
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (NON_LOGINABLE_STATUSES.has(user.accountStatus)) {
    res.status(403).json({ error: "Account is not active", accountStatus: user.accountStatus });
    return;
  }

  if (user.company.status === "suspended" || user.company.status === "deactivated") {
    res.status(403).json({ error: "Company account is not active", companyStatus: user.company.status });
    return;
  }

  const token = signToken({ kind: "company", userId: user.id, tenantId: user.tenantId });
  res.cookie("token", token, COOKIE_OPTS);
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      kind: "company",
      roles: user.roles,
      accountStatus: user.accountStatus,
      tenantId: user.tenantId,
    },
    company: user.company,
    permissions: permissionsForRoles(user.roles as SystemRole[]),
  });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  if (req.auth!.kind === "platform") {
    const user = await prisma.platformUser.findUnique({ where: { id: req.auth!.userId } });
    if (!user) {
      res.status(401).json({ error: "Session no longer valid" });
      return;
    }
    res.json({ user: { id: user.id, name: user.name, email: user.email, kind: "platform", role: user.role } });
    return;
  }

  const user = await prisma.companyUser.findUnique({ where: { id: req.auth!.userId }, include: { company: true } });
  if (!user) {
    res.status(401).json({ error: "Session no longer valid" });
    return;
  }
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      kind: "company",
      roles: user.roles,
      accountStatus: user.accountStatus,
      tenantId: user.tenantId,
    },
    company: user.company,
    permissions: permissionsForRoles(user.roles as SystemRole[]),
  });
});
