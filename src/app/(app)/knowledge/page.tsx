import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export default async function KnowledgePage() {
  await requireSession();
  const tracks = await prisma.track.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
    include: { _count: { select: { modules: true } } }
  });

  // One track is the normal case for now; skip the extra click.
  if (tracks.length === 1) redirect(`/knowledge/${tracks[0].slug}`);

  return (
    <>
      <PageHeader title="Knowledge" description="Choose a learning track." />
      {tracks.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {tracks.map((track) => (
            <Link key={track.id} href={`/knowledge/${track.slug}`}>
              <Card className="flex items-center justify-between gap-3 p-5 hover:border-teal">
                <div>
                  <h2 className="font-bold text-ink">{track.title}</h2>
                  <p className="mt-1 text-sm text-muted">{track._count.modules} modules</p>
                </div>
                <ChevronRight size={18} className="text-muted" />
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No tracks yet" body="Learning tracks will appear here once they are published." />
      )}
    </>
  );
}
