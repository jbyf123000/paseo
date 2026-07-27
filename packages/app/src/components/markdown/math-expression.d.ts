import type { TextStyle } from "react-native";

export interface MathExpressionProps {
  latex: string;
  fallback: string;
  displayMode: boolean;
  color?: TextStyle["color"];
}

export declare function MathExpression(props: MathExpressionProps): React.JSX.Element;
