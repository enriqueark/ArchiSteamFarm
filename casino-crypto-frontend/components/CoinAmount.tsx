import type { CSSProperties } from "react";
import CoinIcon from "./CoinIcon";

type CoinAmountProps = {
  amount: string;
  prefix?: string;
  suffix?: string;
  iconSize?: number;
  gap?: number;
  className?: string;
  style?: CSSProperties;
  textClassName?: string;
  textStyle?: CSSProperties;
};

export default function CoinAmount({
  amount,
  prefix = "",
  suffix = "",
  iconSize = 16,
  gap = 6,
  className,
  style,
  textClassName,
  textStyle
}: CoinAmountProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap, whiteSpace: "nowrap", ...style }}
    >
      <CoinIcon size={iconSize} />
      <span className={textClassName} style={textStyle}>
        {prefix}
        {amount}
        {suffix}
      </span>
    </span>
  );
}
