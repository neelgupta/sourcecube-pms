import { useEffect, useState } from "react";
import { Copy, Mail, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { Badge, Button, Card, DataTable, Modal, SearchBar, type Column } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { usePermission, useSession } from "@/lib/session";
import type { CompanyUser, SystemRole, Team } from "@/types/tenant";
import { RoleEditor } from "./components/RoleEditor";
import { AddEmployeeDrawer } from "./components/AddEmployeeDrawer";

const ROLE_LABELS: Record<SystemRole, string> = {
  company_super_admin: "Company Super Admin",
  hr_admin: "HR Admin",
  department_head: "Department Head",
  team_lead: "Team Lead",
  project_manager: "Project Manager",
  employee: "Employee",
  auditor: "Auditor",
};

export function TeamRolesPage() {
  const { session } = useSession();
  const currentUserId = session?.user.kind === "company" ? session.user.id : "";
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const canEdit = usePermission("company_users", "edit");
  const canCreate = usePermission("company_users", "create");
  const canInvite = usePermission("company_users", "invite");
  const canViewTeams = usePermission("company_settings", "view");

  function load() {
    Promise.all([
      api.listCompanyUsers(),
      canViewTeams ? api.listTeams() : Promise.resolve({ teams: [] }),
    ])
      .then(([userResult, teamResult]) => {
        setUsers(userResult.users);
        setTeams(teamResult.teams);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load team"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [canViewTeams]);

  const filteredUsers = users.filter((user) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [user.name, user.email, ...user.roles, ...(user.teamMemberships?.map((membership) => membership.team.name) ?? [])]
      .some((value) => value.toLowerCase().includes(query));
  });

  async function inviteEmployee(user: CompanyUser) {
    setError(null);
    try {
      const result = await api.inviteCompanyUser(user.id);
      setInviteLink(`${window.location.origin}/login?invite=${result.token}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create invitation");
    }
  }

  async function toggleStatus(user: CompanyUser) {
    setError(null);
    setStatusBusyId(user.id);
    const next = user.accountStatus === "deactivated" || user.accountStatus === "suspended" ? "active" : "deactivated";
    try {
      const result = await api.updateCompanyUserStatus(user.id, next);
      setUsers((prev) => prev.map((u) => (u.id === result.user.id ? result.user : u)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update account status");
    } finally {
      setStatusBusyId(null);
    }
  }

  const columns: Column<CompanyUser>[] = [
    {
      key: "name",
      header: "Name",
      render: (u) => (
        <div>
          <p className="font-medium text-ink-900">{u.name}</p>
          <p className="text-xs text-ink-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      render: (u) => (
        <div className="flex flex-wrap gap-1.5">
          {u.roles.map((r) => (
            <Badge key={r} tone={r === "company_super_admin" ? "purple" : "neutral"}>
              {ROLE_LABELS[r]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "teams",
      header: "Teams",
      render: (u) => (
        <div className="flex flex-wrap gap-1.5">
          {u.teamMemberships?.length ? u.teamMemberships.map((membership) => (
            <Badge key={membership.team.id} tone="blue">{membership.team.name}</Badge>
          )) : <span className="text-xs text-ink-400">Not assigned</span>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => <Badge tone={u.accountStatus === "active" ? "green" : "amber"}>{u.accountStatus}</Badge>,
    },
    {
      key: "actions",
      header: "",
      width: "220px",
      render: (u) => {
        const isSelf = u.id === currentUserId;
        return canEdit || (canInvite && u.accountStatus !== "active") ? (
          <div className="flex justify-end gap-2">
            {canInvite && u.accountStatus !== "active" && (
              <Button variant="outline" size="sm" onClick={() => inviteEmployee(u)}>
                <Mail size={13} className="mr-1.5" />
                Invite
              </Button>
            )}
            {canEdit && (
              <RoleEditor
                user={u}
                onChanged={(updated) => setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
              />
            )}
            {canEdit && !isSelf && (
              <Button
                variant="outline"
                size="sm"
                disabled={statusBusyId === u.id}
                onClick={() => toggleStatus(u)}
                title={u.accountStatus === "deactivated" || u.accountStatus === "suspended" ? "Activate employee" : "Deactivate employee"}
              >
                {u.accountStatus === "deactivated" || u.accountStatus === "suspended" ? (
                  <UserCheck size={13} />
                ) : (
                  <UserX size={13} />
                )}
              </Button>
            )}
          </div>
        ) : null;
      },
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-brand-600" />
          <p className="text-sm font-medium text-ink-700">
            <span className="text-lg font-bold text-ink-900">{filteredUsers.length}</span> Employees &amp; roles
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search employees" className="w-56" />
          {canCreate && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={16} className="mr-1.5" />
              Add employee
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 p-4 lg:p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={filteredUsers}
            rowKey={(u) => u.id}
            emptyMessage={loading ? "Loading…" : "No team members yet"}
          />
        </Card>
      </div>

      <AddEmployeeDrawer
        open={addOpen}
        teams={teams}
        onClose={() => setAddOpen(false)}
        onCreated={(user) => setUsers((current) => [...current, user])}
      />

      <Modal
        open={!!inviteLink}
        onClose={() => setInviteLink(null)}
        title="Employee invitation"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setInviteLink(null)}>Close</Button>
            <Button onClick={async () => {
              if (inviteLink) await navigator.clipboard.writeText(inviteLink);
            }}>
              <Copy size={14} className="mr-1.5" />
              Copy link
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-600">Share this secure link with the employee. It expires in 7 days.</p>
        <div className="break-all rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs text-ink-700">{inviteLink}</div>
      </Modal>
    </div>
  );
}
