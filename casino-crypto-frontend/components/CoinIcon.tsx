import type { CSSProperties } from "react";

const COIN_ICON_SRC = "/assets/coin-dino-original.png";
const COIN_ICON_SCALE = 1.75;

type CoinIconProps = {
  size?: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

export default function CoinIcon({ size = 16, alt = "", className, style }: CoinIconProps) {
  const scaledSize = Math.round(size * COIN_ICON_SCALE);
  return (
    <img
      src={COIN_ICON_SRC}
      alt={alt}
      className={className}
      style={{ width: scaledSize, height: scaledSize, objectFit: "contain", flexShrink: 0, ...style }}
    />
  );
}
