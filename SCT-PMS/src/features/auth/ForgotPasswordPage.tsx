import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mail } from "lucide-react";
import { Button, Field, Input, Logo } from "@/components/common";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Email delivery is out of scope until a transactional email provider is wired up (see project notes).
    setSent(true);
  }

  return (
    <div className="flex h-full items-center justify-center bg-white px-6">
      <div className="w-full max-w-[400px]">
        <Logo size={40} />
        <h1 className="mt-8 text-2xl font-bold tracking-tight text-navy-900">Reset your password</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          {sent
            ? "If an account exists for that email, a reset link has been sent."
            : "Enter your work email and we'll send you a link to reset your password."}
        </p>

        {!sent && (
          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <Field label="Work email" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@sourcecube.com"
                leftIcon={<Mail size={16} />}
                className="h-11"
                required
              />
            </Field>
            <Button type="submit" size="lg" className="h-12 w-full justify-center">
              Send reset link
            </Button>
          </form>
        )}

        <button
          onClick={() => navigate("/login")}
          className="mt-7 flex items-center gap-1.5 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
        >
          <ArrowLeft size={15} />
          Back to sign in
        </button>
      </div>
    </div>
  );
}
