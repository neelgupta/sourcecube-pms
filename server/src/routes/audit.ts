import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePlatform } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePlatform);

auditRouter.get("/", async (req, res) => {
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(action ? { action: { contains: action } } : {}),
    },
    include: { company: { select: { name: true, code: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  res.json({ logs });
});
