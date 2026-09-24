"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import type { Role } from "@prisma/client";
import {
  BarChart3,
  BookOpen,
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/prospects", label: "Prospects", icon: UserPlus },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/plans", label: "Plans", icon: FileText },
  { href: "/reviews", label: "Reviews", icon: BarChart3 },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/certify", label: "Certification", icon: ClipboardCheck }
];

const adminNav = [{ href: "/admin", label: "Admin", icon: ShieldCheck }];

/**
 * The application frame: sidebar, mobile top bar and content column.
 *
 * On desktop the sidebar collapses to an icon rail, and the content column
 * drops its maximum width so the page can use the whole window.
 */
export function AppFrame({
  user,
  initialCollapsed,
  children
}: {
  user: { name: string; role: Role };
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const pathname = usePathname();
  const items = user.role === "ADMIN" ? [...nav, ...adminNav] : nav;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div className="min-h-screen bg-wash">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-20 hidden overflow-hidden whitespace-nowrap border-r border-line bg-panel transition-[width] duration-200 lg:flex lg:flex-col",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className={clsx("border-b border-line py-5", collapsed ? "px-3" : "px-5")}>
          <div className={clsx("flex items-center gap-3", collapsed && "justify-center")}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-navy text-white">
              <Gauge size={18} />
            </div>
            {collapsed ? null : (
              <div className="min-w-0">
                <div className="font-semibold text-ink">Advisory OS</div>
                <div className="mono text-[10px] uppercase tracking-widest text-muted">Internal MVP</div>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex items-center gap-3 rounded py-2 text-sm font-semibold hover:bg-wash hover:text-navy",
                  collapsed ? "justify-center px-0" : "px-3",
                  active ? "bg-wash text-navy" : "text-slate-700"
                )}
              >
                <Icon size={16} className="shrink-0" />
                {collapsed ? null : item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                title={user.name}
                className="flex h-9 w-9 items-center justify-center rounded bg-mint font-bold text-teal"
              >
                {user.name.charAt(0)}
              </div>
              <LogoutButton />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded bg-wash p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-mint font-bold text-teal">
                {user.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{user.name}</div>
                <div className="mono text-[10px] uppercase text-muted">{user.role.toLowerCase()}</div>
              </div>
              <LogoutButton />
            </div>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={clsx(
              "flex w-full items-center rounded py-2 text-muted hover:bg-wash hover:text-ink",
              collapsed ? "justify-center px-0" : "px-3"
            )}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </aside>
      <main className={clsx("transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-64")}>
        <div className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-navy text-white">
                <Gauge size={18} />
              </div>
              <div>
                <div className="font-semibold text-ink">Advisory OS</div>
                <div className="mono text-[10px] uppercase text-muted">{user.role.toLowerCase()}</div>
              </div>
            </div>
            <LogoutButton />
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
            {items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "inline-flex shrink-0 items-center gap-2 rounded border px-3 py-2 text-xs font-semibold",
                    active ? "border-navy bg-panel text-navy" : "border-line bg-wash text-slate-700"
                  )}
                >
                  <Icon size={14} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className={clsx("mx-auto px-4 py-5 sm:px-6 lg:px-8", collapsed ? "max-w-none" : "max-w-7xl")}>
          {children}
        </div>
      </main>
    </div>
  );
}
