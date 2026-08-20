import { createClient, createMeeting, updateClientKyc } from "@/lib/actions";
import { requireSession, scopedUserFilter } from "@/lib/auth";
import { compactInr, dateLabel, maskPan, maskPhone, titleCase } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; kyc?: string }> }) {
  const session = await requireSession();
  const params = await searchParams;
  const kycStatuses = ["VERIFIED", "PENDING", "EXPIRED"] as const;
  const query = params.q?.trim();
  const kyc = kycStatuses.includes(params.kyc as (typeof kycStatuses)[number]) ? params.kyc : undefined;
  const clients = await prisma.client.findMany({
    where: {
      ...scopedUserFilter(session),
      ...(kyc ? { kycStatus: kyc as never } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { pan: { contains: query.toUpperCase() } }
            ]
          }
        : {})
    },
    orderBy: { updatedAt: "desc" },
    include: { assignedTo: true, investmentPlans: true, portfolioReviews: { orderBy: { reviewDate: "desc" }, take: 1 } }
  });

  return (
    <>
      <PageHeader title="Clients" description="Searchable active-client log with masked PAN and phone in the list view." />
      <Card className="mb-5 p-4">
        <form className="grid gap-3 md:grid-cols-[1fr_220px_auto]" action="/clients">
          <input className="field" name="q" placeholder="Search name, phone, or PAN" defaultValue={query || ""} />
          <select className="field" name="kyc" defaultValue={kyc || ""}>
            <option value="">All KYC states</option>
            {kycStatuses.map((value) => (
              <option key={value} value={value}>{titleCase(value)}</option>
            ))}
          </select>
          <button className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white">Filter</button>
        </form>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">KYC</th>
                <th className="px-4 py-3">AUM</th>
                <th className="px-4 py-3">PAN</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Last review</th>
                <th className="px-4 py-3">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {clients.map((client) => (
                <tr key={client.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{client.name}</div>
                    <div className="text-xs text-muted">Owner: {client.assignedTo.name}</div>
                  </td>
                  <td className="px-4 py-3"><KycBadge status={client.kycStatus} /></td>
                  <td className="mono px-4 py-3">{compactInr(client.aum.toString())}</td>
                  <td className="mono px-4 py-3">{maskPan(client.pan)}</td>
                  <td className="mono px-4 py-3">{maskPhone(client.phone)}</td>
                  <td className="px-4 py-3">{client.portfolioReviews[0] ? dateLabel(client.portfolioReviews[0].reviewDate) : "None"}</td>
                  <td className="px-4 py-3">
                    <form action={updateClientKyc} className="flex gap-2">
                      <input type="hidden" name="id" value={client.id} />
                      <select className="field min-w-32" name="kycStatus" defaultValue={client.kycStatus}>
                        {kycStatuses.map((value) => (
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
        </Card>
        <div className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-4 font-semibold text-ink">Add client</h2>
            <form action={createClient} className="space-y-3">
              <input className="field" name="name" placeholder="Full name" required />
              <input className="field" name="phone" placeholder="Phone" required />
              <input className="field uppercase" name="pan" placeholder="ABCDE1234F" required />
              <select className="field" name="kycStatus" defaultValue="PENDING">
                <option value="VERIFIED">Verified</option>
                <option value="PENDING">Pending</option>
                <option value="EXPIRED">Expired</option>
              </select>
              <input className="field" name="aum" type="number" min="1" placeholder="AUM" required />
              <label className="label">Onboarding date<input className="field" name="onboardingDate" type="date" required /></label>
              <SubmitButton>Add client</SubmitButton>
            </form>
          </Card>
          <Card className="p-4">
            <h2 className="mb-4 font-semibold text-ink">Log client meeting</h2>
            <form action={createMeeting} className="space-y-3">
              <input type="hidden" name="kind" value="CLIENT" />
              <select className="field" name="clientId" required>
                <option value="">Select client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              <input className="field" name="summary" placeholder="Summary" required />
              <label className="label">Meeting date<input className="field" name="meetingDate" type="date" required /></label>
              <label className="label">Follow-up<input className="field" name="followUpDate" type="date" /></label>
              <textarea className="field min-h-20" name="notes" placeholder="Notes" />
              <SubmitButton>Log meeting</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function KycBadge({ status }: { status: string }) {
  const tone = status === "VERIFIED" ? "teal" : status === "PENDING" ? "amber" : "rose";
  return <StatusBadge tone={tone}>{titleCase(status)}</StatusBadge>;
}
