import type { ReactNode } from "react";
import type { TextStyle } from "react-native";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { MarkdownStyles } from "./renderer";
import { MathExpression } from "./math-expression";

function formulaFallback(node: ASTNode): string {
  const delimiter = node.markup || (node.type === "math_block" ? "$$" : "$");
  return `${delimiter}${node.content ?? ""}${delimiter}`;
}

export function createMathMarkdownRules(): RenderRules {
  return {
    math_inline: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MathExpression
        key={node.key}
        latex={node.content ?? ""}
        fallback={formulaFallback(node)}
        displayMode={false}
        color={inheritedStyles.color ?? styles.text.color}
      />
    ),
    math_block: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles: TextStyle = {},
    ) => (
      <MathExpression
        key={node.key}
        latex={node.content ?? ""}
        fallback={formulaFallback(node)}
        displayMode
        color={inheritedStyles.color ?? styles.text.color}
      />
    ),
  };
}
