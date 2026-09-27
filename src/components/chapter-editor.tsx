"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { saveChapter } from "@/lib/actions";
import { Card } from "@/components/ui";
import { ChapterBody } from "@/components/chapter-body";

/**
 * Markdown editor for one chapter with a Write / Preview toggle. The preview
 * uses the same renderer trainees see, so what it shows is what they get.
 */
type Asset = { id: string; filename: string; contentType: string };

/** Markdown for a file: images show inline, PDFs are a link (opens in a new tab). */
function assetMarkdown({ id, filename, contentType }: Asset) {
  const label = filename.replace(/[[\]()\\]/g, "");
  return `${contentType.startsWith("image/") ? "!" : ""}[${label}](/api/files/${id})`;
}

export function ChapterEditor({
  chapter,
  assets,
  uploadsEnabled
}: {
  chapter: { id: string; title: string; slug: string; body: string; isPublished: boolean };
  assets: Asset[];
  uploadsEnabled: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveChapter, {});
  const [body, setBody] = useState(chapter.body);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Inserts at the cursor (or the end), on its own line. */
  function insert(markdown: string) {
    const at = textareaRef.current?.selectionStart ?? body.length;
    setBody((current) => `${current.slice(0, at)}\n${markdown}\n${current.slice(at)}`);
    setPreview(false);
  }

  /**
   * The server records the file and signs a PUT for exactly this type and
   * size; the browser then sends the file straight to the bucket.
   */
  async function upload(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id, filename: file.name, contentType: file.type, size: file.size })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Upload refused");
      const put = await fetch(result.upload.url, { method: "PUT", headers: result.upload.headers, body: file });
      if (!put.ok) throw new Error("The file store rejected the upload; try again");
      insert(assetMarkdown({ id: result.assetId, filename: file.name, contentType: file.type }));
      router.refresh();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
            ref={textareaRef}
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

        {uploadsEnabled ? (
          <Card className="space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded border border-line px-3 py-1.5 font-semibold hover:bg-wash">
                {uploading ? "Uploading…" : "Add image or PDF"}
                <input
                  type="file"
                  className="sr-only"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                  }}
                />
              </label>
              <span className="text-muted">PNG, JPEG, WebP or PDF, up to 10 MB. Save the chapter afterwards.</span>
            </div>
            {uploadError ? (
              <p role="alert" className="font-semibold text-rose">
                {uploadError}
              </p>
            ) : null}
            {assets.length ? (
              <ul className="divide-y divide-line">
                {assets.map((asset) => (
                  <li key={asset.id} className="flex items-center justify-between gap-3 py-1.5">
                    <a href={`/api/files/${asset.id}`} target="_blank" rel="noopener noreferrer" className="truncate">
                      {asset.filename}
                    </a>
                    <button
                      type="button"
                      onClick={() => insert(assetMarkdown(asset))}
                      className="shrink-0 text-xs font-semibold text-teal hover:underline"
                    >
                      Insert
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : (
          <p className="text-sm text-muted">File uploads are off: storage is not configured.</p>
        )}

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
