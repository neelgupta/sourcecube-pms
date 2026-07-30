import { useEffect, useMemo, useState } from "react";
import { Plus, Users2 } from "lucide-react";
import { Badge, Button, Card, SearchBar } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { usePermission } from "@/lib/session";
import type { CompanyUser, Team } from "@/types/tenant";
import { CreateTeamDrawer } from "./components/CreateTeamDrawer";
import { TeamDetailDrawer } from "./components/TeamDetailDrawer";

export function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const canManage = usePermission("company_settings", "manage");

  function load() {
    Promise.all([api.listTeams(), api.listCompanyUsers()])
      .then(([teamRes, userRes]) => {
        setTeams(teamRes.teams);
        setCompanyUsers(userRes.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load teams"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(
    () => teams.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase())),
    [teams, search],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-700">
          <Users2 size={18} className="text-brand-600" />
          <span className="text-lg font-bold text-ink-900">{filtered.length}</span> Teams
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search teams" className="w-56" />
          {canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} className="mr-1.5" />
              Create team
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

        {loading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <Card className="px-6 py-10 text-center text-sm text-ink-500">No teams match your search.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((team) => (
              <Card
                key={team.id}
                className="cursor-pointer p-4 transition-shadow hover:shadow-md"
                onClick={() => setSelectedTeamId(team.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <Users2 size={18} />
                  </div>
                  <Badge tone={team.status === "active" ? "green" : "neutral"}>{team.status}</Badge>
                </div>
                <h3 className="mt-3 font-semibold text-ink-900">{team.name}</h3>
                {team.purpose && <p className="mt-1 line-clamp-2 text-xs text-ink-500">{team.purpose}</p>}
                <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                  <span>{team.leadUser ? `Led by ${team.leadUser.name}` : "No lead assigned"}</span>
                  <span className="font-medium text-ink-700">{team._count?.members ?? 0} members</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreateTeamDrawer open={createOpen} companyUsers={companyUsers} onClose={() => setCreateOpen(false)} onCreated={load} />
      <TeamDetailDrawer teamId={selectedTeamId} companyUsers={companyUsers} onClose={() => setSelectedTeamId(null)} onChanged={load} />
    </div>
  );
}
