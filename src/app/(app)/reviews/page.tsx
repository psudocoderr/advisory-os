import { createReview } from "@/lib/actions";
import { requireSession, scopedUserFilter } from "@/lib/auth";
import { compactInr, dateLabel } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export default async function ReviewsPage() {
  const session = await requireSession();
  const scope = scopedUserFilter(session);
  const [reviews, clients] = await Promise.all([
    prisma.portfolioReview.findMany({
      where: { client: scope },
      orderBy: { reviewDate: "desc" },
      include: { client: { include: { assignedTo: true } } }
    }),
    prisma.client.findMany({ where: scope, orderBy: { name: "asc" } })
  ]);

  return (
    <>
      <PageHeader title="Portfolio Reviews" description="Record AUM, returns, rebalancing actions, and next review dates." />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-wash text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Review date</th>
                <th className="px-4 py-3">AUM</th>
                <th className="px-4 py-3">XIRR</th>
                <th className="px-4 py-3">Actions</th>
                <th className="px-4 py-3">Next review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reviews.map((review) => (
                <tr key={review.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{review.client.name}</div>
                    <div className="text-xs text-muted">{review.client.assignedTo.name}</div>
                  </td>
                  <td className="px-4 py-3">{dateLabel(review.reviewDate)}</td>
                  <td className="mono px-4 py-3">{compactInr(review.currentAum.toString())}</td>
                  <td className="px-4 py-3"><StatusBadge tone={Number(review.returns) >= 10 ? "teal" : "amber"}>{review.returns.toString()}%</StatusBadge></td>
                  <td className="max-w-md px-4 py-3 text-muted">{review.actions}</td>
                  <td className="px-4 py-3">{dateLabel(review.nextReviewDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="p-4">
          <h2 className="mb-4 font-semibold text-ink">Add review</h2>
          <form action={createReview} className="space-y-3">
            <select className="field" name="clientId" required>
              <option value="">Select client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            <label className="label">Review date<input className="field" name="reviewDate" type="date" required /></label>
            <input className="field" name="currentAum" type="number" min="1" placeholder="Current AUM" required />
            <input className="field" name="returns" type="number" step="0.01" placeholder="XIRR %" required />
            <textarea className="field min-h-24" name="actions" placeholder="Rebalancing actions" required />
            <label className="label">Next review<input className="field" name="nextReviewDate" type="date" required /></label>
            <input className="field" name="attachmentNote" placeholder="Attachment note" />
            <SubmitButton>Add review</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
