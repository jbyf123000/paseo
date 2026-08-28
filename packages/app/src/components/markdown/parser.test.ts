import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "./parser";

describe("LaTeX Markdown parser", () => {
  it("emits inline and block math tokens", () => {
    const parser = createMarkdownParser();
    const inlineTokens = parser
      .parse("Inline $f(x)=x^2$ formula", {})
      .flatMap((token) => token.children ?? [token])
      .filter((token) => token.type.startsWith("math_"));
    const blockTokens = parser
      .parse("$$\n\\lim_{x\\to0}\\frac{\\sin x}{x}=1\n$$", {})
      .filter((token) => token.type.startsWith("math_"));
    const latexDelimiterTokens = parser
      .parse("\\[\n\\boxed{x^2}\n\\]", {})
      .filter((token) => token.type.startsWith("math_"));

    expect(inlineTokens).toEqual([
      expect.objectContaining({ type: "math_inline", content: "f(x)=x^2" }),
    ]);
    expect(blockTokens).toEqual([
      expect.objectContaining({
        type: "math_block",
        content: "\\lim_{x\\to0}\\frac{\\sin x}{x}=1",
      }),
    ]);
    expect(latexDelimiterTokens).toEqual([
      expect.objectContaining({ type: "math_block", content: "\\boxed{x^2}" }),
    ]);
  });

  it("leaves fenced source and unmatched delimiters untouched", () => {
    const parser = createMarkdownParser();
    const fencedTokens = parser
      .parse("```latex\n$x^2$\n```", {})
      .flatMap((token) => token.children ?? [token])
      .filter((token) => token.type.startsWith("math_"));
    const priceTokens = parser
      .parse("Price $100", {})
      .flatMap((token) => token.children ?? [token])
      .filter((token) => token.type.startsWith("math_"));

    expect(fencedTokens).toEqual([]);
    expect(priceTokens).toEqual([]);
  });
});
