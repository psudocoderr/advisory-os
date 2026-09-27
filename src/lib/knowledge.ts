import type { BadgeLevel } from "@prisma/client";
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

/**
 * The final exam opens once every module in the track is badged. A track with
 * no modules has nothing to examine.
 */
export function finalExamUnlocked(progress: ModuleProgress[], unlockAll = false): boolean {
  return progress.length > 0 && (unlockAll || progress.every((module) => module.badged));
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
    // Module badges, plus the track certificate (the row with no module).
    prisma.certification.findMany({
      where: { userId: user.id, trackId: track.id, status: "ACTIVE" },
      select: { moduleId: true, badgeLevel: true }
    })
  ]);
  const moduleBadges = badges.filter((row) => row.moduleId !== null);
  const certificateLevel = badges.find((row) => row.moduleId === null)?.badgeLevel ?? null;

  const progress = trackProgress(
    track.modules,
    new Set(completions.map((row) => row.chapterId)),
    new Set(moduleBadges.map((row) => row.moduleId!)),
    user.role === "ADMIN"
  );
  const badgeLevels = new Map(moduleBadges.map((row) => [row.moduleId!, row.badgeLevel]));
  return {
    track,
    progress,
    badgeLevels,
    finalUnlocked: finalExamUnlocked(progress, user.role === "ADMIN"),
    certificateLevel
  };
}

type TrackOutline = {
  id: string;
  slug: string;
  modules: { id: string; title: string; slug: string; chapters: { title: string; slug: string }[] }[];
};

/**
 * What a trainee should do next in a track, as a label and a link. Shared by
 * the dashboard and the admin tracker so both say the same thing.
 */
export function nextStep(
  track: TrackOutline,
  progress: ModuleProgress[],
  finalUnlocked: boolean,
  certificateLevel: BadgeLevel | null
): { label: string; href: string } {
  if (certificateLevel) return { label: "Certified", href: `/knowledge/${track.slug}` };
  if (finalUnlocked) return { label: "Take the final exam", href: `/certify/final/${track.id}` };
  const index = progress.findIndex((module) => !module.badged);
  const current = track.modules[index];
  if (!current) return { label: "Nothing to do yet", href: `/knowledge/${track.slug}` };
  if (progress[index].testUnlocked)
    return { label: `Take the module ${index + 1} test`, href: `/certify/${current.id}` };
  const chapterIndex = progress[index].chapters.findIndex((chapter) => chapter.state === "open");
  const chapter = current.chapters[chapterIndex];
  if (!chapter) return { label: `Module ${index + 1} has no chapters yet`, href: `/knowledge/${track.slug}` };
  return { label: `Read "${chapter.title}"`, href: chapterHref(track.slug, current.slug, chapter.slug) };
}

/**
 * Every active advisor's standing in a track, for the admin tracker. Five
 * queries however many trainees there are; the rule itself is trackProgress.
 */
export async function loadTeamProgress(trackId: string) {
  const track = await loadTrack({ id: trackId });
  if (!track) return null;
  const chapterIds = track.modules.flatMap((module) => module.chapters.map((chapter) => chapter.id));

  const [users, completions, certifications, lastCompletion, lastAttempt] = await Promise.all([
    prisma.user.findMany({
      where: { role: "ADVISOR", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true }
    }),
    prisma.chapterCompletion.findMany({
      where: { chapterId: { in: chapterIds } },
      select: { userId: true, chapterId: true }
    }),
    prisma.certification.findMany({
      where: { trackId: track.id, status: "ACTIVE" },
      select: { userId: true, moduleId: true, badgeLevel: true }
    }),
    prisma.chapterCompletion.groupBy({
      by: ["userId"],
      where: { chapterId: { in: chapterIds } },
      _max: { completedAt: true }
    }),
    prisma.testSession.groupBy({ by: ["userId"], where: { trackId: track.id }, _max: { startedAt: true } })
  ]);

  const rows = users.map((user) => {
    const mine = certifications.filter((row) => row.userId === user.id);
    const moduleBadges = mine.filter((row) => row.moduleId !== null);
    const certificateLevel = mine.find((row) => row.moduleId === null)?.badgeLevel ?? null;
    const progress = trackProgress(
      track.modules,
      new Set(completions.filter((row) => row.userId === user.id).map((row) => row.chapterId)),
      new Set(moduleBadges.map((row) => row.moduleId!))
    );
    const lastActivity = [
      lastCompletion.find((row) => row.userId === user.id)?._max.completedAt,
      lastAttempt.find((row) => row.userId === user.id)?._max.startedAt
    ]
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      user,
      chaptersDone: progress.reduce((sum, module) => sum + module.chaptersDone, 0),
      badgeLevels: new Map(moduleBadges.map((row) => [row.moduleId!, row.badgeLevel])),
      certificateLevel,
      next: nextStep(track, progress, finalExamUnlocked(progress), certificateLevel),
      lastActivity: lastActivity ?? null
    };
  });

  return { track, chaptersTotal: chapterIds.length, rows };
}

export function chapterHref(trackSlug: string, moduleSlug: string, chapterSlug: string) {
  return `/knowledge/${trackSlug}/${moduleSlug}/${chapterSlug}`;
}
