import { useEffect, useState } from "react";
import { Ban, Building2, Check, CheckCircle2, Copy, KeyRound, Pause, Play, Users } from "lucide-react";
import { Badge, Button, CompanyStatusBadge, Drawer, Modal } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { Company, CompanyStatus, CompanyUser } from "@/types/tenant";

interface Props {
  companyId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const LIFECYCLE_ACTIONS: Partial<Record<CompanyStatus, { label: string; to: CompanyStatus; icon: typeof Play; danger?: boolean }[]>> = {
  invitation_pending: [{ label: "Activate", to: "active", icon: Play }],
  trial: [
    { label: "Activate", to: "active", icon: Play },
    { label: "Suspend", to: "suspended", icon: Pause, danger: true },
  ],
  active: [
    { label: "Suspend", to: "suspended", icon: Pause, danger: true },
    { label: "Deactivate", to: "deactivated", icon: Ban, danger: true },
  ],
  suspended: [
    { label: "Reactivate", to: "active", icon: CheckCircle2 },
    { label: "Deactivate", to: "deactivated", icon: Ban, danger: true },
  ],
};

export function CompanyDetailDrawer({ companyId, onClose, onChanged }: Props) {
  const [company, setCompany] = useState<(Company & { companyUsers: CompanyUser[] }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ label: string; to: CompanyStatus } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [pendingPasswordUser, setPendingPasswordUser] = useState<CompanyUser | null>(null);
  const [generatedCredential, setGeneratedCredential] = useState<{ email: string; password: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setCompany(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getCompany(companyId)
      .then((res) => setCompany(res.company))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load company"))
      .finally(() => setLoading(false));
  }, [companyId]);

  async function confirmAction() {
    if (!company || !pendingAction) return;
    setActionLoading(true);
    try {
      const res = await api.setCompanyStatus(company.id, pendingAction.to);
      setCompany({ ...company, status: res.company.status });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status");
    } finally {
      setActionLoading(false);
      setPendingAction(null);
    }
  }

  async function confirmGeneratePassword() {
    if (!company || !pendingPasswordUser) return;
    setPasswordLoading(true);
    try {
      const res = await api.generateCompanyUserPassword(company.id, pendingPasswordUser.id);
      setGeneratedCredential(res);
      setCompany({
        ...company,
        companyUsers: company.companyUsers.map((u) =>
          u.id === pendingPasswordUser.id ? { ...u, accountStatus: "active" } : u,
        ),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate password");
    } finally {
      setPasswordLoading(false);
      setPendingPasswordUser(null);
    }
  }

  const actions = company ? (LIFECYCLE_ACTIONS[company.status] ?? []) : [];

  return (
    <>
      <Drawer open={!!companyId} onClose={onClose} title="Company details" width="max-w-2xl">
        {loading && <p className="text-sm text-ink-500">Loading…</p>}
        {error && (
          <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}
        {company && (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-ink-900">{company.name}</h3>
                  <p className="text-xs text-ink-500">
                    {company.code} · {company.domain ?? "no domain set"}
                  </p>
                </div>
              </div>
              <CompanyStatusBadge status={company.status} />
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-lg border border-ink-200 p-4 text-sm">
              <Detail label="Country" value={company.country} />
              <Detail label="Timezone" value={company.timezone} />
              <Detail label="Currency" value={company.currency} />
              <Detail label="Fiscal year start" value={company.fiscalYearStart} />
              <Detail label="Plan" value={<Badge tone="purple">{company.plan}</Badge>} />
              <Detail
                label="Seats"
                value={`${company.companyUsers.length} / ${company.employeeSeatLimit}`}
              />
            </div>

            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                <Users size={13} />
                Company users ({company.companyUsers.length})
              </h4>
              <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                {company.companyUsers.length === 0 && (
                  <p className="px-3.5 py-3 text-sm text-ink-500">No users yet.</p>
                )}
                {company.companyUsers.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
                    <div>
                      <p className="font-medium text-ink-900">{u.name}</p>
                      <p className="text-xs text-ink-500">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{u.roles.join(", ")}</Badge>
                      <Badge tone={u.accountStatus === "active" ? "green" : "amber"}>{u.accountStatus}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingPasswordUser(u)}
                        title="Generate a new password for this admin"
                      >
                        <KeyRound size={13} className="mr-1.5" />
                        Generate password
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {actions.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Lifecycle actions
                </h4>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <Button
                      key={a.to}
                      variant={a.danger ? "outline" : "primary"}
                      className={a.danger ? "border-danger-200 text-danger-600 hover:bg-danger-50" : ""}
                      onClick={() => setPendingAction({ label: a.label, to: a.to })}
                    >
                      <a.icon size={15} className="mr-1.5" />
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={!!pendingAction}
        onClose={() => setPendingAction(null)}
        title={`${pendingAction?.label} ${company?.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingAction(null)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button onClick={confirmAction} disabled={actionLoading}>
              {actionLoading ? "Working…" : `Confirm ${pendingAction?.label}`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This changes the tenant status for <strong>{company?.name}</strong> and will be recorded in the platform
          audit log.
          {pendingAction?.to === "suspended" && " Company users will not be able to sign in while suspended."}
          {pendingAction?.to === "deactivated" && " This company will lose access until reactivated."}
        </p>
      </Modal>

      <Modal
        open={!!pendingPasswordUser}
        onClose={() => setPendingPasswordUser(null)}
        title="Generate new password?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingPasswordUser(null)} disabled={passwordLoading}>
              Cancel
            </Button>
            <Button onClick={confirmGeneratePassword} disabled={passwordLoading}>
              {passwordLoading ? "Generating…" : "Generate password"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          This creates a new password for <strong>{pendingPasswordUser?.email}</strong> and activates their account
          if it isn't active yet. Their previous password (if any) will stop working immediately. This action is
          recorded in the platform audit log.
        </p>
      </Modal>

      <Modal
        open={!!generatedCredential}
        onClose={() => {
          setGeneratedCredential(null);
          setCopied(false);
        }}
        title="Password generated"
        size="sm"
        footer={
          <Button
            onClick={() => {
              setGeneratedCredential(null);
              setCopied(false);
            }}
          >
            Done
          </Button>
        }
      >
        <p className="mb-3 text-sm text-ink-600">
          Share this password with <strong>{generatedCredential?.email}</strong> securely. It will not be shown
          again.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-surface-subtle px-3.5 py-2.5">
          <code className="flex-1 select-all break-all font-mono text-sm text-ink-900">
            {generatedCredential?.password}
          </code>
          <button
            type="button"
            onClick={async () => {
              if (!generatedCredential) return;
              await navigator.clipboard.writeText(generatedCredential.password);
              setCopied(true);
            }}
            className="shrink-0 rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
            title="Copy password"
          >
            {copied ? <Check size={15} className="text-success-600" /> : <Copy size={15} />}
          </button>
        </div>
      </Modal>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-0.5 font-medium text-ink-900">{value}</p>
    </div>
  );
}
