export type ChapterSection = { heading: string; body: string };

/**
 * Splits chapter markdown at its `## ` headings. Text before the first one is
 * the intro; `###` and deeper stay inside their section. Lines inside code
 * fences never split, so a `## ` in a code sample stays code.
 */
export function splitSections(markdown: string): { intro: string; sections: ChapterSection[] } {
  const intro: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    }

    const heading = fence === null && !marker ? /^ {0,3}## +(.*?)\s*#*\s*$/.exec(line) : null;
    if (heading) sections.push({ heading: heading[1], lines: [] });
    else (sections.at(-1)?.lines ?? intro).push(line);
  }

  return {
    intro: intro.join("\n").trim(),
    sections: sections.map((s) => ({ heading: s.heading, body: s.lines.join("\n").trim() }))
  };
}
