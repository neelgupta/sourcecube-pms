import { useEffect, useState } from "react";
import { Save, Trash2, Users2 } from "lucide-react";
import { Badge, Button, Checkbox, Drawer, MemberAvatar } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { usePermission } from "@/lib/session";
import type { CompanyUser, TeamDetail, TeamStatus } from "@/types/tenant";

interface Props {
  teamId: string | null;
  companyUsers: CompanyUser[];
  onClose: () => void;
  onChanged: () => void;
}

export function TeamDetailDrawer({ teamId, companyUsers, onClose, onChanged }: Props) {
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [savingMembers, setSavingMembers] = useState(false);
  const canManage = usePermission("company_settings", "manage");

  function load() {
    if (!teamId) return;
    setLoading(true);
    api
      .getTeam(teamId)
      .then((result) => {
        setTeam(result.team);
        setSelectedMemberIds(result.team.members.map((member) => member.userId));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load team"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!teamId) {
      setTeam(null);
      return;
    }
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  async function saveMemberAssignments() {
    if (!team) return;
    setError(null);
    setSavingMembers(true);
    try {
      await api.replaceTeamMembers(team.id, selectedMemberIds);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save team members");
    } finally {
      setSavingMembers(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!team) return;
    setError(null);
    try {
      await api.removeTeamMember(team.id, userId);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove member");
    }
  }

  async function toggleStatus() {
    if (!team) return;
    try {
      const next: TeamStatus = team.status === "active" ? "inactive" : "active";
      await api.updateTeam(team.id, { status: next });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status");
    }
  }

  return (
    <Drawer open={!!teamId} onClose={onClose} title="Team details" width="max-w-2xl">
      {loading && <p className="text-sm text-ink-500">Loading…</p>}
      {error && (
        <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}
      {team && (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Users2 size={20} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink-900">{team.name}</h3>
                {team.purpose && <p className="text-xs text-ink-500">{team.purpose}</p>}
              </div>
            </div>
            <Badge tone={team.status === "active" ? "green" : "neutral"}>{team.status}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-lg border border-ink-200 p-4 text-sm">
            <div>
              <p className="text-xs text-ink-500">Team lead</p>
              <p className="mt-0.5 font-medium text-ink-900">{team.leadUser?.name ?? "Unassigned"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Members</p>
              <p className="mt-0.5 font-medium text-ink-900">{team.members.length}</p>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Members ({team.members.length})
            </h4>

            {canManage && (
              <div className="mb-4 rounded-xl border border-ink-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink-800">Assign employees</p>
                    <p className="text-xs text-ink-500">The same employee can also belong to other teams.</p>
                  </div>
                  <Button size="sm" onClick={saveMemberAssignments} disabled={savingMembers}>
                    <Save size={14} className="mr-1.5" />
                    {savingMembers ? "Saving…" : "Save"}
                  </Button>
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {companyUsers.map((user) => {
                    const isLead = team.leadUserId === user.id;
                    return (
                      <Checkbox
                        key={user.id}
                        checked={selectedMemberIds.includes(user.id) || isLead}
                        disabled={isLead}
                        onChange={() => setSelectedMemberIds((current) =>
                          current.includes(user.id)
                            ? current.filter((id) => id !== user.id)
                            : [...current, user.id],
                        )}
                        label={
                          <span>
                            <span className="font-medium text-ink-800">{user.name}</span>
                            <span className="ml-2 text-xs text-ink-500">{user.email}</span>
                            {isLead && <span className="ml-2 text-xs text-brand-600">Team lead</span>}
                          </span>
                        }
                        className="rounded-lg px-2 py-2 hover:bg-ink-50"
                      />
                    );
                  })}
                  {companyUsers.length === 0 && <p className="py-2 text-sm text-ink-500">No employees available.</p>}
                </div>
              </div>
            )}

            <div className="divide-y divide-ink-100 rounded-lg border border-ink-200 bg-white">
              {team.members.length === 0 && <p className="px-3.5 py-3 text-sm text-ink-500">No members yet.</p>}
              {team.members.map((member) => (
                <div key={member.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm hover:bg-surface-subtle/70">
                  <div className="flex min-w-0 items-center gap-3">
                    <MemberAvatar id={member.userId} name={member.user.name} size="md" status={member.user.accountStatus === "active" ? "active" : "inactive"} className="ring-0" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{member.user.name}</p>
                      <p className="truncate text-xs text-ink-500">{member.user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={member.user.accountStatus === "active" ? "green" : "amber"}>
                      {member.user.accountStatus}
                    </Badge>
                    {canManage && team.leadUserId !== member.userId && (
                      <button
                        onClick={() => handleRemoveMember(member.userId)}
                        className="rounded p-1 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                        title="Remove from team"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {canManage && (
            <Button variant="outline" onClick={toggleStatus}>
              {team.status === "active" ? "Mark inactive" : "Mark active"}
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}
