import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The start of today in India, in the form follow-up dates are stored: a form
 * date "YYYY-MM-DD" is saved as that day's UTC midnight (`optionalDate` in
 * actions.ts). Comparing against `new Date()` instead made a follow-up due
 * today vanish from the dashboard on the day itself (flags O18).
 */
export function startOfTodayIst(now = new Date()) {
  return new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now));
}

export type FollowUp = {
  key: string;
  name: string;
  kind: "prospect" | "client";
  date: Date;
  when: "overdue" | "today" | "upcoming";
  /** The list page, filtered to this record. */
  href: string;
};

/**
 * What each advisor has to follow up, soonest first, overdue included.
 *
 * - The latest meeting with a prospect or client decides: logging a new
 *   meeting replaces the old follow-up, and one logged without a follow-up
 *   date closes it.
 * - A prospect's own follow-up date (the New prospect form) counts until the
 *   first meeting with them is logged.
 * - Onboarded and dropped prospects have nothing to follow up.
 * - Advisors see the follow-ups of the prospects and clients assigned to
 *   them, whoever logged the meeting; `scope` is `{}` for an admin.
 *
 * ponytail: reads every meeting in scope to find the latest per record; fine
 * at an advisor's volume, a DISTINCT ON query when that stops being true.
 */
export async function loadFollowUps(scope: Prisma.ProspectWhereInput & Prisma.ClientWhereInput, now = new Date()) {
  const today = startOfTodayIst(now);
  const open: Prisma.ProspectWhereInput = { ...scope, stage: { notIn: ["ONBOARDED", "DROPPED"] } };

  const [meetings, prospects] = await Promise.all([
    prisma.meetingLog.findMany({
      where: { OR: [{ prospect: open }, { client: scope }] },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      select: {
        prospectId: true,
        clientId: true,
        followUpDate: true,
        prospect: { select: { name: true } },
        client: { select: { name: true } }
      }
    }),
    prisma.prospect.findMany({
      where: { ...open, followUpDate: { not: null }, meetings: { none: {} } },
      select: { id: true, name: true, followUpDate: true }
    })
  ]);

  const items: Omit<FollowUp, "when">[] = [];
  const seen = new Set<string>();
  for (const meeting of meetings) {
    const key = meeting.prospectId ? `prospect:${meeting.prospectId}` : `client:${meeting.clientId}`;
    if (seen.has(key)) continue; // only the latest meeting per record counts
    seen.add(key);
    if (!meeting.followUpDate) continue;
    const kind = meeting.prospectId ? "prospect" : "client";
    const name = (meeting.prospect ?? meeting.client)!.name;
    items.push({ key, name, kind, date: meeting.followUpDate, href: listHref(kind, name) });
  }
  for (const prospect of prospects) {
    items.push({
      key: `prospect:${prospect.id}`,
      name: prospect.name,
      kind: "prospect",
      date: prospect.followUpDate!,
      href: listHref("prospect", prospect.name)
    });
  }

  return items
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.name.localeCompare(b.name))
    .map((item): FollowUp => {
      const when = item.date < today ? "overdue" : item.date.getTime() === today.getTime() ? "today" : "upcoming";
      return { ...item, when };
    });
}

function listHref(kind: "prospect" | "client", name: string) {
  return `/${kind === "prospect" ? "prospects" : "clients"}?q=${encodeURIComponent(name)}`;
}
