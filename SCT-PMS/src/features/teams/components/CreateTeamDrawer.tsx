import { useState, type FormEvent } from "react";
import { Users2 } from "lucide-react";
import { Button, Checkbox, Drawer, Field, Input, MemberAvatar, Select, Textarea } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { CompanyUser } from "@/types/tenant";

interface Props {
  open: boolean;
  companyUsers: CompanyUser[];
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTeamDrawer({ open, companyUsers, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [leadUserId, setLeadUserId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.createTeam({ name, purpose: purpose || null, leadUserId: leadUserId || null, memberIds });
      setName("");
      setPurpose("");
      setLeadUserId("");
      setMemberIds([]);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Users2 size={18} className="text-brand-600" />
          Create team
        </span>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? "Creating…" : "Create team"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}

        <Field label="Team name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Purpose" hint="What this team is responsible for">
          <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} />
        </Field>
        <Field label="Team lead">
          <Select value={leadUserId} onChange={(e) => setLeadUserId(e.target.value)}>
            <option value="">Unassigned</option>
            {companyUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team members" hint="Employees can be selected in multiple teams.">
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-ink-200 p-3">
            {companyUsers.length === 0 ? (
              <p className="px-1 py-2 text-sm text-ink-500">Add employees from Team &amp; Roles first.</p>
            ) : companyUsers.map((user) => (
              <Checkbox
                key={user.id}
                checked={memberIds.includes(user.id) || leadUserId === user.id}
                disabled={leadUserId === user.id}
                onChange={() => setMemberIds((current) =>
                  current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id],
                )}
                label={
                  <span className="flex min-w-0 items-center gap-3">
                    <MemberAvatar id={user.id} name={user.name} size="sm" status={user.accountStatus === "active" ? "active" : "inactive"} className="ring-0" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-800">{user.name}</span>
                      <span className="block truncate text-xs text-ink-500">{user.email}</span>
                    </span>
                    {leadUserId === user.id && <span className="ml-auto shrink-0 text-xs text-brand-600">Team lead</span>}
                  </span>
                }
                className="rounded-lg px-2 py-2 hover:bg-ink-50"
              />
            ))}
          </div>
        </Field>
      </form>
    </Drawer>
  );
}
