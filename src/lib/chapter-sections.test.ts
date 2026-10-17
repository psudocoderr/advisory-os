import { describe, expect, it } from "vitest";
import { splitSections } from "./chapter-sections";

describe("splitSections", () => {
  it("splits an intro and sections, keeping ### nested", () => {
    const md = "# Title\n\nIntro.\n\n## One\n\nA.\n\n### Sub\n\nB.\n\n## Two ##\n\nC.";
    expect(splitSections(md)).toEqual({
      intro: "# Title\n\nIntro.",
      sections: [
        { heading: "One", body: "A.\n\n### Sub\n\nB." },
        { heading: "Two", body: "C." }
      ]
    });
  });

  it("does not split on ## inside a code fence", () => {
    const md = "## Real\n\n```md\n## not a heading\n```\n\n~~~\n## nor this\n~~~";
    const { sections } = splitSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain("## not a heading");
    expect(sections[0].body).toContain("## nor this");
  });

  it("returns no sections when there are no ## headings", () => {
    expect(splitSections("Just text.\n\n### Small")).toEqual({ intro: "Just text.\n\n### Small", sections: [] });
  });
});
