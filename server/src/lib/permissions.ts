export type Module = "company_settings" | "company_users" | "projects" | "tasks" | "resources" | "chat";
export type Action = "view" | "create" | "edit" | "deactivate" | "approve" | "export" | "invite" | "manage";
export type SystemRole =
  | "company_super_admin"
  | "hr_admin"
  | "department_head"
  | "team_lead"
  | "project_manager"
  | "employee"
  | "auditor";

/**
 * Predefined-role permission matrix. "manage" on a module implies all other actions for it.
 * Only modules with a real backend today (company_settings, company_users) are enforced server-side;
 * projects/tasks/resources have no API yet (frontend mock data) so those rows are enforced client-side only.
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
    resources: ["view"],
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

export function permissionsForRoles(roles: SystemRole[]): Record<Module, Action[]> {
  const modules: Module[] = ["company_settings", "company_users", "projects", "tasks", "resources", "chat"];
  const result = {} as Record<Module, Action[]>;
  for (const module of modules) {
    const allActions: Action[] = ["view", "create", "edit", "deactivate", "approve", "export", "invite", "manage"];
    result[module] = allActions.filter((action) => hasPermission(roles, module, action));
  }
  return result;
}
