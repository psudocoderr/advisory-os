import type { BadgeLevel } from "@prisma/client";
import { outranks } from "@/lib/irt";
import { prisma } from "@/lib/prisma";

/**
 * What a trainee may open in a track (decisions.md 2026-10-17).
 *
 * Modules open in order: the first is open, each later one once the module
 * before it has its badge. Inside an open module, topics open in order: the
 * first is open, each later one once the topic before it is passed. Inside an
 * open topic, chapters open one at a time as the previous one is marked
 * complete, and the topic test opens once every chapter is complete.
 *
 * A topic with no published chapters is "coming soon": shown, never open,
 * skipped by the order and left out of the module badge until it has content.
 *
 * The module badge is not stored: it is held while every counted topic of the
 * module has a topic badge, at the lowest of their levels. Publishing a new
 * topic therefore takes it away until that topic is passed.
 *
 * Pure, so the same rule is shared by the pages that show locks and the
 * server code that enforces them. Hiding a link is not a lock; every write
 * and every page load checks this.
 */
export type ChapterState = "complete" | "open" | "locked";

export type TopicProgress = {
  id: string;
  moduleId: string;
  comingSoon: boolean;
  unlocked: boolean;
  chapters: { id: string; state: ChapterState }[];
  chaptersDone: number;
  testUnlocked: boolean;
  badged: boolean;
};

export type ModuleProgress = {
  id: string;
  unlocked: boolean;
  /** Topics that count toward the badge: published and with chapters. */
  topicsCounted: number;
  topicsPassed: number;
  /** Held when every counted topic is passed; the lowest of their levels. */
  badged: boolean;
  badgeLevel: BadgeLevel | null;
};

export function trackProgress(
  modules: { id: string; topics: { id: string; chapters: { id: string }[] }[] }[],
  completedChapterIds: ReadonlySet<string>,
  /** Active topic badges: topic id -> level. */
  topicBadges: ReadonlyMap<string, BadgeLevel | null>,
  /** Admins preview everything with content; nothing is locked for them. */
  unlockAll = false
): { topics: TopicProgress[]; modules: ModuleProgress[] } {
  const topics: TopicProgress[] = [];
  const moduleRows: ModuleProgress[] = [];
  let previousModuleBadged = true;

  for (const trainingModule of modules) {
    const moduleUnlocked = unlockAll || previousModuleBadged;
    let previousTopicPassed = true;
    const counted: TopicProgress[] = [];

    for (const topic of trainingModule.topics) {
      const comingSoon = topic.chapters.length === 0;
      const unlocked = !comingSoon && moduleUnlocked && (unlockAll || previousTopicPassed);
      let previousDone = true;
      const chapters = topic.chapters.map(({ id }) => {
        const done = completedChapterIds.has(id);
        const state: ChapterState = done ? "complete" : unlocked && (previousDone || unlockAll) ? "open" : "locked";
        previousDone = done;
        return { id, state };
      });
      const chaptersDone = chapters.filter((chapter) => chapter.state === "complete").length;
      const row: TopicProgress = {
        id: topic.id,
        moduleId: trainingModule.id,
        comingSoon,
        unlocked,
        chapters,
        chaptersDone,
        testUnlocked: unlocked && (unlockAll || chaptersDone === chapters.length),
        badged: topicBadges.has(topic.id)
      };
      topics.push(row);
      if (comingSoon) continue;
      counted.push(row);
      previousTopicPassed = row.badged;
    }

    const badged = counted.length > 0 && counted.every((topic) => topic.badged);
    moduleRows.push({
      id: trainingModule.id,
      unlocked: moduleUnlocked,
      topicsCounted: counted.length,
      topicsPassed: counted.filter((topic) => topic.badged).length,
      badged,
      badgeLevel: badged ? lowestLevel(counted.map((topic) => topicBadges.get(topic.id) ?? null)) : null
    });
    // A module with nothing to pass yet is skipped, like a coming-soon topic.
    if (counted.length > 0) previousModuleBadged = badged;
  }

  return { topics, modules: moduleRows };
}

function lowestLevel(levels: (BadgeLevel | null)[]): BadgeLevel | null {
  return levels.reduce<BadgeLevel | null>((lowest, level) => {
    if (level === null) return lowest;
    return lowest === null || outranks(lowest, level) ? level : lowest;
  }, null);
}

/**
 * A track with its modules, their published topics and those topics'
 * published chapters, in order, numbered: module "1", topic "1.0", chapter
 * "1.0.1". Modules count from 1, topics from 0 (the client's numbering),
 * chapters from 1; the numbers follow the order, so reordering renumbers.
 * `topics` is the same topics as one list in track order, each carrying its
 * module.
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
  const modules = track.modules.map((trainingModule, moduleIndex) => {
    const number = String(moduleIndex + 1);
    return {
      ...trainingModule,
      number,
      topics: trainingModule.topics.map((topic, topicIndex) => {
        const topicNumber = `${number}.${topicIndex}`;
        return {
          ...topic,
          number: topicNumber,
          chapters: topic.chapters.map((chapter, chapterIndex) => ({
            ...chapter,
            number: `${topicNumber}.${chapterIndex + 1}`
          }))
        };
      })
    };
  });
  const topics = modules.flatMap(({ topics, ...trainingModule }) =>
    topics.map((topic) => ({ ...topic, module: trainingModule }))
  );
  return { ...track, modules, topics };
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
    prisma.certification.findMany({
      where: { userId: user.id, trackId: track.id, status: "ACTIVE", topicId: { not: null } },
      select: { topicId: true, badgeLevel: true }
    })
  ]);

  const badgeLevels = new Map(badges.map((row) => [row.topicId!, row.badgeLevel]));
  const { topics, modules } = trackProgress(
    track.modules,
    new Set(completions.map((row) => row.chapterId)),
    badgeLevels,
    user.role === "ADMIN"
  );
  return { track, progress: topics, moduleProgress: modules, badgeLevels };
}

type TrackOutline = {
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
export function nextStep(track: TrackOutline, progress: TopicProgress[]): { label: string; href: string } {
  const index = progress.findIndex((topic) => !topic.comingSoon && !topic.badged);
  const current = track.topics[index];
  if (!current) {
    const any = progress.some((topic) => !topic.comingSoon);
    return { label: any ? "Every topic passed" : "Nothing to do yet", href: `/knowledge/${track.slug}` };
  }
  if (progress[index].testUnlocked)
    return { label: `Take the "${current.title}" test`, href: `/certify/${current.id}` };
  const chapterIndex = progress[index].chapters.findIndex((chapter) => chapter.state === "open");
  const chapter = current.chapters[chapterIndex];
  if (!chapter) return { label: `"${current.title}" is locked`, href: `/knowledge/${track.slug}` };
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
      where: { trackId: track.id, status: "ACTIVE", topicId: { not: null } },
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
    const badgeLevels = new Map(
      certifications.filter((row) => row.userId === user.id).map((row) => [row.topicId!, row.badgeLevel])
    );
    const { topics, modules } = trackProgress(
      track.modules,
      new Set(completions.filter((row) => row.userId === user.id).map((row) => row.chapterId)),
      badgeLevels
    );
    const lastActivity = [
      lastCompletion.find((row) => row.userId === user.id)?._max.completedAt,
      lastAttempt.find((row) => row.userId === user.id)?._max.startedAt
    ]
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      user,
      chaptersDone: topics.reduce((sum, topic) => sum + topic.chaptersDone, 0),
      badgeLevels,
      moduleProgress: modules,
      next: nextStep(track, topics),
      lastActivity: lastActivity ?? null
    };
  });

  return { track, chaptersTotal: chapterIds.length, rows };
}

export function chapterHref(trackSlug: string, moduleSlug: string, topicSlug: string, chapterSlug: string) {
  return `/knowledge/${trackSlug}/${moduleSlug}/${topicSlug}/${chapterSlug}`;
}
