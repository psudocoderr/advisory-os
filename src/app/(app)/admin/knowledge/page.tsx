import Link from "next/link";
import { ArrowDown, ArrowUp, FilePlus, Pencil, Plus } from "lucide-react";
import { createChapter, moveKnowledgeItem, saveModule, saveTrack } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MINIMUM_BANK_SIZE } from "@/lib/question-bank";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";

/** Admin editor for tracks, modules and chapters (text only). */
export default async function KnowledgeEditorPage() {
  await requireAdmin();
  const tracks = await prisma.track.findMany({
    orderBy: { order: "asc" },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          chapters: { orderBy: { order: "asc" }, select: { id: true, title: true, isPublished: true } },
          _count: { select: { questions: { where: { isActive: true } } } }
        }
      }
    }
  });

  return (
    <>
      <PageHeader
        title="Knowledge editor"
        description="Tracks, modules and chapters. New chapters start as drafts; trainees see a chapter once it is published."
        action={
          <FormDialog label="New track" title="New track" icon={<Plus size={15} />} primary action={saveTrack}>
            <TitledFields />
            <ActiveField checked />
            <Save />
          </FormDialog>
        }
      />

      <div className="space-y-5">
        {tracks.map((track, trackIndex) => (
          <Card key={track.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <Move kind="track" id={track.id} first={trackIndex === 0} last={trackIndex === tracks.length - 1} />
                <h2 className="text-lg font-bold text-ink">{track.title}</h2>
                {track.isActive ? null : <StatusBadge tone="rose">Hidden</StatusBadge>}
              </div>
              <div className="flex gap-2">
                <FormDialog label="Edit" title="Edit track" icon={<Pencil size={14} />} action={saveTrack}>
                  <input type="hidden" name="id" value={track.id} />
                  <TitledFields values={track} />
                  <ActiveField checked={track.isActive} />
                  <Save />
                </FormDialog>
                <FormDialog label="New module" title="New module" icon={<Plus size={14} />} action={saveModule}>
                  <input type="hidden" name="trackId" value={track.id} />
                  <TitledFields />
                  <Save />
                </FormDialog>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {track.modules.map((module, moduleIndex) => {
                const published = module.chapters.filter((chapter) => chapter.isPublished).length;
                return (
                  <div key={module.id} className="rounded border border-line p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Move
                          kind="module"
                          id={module.id}
                          first={moduleIndex === 0}
                          last={moduleIndex === track.modules.length - 1}
                        />
                        <h3 className="font-bold text-ink">
                          {moduleIndex + 1}. {module.title}
                        </h3>
                        {/* Either gap stops trainees at this module: its test can't open. */}
                        {published === 0 ? <StatusBadge tone="amber">No published chapters</StatusBadge> : null}
                        {module._count.questions < MINIMUM_BANK_SIZE ? (
                          <StatusBadge tone="amber">
                            {module._count.questions}/{MINIMUM_BANK_SIZE} questions
                          </StatusBadge>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <FormDialog label="Edit" title="Edit module" icon={<Pencil size={14} />} action={saveModule}>
                          <input type="hidden" name="id" value={module.id} />
                          <TitledFields values={module} />
                          <Save />
                        </FormDialog>
                        <FormDialog
                          label="New chapter"
                          title="New chapter"
                          icon={<FilePlus size={14} />}
                          action={createChapter}
                        >
                          <input type="hidden" name="moduleId" value={module.id} />
                          <TitledFields description={false} />
                          <Save />
                        </FormDialog>
                      </div>
                    </div>
                    <ol className="mt-3 divide-y divide-line">
                      {module.chapters.map((chapter, chapterIndex) => (
                        <li key={chapter.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <Move
                              kind="chapter"
                              id={chapter.id}
                              first={chapterIndex === 0}
                              last={chapterIndex === module.chapters.length - 1}
                            />
                            <span className="text-ink">{chapter.title}</span>
                            {chapter.isPublished ? null : <StatusBadge>Draft</StatusBadge>}
                          </div>
                          <Link
                            href={`/admin/knowledge/chapters/${chapter.id}`}
                            className="text-xs font-semibold text-teal hover:underline"
                          >
                            Edit
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function TitledFields({
  values,
  description = true
}: {
  values?: { title: string; slug: string; description?: string };
  description?: boolean;
}) {
  return (
    <>
      <input className="field" name="title" placeholder="Title" defaultValue={values?.title} required />
      <input
        className="field"
        name="slug"
        placeholder="URL slug (blank: made from the title)"
        defaultValue={values?.slug}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
      />
      {description ? (
        <textarea
          className="field min-h-20"
          name="description"
          placeholder="Short description"
          defaultValue={values?.description}
        />
      ) : null}
    </>
  );
}

function ActiveField({ checked }: { checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="isActive" defaultChecked={checked} />
      Visible to trainees
    </label>
  );
}

function Save() {
  return <button className="rounded bg-navy px-4 py-2 text-sm font-semibold text-white">Save</button>;
}

function Move({ kind, id, first, last }: { kind: string; id: string; first: boolean; last: boolean }) {
  return (
    <form action={moveKnowledgeItem} className="flex">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <button
        name="direction"
        value="up"
        disabled={first}
        aria-label="Move up"
        className="rounded p-1 text-muted hover:bg-wash hover:text-ink disabled:opacity-30"
      >
        <ArrowUp size={14} />
      </button>
      <button
        name="direction"
        value="down"
        disabled={last}
        aria-label="Move down"
        className="rounded p-1 text-muted hover:bg-wash hover:text-ink disabled:opacity-30"
      >
        <ArrowDown size={14} />
      </button>
    </form>
  );
}
