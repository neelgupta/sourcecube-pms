---
name: pms-feature
description: Use whenever the user asks to add, change, or fix a feature/endpoint/screen in the SCT-PMS project (backend Express/Prisma or frontend React). Ensures every change is threaded through the existing multi-tenant role/permission system on both server and client, the way a senior MERN engineer would, instead of a narrow single-layer patch.
---

# PMS Feature Development

This project is a multi-tenant SaaS PMS with two identity planes (`PlatformUser`, `CompanyUser`) and 7 `SystemRole`s enforced by a permission matrix on both server and client. Read `server/BACKEND.md` and `SCT-PMS/FRONTEND.md` first if you haven't already loaded them this session — they are the ground-truth reference for schema, routes, and conventions.

When asked to build or change a feature, work through this checklist. Don't skip steps because the user's request only mentioned one layer — a "senior dev" answer touches every layer that's actually affected.

## 1. Identify who's affected
Before writing code, determine:
- Which `Module` does this touch? (`company_settings`, `company_users`, `projects`, `tasks`, `resources` — or does it need a new one?)
- Which roles should be able to do this, and with which `Action` (`view/create/edit/deactivate/approve/export/invite/manage`)? Check the existing matrix in `server/src/lib/permissions.ts` — don't guess, read it.
- Is this a **project/task** resource? If so it also needs row-level scoping (ownership/membership/department/team-lead), not just the module matrix — see `projectReadScope`/`projectAccessLevel` in `server/src/routes/projects.ts`.
- Does this cross tenant boundaries at all? If yes, it almost certainly shouldn't (flag it back to the user).

If the required role/permission mapping isn't obvious from the request, make the sensible call based on the existing matrix's pattern (e.g. `company_super_admin` and `manage`-level roles can always do everything) rather than blocking — but call out the assumption in your summary.

## 2. Backend changes
- Prisma schema changes → new migration (`npx prisma migrate dev --name <desc>`), then update `server/prisma/seed.ts` if seed data is affected.
- New/changed route → apply `requireAuth` + `requireCompany`/`requirePlatform` + `requirePermission(module, action)`, in that order, matching sibling routes' style.
- Mutating endpoint → call `recordAudit()` with an action name following the existing `"resource.verb"` convention (e.g. `"project.archived"`).
- Any tenant-scoped query → filter by `req.auth.tenantId` explicitly. Never trust a client-supplied tenantId.
- If it's a project/task endpoint, reuse or extend `projectAccessLevel`/`canEditTaskForProject` rather than writing a parallel authorization path.
- Update `server/BACKEND.md` if you added a new module, role, or route family (not for every minor endpoint — use judgment).

## 3. Frontend changes
- New API call → typed function in `SCT-PMS/src/lib/api.ts`, never raw `fetch` in a feature component.
- New/changed screen → gate it with `usePermission(module, action)` matching what the backend now enforces, and add/update the route guard in `src/app/router.tsx` (`requireKind`/`requiredPermission`).
- Update `src/components/layout/Sidebar.tsx` nav entry's `requires` if navigation should be hidden/shown per role.
- For project/task UI, combine `usePermission` with the backend's `currentUserAccess` field the same way `ProjectsPage.tsx` does — don't rely on the module flag alone.
- If you changed the backend permission matrix, mirror the exact same change in `SCT-PMS/src/lib/permissions.ts` immediately.
- New/changed response shape → add/update the type in `SCT-PMS/src/types/tenant.ts` (real backend-driven types), not `types/index.ts` (legacy mock types), unless you're deliberately working on a still-mocked screen.

## 4. Sanity pass before calling it done
Ask yourself, and briefly report to the user:
- Which roles can now do this, and which can't — does that match intent?
- Did both the server permission check and the client-side gate get updated, or just one?
- For anything project/task-scoped: does row-level access (ownership/team/department) still correctly restrict it, or did the change accidentally widen visibility?
- Is the change tenant-isolated (no cross-company leakage)?

Keep this pass short — a few bullet points, not a formal audit — unless the change is security-sensitive enough to warrant more.
