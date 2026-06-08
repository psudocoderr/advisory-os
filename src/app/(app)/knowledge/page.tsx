import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, StatusBadge } from "@/components/ui";

export default async function KnowledgePage() {
  const categories = await prisma.knowledgeCategory.findMany({
    orderBy: { order: "asc" },
    include: { entries: { where: { isPublished: true }, orderBy: { title: "asc" } } }
  });

  return (
    <>
      <PageHeader title="Knowledge Portal" description="Structured SOPs for KYC, onboarding, operations, and portfolio reviews." />
      <div className="grid gap-5 lg:grid-cols-2">
        {categories.map((category) => (
          <Card key={category.id} className="p-4">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded bg-mint text-teal">
                <BookOpen size={18} />
              </div>
              <div>
                <h2 className="font-semibold text-ink">{category.title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted">{category.description}</p>
              </div>
            </div>
            <div className="space-y-2">
              {category.entries.map((entry) => (
                <Link
                  key={entry.id}
                  href={`/knowledge/${entry.slug}`}
                  className="flex items-center justify-between rounded border border-line px-3 py-2 hover:border-teal hover:bg-wash"
                >
                  <div>
                    <div className="text-sm font-semibold text-ink">{entry.title}</div>
                    <div className="mt-1 flex gap-2">
                      {entry.module ? <StatusBadge tone="navy">{entry.module}</StatusBadge> : null}
                      <StatusBadge tone="teal">Published</StatusBadge>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted" />
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
