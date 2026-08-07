import { prisma } from "./prisma.js";
import { resolveOverdueApprover } from "./overdueReview.js";

/** Same routing as overdue-review approval: task creator (unless that's the assignee),
 *  falling back to the assignee's team lead, falling back to any active company_super_admin.
 *  Re-exported here so callers outside overdueReview.ts (e.g. re-estimate requests) share one
 *  approver-resolution policy instead of drifting copies. */
export const resolveApprover = resolveOverdueApprover;

/** Routes straight to an employee's team lead (no creator step) — used for work-log time-change
 *  requests, which the assignee's manager should review regardless of who created the task,
 *  falling back to any active company_super_admin if the employee has no team/lead assigned. */
export async function resolveTeamLead(tid: string, employeeId: string): Promise<string | null> {
  const membership = await prisma.teamMember.findFirst({
    where: { userId: employeeId, team: { tenantId: tid, leadUserId: { not: null } } },
    select: { team: { select: { leadUserId: true } } },
  });
  if (membership?.team.leadUserId) return membership.team.leadUserId;
  const superAdmin = await prisma.companyUser.findFirst({ where: { tenantId: tid, accountStatus: "active", roles: { has: "company_super_admin" } }, select: { id: true } });
  return superAdmin?.id ?? null;
}
