"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LOGIN_LIMITS, TOO_MANY_ATTEMPTS } from "@/lib/login-limits";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState(params.get("error") ? "Please check your credentials." : "");
  const changed = params.get("changed") === "1" && !error;
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = await signIn("credentials", {
        email: String(formData.get("email")),
        password: String(formData.get("password")),
        redirect: false
      });
      if (result?.ok) router.push("/dashboard");
      else if (result?.error === TOO_MANY_ATTEMPTS)
        setError(`Too many failed sign-ins. Try again in ${LOGIN_LIMITS.windowMinutes} minutes.`);
      else setError("Invalid email or password.");
    });
  }

  return (
    <form action={onSubmit} className="w-full max-w-sm rounded border border-line bg-panel p-6 shadow-soft">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-mint text-teal">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">Sign in</h1>
          <p className="text-sm text-muted">Use your staff account.</p>
        </div>
      </div>
      <div className="space-y-4">
        <label className="label">
          Email
          <input className="field" name="email" type="email" autoComplete="username" required />
        </label>
        <label className="label">
          Password
          <input className="field" name="password" type="password" autoComplete="current-password" required />
        </label>
        {changed ? (
          <div role="status" className="rounded border border-teal/20 bg-mint px-3 py-2 text-sm text-teal">
            Password changed. Sign in with your new password.
          </div>
        ) : null}
        {error ? (
          <div className="rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm text-rose">{error}</div>
        ) : null}
        <button
          className="w-full rounded bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink"
          disabled={pending}
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </div>
    </form>
  );
}
