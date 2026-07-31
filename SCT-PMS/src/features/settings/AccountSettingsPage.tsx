import { useState, type FormEvent } from "react";
import { KeyRound, User as UserIcon } from "lucide-react";
import { Button, Card, Field, Input, MemberAvatar } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

export function AccountSettingsPage() {
  const { session } = useSession();
  const currentUser = session?.user;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    setSaving(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Password could not be changed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <div className="mb-5 flex items-center gap-3">
        <MemberAvatar id={currentUser?.id} name={currentUser?.name ?? "?"} size="lg" />
        <div>
          <h1 className="text-lg font-semibold text-ink-900">{currentUser?.name ?? "Account"}</h1>
          <p className="text-xs text-ink-500">{currentUser?.email}</p>
        </div>
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-ink-200 px-6 py-4">
          <UserIcon size={16} className="text-ink-400" />
          <p className="text-sm font-semibold text-ink-900">Profile</p>
        </div>
        <div className="grid grid-cols-2 gap-4 p-6">
          <Field label="Name"><Input value={currentUser?.name ?? ""} disabled /></Field>
          <Field label="Email"><Input value={currentUser?.email ?? ""} disabled /></Field>
        </div>
      </Card>

      <Card className="mt-5">
        <div className="flex items-center gap-2 border-b border-ink-200 px-6 py-4">
          <KeyRound size={16} className="text-ink-400" />
          <p className="text-sm font-semibold text-ink-900">Change password</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && (
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">{error}</div>
          )}
          {saved && !error && (
            <div className="rounded-lg border border-success-200 bg-success-50 px-3.5 py-2.5 text-sm text-success-700">Password updated.</div>
          )}
          <Field label="Current password" required>
            <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="New password" required hint="At least 8 characters">
            <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={8} />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={8} />
          </Field>
          <div className="flex justify-end border-t border-ink-200 pt-5">
            <Button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
              {saving ? "Updating…" : "Update password"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
