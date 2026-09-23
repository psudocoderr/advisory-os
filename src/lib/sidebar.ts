/**
 * Remembers whether the desktop sidebar is collapsed. Written by AppFrame in
 * the browser and read by AppShell on the server, so a reload renders in the
 * remembered state rather than flashing the wide sidebar first.
 *
 * Lives here rather than in app-frame.tsx because a value exported from a
 * "use client" module reaches a server component as a client reference, not
 * as the string itself.
 */
export const SIDEBAR_COOKIE = "sidebar";
