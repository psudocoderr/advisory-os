import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Award, CheckCircle2, AlertTriangle, BookOpen } from "lucide-react";
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

  // Fetch adjacent SOPs for 30-day curriculum flow
  const allEntries = await prisma.sopEntry.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, title: true }
  });

  const currentIndex = allEntries.findIndex((e) => e.slug === sopId);
  const prevSop = currentIndex > 0 ? allEntries[currentIndex - 1] : null;
  const nextSop = currentIndex >= 0 && currentIndex < allEntries.length - 1 ? allEntries[currentIndex + 1] : null;

  const steps = (entry.steps as JsonList) || [];
  const outcomes = (entry.outcomes as JsonList) || [];
  const errors = (entry.commonErrors as JsonList) || [];
  const references = (entry.references as JsonList) || [];

  return (
    <>
      <PageHeader
        title={entry.title}
        description={`${entry.category.title} • Updated ${entry.updatedAt.toLocaleDateString("en-IN")}`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/knowledge" className="inline-flex items-center gap-2 rounded border border-line bg-panel px-3 py-2 text-sm font-semibold text-ink hover:bg-wash">
              <ArrowLeft size={16} />
              Table of Contents
            </Link>
            {entry.module ? (
              <Link
                href={`/certify/${entry.module}`}
                className="inline-flex items-center gap-2 rounded bg-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal transition-colors"
              >
                <Award size={16} />
                Test {entry.module} Module
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
              {entry.module ? <StatusBadge tone="navy">{entry.module} Module</StatusBadge> : null}
              <StatusBadge tone="teal">30-Day SOP Standard</StatusBadge>
              <span className="text-xs font-semibold text-muted ml-auto">
                Step {currentIndex + 1} of {allEntries.length} in Curriculum
              </span>
            </div>

            <section className="grid gap-4 rounded-lg bg-wash p-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted">What (Objective)</div>
                <p className="mt-1 text-sm leading-relaxed font-medium text-ink">{entry.what}</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted">When (Operational Trigger)</div>
                <p className="mt-1 text-sm leading-relaxed font-medium text-ink">{entry.when}</p>
              </div>
            </section>

            <section className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-ink text-base flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-teal" />
                  Actionable Operational Checklist
                </h2>
                <span className="text-xs text-muted font-mono">{steps.length} Mandatory Execution Steps</span>
              </div>

              <ol className="space-y-3">
                {steps.map((step, index) => (
                  <li key={step} className="flex items-start gap-3 rounded-lg border border-line bg-panel p-3.5 hover:border-teal transition-colors">
                    <span className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-ink font-medium mt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          </Card>

          {/* Curriculum Step Navigation */}
          <div className="flex items-center justify-between gap-3">
            {prevSop ? (
              <Link
                href={`/knowledge/${prevSop.slug}`}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-sm font-semibold text-ink hover:border-teal hover:bg-wash transition-all"
              >
                <ArrowLeft size={16} className="text-muted" />
                <div>
                  <div className="text-[10px] text-muted uppercase">Previous Day</div>
                  <div className="truncate max-w-[180px] font-bold text-xs">{prevSop.title}</div>
                </div>
              </Link>
            ) : <div />}

            {nextSop ? (
              <Link
                href={`/knowledge/${nextSop.slug}`}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-3 text-sm font-semibold text-ink hover:border-teal hover:bg-wash text-right transition-all ml-auto"
              >
                <div>
                  <div className="text-[10px] text-muted uppercase">Next Day</div>
                  <div className="truncate max-w-[180px] font-bold text-xs">{nextSop.title}</div>
                </div>
                <ArrowRight size={16} className="text-muted" />
              </Link>
            ) : null}
          </div>
        </div>

        {/* Sidebar Controls */}
        <div className="space-y-5">
          <SideList title="Target Outcomes" items={outcomes} icon={CheckCircle2} tone="teal" />
          <SideList title="Fresher Pitfalls to Avoid" items={errors} icon={AlertTriangle} tone="amber" />
          <SideList title="Regulatory References" items={references} icon={BookOpen} tone="navy" />
        </div>
      </div>
    </>
  );
}

function SideList({
  title,
  items,
  icon: Icon,
  tone
}: {
  title: string;
  items: string[];
  icon: React.ComponentType<{ size: number; className?: string }>;
  tone: "teal" | "amber" | "navy";
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-bold text-ink flex items-center gap-2">
        <Icon size={16} className={tone === "teal" ? "text-teal" : tone === "amber" ? "text-amber-600" : "text-navy"} />
        {title}
      </h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
            <StatusBadge tone={tone}>•</StatusBadge>
            <span className="font-medium text-slate-700">{item}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
