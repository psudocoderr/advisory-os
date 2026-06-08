import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge } from "@/components/ui";

type JsonList = string[];

export default async function SopPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const entry = await prisma.sopEntry.findUnique({
    where: { slug: sopId },
    include: { category: true }
  });
  if (!entry || !entry.isPublished) notFound();

  const steps = entry.steps as JsonList;
  const outcomes = entry.outcomes as JsonList;
  const errors = entry.commonErrors as JsonList;
  const references = entry.references as JsonList;

  return (
    <>
      <PageHeader
        title={entry.title}
        description={`${entry.category.title} SOP. Updated ${entry.updatedAt.toLocaleDateString("en-IN")}.`}
        action={
          <Link href="/knowledge" className="inline-flex items-center gap-2 rounded border border-line bg-panel px-3 py-2 text-sm font-semibold text-ink">
            <ArrowLeft size={16} />
            Back
          </Link>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <div className="mb-5 flex flex-wrap gap-2">
            {entry.module ? <StatusBadge tone="navy">{entry.module}</StatusBadge> : null}
            <StatusBadge tone="teal">Published</StatusBadge>
          </div>
          <section className="grid gap-3 border-b border-line pb-5 md:grid-cols-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted">What</div>
              <p className="mt-1 text-sm leading-6 text-ink">{entry.what}</p>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted">When</div>
              <p className="mt-1 text-sm leading-6 text-ink">{entry.when}</p>
            </div>
          </section>
          <section className="mt-5">
            <h2 className="font-semibold text-ink">Step-by-step process</h2>
            <ol className="mt-3 space-y-3">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3 rounded border border-line bg-wash p-3">
                  <span className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded bg-navy text-xs text-white">{index + 1}</span>
                  <span className="text-sm leading-6 text-ink">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        </Card>
        <div className="space-y-5">
          <SideList title="Outcome Badges" items={outcomes} tone="teal" />
          <SideList title="Common Errors" items={errors} tone="amber" />
          <SideList title="References" items={references} tone="navy" />
        </div>
      </div>
    </>
  );
}

function SideList({ title, items, tone }: { title: string; items: string[]; tone: "teal" | "amber" | "navy" }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm text-muted">
            <StatusBadge tone={tone}>•</StatusBadge>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
