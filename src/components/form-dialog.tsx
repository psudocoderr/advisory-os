"use client";

import { useRef } from "react";
import clsx from "clsx";
import { X } from "lucide-react";

/**
 * A header button that opens a form in a modal dialog.
 *
 * The form is passed as children, so it can stay server-rendered. The dialog
 * closes as soon as the form inside it submits; the server action still runs
 * and the page refreshes through its revalidatePath.
 */
export function FormDialog({
  label,
  title,
  icon,
  primary = false,
  children
}: {
  label: string;
  title: string;
  icon?: React.ReactNode;
  primary?: boolean;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

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
        onSubmit={close}
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
        <div className="p-4">{children}</div>
      </dialog>
    </>
  );
}
