import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { AuthTokenPayload } from "./jwt.js";

export function recordAudit(params: {
  actor: AuthTokenPayload;
  action: string;
  tenantId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      actorId: params.actor.userId,
      actorKind: params.actor.kind,
      action: params.action,
      tenantId: params.tenantId,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
