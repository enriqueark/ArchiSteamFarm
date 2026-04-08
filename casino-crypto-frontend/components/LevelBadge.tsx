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
        border: isRainbow ? undefined : `1px solid ${tier.color}`,
        background: isRainbow ? undefined : tier.bg,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: '"DM Sans","Gotham",sans-serif',
        color: isRainbow ? undefined : tier.color,
        lineHeight: "1",
        boxShadow: isRainbow ? undefined : `0 0 8px ${tier.color}40, inset 0 0 4px ${tier.color}20`,
        animation: isRainbow ? "rainbowGlow 6s ease-in-out infinite" : "levelPulse 2s ease-in-out infinite",
        textShadow: isRainbow ? undefined : `0 0 6px ${tier.color}80`,
      }}
    >
      {level}
    </span>
  );
}
