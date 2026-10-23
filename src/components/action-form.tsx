"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/lib/form-state";

/**
 * An inline form for a server action that returns FormState: the action's
 * error appears above the fields, which keep what was typed; on success the
 * form clears and `success`, if given, is shown. FormDialog does the same
 * inside a modal.
 */
export function ActionForm({
  action,
  className,
  success,
  children
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  className?: string;
  success?: string;
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
      // Only for a submit before hydration: without it the browser sends a GET
      // and puts every field, a new user's password included, in the URL.
      method="post"
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
        ) : state.ok && success && !pending ? (
          <p
            role="status"
            className="col-span-full rounded border border-teal/20 bg-mint px-3 py-2 text-sm font-semibold text-teal"
          >
            {success}
          </p>
        ) : null}
        {children}
      </fieldset>
    </form>
  );
}
