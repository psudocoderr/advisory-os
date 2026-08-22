import Link from "next/link";
import { BookOpen, Calendar, CheckCircle2, ChevronRight, Award, Layers } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, StatusBadge } from "@/components/ui";

export default async function KnowledgePage() {
  const categories = await prisma.knowledgeCategory.findMany({
    orderBy: { order: "asc" },
    include: { entries: { where: { isPublished: true }, orderBy: { createdAt: "asc" } } }
  });

  const totalSops = categories.reduce((acc, cat) => acc + cat.entries.length, 0);

  return (
    <>
      <PageHeader
        title="30-Day MFD Operational Excellence Curriculum"
        description="First-principles training roadmap designed to convert freshers into operationally proficient Mutual Fund Distributor professionals."
      />

      {/* Hero Overview Bar */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-mint text-teal">
            <Calendar size={20} />
          </div>
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">Duration</div>
            <div className="text-lg font-bold text-ink">30 Days (4 Weeks)</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-sky-100 text-sky-700">
            <BookOpen size={20} />
          </div>
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">Curriculum Modules</div>
            <div className="text-lg font-bold text-ink">{categories.length} Training Phases</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-amber-100 text-amber-700">
            <Layers size={20} />
          </div>
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">Operational SOPs</div>
            <div className="text-lg font-bold text-ink">{totalSops} Action Checklists</div>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-emerald-100 text-emerald-700">
            <Award size={20} />
          </div>
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">Adaptive Evaluation</div>
            <div className="text-lg font-bold text-ink">M1–M5 Certification</div>
          </div>
        </Card>
      </div>

      {/* 30-Day Table of Contents */}
      <div className="space-y-6">
        {categories.map((category, index) => {
          const moduleCode = category.entries[0]?.module || `M${index + 1}`;
          return (
            <Card key={category.id} className="p-5 overflow-hidden border-l-4 border-l-teal">
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded bg-navy text-white font-bold text-sm">
                    W{index + 1}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-ink">{category.title}</h2>
                    <p className="text-xs text-muted leading-relaxed mt-0.5">{category.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone="navy">{moduleCode} Module</StatusBadge>
                  <Link
                    href={`/certify/${moduleCode}`}
                    className="inline-flex items-center gap-1 rounded bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal hover:bg-teal hover:text-white transition-colors"
                  >
                    <Award size={13} />
                    Take {moduleCode} Test
                  </Link>
                </div>
              </div>

              {/* Day SOP Items */}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {category.entries.map((entry) => {
                  const stepsArray = Array.isArray(entry.steps) ? (entry.steps as string[]) : [];
                  return (
                    <Link
                      key={entry.id}
                      href={`/knowledge/${entry.slug}`}
                      className="group flex flex-col justify-between rounded-lg border border-line p-3.5 bg-panel hover:border-teal hover:bg-wash transition-all"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-ink group-hover:text-teal text-sm leading-snug">
                            {entry.title}
                          </h3>
                          <ChevronRight size={16} className="text-muted shrink-0 group-hover:text-teal group-hover:translate-x-0.5 transition-transform" />
                        </div>
                        <p className="mt-1.5 text-xs text-muted line-clamp-2 leading-relaxed">{entry.what}</p>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[11px] text-muted">
                        <span className="flex items-center gap-1 font-medium text-slate-600">
                          <CheckCircle2 size={12} className="text-teal" />
                          {stepsArray.length} Action Steps
                        </span>
                        <span className="mono text-[10px] uppercase font-semibold text-teal bg-teal/5 px-1.5 py-0.5 rounded">
                          {entry.module}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
