import Link from "next/link";
import { KeyRound } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { LogoutButton } from "@/components/logout-button";
import { changePassword } from "@/lib/actions";
import { requireSession } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

/**
 * Outside the (app) group, so it has no sidebar: a page on its own, like
 * sign-in, that a user can be sent to before they may use anything else.
 */
export default async function ChangePasswordPage() {
  const session = await requireSession({ allowPasswordChange: true });
  const required = session.user.mustChangePassword;

  return (
    <main className="flex min-h-screen items-center justify-center bg-wash px-6 py-10">
      <div className="w-full max-w-sm rounded border border-line bg-panel p-6 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-mint text-teal">
            <KeyRound size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-ink">{required ? "Set your password" : "Change password"}</h1>
            <p className="truncate text-sm text-muted">{session.user.email}</p>
          </div>
          <LogoutButton />
        </div>
        {required ? (
          <p className="mb-4 rounded border border-line bg-wash px-3 py-2 text-sm text-ink">
            Your account was set up with a temporary password. Choose your own to continue.
          </p>
        ) : null}
        <ActionForm action={changePassword} className="space-y-4">
          <label className="label">
            {required ? "Temporary password" : "Current password"}
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
            {required ? "Set password" : "Change password"}
          </button>
          <p className="text-xs text-muted">You will be asked to sign in again with the new password.</p>
        </ActionForm>
        {required ? null : (
          <Link href="/dashboard" className="mt-4 block text-center text-sm font-semibold text-muted hover:text-ink">
            Back to the dashboard
          </Link>
        )}
      </div>
    </main>
  );
}
