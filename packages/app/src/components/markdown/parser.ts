import MarkdownIt from "markdown-it";
import markdownItMath from "markdown-it-math/no-default-renderer";

export function createMarkdownParser(): MarkdownIt {
  return MarkdownIt({ typographer: true, linkify: true }).use(markdownItMath, {
    inlineDelimiters: ["$", ["\\(", "\\)"]],
    blockDelimiters: ["$$", ["\\[", "\\]"]],
    inlineRenderer: (source) => source,
    blockRenderer: (source) => source,
  });
}
