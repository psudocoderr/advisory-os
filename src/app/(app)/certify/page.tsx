import Link from "next/link";
import { Award, ClipboardCheck } from "lucide-react";
import { ModuleCode } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge } from "@/components/ui";

const modules: { code: ModuleCode; title: string; description: string }[] = [
  { code: "M1", title: "KYC & Compliance", description: "Identity verification, KRA fetches, PAN checks, and proof protocol." },
  { code: "M2", title: "Client Onboarding", description: "Readiness checks, account setup, and first-review scheduling." },
  { code: "M3", title: "Investment Operations", description: "SIP, lump sum, ELSS, and transaction workflow controls." },
  { code: "M4", title: "Portfolio Reviews", description: "AUM, XIRR, allocation drift, actions, and next-review cadence." },
  { code: "M5", title: "Full Advisory Certification", description: "Composite workflow judgment across CRM, KYC, planning, reviews, and certification controls." }
];

export default async function CertifyPage() {
  const session = await requireSession();
  const [certifications, counts] = await Promise.all([
    prisma.certification.findMany({
      where: { status: "ACTIVE", ...(session.user.role === "ADMIN" ? {} : { userId: session.user.id }) },
      orderBy: { issuedAt: "desc" },
      include: { user: true }
    }),
    prisma.questionItem.groupBy({ by: ["module"], where: { isActive: true }, _count: true })
  ]);

  return (
    <>
      <PageHeader title="Train, Test, Certify" description="Adaptive module tests use server-side scoring and EAP theta estimation." />
      <div className="grid gap-4 lg:grid-cols-2">
        {modules.map((module) => {
          const cert = certifications.find((item) => item.module === module.code && (session.user.role === "ADMIN" || item.userId === session.user.id));
          const questionCount = counts.find((item) => item.module === module.code)?._count ?? 0;
          return (
            <Card key={module.code} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded bg-mint text-teal">
                    <ClipboardCheck size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-ink">{module.title}</h2>
                      <StatusBadge tone="navy">{module.code}</StatusBadge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted">{module.description}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div className="text-sm text-muted">
                  {questionCount} active questions
                  {cert ? (
                    <span> • {cert.level}, expires {dateLabel(cert.expiresAt)}</span>
                  ) : (
                    <span> • Not certified</span>
                  )}
                </div>
                <Link href={`/certify/${module.code}`} className="rounded bg-navy px-3 py-2 text-sm font-semibold text-white">
                  {cert ? "Retake module" : "Start module"}
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="mt-5 p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold text-ink">
          <Award size={18} />
          Certification status
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {certifications.length ? certifications.slice(0, 8).map((cert) => (
            <div key={cert.id} className="rounded border border-line bg-wash p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{cert.module}</span>
                <StatusBadge tone="teal">{cert.level}</StatusBadge>
              </div>
              <div className="mt-1 text-xs text-muted">
                {session.user.role === "ADMIN" ? `${cert.user.name} • ` : ""}Issued {dateLabel(cert.issuedAt)}
              </div>
            </div>
          )) : <div className="text-sm text-muted">No certifications yet.</div>}
        </div>
      </Card>
    </>
  );
}
