import type { BadgeLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * What a trainee may open in a track.
 *
 * Strict sequence across the track: the first topic is open; each later topic
 * opens once the one before it has a badge. Inside an open topic, chapters
 * open one at a time as the previous one is marked complete, and the topic
 * test opens once every chapter is complete.
 *
 * Pure, so the same rule is shared by the pages that show locks and the
 * server code that enforces them. Hiding a link is not a lock; every write
 * and every page load checks this.
 */
export type ChapterState = "complete" | "open" | "locked";

export type TopicProgress = {
  id: string;
  unlocked: boolean;
  chapters: { id: string; state: ChapterState }[];
  chaptersDone: number;
  testUnlocked: boolean;
  badged: boolean;
};

export function trackProgress(
  topics: { id: string; chapters: { id: string }[] }[],
  completedChapterIds: ReadonlySet<string>,
  badgedTopicIds: ReadonlySet<string>,
  /** Admins preview everything; nothing is locked for them. */
  unlockAll = false
): TopicProgress[] {
  return topics.map((topic, index) => {
    const unlocked = unlockAll || index === 0 || badgedTopicIds.has(topics[index - 1].id);
    let previousDone = true;
    const chapters = topic.chapters.map(({ id }) => {
      const done = completedChapterIds.has(id);
      const state: ChapterState = done ? "complete" : unlocked && (previousDone || unlockAll) ? "open" : "locked";
      previousDone = done;
      return { id, state };
    });
    const chaptersDone = chapters.filter((chapter) => chapter.state === "complete").length;
    return {
      id: topic.id,
      unlocked,
      chapters,
      chaptersDone,
      testUnlocked: unlocked && chapters.length > 0 && (unlockAll || chaptersDone === chapters.length),
      badged: badgedTopicIds.has(topic.id)
    };
  });
}

/**
 * The final exam opens once every topic in the track is badged. A track with
 * no topics has nothing to examine.
 */
export function finalExamUnlocked(progress: TopicProgress[], unlockAll = false): boolean {
  return progress.length > 0 && (unlockAll || progress.every((topic) => topic.badged));
}

/**
 * A track with its modules, their published topics and those topics'
 * published chapters, in order. `topics` is the same topics as one list in
 * track order, each carrying its module: the sequence trainees work through.
 */
export async function loadTrack(where: { slug: string } | { id: string }) {
  const track = await prisma.track.findFirst({
    where: { ...where, isActive: true },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          topics: {
            where: { isPublished: true },
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
      }
    }
  });
  if (!track) return null;
  const topics = track.modules.flatMap(({ topics, ...module }) => topics.map((topic) => ({ ...topic, module })));
  return { ...track, topics };
}

/** A track together with where this user stands in it. */
export async function loadTrackProgress(where: { slug: string } | { id: string }, user: { id: string; role: string }) {
  const track = await loadTrack(where);
  if (!track) return null;

  const chapterIds = track.topics.flatMap((topic) => topic.chapters.map((chapter) => chapter.id));
  const [completions, badges] = await Promise.all([
    prisma.chapterCompletion.findMany({
      where: { userId: user.id, chapterId: { in: chapterIds } },
      select: { chapterId: true }
    }),
    // Topic badges, plus the track certificate (the row with no topic).
    prisma.certification.findMany({
      where: { userId: user.id, trackId: track.id, status: "ACTIVE" },
      select: { topicId: true, badgeLevel: true }
    })
  ]);
  const topicBadges = badges.filter((row) => row.topicId !== null);
  const certificateLevel = badges.find((row) => row.topicId === null)?.badgeLevel ?? null;

  const progress = trackProgress(
    track.topics,
    new Set(completions.map((row) => row.chapterId)),
    new Set(topicBadges.map((row) => row.topicId!)),
    user.role === "ADMIN"
  );
  const badgeLevels = new Map(topicBadges.map((row) => [row.topicId!, row.badgeLevel]));
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
  topics: {
    id: string;
    title: string;
    slug: string;
    module: { slug: string };
    chapters: { title: string; slug: string }[];
  }[];
};

/**
 * What a trainee should do next in a track, as a label and a link. Shared by
 * the dashboard and the admin tracker so both say the same thing.
 */
export function nextStep(
  track: TrackOutline,
  progress: TopicProgress[],
  finalUnlocked: boolean,
  certificateLevel: BadgeLevel | null
): { label: string; href: string } {
  if (certificateLevel) return { label: "Certified", href: `/knowledge/${track.slug}` };
  if (finalUnlocked) return { label: "Take the final exam", href: `/certify/final/${track.id}` };
  const index = progress.findIndex((topic) => !topic.badged);
  const current = track.topics[index];
  if (!current) return { label: "Nothing to do yet", href: `/knowledge/${track.slug}` };
  if (progress[index].testUnlocked)
    return { label: `Take the "${current.title}" test`, href: `/certify/${current.id}` };
  const chapterIndex = progress[index].chapters.findIndex((chapter) => chapter.state === "open");
  const chapter = current.chapters[chapterIndex];
  if (!chapter) return { label: `"${current.title}" has no chapters yet`, href: `/knowledge/${track.slug}` };
  return {
    label: `Read "${chapter.title}"`,
    href: chapterHref(track.slug, current.module.slug, current.slug, chapter.slug)
  };
}

/**
 * Every active advisor's standing in a track, for the admin tracker. Five
 * queries however many trainees there are; the rule itself is trackProgress.
 */
export async function loadTeamProgress(trackId: string) {
  const track = await loadTrack({ id: trackId });
  if (!track) return null;
  const chapterIds = track.topics.flatMap((topic) => topic.chapters.map((chapter) => chapter.id));

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
      select: { userId: true, topicId: true, badgeLevel: true }
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
    const topicBadges = mine.filter((row) => row.topicId !== null);
    const certificateLevel = mine.find((row) => row.topicId === null)?.badgeLevel ?? null;
    const progress = trackProgress(
      track.topics,
      new Set(completions.filter((row) => row.userId === user.id).map((row) => row.chapterId)),
      new Set(topicBadges.map((row) => row.topicId!))
    );
    const lastActivity = [
      lastCompletion.find((row) => row.userId === user.id)?._max.completedAt,
      lastAttempt.find((row) => row.userId === user.id)?._max.startedAt
    ]
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      user,
      chaptersDone: progress.reduce((sum, topic) => sum + topic.chaptersDone, 0),
      badgeLevels: new Map(topicBadges.map((row) => [row.topicId!, row.badgeLevel])),
      certificateLevel,
      next: nextStep(track, progress, finalExamUnlocked(progress), certificateLevel),
      lastActivity: lastActivity ?? null
    };
  });

  return { track, chaptersTotal: chapterIds.length, rows };
}

export function chapterHref(trackSlug: string, moduleSlug: string, topicSlug: string, chapterSlug: string) {
  return `/knowledge/${trackSlug}/${moduleSlug}/${topicSlug}/${chapterSlug}`;
}
