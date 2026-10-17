import Markdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitSections } from "@/lib/chapter-sections";

/**
 * Chapter text is pasted in from client documents, so it is treated as
 * untrusted: react-markdown escapes raw HTML rather than rendering it, and
 * its default URL transform drops javascript: and other unsafe link targets.
 * Do not add rehype-raw here. Every <Markdown> below uses these options.
 */
const markdownOptions: Options = {
  remarkPlugins: [remarkGfm],
  components: {
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
};

/**
 * Renders a chapter's markdown. With `collapsible` (the default), each `## `
 * section folds into a native <details>, closed until the reader opens it.
 */
export function ChapterBody({ markdown, collapsible = true }: { markdown: string; collapsible?: boolean }) {
  const { intro, sections } = splitSections(markdown);

  if (!collapsible || sections.length === 0) {
    return (
      <div className="chapter-body">
        <Markdown {...markdownOptions}>{markdown}</Markdown>
      </div>
    );
  }

  return (
    <div className="chapter-body">
      {intro ? <Markdown {...markdownOptions}>{intro}</Markdown> : null}
      {sections.map((section, i) => (
        <details key={i} className="chapter-section">
          <summary>
            <Markdown {...markdownOptions}>{`## ${section.heading}`}</Markdown>
          </summary>
          <div className="chapter-section-body">
            <Markdown {...markdownOptions}>{section.body}</Markdown>
          </div>
        </details>
      ))}
    </div>
  );
}
