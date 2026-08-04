import type { SystemRole } from "@/types/tenant";

export type Module = "company_settings" | "company_users" | "projects" | "tasks" | "resources" | "chat";
export type Action = "view" | "create" | "edit" | "deactivate" | "approve" | "export" | "invite" | "manage";

/**
 * Predefined-role permission matrix — mirrors server/src/lib/permissions.ts.
 * Kept in sync manually since frontend and backend are separate deployables; the backend
 * is always the enforcement source of truth, this copy only drives UI (hiding nav/actions).
 */
const MATRIX: Record<SystemRole, Partial<Record<Module, Action[]>>> = {
  company_super_admin: {
    company_settings: ["manage"],
    company_users: ["manage"],
    projects: ["manage"],
    tasks: ["manage"],
    resources: ["manage"],
    chat: ["manage"],
  },
  hr_admin: {
    company_settings: ["view", "edit"],
    company_users: ["view", "create", "edit", "deactivate", "invite"],
    projects: ["view"],
    tasks: ["view"],
    resources: ["view", "export"],
    chat: ["view", "create", "invite"],
  },
  department_head: {
    company_settings: ["view"],
    company_users: ["view"],
    projects: ["view", "create", "edit", "approve"],
    tasks: ["view", "create", "edit", "approve"],
    resources: ["view"],
    chat: ["view", "create", "invite"],
  },
  team_lead: {
    company_settings: ["view"],
    company_users: ["view"],
    projects: ["view", "edit"],
    tasks: ["view", "create", "edit"],
    resources: ["view"],
    chat: ["view", "create", "invite"],
  },
  project_manager: {
    company_users: ["view"],
    projects: ["view", "create", "edit", "deactivate", "approve", "export", "manage"],
    tasks: ["view", "create", "edit", "approve", "export", "manage"],
    resources: ["view", "export"],
    chat: ["view", "create", "invite"],
  },
  employee: {
    projects: ["view"],
    tasks: ["view", "create", "edit"],
    resources: ["view", "edit"],
    chat: ["view", "create"],
  },
  auditor: {
    company_settings: ["view"],
    company_users: ["view"],
    projects: ["view", "export"],
    tasks: ["view", "export"],
    resources: ["view", "export"],
    chat: ["view"],
  },
};

export function hasPermission(roles: SystemRole[], module: Module, action: Action): boolean {
  return roles.some((role) => {
    const actions = MATRIX[role]?.[module];
    if (!actions) return false;
    return actions.includes("manage") || actions.includes(action);
  });
}
