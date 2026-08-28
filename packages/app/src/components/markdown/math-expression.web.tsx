import { renderToString } from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import type { TextStyle } from "react-native";

interface MathExpressionProps {
  latex: string;
  fallback: string;
  displayMode: boolean;
  color?: TextStyle["color"];
}

export function MathExpression({ latex, fallback, displayMode, color }: MathExpressionProps) {
  const html = useMemo(() => {
    try {
      return renderToString(latex, { displayMode, throwOnError: true });
    } catch {
      return null;
    }
  }, [displayMode, latex]);
  const textColor = typeof color === "string" ? color : undefined;
  const style = useMemo(() => ({ color: textColor }), [textColor]);
  const dangerouslySetInnerHTML = useMemo(() => (html ? { __html: html } : undefined), [html]);

  if (!html) {
    return <span style={style}>{fallback}</span>;
  }

  if (displayMode) {
    return <div style={style} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />;
  }

  return <span style={style} dangerouslySetInnerHTML={dangerouslySetInnerHTML} />;
}
