import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { ChapterEditor } from "@/components/chapter-editor";

export default async function EditChapterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: { module: { select: { title: true, track: { select: { title: true } } } } }
  });
  if (!chapter) notFound();

  return (
    <>
      <Link
        href="/admin/knowledge"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-teal"
      >
        <ArrowLeft size={14} />
        Knowledge editor
      </Link>
      <PageHeader
        title={chapter.title}
        description={`${chapter.module.track.title} · ${chapter.module.title}. Markdown; raw HTML is shown as text, not run.`}
      />
      <ChapterEditor chapter={chapter} />
    </>
  );
}
