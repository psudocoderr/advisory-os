import clsx from "clsx";

export function PageHeader({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-ink">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("rounded border border-line bg-panel shadow-soft", className)}>{children}</div>;
}

export function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <Card className="p-4">
      <div className="mono text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
      {detail ? <div className="mt-1 text-xs text-muted">{detail}</div> : null}
    </Card>
  );
}

export function StatusBadge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "teal" | "amber" | "rose" | "slate" | "navy" }) {
  const tones = {
    teal: "bg-mint text-teal border-teal/20",
    amber: "bg-gold text-amber border-amber/20",
    rose: "bg-rose/10 text-rose border-rose/20",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    navy: "bg-navy/10 text-navy border-navy/20"
  };
  return (
    <span className={clsx("inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-bold", tones[tone])}>
      {children}
    </span>
  );
}

export function SubmitButton({ children = "Save" }: { children?: React.ReactNode }) {
  return (
    <button className="inline-flex items-center justify-center rounded bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-ink">
      {children}
    </button>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-8 text-center">
      <div className="font-semibold text-ink">{title}</div>
      <div className="mt-1 text-sm text-muted">{body}</div>
    </Card>
  );
}
