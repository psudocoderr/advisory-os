import { notFound } from "next/navigation";
import { ModuleCode } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { StartTestButton } from "@/components/start-test-button";

const details: Record<ModuleCode, { title: string; body: string }> = {
  M1: { title: "KYC & Compliance", body: "Adaptive testing across identity verification, proof protocol, and KRA/PAN handling." },
  M2: { title: "Client Onboarding", body: "Readiness checks, onboarding controls, and first-review scheduling." },
  M3: { title: "Investment Operations", body: "SIP, ELSS, lump sum, and operational follow-up controls." },
  M4: { title: "Portfolio Reviews", body: "AUM, XIRR, allocation drift, action capture, and next-review discipline." },
  M5: { title: "Full Advisory Certification", body: "Composite adaptive testing across CRM, compliance, planning, review, and operating controls." }
};

export default async function ModulePage({ params }: { params: Promise<{ moduleId: ModuleCode }> }) {
  await requireSession();
  const { moduleId } = await params;
  if (!details[moduleId]) notFound();
  const [questionCount, sopEntries] = await Promise.all([
    prisma.questionItem.count({ where: { module: moduleId, isActive: true } }),
    prisma.sopEntry.findMany({ where: { module: moduleId, isPublished: true }, orderBy: { title: "asc" } })
  ]);

  return (
    <>
      <PageHeader title={details[moduleId].title} description={details[moduleId].body} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Question floor" value="10" />
            <Metric label="Question cap" value="18" />
            <Metric label="Pass theta" value="0.50" />
          </div>
          <div className="mt-5 rounded border border-line bg-wash p-4 text-sm leading-6 text-muted">
            The session starts at theta 0.0 and selects the next unused item with the most information at the current estimate.
            Correct answers stay on the server; the client only receives the question stem and options.
          </div>
          <div className="mt-5">
            <StartTestButton moduleId={moduleId} disabled={questionCount < 10} />
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-ink">Study links</h2>
            <StatusBadge tone={questionCount >= 10 ? "teal" : "rose"}>{questionCount} items</StatusBadge>
          </div>
          <div className="space-y-2">
            {sopEntries.map((entry) => (
              <a key={entry.id} href={`/knowledge/${entry.slug}`} className="block rounded border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-teal">
                {entry.title}
              </a>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-wash p-3">
      <div className="mono text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
