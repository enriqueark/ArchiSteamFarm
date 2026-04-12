const XP_DISPLAY_DIVISOR = BigInt("100000000");
const MAX_LEVEL = 100;

// Mirrors backend progression curve (scaled XP thresholds by level).
const LEVEL_TOTAL_XP_SCALED = [
  BigInt("0"), BigInt("2072964945"), BigInt("4361670956"), BigInt("6888570996"), BigInt("9678454792"), BigInt("12758692028"), BigInt("16159500851"),
  BigInt("19914244322"), BigInt("24059757718"), BigInt("28636709899"), BigInt("33690002281"), BigInt("39269209337"), BigInt("45429064935"),
  BigInt("52229999300"), BigInt("59738731849"), BigInt("68028925736"), BigInt("77181910509"), BigInt("87287479979"), BigInt("98444773132"),
  BigInt("110763246706"), BigInt("124363749010"), BigInt("139379705473"), BigInt("155958427604"), BigInt("174262558156"), BigInt("194471666714"),
  BigInt("216784011325"), BigInt("241418483480"), BigInt("268616755510"), BigInt("298645651472"), BigInt("331799764780"), BigInt("368404348269"),
  BigInt("408818505024"), BigInt("453438711309"), BigInt("502702706127"), BigInt("557093785583"), BigInt("617145544181"), BigInt("683447109563"),
  BigInt("756648922045"), BigInt("837469115651"), BigInt("926700563250"), BigInt("1025218654896"), BigInt("1133989885698"), BigInt("1254081337456"),
  BigInt("1386671147087"), BigInt("1533060064538"), BigInt("1694684213574"), BigInt("1873129180628"), BigInt("2070145569929"), BigInt("2287666177509"),
  BigInt("2527824952572"), BigInt("2792977932245"), BigInt("3085726355078"), BigInt("3408942180059"), BigInt("3765796261483"), BigInt("4159789456080"),
  BigInt("4594786967582"), BigInt("5075056265652"), BigInt("5605308951172"), BigInt("6190746978609"), BigInt("6837113688914"), BigInt("7550750153596"),
  BigInt("8338657382733"), BigInt("9208565007204"), BigInt("10169007108924"), BigInt("11229405943015"), BigInt("12400164373250"), BigInt("13692767927593"),
  BigInt("15119897475031"), BigInt("16695553629097"), BigInt("18435194098531"), BigInt("20355885332518"), BigInt("22476469948208"), BigInt("24817751583033"),
  BigInt("27402698985277"), BigInt("30256671345108"), BigInt("33407667076629"), BigInt("36886598491597"), BigInt("40727595059436"), BigInt("44968338228640"),
  BigInt("49650431094259"), BigInt("54819806538044"), BigInt("60527177845229"), BigInt("66828536218655"), BigInt("73785700071015"), BigInt("81466921483957"),
  BigInt("89947555783613"), BigInt("99310800801302"), BigInt("109648513071814"), BigInt("121062108976438"), BigInt("133663559671255"),
  BigInt("147576489561261"), BigInt("162937389096729"), BigInt("179896953789728"), BigInt("198621562587013"), BigInt("219294910102595"),
  BigInt("242119808722747"), BigInt("267320178262682"), BigInt("295143242694112"), BigInt("325861955494284"), BigInt("359777677410002")
] as const;

function toBigIntSafe(value: string | undefined): bigint {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

function scaledToDisplay(value: bigint): number {
  return Number(value / XP_DISPLAY_DIVISOR);
}

function getLevelFromScaledXp(xpScaled: bigint): number {
  if (xpScaled <= BigInt(0)) return 1;
  let low = 0;
  let high = LEVEL_TOTAL_XP_SCALED.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const threshold = LEVEL_TOTAL_XP_SCALED[mid];
    if (threshold === xpScaled) {
      return Math.min(MAX_LEVEL, mid + 1);
    }
    if (threshold < xpScaled) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.min(MAX_LEVEL, Math.max(1, high + 1));
}

export function getLevelProgressFromXpAtomic(xpAtomic?: string) {
  const xpScaled = toBigIntSafe(xpAtomic);
  const level = getLevelFromScaledXp(xpScaled);
  if (level >= MAX_LEVEL) {
    const totalDisplay = Math.max(1, scaledToDisplay(xpScaled));
    return {
      level,
      current: totalDisplay,
      target: totalDisplay,
      ratio: 1
    };
  }

  const currentThreshold = LEVEL_TOTAL_XP_SCALED[level - 1] ?? BigInt(0);
  const nextThreshold =
    LEVEL_TOTAL_XP_SCALED[level] ??
    LEVEL_TOTAL_XP_SCALED[LEVEL_TOTAL_XP_SCALED.length - 1] ??
    currentThreshold;

  const spanScaled = nextThreshold > currentThreshold ? nextThreshold - currentThreshold : BigInt(0);
  const progressScaledRaw = xpScaled - currentThreshold;
  const progressScaled =
    spanScaled <= BigInt(0)
      ? BigInt(0)
      : progressScaledRaw < BigInt(0)
        ? BigInt(0)
        : progressScaledRaw > spanScaled
          ? spanScaled
          : progressScaledRaw;

  const targetDisplay = Math.max(1, scaledToDisplay(spanScaled));
  const currentDisplay = Math.max(0, Math.min(targetDisplay, scaledToDisplay(progressScaled)));
  const ratio = Math.max(0, Math.min(1, currentDisplay / targetDisplay));

  return {
    level,
    current: currentDisplay,
    target: targetDisplay,
    ratio
  };
}

export function getLevelAccentColor(level: number): string {
  if (level >= 100) return "#ffffff";
  if (level <= 19) return "#53ff87";
  if (level <= 39) return "#53a3ff";
  if (level <= 59) return "#ffc353";
  if (level <= 79) return "#c053ff";
  return "#ff5353";
}
