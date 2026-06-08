import { createPlan, updatePlanStatus } from "@/lib/actions";
import { requireSession, scopedUserFilter } from "@/lib/auth";
import { compactInr, dateLabel, titleCase } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export default async function PlansPage() {
  const session = await requireSession();
  const scope = scopedUserFilter(session);
  const [plans, clients] = await Promise.all([
    prisma.investmentPlan.findMany({
      where: { client: scope },
      orderBy: { updatedAt: "desc" },
      include: { client: { include: { assignedTo: true } } }
    }),
    prisma.client.findMany({ where: scope, orderBy: { name: "asc" } })
  ]);

  return (
    <>
      <PageHeader title="Investment Plans" description="Track SIP, ELSS, lump sum, and mixed plans from draft through activation." />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Goal</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {plans.map((plan) => (
                <tr key={plan.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{plan.client.name}</div>
                    <div className="text-xs text-muted">{plan.client.assignedTo.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{titleCase(plan.planType)}</div>
                    <div className="text-xs text-muted">{titleCase(plan.frequency)}</div>
                  </td>
                  <td className="mono px-4 py-3">{compactInr(plan.amount.toString())}</td>
                  <td className="px-4 py-3">{titleCase(plan.goal)}</td>
                  <td className="px-4 py-3"><PlanBadge status={plan.status} /></td>
                  <td className="px-4 py-3 text-xs text-muted">
                    Sent: {plan.sentDate ? dateLabel(plan.sentDate) : "None"}<br />
                    Accepted: {plan.acceptedDate ? dateLabel(plan.acceptedDate) : "None"}
                  </td>
                  <td className="px-4 py-3">
                    <form action={updatePlanStatus} className="flex gap-2">
                      <input type="hidden" name="id" value={plan.id} />
                      <select className="field min-w-32" name="status" defaultValue={plan.status}>
                        {["DRAFT", "SENT", "ACCEPTED", "ACTIVE", "CLOSED"].map((value) => (
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
        <Card className="p-4">
          <h2 className="mb-4 font-semibold text-ink">Create plan</h2>
          <form action={createPlan} className="space-y-3">
            <select className="field" name="clientId" required>
              <option value="">Select client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select className="field" name="planType" defaultValue="SIP">
                <option value="SIP">SIP</option>
                <option value="LUMP_SUM">Lump sum</option>
                <option value="ELSS">ELSS</option>
                <option value="MIXED">Mixed</option>
              </select>
              <select className="field" name="frequency" defaultValue="MONTHLY">
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ONE_TIME">One-time</option>
              </select>
            </div>
            <input className="field" name="amount" type="number" min="1" placeholder="Amount" required />
            <select className="field" name="goal" defaultValue="WEALTH">
              <option value="RETIREMENT">Retirement</option>
              <option value="EDUCATION">Education</option>
              <option value="WEALTH">Wealth</option>
              <option value="TAX_SAVING">Tax saving</option>
              <option value="OTHER">Other</option>
            </select>
            <select className="field" name="status" defaultValue="DRAFT">
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="ACTIVE">Active</option>
              <option value="CLOSED">Closed</option>
            </select>
            <textarea className="field min-h-24" name="notes" placeholder="Plan notes" />
            <SubmitButton>Create plan</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

function PlanBadge({ status }: { status: string }) {
  const tone = status === "ACTIVE" || status === "ACCEPTED" ? "teal" : status === "SENT" ? "amber" : status === "CLOSED" ? "slate" : "navy";
  return <StatusBadge tone={tone}>{titleCase(status)}</StatusBadge>;
}
