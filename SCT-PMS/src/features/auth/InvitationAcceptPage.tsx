import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Field, Input, Logo } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { LoginPage } from "./LoginPage";

interface InvitationDetails {
  name: string;
  email: string;
  companyName: string;
  companyLogoUrl?: string | null;
  message?: string | null;
  expiresAt: string;
}

export function LoginOrInvitationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("invite");
  return token ? <InvitationAcceptPage token={token} /> : <LoginPage />;
}

function InvitationAcceptPage({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    api.getEmployeeInvitation(token)
      .then((result) => setInvitation(result.invitation))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Invitation could not be opened"))
      .finally(() => setLoading(false));
  }, [token]);

  const passwordValid = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);

  async function acceptInvitation(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!passwordValid) {
      setError("Use at least 8 characters with uppercase, lowercase, and a number");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      await api.acceptEmployeeInvitation(token, password);
      setAccepted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete onboarding");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <Card className="p-6 shadow-lg sm:p-8">
          {loading ? (
            <div className="py-10 text-center text-sm text-ink-500">Validating your invitation…</div>
          ) : accepted ? (
            <div className="py-4 text-center">
              <CheckCircle2 size={44} className="mx-auto text-success-600" />
              <h1 className="mt-4 text-xl font-bold text-ink-900">Your account is ready</h1>
              <p className="mt-2 text-sm text-ink-600">Your password has been set and this invitation can no longer be used.</p>
              <Link to="/login" className="mt-6 inline-block"><Button>Continue to sign in</Button></Link>
            </div>
          ) : error && !invitation ? (
            <div className="py-4 text-center">
              <ShieldCheck size={40} className="mx-auto text-danger-500" />
              <h1 className="mt-4 text-xl font-bold text-ink-900">Invitation unavailable</h1>
              <p className="mt-2 text-sm text-ink-600">{error}</p>
              <Link to="/login" className="mt-6 inline-block"><Button variant="outline">Back to sign in</Button></Link>
            </div>
          ) : invitation ? (
            <form onSubmit={acceptInvitation} className="space-y-5">
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><KeyRound size={22} /></div>
                <h1 className="mt-3 text-xl font-bold text-ink-900">Join {invitation.companyName}</h1>
                <p className="mt-1 text-sm text-ink-600">Welcome {invitation.name}. Set your password to activate <b>{invitation.email}</b>.</p>
              </div>
              {invitation.message && <div className="rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-3 text-sm text-ink-700">{invitation.message}</div>}
              {error && <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">{error}</div>}
              <Field label="Create password" required>
                <Input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" rightIcon={<button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>} />
              </Field>
              <div className="grid grid-cols-2 gap-1 text-xs text-ink-500">
                <span className={password.length >= 8 ? "text-success-600" : ""}>• 8+ characters</span>
                <span className={/[A-Z]/.test(password) ? "text-success-600" : ""}>• Uppercase</span>
                <span className={/[a-z]/.test(password) ? "text-success-600" : ""}>• Lowercase</span>
                <span className={/[0-9]/.test(password) ? "text-success-600" : ""}>• Number</span>
              </div>
              <Field label="Confirm password" required>
                <Input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
              </Field>
              <Button type="submit" className="w-full" disabled={saving || !password || !confirmPassword}>{saving ? "Activating account…" : "Activate account"}</Button>
              <p className="text-center text-xs text-ink-500">Invitation expires {new Date(invitation.expiresAt).toLocaleString()}.</p>
            </form>
          ) : null}
        </Card>
      </div>
    </div>
  );
}