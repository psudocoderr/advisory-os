import { createMeeting, createProspect, onboardProspect, updateProspectStage } from "@/lib/actions";
import { requireSession, scopedUserFilter } from "@/lib/auth";
import { dateLabel, maskPhone, titleCase } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, EmptyState, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string }> }) {
  const session = await requireSession();
  const params = await searchParams;
  const stages = ["LEAD", "MEETING_HELD", "PLAN_SENT", "ONBOARDED", "DROPPED"] as const;
  const stage = stages.includes(params.stage as (typeof stages)[number]) ? params.stage : undefined;
  const query = params.q?.trim();
  const prospects = await prisma.prospect.findMany({
    where: {
      ...scopedUserFilter(session),
      ...(stage ? { stage: stage as never } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { notes: { contains: query, mode: "insensitive" } }
            ]
          }
        : {})
    },
    orderBy: [{ followUpDate: "asc" }, { updatedAt: "desc" }],
    include: { assignedTo: true, meetings: { orderBy: { meetingDate: "desc" }, take: 1 } }
  });
  const onboardableProspects = prospects.filter((prospect) => prospect.stage !== "ONBOARDED" && prospect.stage !== "DROPPED");

  return (
    <>
      <PageHeader title="Prospects" description="Track lead source, stage, notes, and next action dates before onboarding." />
      <Card className="mb-5 p-4">
        <form className="grid gap-3 md:grid-cols-[1fr_220px_auto]" action="/prospects">
          <input className="field" name="q" placeholder="Search name, phone, or notes" defaultValue={query || ""} />
          <select className="field" name="stage" defaultValue={stage || ""}>
            <option value="">All stages</option>
            {stages.map((value) => (
              <option key={value} value={value}>{titleCase(value)}</option>
            ))}
          </select>
          <button className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white">Filter</button>
        </form>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {prospects.map((prospect) => (
                <tr key={prospect.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{prospect.name}</div>
                    <div className="mt-1 max-w-xs text-xs text-muted">{prospect.notes}</div>
                  </td>
                  <td className="px-4 py-3"><StageBadge stage={prospect.stage} /></td>
                  <td className="px-4 py-3">{titleCase(prospect.source)}</td>
                  <td className="mono px-4 py-3">{maskPhone(prospect.phone)}</td>
                  <td className="px-4 py-3">{prospect.followUpDate ? dateLabel(prospect.followUpDate) : "None"}</td>
                  <td className="px-4 py-3">{prospect.assignedTo.name}</td>
                  <td className="px-4 py-3">
                    <form action={updateProspectStage} className="flex gap-2">
                      <input type="hidden" name="id" value={prospect.id} />
                      <select className="field min-w-36" name="stage" defaultValue={prospect.stage}>
                        {stages.map((value) => (
                          <option key={value} value={value}>{titleCase(value)}</option>
                        ))}
                      </select>
                      <button className="rounded border border-line px-2 text-xs font-bold">Update</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!prospects.length ? <EmptyState title="No prospects" body="Add the first prospect from the form." /> : null}
        </Card>
        <div className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-4 font-semibold text-ink">Log prospect</h2>
            <form action={createProspect} className="space-y-3">
              <input className="field" name="name" placeholder="Full name" required />
              <input className="field" name="phone" placeholder="Phone" required />
              <div className="grid grid-cols-2 gap-3">
                <select className="field" name="source" defaultValue="REFERRAL">
                  <option value="REFERRAL">Referral</option>
                  <option value="WALK_IN">Walk-in</option>
                  <option value="EVENT">Event</option>
                  <option value="ONLINE">Online</option>
                </select>
                <select className="field" name="stage" defaultValue="LEAD">
                  <option value="LEAD">Lead</option>
                  <option value="MEETING_HELD">Meeting held</option>
                  <option value="PLAN_SENT">Plan sent</option>
                  <option value="ONBOARDED">Onboarded</option>
                  <option value="DROPPED">Dropped</option>
                </select>
              </div>
              <label className="label">First contact<input className="field" name="firstContactDate" type="date" required /></label>
              <label className="label">Follow-up<input className="field" name="followUpDate" type="date" /></label>
              <textarea className="field min-h-24" name="notes" placeholder="Running notes" />
              <SubmitButton>Add prospect</SubmitButton>
            </form>
          </Card>
          <Card className="p-4">
            <h2 className="mb-4 font-semibold text-ink">Quick meeting</h2>
            <form action={createMeeting} className="space-y-3">
              <input type="hidden" name="kind" value="PROSPECT" />
              <select className="field" name="prospectId" required>
                <option value="">Select prospect</option>
                {prospects.map((prospect) => <option key={prospect.id} value={prospect.id}>{prospect.name}</option>)}
              </select>
              <input className="field" name="summary" placeholder="Summary" required />
              <label className="label">Meeting date<input className="field" name="meetingDate" type="date" required /></label>
              <label className="label">Follow-up<input className="field" name="followUpDate" type="date" /></label>
              <textarea className="field min-h-20" name="notes" placeholder="Notes" />
              <SubmitButton>Log meeting</SubmitButton>
            </form>
          </Card>
          <Card className="p-4">
            <h2 className="mb-4 font-semibold text-ink">Onboard prospect</h2>
            <form action={onboardProspect} className="space-y-3">
              <select className="field" name="prospectId" required>
                <option value="">Select prospect</option>
                {onboardableProspects.map((prospect) => <option key={prospect.id} value={prospect.id}>{prospect.name}</option>)}
              </select>
              <input className="field uppercase" name="pan" placeholder="ABCDE1234F" required />
              <select className="field" name="kycStatus" defaultValue="VERIFIED">
                <option value="VERIFIED">Verified</option>
                <option value="PENDING">Pending</option>
                <option value="EXPIRED">Expired</option>
              </select>
              <input className="field" name="aum" type="number" min="1" placeholder="Opening AUM" required />
              <label className="label">Onboarding date<input className="field" name="onboardingDate" type="date" required /></label>
              <SubmitButton>Create client</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const tone = stage === "ONBOARDED" ? "teal" : stage === "DROPPED" ? "rose" : stage === "PLAN_SENT" ? "amber" : "navy";
  return <StatusBadge tone={tone}>{titleCase(stage)}</StatusBadge>;
}
