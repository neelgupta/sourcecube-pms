import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthTokenPayload } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { hasPermission, type Action, type Module, type SystemRole } from "../lib/permissions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function requirePlatform(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.kind !== "platform") {
    res.status(403).json({ error: "SaaS Super Admin access required" });
    return;
  }
  next();
}

export function requireCompany(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.kind !== "company") {
    res.status(403).json({ error: "Company user access required" });
    return;
  }
  next();
}

export async function requireCompanySuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.kind !== "company") {
    res.status(403).json({ error: "Company user access required" });
    return;
  }
  const user = await prisma.companyUser.findUnique({ where: { id: req.auth.userId } });
  if (!user || !user.roles.includes("company_super_admin")) {
    res.status(403).json({ error: "Company Super Admin access required" });
    return;
  }
  next();
}

/** Matrix-driven permission check for company users. Caches nothing — always reads current roles from DB. */
export function requirePermission(module: Module, action: Action) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.kind !== "company") {
      res.status(403).json({ error: "Company user access required" });
      return;
    }
    const user = await prisma.companyUser.findUnique({ where: { id: req.auth.userId } });
    if (!user || !hasPermission(user.roles as SystemRole[], module, action)) {
      res.status(403).json({ error: `Missing permission: ${action} on ${module}` });
      return;
    }
    next();
  };
}
