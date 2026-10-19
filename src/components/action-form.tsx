"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/lib/form-state";

/**
 * An inline form for a server action that returns FormState: the action's
 * error appears above the fields, which keep what was typed; on success the
 * form clears. FormDialog does the same inside a modal.
 */
export function ActionForm({
  action,
  className,
  children
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  className?: string;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, {});

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form
      ref={formRef}
      // Submitted by hand: React resets a form after its `action` runs, which
      // would wipe the fields on an error.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <fieldset disabled={pending} className={className}>
        {state.error && !pending ? (
          <p
            role="alert"
            className="col-span-full rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm font-semibold text-rose"
          >
            {state.error}
          </p>
        ) : null}
        {children}
      </fieldset>
    </form>
  );
}
