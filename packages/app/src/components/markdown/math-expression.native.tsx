import { renderToString } from "katex";
import { useMemo } from "react";
import { Text, type TextStyle } from "react-native";
import Katex from "react-native-katex";

interface MathExpressionProps {
  latex: string;
  fallback: string;
  displayMode: boolean;
  color?: TextStyle["color"];
}

export function MathExpression({ latex, fallback, displayMode, color }: MathExpressionProps) {
  const isValid = useMemo(() => {
    try {
      renderToString(latex, { throwOnError: true });
      return true;
    } catch {
      return false;
    }
  }, [latex]);
  const textColor = typeof color === "string" ? color : "#000";
  const inlineStyle = `
    html, body {
      align-items: center;
      background: transparent;
      color: ${textColor};
      display: flex;
      height: 100%;
      justify-content: ${displayMode ? "center" : "flex-start"};
      margin: 0;
      padding: 0;
    }
    .katex { margin: 0; }
  `;
  const fallbackStyle = useMemo(() => ({ color }), [color]);
  const katexStyle = useMemo(
    () => ({ alignSelf: "stretch" as const, height: displayMode ? 72 : 32 }),
    [displayMode],
  );

  if (!isValid) {
    return <Text style={fallbackStyle}>{fallback}</Text>;
  }

  return (
    <Katex
      expression={latex}
      displayMode={displayMode}
      colorIsTextColor
      inlineStyle={inlineStyle}
      style={katexStyle}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    />
  );
}
