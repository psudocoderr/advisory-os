import { prisma } from "@/lib/prisma";

/**
 * What a trainee may open in a track.
 *
 * Strict sequence: the first module is open; each later module opens once
 * the one before it has a badge. Inside an open module, chapters open one at
 * a time as the previous one is marked complete, and the module test opens
 * once every chapter is complete.
 *
 * Pure, so the same rule is shared by the pages that show locks and the
 * server code that enforces them. Hiding a link is not a lock; every write
 * and every page load checks this.
 */
export type ChapterState = "complete" | "open" | "locked";

export type ModuleProgress = {
  id: string;
  unlocked: boolean;
  chapters: { id: string; state: ChapterState }[];
  chaptersDone: number;
  testUnlocked: boolean;
  badged: boolean;
};

export function trackProgress(
  modules: { id: string; chapters: { id: string }[] }[],
  completedChapterIds: ReadonlySet<string>,
  badgedModuleIds: ReadonlySet<string>,
  /** Admins preview everything; nothing is locked for them. */
  unlockAll = false
): ModuleProgress[] {
  return modules.map((module, index) => {
    const unlocked = unlockAll || index === 0 || badgedModuleIds.has(modules[index - 1].id);
    let previousDone = true;
    const chapters = module.chapters.map(({ id }) => {
      const done = completedChapterIds.has(id);
      const state: ChapterState = done ? "complete" : unlocked && (previousDone || unlockAll) ? "open" : "locked";
      previousDone = done;
      return { id, state };
    });
    const chaptersDone = chapters.filter((chapter) => chapter.state === "complete").length;
    return {
      id: module.id,
      unlocked,
      chapters,
      chaptersDone,
      testUnlocked: unlocked && chapters.length > 0 && (unlockAll || chaptersDone === chapters.length),
      badged: badgedModuleIds.has(module.id)
    };
  });
}

/** A track with its modules and published chapters, in order. */
export function loadTrack(where: { slug: string } | { id: string }) {
  return prisma.track.findFirst({
    where: { ...where, isActive: true },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          chapters: {
            where: { isPublished: true },
            orderBy: { order: "asc" },
            select: { id: true, slug: true, title: true, order: true }
          }
        }
      }
    }
  });
}

/** A track together with where this user stands in it. */
export async function loadTrackProgress(where: { slug: string } | { id: string }, user: { id: string; role: string }) {
  const track = await loadTrack(where);
  if (!track) return null;

  const chapterIds = track.modules.flatMap((module) => module.chapters.map((chapter) => chapter.id));
  const [completions, badges] = await Promise.all([
    prisma.chapterCompletion.findMany({
      where: { userId: user.id, chapterId: { in: chapterIds } },
      select: { chapterId: true }
    }),
    prisma.certification.findMany({
      where: { userId: user.id, trackId: track.id, moduleId: { not: null }, status: "ACTIVE" },
      select: { moduleId: true, badgeLevel: true }
    })
  ]);

  const progress = trackProgress(
    track.modules,
    new Set(completions.map((row) => row.chapterId)),
    new Set(badges.map((row) => row.moduleId!)),
    user.role === "ADMIN"
  );
  const badgeLevels = new Map(badges.map((row) => [row.moduleId!, row.badgeLevel]));
  return { track, progress, badgeLevels };
}

export function chapterHref(trackSlug: string, moduleSlug: string, chapterSlug: string) {
  return `/knowledge/${trackSlug}/${moduleSlug}/${chapterSlug}`;
}
