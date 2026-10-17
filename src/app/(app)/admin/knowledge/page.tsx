import Link from "next/link";
import { ArrowDown, ArrowUp, FilePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { createChapter, deleteModule, deleteTopic, moveKnowledgeItem, saveTopic, saveTrack } from "@/lib/actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MINIMUM_BANK_SIZE } from "@/lib/question-bank";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";

/** Admin editor for tracks, topics and chapters (text only). Modules are created by migration for now. */
export default async function KnowledgeEditorPage() {
  await requireAdmin();
  const tracks = await prisma.track.findMany({
    orderBy: { order: "asc" },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          topics: {
            orderBy: { order: "asc" },
            include: {
              chapters: {
                orderBy: { order: "asc" },
                select: { id: true, title: true, isPublished: true, _count: { select: { assets: true } } }
              },
              // Active questions for the bank warning; attempts and badges for the delete dialog.
              _count: {
                select: { questions: { where: { isActive: true } }, testSessions: true, certifications: true }
              }
            }
          }
        }
      }
    }
  });

  return (
    <>
      <PageHeader
        title="Knowledge editor"
        description="Tracks, topics and chapters. New chapters start as drafts; trainees see a chapter once it is published."
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
              </div>
            </div>

            <div className="mt-4 space-y-5">
              {track.modules.map((module, moduleIndex) => {
                // Trainees' numbering: published topics only, counted from 0.
                let shown = 0;
                const numbers = new Map(
                  module.topics.map((topic) => [topic.id, topic.isPublished ? `${moduleIndex + 1}.${shown++}` : null])
                );
                return (
                  <section key={module.id} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                        Module {moduleIndex + 1} · {module.title}
                      </h3>
                      <div className="flex gap-2">
                        <FormDialog label="New topic" title="New topic" icon={<Plus size={14} />} action={saveTopic}>
                          <input type="hidden" name="moduleId" value={module.id} />
                          <TitledFields />
                          <PublishedField checked={false} />
                          <Save />
                        </FormDialog>
                        {module.topics.length === 0 ? (
                          <FormDialog
                            label="Delete module"
                            title={`Delete ${module.title}`}
                            icon={<Trash2 size={14} />}
                            action={deleteModule}
                          >
                            <input type="hidden" name="id" value={module.id} />
                            <p className="text-sm text-muted">
                              This module has no topics. Deleting it cannot be undone.
                            </p>
                            <DeleteButton />
                          </FormDialog>
                        ) : null}
                      </div>
                    </div>
                    {module.topics.map((topic, topicIndex) => {
                      const published = topic.chapters.filter((chapter) => chapter.isPublished).length;
                      return (
                        <div key={topic.id} className="rounded border border-line p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Move
                                kind="topic"
                                id={topic.id}
                                first={topicIndex === 0}
                                last={topicIndex === module.topics.length - 1}
                              />
                              <h4 className="font-bold text-ink">
                                {numbers.get(topic.id)} {topic.title}
                              </h4>
                              {topic.isPublished ? null : <StatusBadge tone="rose">Unpublished</StatusBadge>}
                              {/* Shown to trainees, skipped by the order, until a chapter is published. */}
                              {topic.isPublished && published === 0 ? <StatusBadge>Coming soon</StatusBadge> : null}
                              {/* With chapters but too few questions, trainees stop here: the test can't open. */}
                              {published > 0 && topic._count.questions < MINIMUM_BANK_SIZE ? (
                                <StatusBadge tone="amber">
                                  {topic._count.questions}/{MINIMUM_BANK_SIZE} questions
                                </StatusBadge>
                              ) : null}
                            </div>
                            <div className="flex gap-2">
                              <FormDialog
                                label="Edit"
                                title="Edit topic"
                                icon={<Pencil size={14} />}
                                action={saveTopic}
                              >
                                <input type="hidden" name="id" value={topic.id} />
                                <TitledFields values={topic} />
                                <PublishedField checked={topic.isPublished} />
                                <Save />
                              </FormDialog>
                              <FormDialog
                                label="New chapter"
                                title="New chapter"
                                icon={<FilePlus size={14} />}
                                action={createChapter}
                              >
                                <input type="hidden" name="topicId" value={topic.id} />
                                <TitledFields description={false} />
                                <Save />
                              </FormDialog>
                              <FormDialog
                                label="Delete"
                                title={`Delete ${topic.title}`}
                                icon={<Trash2 size={14} />}
                                action={deleteTopic}
                              >
                                <input type="hidden" name="id" value={topic.id} />
                                <p className="text-sm text-ink">
                                  This permanently deletes the topic and everything in it:
                                </p>
                                <ul className="list-disc pl-5 text-sm text-muted">
                                  <li>{topic.chapters.length} chapters and their completion ticks</li>
                                  <li>
                                    {topic.chapters.reduce((sum, chapter) => sum + chapter._count.assets, 0)} uploaded
                                    files
                                  </li>
                                  <li>its questions ({topic._count.questions} active)</li>
                                  <li>{topic._count.testSessions} test attempts, with their answers</li>
                                  <li>{topic._count.certifications} badges</li>
                                </ul>
                                <p className="text-sm text-ink">It cannot be undone. Unpublishing hides it instead.</p>
                                <input
                                  className="field"
                                  name="confirm"
                                  placeholder={`Type ${topic.slug} to confirm`}
                                  autoComplete="off"
                                  required
                                />
                                <DeleteButton />
                              </FormDialog>
                            </div>
                          </div>
                          <ol className="mt-3 divide-y divide-line">
                            {topic.chapters.map((chapter, chapterIndex) => (
                              <li key={chapter.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                                <div className="flex items-center gap-2">
                                  <Move
                                    kind="chapter"
                                    id={chapter.id}
                                    first={chapterIndex === 0}
                                    last={chapterIndex === topic.chapters.length - 1}
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
                  </section>
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

/**
 * A published topic is shown to trainees ("Coming soon" until it has a
 * published chapter). Once it has chapters it counts toward the module badge,
 * so publishing one takes the badge away until it is passed.
 */
function PublishedField({ checked }: { checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="isPublished" defaultChecked={checked} />
      Published: shown to trainees
    </label>
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

function DeleteButton() {
  return (
    <button className="rounded bg-rose px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Delete</button>
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
