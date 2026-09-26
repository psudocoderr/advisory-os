import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a chapter's markdown.
 *
 * Chapter text is pasted in from client documents, so it is treated as
 * untrusted: react-markdown escapes raw HTML rather than rendering it, and
 * its default URL transform drops javascript: and other unsafe link targets.
 * Do not add rehype-raw here.
 */
export function ChapterBody({ markdown }: { markdown: string }) {
  return (
    <div className="chapter-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
