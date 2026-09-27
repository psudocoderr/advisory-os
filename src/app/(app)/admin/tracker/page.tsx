import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { LEVEL_LABEL } from "@/lib/irt";
import { loadTeamProgress } from "@/lib/knowledge";
import { prisma } from "@/lib/prisma";
import { Card, EmptyState, PageHeader, StatusBadge, TableScroll } from "@/components/ui";

/** Where every active advisor stands in each track. */
export default async function TrackerPage() {
  await requireAdmin();
  const tracks = await prisma.track.findMany({ where: { isActive: true }, orderBy: { order: "asc" } });
  const teams = (await Promise.all(tracks.map((track) => loadTeamProgress(track.id)))).filter((team) => team !== null);

  return (
    <>
      <PageHeader
        title="Trainee tracker"
        description="Where each active advisor stands: chapters, badges and next step."
      />
      {teams.length === 0 ? (
        <EmptyState title="No active tracks" body="Create a track in the knowledge editor." />
      ) : null}
      {teams.map(({ track, chaptersTotal, rows }) => (
        <Card key={track.id} className="mb-5 overflow-hidden">
          <div className="border-b border-line px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">
            {track.title}
          </div>
          <TableScroll>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Trainee</th>
                  <th className="px-4 py-3">Next step</th>
                  <th className="px-4 py-3">Chapters</th>
                  {track.modules.map((module, index) => (
                    <th key={module.id} className="px-4 py-3" title={module.title}>
                      M{index + 1}
                    </th>
                  ))}
                  <th className="px-4 py-3">Certificate</th>
                  <th className="px-4 py-3">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.user.id}>
                    <td className="px-4 py-3 font-semibold text-ink">{row.user.name}</td>
                    <td className="px-4 py-3">{row.next.label}</td>
                    <td className="mono px-4 py-3">
                      {row.chaptersDone}/{chaptersTotal}
                    </td>
                    {track.modules.map((module) => {
                      const level = row.badgeLevels.get(module.id);
                      return (
                        <td key={module.id} className="px-4 py-3">
                          {level ? <StatusBadge tone="teal">{LEVEL_LABEL[level]}</StatusBadge> : "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3">
                      {row.certificateLevel ? (
                        <StatusBadge tone="navy">{LEVEL_LABEL[row.certificateLevel]}</StatusBadge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{row.lastActivity ? dateLabel(row.lastActivity) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {rows.length === 0 ? <div className="px-4 py-3 text-sm text-muted">No active advisors.</div> : null}
        </Card>
      ))}
      <Link href="/admin" className="text-xs font-semibold text-muted hover:text-teal">
        ← Admin
      </Link>
    </>
  );
}
