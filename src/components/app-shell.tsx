import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { AppFrame } from "@/components/app-frame";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  return (
    <AppFrame user={{ name: session.user.name, role: session.user.role }} initialCollapsed={collapsed}>
      {children}
    </AppFrame>
  );
}
