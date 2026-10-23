import Link from "next/link";
import { KeyRound } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { changePassword } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

/**
 * Outside the (app) group, so it has no sidebar: a page on its own, like
 * sign-in, that a user can be sent to before they may use anything else.
 */
export default async function ChangePasswordPage() {
  const session = await requireSession();

  return (
    <main className="flex min-h-screen items-center justify-center bg-wash px-6 py-10">
      <div className="w-full max-w-sm rounded border border-line bg-panel p-6 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-mint text-teal">
            <KeyRound size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink">Change password</h1>
            <p className="truncate text-sm text-muted">{session.user.email}</p>
          </div>
        </div>
        <ActionForm action={changePassword} success="Password changed." className="space-y-4">
          <label className="label">
            Current password
            <input className="field" name="current" type="password" autoComplete="current-password" required />
          </label>
          <label className="label">
            New password
            <input
              className="field"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <span className="mt-1 block text-xs font-normal text-muted">
              At least {MIN_PASSWORD_LENGTH} characters.
            </span>
          </label>
          <label className="label">
            Confirm new password
            <input
              className="field"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </label>
          <button className="w-full rounded bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink">
            Change password
          </button>
        </ActionForm>
        <Link href="/dashboard" className="mt-4 block text-center text-sm font-semibold text-muted hover:text-ink">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
