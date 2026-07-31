import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Button, Checkbox, Field, Input, Logo, LogoMark } from "@/components/common";
import { useSession, ApiError } from "@/lib/session";

const highlights = [
  {
    icon: TrendingUp,
    title: "Real-time delivery insights",
    copy: "Track progress, burndown and workload across every project.",
  },
  {
    icon: Sparkles,
    title: "Automations that scale",
    copy: "Rules, recurring tasks and workflows that remove busywork.",
  },
  {
    icon: ShieldCheck,
    title: "Enterprise-grade governance",
    copy: "Granular roles, audit trails and approval gates by default.",
  },
];

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginPlatform, loginCompany } = useSession();
  const [portal, setPortal] = useState<"company" | "platform">("company");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (portal === "platform") {
        await loginPlatform(email, password);
        navigate("/saas", { replace: true });
      } else {
        await loginCompany(email, password);
        const from = (location.state as { from?: string } | null)?.from;
        navigate(from ?? "/dashboard", { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full bg-white">
      {/* ── Form column ───────────────────────────────────────────── */}
      <div className="flex w-full flex-col px-6 py-8 sm:px-12 lg:w-[48%] lg:px-16 xl:px-24">
        <Logo size={40} />

        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="mx-auto w-full max-w-[400px]">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Project Management Suite
            </span>

            <h1 className="mt-5 text-[2rem] font-bold leading-tight tracking-tight text-navy-900">
              Welcome back
            </h1>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-500">
              Sign in to your workspace to pick up exactly where you left off.
            </p>

            <div className="mt-6 inline-flex rounded-lg border border-ink-200 bg-surface-subtle p-1 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setPortal("company")}
                className={`rounded-md px-3.5 py-1.5 transition-colors ${portal === "company" ? "bg-white text-navy-900 shadow-sm" : "text-ink-500"}`}
              >
                Company sign in
              </button>
              <button
                type="button"
                onClick={() => setPortal("platform")}
                className={`rounded-md px-3.5 py-1.5 transition-colors ${portal === "platform" ? "bg-white text-navy-900 shadow-sm" : "text-ink-500"}`}
              >
                SaaS Super Admin
              </button>
            </div>

            {error && (
              <div className="mt-5 flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
                <AlertCircle size={16} className="shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <Field label="Work email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  leftIcon={<Mail size={16} />}
                  className="h-11"
                  required
                />
              </Field>

              <Field label="Password" required>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  leftIcon={<Lock size={16} />}
                  className="h-11"
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="text-ink-400 transition-colors hover:text-ink-700"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                  required
                />
              </Field>

              <div className="flex items-center justify-between pt-0.5">
                <Checkbox label="Keep me signed in" defaultChecked />
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
                >
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={loading}
                className="h-12 w-full justify-center text-[0.9375rem]"
                rightIcon={<ArrowRight size={17} />}
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <p className="mt-8 text-center text-sm text-ink-500">
              Have an invitation?{" "}
              <button
                type="button"
                disabled
                title="Invitation acceptance is delivered in Phase 11"
                className="font-semibold text-brand-600/50 cursor-not-allowed"
              >
                Set up your account
              </button>
            </p>
          </div>
        </div>

        <p className="text-xs text-ink-400">
          © {new Date().getFullYear()} Sourcecube Technologies. All rights reserved.
        </p>
      </div>

      {/* ── Brand column ──────────────────────────────────────────── */}
      <div className="relative hidden overflow-hidden bg-navy-900 lg:flex lg:w-[52%] lg:flex-col lg:justify-center lg:px-16 xl:px-20">
        {/* ambient brand glow */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-brand-400/10 blur-3xl" />
        {/* subtle grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />

        <div className="relative max-w-xl">
          <LogoMark size={52} />

          <h2 className="mt-8 text-[2.5rem] font-bold leading-[1.15] tracking-tight text-white">
            One workspace for every project, team and deadline.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-navy-100/80">
            Plan sprints, allocate resources and ship on time — with the clarity your leadership
            team expects.
          </p>

          <div className="mt-11 space-y-3.5">
            {highlights.map(({ icon: Icon, title, copy }) => (
              <div
                key={title}
                className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm transition-colors hover:bg-white/[0.09]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/20 text-brand-300">
                  <Icon size={19} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-navy-100/70">{copy}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-11 flex items-center gap-10 border-t border-white/10 pt-8">
            <Stat value="1,200+" label="Teams onboarded" />
            <Stat value="48k" label="Projects delivered" />
            <Stat value="99.9%" label="Uptime SLA" />
          </div>

          <p className="mt-8 flex items-center gap-2 text-xs text-navy-100/60">
            <CheckCircle2 size={14} className="text-brand-400" />
            SOC 2 Type II · ISO 27001 · GDPR ready
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[1.75rem] font-bold leading-none tracking-tight text-white">{value}</p>
      <p className="mt-1.5 text-xs text-navy-100/60">{label}</p>
    </div>
  );
}
