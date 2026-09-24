"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import type { FormState } from "@/lib/form-state";

/**
 * A header button that opens a form in a modal dialog.
 *
 * The dialog owns the <form> and runs `action` through useActionState. If the
 * action returns an error, the dialog stays open with the message and the
 * fields keep what was typed. On success it resets the form and closes; the
 * page refreshes through the action's revalidatePath.
 */
export function FormDialog({
  label,
  title,
  icon,
  primary = false,
  action,
  children
}: {
  label: string;
  title: string;
  icon?: React.ReactNode;
  primary?: boolean;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, {});
  const close = () => dialogRef.current?.close();

  useEffect(() => {
    if (!state.ok) return;
    formRef.current?.reset();
    dialogRef.current?.close();
  }, [state.ok]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={clsx(
          "inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold",
          primary ? "bg-navy text-white hover:bg-ink" : "border border-line bg-panel text-ink hover:bg-wash"
        )}
      >
        {icon}
        {label}
      </button>
      <dialog
        ref={dialogRef}
        aria-label={title}
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        className="w-[min(28rem,calc(100vw-2rem))] rounded border border-line bg-panel p-0 text-ink shadow-soft backdrop:bg-ink/40"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-wash hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <form
          ref={formRef}
          // Submitting by hand rather than through the `action` prop: React resets
          // a form after its action runs, which would wipe the fields on an error.
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            startTransition(() => formAction(formData));
          }}
          className="p-4"
        >
          <fieldset disabled={pending} className="space-y-3">
            {state.error && !pending ? (
              <p
                role="alert"
                className="rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm font-semibold text-rose"
              >
                {state.error}
              </p>
            ) : null}
            {children}
          </fieldset>
        </form>
      </dialog>
    </>
  );
}
