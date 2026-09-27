"use client";

import { startTransition, useActionState, useState } from "react";
import clsx from "clsx";
import { saveChapter } from "@/lib/actions";
import { Card } from "@/components/ui";
import { ChapterBody } from "@/components/chapter-body";

/**
 * Markdown editor for one chapter with a Write / Preview toggle. The preview
 * uses the same renderer trainees see, so what it shows is what they get.
 */
export function ChapterEditor({
  chapter
}: {
  chapter: { id: string; title: string; slug: string; body: string; isPublished: boolean };
}) {
  const [state, formAction, pending] = useActionState(saveChapter, {});
  const [body, setBody] = useState(chapter.body);
  const [preview, setPreview] = useState(false);

  return (
    <form
      // Submitted by hand so an error keeps what was typed (see FormDialog).
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <input type="hidden" name="id" value={chapter.id} />
      <fieldset disabled={pending} className="space-y-3">
        {state.error && !pending ? (
          <p
            role="alert"
            className="rounded border border-rose/20 bg-rose/10 px-3 py-2 text-sm font-semibold text-rose"
          >
            {state.error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="field" name="title" defaultValue={chapter.title} placeholder="Title" required />
          <input
            className="field"
            name="slug"
            defaultValue={chapter.slug}
            placeholder="URL slug"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </div>

        <Card className="overflow-hidden">
          <div className="flex border-b border-line text-sm font-semibold" role="tablist">
            {(["Write", "Preview"] as const).map((label) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={preview === (label === "Preview")}
                onClick={() => setPreview(label === "Preview")}
                className={clsx(
                  "px-4 py-2",
                  preview === (label === "Preview") ? "border-b-2 border-navy text-ink" : "text-muted"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* The textarea stays mounted while previewing so its value is submitted. */}
          <textarea
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={200_000}
            className={clsx("mono block min-h-[28rem] w-full resize-y p-4 text-sm outline-none", preview && "hidden")}
            aria-label="Chapter body (markdown)"
          />
          {preview ? (
            <div className="min-h-[28rem] p-6">
              <ChapterBody markdown={body} />
            </div>
          ) : null}
        </Card>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPublished" defaultChecked={chapter.isPublished} />
            Published (trainees can read it)
          </label>
          <button className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white">
            {pending ? "Saving…" : "Save"}
          </button>
          {state.ok && !pending ? <span className="text-sm text-teal">Saved</span> : null}
        </div>
      </fieldset>
    </form>
  );
}
