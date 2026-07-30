import { useState, type FormEvent } from "react";
import { CheckCircle2, Copy, Mail, UserPlus } from "lucide-react";
import { Button, Checkbox, Drawer, Field, Input, Textarea } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { CompanyUser, SystemRole, Team } from "@/types/tenant";

const EMPLOYEE_ROLES: { value: SystemRole; label: string; description: string }[] = [
  { value: "employee", label: "Employee", description: "Standard project and task access" },
  { value: "team_lead", label: "Team Lead", description: "Can coordinate team work" },
  { value: "project_manager", label: "Project Manager", description: "Can create and manage projects" },
  { value: "department_head", label: "Department Head", description: "Department-level oversight" },
  { value: "hr_admin", label: "HR Admin", description: "Employee and organization administration" },
  { value: "auditor", label: "Auditor", description: "Read-only reporting and audit access" },
  { value: "company_super_admin", label: "Company Super Admin", description: "Full company access" },
];

interface Props {
  open: boolean;
  teams: Team[];
  onClose: () => void;
  onCreated: (user: CompanyUser) => void;
}

export function AddEmployeeDrawer({ open, teams, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<SystemRole[]>(["employee"]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [sendInvite, setSendInvite] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName("");
    setEmail("");
    setRoles(["employee"]);
    setTeamIds([]);
    setSendInvite(true);
    setMessage("");
    setError(null);
    setInviteLink(null);
    setCopied(false);
  }

  function toggleRole(role: SystemRole) {
    setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  }

  function toggleTeam(teamId: string) {
    setTeamIds((current) => current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await api.createCompanyUser({
        name: name.trim(),
        email: email.trim(),
        roles,
        teamIds,
        sendInvite,
        invitationMessage: message.trim() || null,
      });
      onCreated(result.user);
      if (result.inviteToken) {
        setInviteLink(`${window.location.origin}/login?invite=${result.inviteToken}`);
      } else {
        reset();
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add employee");
    } finally {
      setSaving(false);
    }
  }

  async function copyInvite() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
  }

  return (
    <Drawer
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={
        <span className="flex items-center gap-2">
          <UserPlus size={18} className="text-brand-600" />
          Add employee
        </span>
      }
      width="max-w-2xl"
      footer={
        inviteLink ? (
          <>
            <Button variant="outline" onClick={copyInvite}>
              <Copy size={15} className="mr-1.5" />
              {copied ? "Copied" : "Copy invite link"}
            </Button>
            <Button onClick={() => { reset(); onClose(); }}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !name.trim() || !email.trim() || roles.length === 0}>
              {saving ? "Adding…" : sendInvite ? "Add & create invite" : "Add employee"}
            </Button>
          </>
        )
      }
    >
      {inviteLink ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-success-200 bg-success-50 p-5">
            <CheckCircle2 className="text-success-600" size={28} />
            <h3 className="mt-3 font-semibold text-ink-900">Employee added successfully</h3>
            <p className="mt-1 text-sm text-ink-600">
              Share this secure invitation link with {name}. It expires in 7 days.
            </p>
          </div>
          <Field label="Invitation link">
            <Input value={inviteLink} readOnly rightIcon={<Mail size={15} />} />
          </Field>
          <p className="text-xs text-ink-500">
            The employee can belong to other teams too. Open any team and select the same employee again.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee name" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" />
            </Field>
            <Field label="Work email" required>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
            </Field>
          </div>

          <Field label="Roles" hint="An employee may have more than one system role.">
            <div className="grid gap-2 rounded-xl border border-ink-200 p-3 sm:grid-cols-2">
              {EMPLOYEE_ROLES.map((role) => (
                <Checkbox
                  key={role.value}
                  checked={roles.includes(role.value)}
                  onChange={() => toggleRole(role.value)}
                  className="rounded-lg p-2 hover:bg-ink-50"
                  label={
                    <span>
                      <span className="block text-sm font-medium text-ink-800">{role.label}</span>
                      <span className="block text-xs text-ink-500">{role.description}</span>
                    </span>
                  }
                />
              ))}
            </div>
          </Field>

          <Field label="Assign to teams" hint="Select any number of teams. Membership is many-to-many.">
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-ink-200 p-3">
              {teams.length === 0 ? (
                <p className="px-1 py-2 text-sm text-ink-500">No teams created yet. You can assign teams later.</p>
              ) : teams.map((team) => (
                <Checkbox
                  key={team.id}
                  checked={teamIds.includes(team.id)}
                  onChange={() => toggleTeam(team.id)}
                  label={
                    <span>
                      <span className="font-medium text-ink-800">{team.name}</span>
                      {team.purpose && <span className="ml-2 text-xs text-ink-500">{team.purpose}</span>}
                    </span>
                  }
                  className="rounded-lg px-2 py-2 hover:bg-ink-50"
                />
              ))}
            </div>
          </Field>

          <div className="rounded-xl border border-ink-200 p-4">
            <Checkbox
              checked={sendInvite}
              onChange={(event) => setSendInvite(event.target.checked)}
              label={
                <span>
                  <span className="block font-medium text-ink-800">Create invitation</span>
                  <span className="block text-xs text-ink-500">Generate a secure 7-day joining link.</span>
                </span>
              }
            />
            {sendInvite && (
              <Field label="Welcome message" className="mt-4">
                <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} placeholder="Optional message for the employee" />
              </Field>
            )}
          </div>
        </form>
      )}
    </Drawer>
  );
}
