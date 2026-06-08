"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="inline-flex h-8 w-8 items-center justify-center rounded border border-line text-muted hover:bg-wash hover:text-ink"
      title="Sign out"
    >
      <LogOut size={15} />
    </button>
  );
}
