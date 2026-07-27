import MarkdownIt from "markdown-it";
import { createMarkdownParser } from "@/components/markdown/parser";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = createMarkdownParser();
  const defaultValidateLink = parser.validateLink.bind(parser);

  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
