import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen grid-cols-1 bg-wash lg:grid-cols-[1fr_440px]">
      <section className="hidden bg-navy px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div>
          <div className="mono text-xs uppercase tracking-[0.28em] text-white/60">Advisory OS</div>
          <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-tight">
            A calm operating layer for advisory work.
          </h1>
        </div>
        <div className="grid max-w-3xl grid-cols-3 gap-3 text-sm text-white/72">
          <div className="rounded border border-white/15 p-4">CRM follow-ups and client context in one place.</div>
          <div className="rounded border border-white/15 p-4">SOPs that stay linked to daily workflows.</div>
          <div className="rounded border border-white/15 p-4">Adaptive certification for compliance confidence.</div>
        </div>
      </section>
      <section className="flex items-center justify-center px-6">
        <Suspense fallback={<div className="h-80 w-full max-w-sm rounded border border-line bg-panel shadow-soft" />}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
