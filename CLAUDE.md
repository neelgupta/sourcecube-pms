# SCT-PMS — Project Notes for Claude

Multi-tenant SaaS Project Management System.
- Backend: `server/` — Express 5 + Prisma (PostgreSQL) + TypeScript. See [server/BACKEND.md](server/BACKEND.md) for schema, routes, and the role/permission model.
- Frontend: `SCT-PMS/` — React 19 + Vite + TypeScript + Tailwind 4. See [SCT-PMS/FRONTEND.md](SCT-PMS/FRONTEND.md) for routing, session/permission hooks, and feature-folder conventions.

Read the relevant MD file before making non-trivial changes in that half of the stack — they reflect the actual current schema/routes/components, not aspirational design.

## Role/permission model (short version)
Two identity planes: `PlatformUser` (SaaS admins) and `CompanyUser` (tenant employees, one or more `SystemRole`s: `company_super_admin`, `hr_admin`, `department_head`, `team_lead`, `project_manager`, `employee`, `auditor`). A permission matrix (`Module` × `Action`) is enforced server-side (`server/src/lib/permissions.ts` + `requirePermission` middleware) and mirrored client-side for UI hiding only. Projects/tasks additionally have row-level access (ownership, membership, department, team-lead scoping) — see BACKEND.md §3.

**Any feature request should be considered against this role model on both server and client** — use the `pms-feature` skill for feature/endpoint/screen work so nothing gets built single-layer.

## Known things to double check locally
- Backend defaults to port `4000`; frontend's `VITE_API_URL` default is `http://localhost:4100/api`. Confirm they match your local `.env`.
- No `server/.env.example` is committed — required vars: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `CLIENT_ORIGIN`.
