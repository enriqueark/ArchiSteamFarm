const TIERS = [
  { max: 19, color: "#53ff87", bg: "linear-gradient(180deg, #53ff8738, #53ff87)" },
  { max: 39, color: "#53a3ff", bg: "linear-gradient(180deg, #53a3ff38, #53a3ff)" },
  { max: 59, color: "#ffc353", bg: "linear-gradient(180deg, #ffc35338, #ffc353)" },
  { max: 79, color: "#c053ff", bg: "linear-gradient(180deg, #c053ff38, #c053ff)" },
  { max: 99, color: "#ff5353", bg: "linear-gradient(180deg, #ff535338, #ff5353)" },
  { max: Infinity, color: "#c053ff", bg: "linear-gradient(180deg, #c053ff38, #ffb753)" },
];

function getTier(level: number) {
  return TIERS.find((t) => level <= t.max) || TIERS[TIERS.length - 1];
}

export default function LevelBadge({ level }: { level: number }) {
  const tier = getTier(level);
  const isRainbow = level >= 100;

  if (isRainbow) {
    return (
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 26, height: 20, padding: "0 7px", borderRadius: 6 }}>
        {/* Animated gradient border */}
        <span style={{
          position: "absolute", inset: 0, borderRadius: 6, padding: 1,
          background: "linear-gradient(90deg, #ff5353, #ffb753, #53ff87, #53a3ff, #c053ff, #ff53a3, #ff5353)",
          backgroundSize: "300% 100%",
          animation: "rainbowBorder 4s linear infinite",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }} />
        {/* Inner fill */}
        <span style={{
          position: "absolute", inset: 1, borderRadius: 5,
          background: "linear-gradient(90deg, #ff535325, #ffb75325, #53ff8725, #53a3ff25, #c053ff25, #ff53a325, #ff535325)",
          backgroundSize: "300% 100%",
          animation: "rainbowBorder 4s linear infinite",
        }} />
        {/* Text */}
        <span style={{
          position: "relative", zIndex: 1,
          fontSize: 10, fontWeight: 700, fontFamily: '"DM Sans","Gotham",sans-serif',
          lineHeight: "1",
          background: "linear-gradient(90deg, #ff5353, #ffb753, #53ff87, #53a3ff, #c053ff, #ff53a3, #ff5353)",
          backgroundSize: "300% 100%",
          animation: "rainbowBorder 4s linear infinite",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          filter: "drop-shadow(0 0 4px rgba(255,255,255,0.3))",
        }}>
          {level}
        </span>
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 24,
        height: 18,
        padding: "0 6px",
        borderRadius: 5,
        border: `1px solid ${tier.color}`,
        background: tier.bg,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: '"DM Sans","Gotham",sans-serif',
        color: tier.color,
        lineHeight: "1",
        boxShadow: `0 0 8px ${tier.color}40, inset 0 0 4px ${tier.color}20`,
        animation: "levelPulse 2s ease-in-out infinite",
        textShadow: `0 0 6px ${tier.color}80`,
      }}
    >
      {level}
    </span>
  );
}
