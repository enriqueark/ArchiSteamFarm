import type { CSSProperties } from "react";

const COIN_ICON_SRC = "/assets/coin-dino-original.png";

type CoinIconProps = {
  size?: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
};

export default function CoinIcon({ size = 16, alt = "", className, style }: CoinIconProps) {
  return (
    <img
      src={COIN_ICON_SRC}
      alt={alt}
      className={className}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, ...style }}
    />
  );
}
