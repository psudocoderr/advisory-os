import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import { requireSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/prospects", label: "Prospects", icon: UserPlus },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/plans", label: "Plans", icon: FileText },
  { href: "/reviews", label: "Reviews", icon: BarChart3 },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/certify", label: "Certification", icon: ClipboardCheck }
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const adminNav = session.user.role === "ADMIN" ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : [];
  const items = [...nav, ...adminNav];
  return (
    <div className="min-h-screen bg-wash">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-line bg-panel lg:flex lg:flex-col">
        <div className="border-b border-line px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-navy text-white">
              <Gauge size={18} />
            </div>
            <div>
              <div className="font-semibold text-ink">Advisory OS</div>
              <div className="mono text-[10px] uppercase tracking-widest text-muted">Internal MVP</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-wash hover:text-navy"
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded bg-wash p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-mint font-bold text-teal">
              {session.user.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{session.user.name}</div>
              <div className="mono text-[10px] uppercase text-muted">{session.user.role.toLowerCase()}</div>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>
      <main className="lg:pl-64">
        <div className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-navy text-white">
                <Gauge size={18} />
              </div>
              <div>
                <div className="font-semibold text-ink">Advisory OS</div>
                <div className="mono text-[10px] uppercase text-muted">{session.user.role.toLowerCase()}</div>
              </div>
            </div>
            <LogoutButton />
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex shrink-0 items-center gap-2 rounded border border-line bg-wash px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  <Icon size={14} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
