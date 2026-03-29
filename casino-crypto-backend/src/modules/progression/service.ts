import { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/db/prisma";

const XP_SCALE = 1_000_000n;
const XP_PER_COIN_SCALED = 100n * XP_SCALE;

export const MAX_LEVEL = 100;

export const LEVEL_TOTAL_XP_SCALED = [
  0n, // L1
  2072964945n, // L2
  4361670956n, // L3
  6888570996n, // L4
  9678454792n, // L5
  12758692028n, // L6
  16159500851n, // L7
  19914244322n, // L8
  24059757718n, // L9
  28636709899n, // L10
  33690002281n, // L11
  39269209337n, // L12
  45429064935n, // L13
  52229999300n, // L14
  59738731849n, // L15
  68028925736n, // L16
  77181910509n, // L17
  87287479979n, // L18
  98444773132n, // L19
  110763246706n, // L20
  124363749010n, // L21
  139379705473n, // L22
  155958427604n, // L23
  174262558156n, // L24
  194471666714n, // L25
  216784011325n, // L26
  241418483480n, // L27
  268616755510n, // L28
  298645651472n, // L29
  331799764780n, // L30
  368404348269n, // L31
  408818505024n, // L32
  453438711309n, // L33
  502702706127n, // L34
  557093785583n, // L35
  617145544181n, // L36
  683447109563n, // L37
  756648922045n, // L38
  837469115651n, // L39
  926700563250n, // L40
  1025218654896n, // L41
  1133989885698n, // L42
  1254081337456n, // L43
  1386671147087n, // L44
  1533060064538n, // L45
  1694684213574n, // L46
  1873129180628n, // L47
  2070145569929n, // L48
  2287666177509n, // L49
  2527824952572n, // L50
  2792977932245n, // L51
  3085726355078n, // L52
  3408942180059n, // L53
  3765796261483n, // L54
  4159789456080n, // L55
  4594786967582n, // L56
  5075056265652n, // L57
  5605308951172n, // L58
  6190746978609n, // L59
  6837113688914n, // L60
  7550750153596n, // L61
  8338657382733n, // L62
  9208565007204n, // L63
  10169007108924n, // L64
  11229405943015n, // L65
  12400164373250n, // L66
  13692767927593n, // L67
  15119897475031n, // L68
  16695553629097n, // L69
  18435194098531n, // L70
  20355885332518n, // L71
  22476469948208n, // L72
  24817751583033n, // L73
  27402698985277n, // L74
  30256671345108n, // L75
  33407667076629n, // L76
  36886598491597n, // L77
  40727595059436n, // L78
  44968338228640n, // L79
  49650431094259n, // L80
  54819806538044n, // L81
  60527177845229n, // L82
  66828536218655n, // L83
  73785700071015n, // L84
  81466921483957n, // L85
  89947555783613n, // L86
  99310800801302n, // L87
  109648513071814n, // L88
  121062108976438n, // L89
  133663559671255n, // L90
  147576489561261n, // L91
  162937389096729n, // L92
  179896953789728n, // L93
  198621562587013n, // L94
  219294910102595n, // L95
  242119808722747n, // L96
  267320178262682n, // L97
  295143242694112n, // L98
  325861955494284n, // L99
  359777677410002n // L100
] as const;

export const getLevelFromXp = (xpScaled: bigint): number => {
  if (xpScaled <= 0n) {
    return 1;
  }

  let low = 0;
  let high = LEVEL_TOTAL_XP_SCALED.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = LEVEL_TOTAL_XP_SCALED[mid];
    if (value === xpScaled) {
      return mid + 1;
    }
    if (value < xpScaled) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return Math.min(MAX_LEVEL, Math.max(1, high + 1));
};

export const coinsAtomicToXpScaled = (amountAtomic: bigint): bigint => {
  if (amountAtomic <= 0n) {
    return 0n;
  }
  // amountAtomic is in 1e-8 coins; 1 coin => 100 xp.
  // xpScaled keeps 6 decimals to preserve progression precision.
  return amountAtomic * XP_PER_COIN_SCALED / 100000000n;
};

const isMissingLevelXpColumn = (error: unknown): boolean => {
  // Prisma uses P2022 for missing-column errors.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("levelxpatomic");
  }
  return false;
};

let ensureLevelXpColumnPromise: Promise<void> | null = null;

const ensureLevelXpColumnExistsBestEffort = async (): Promise<void> => {
  if (ensureLevelXpColumnPromise) {
    return ensureLevelXpColumnPromise;
  }

  ensureLevelXpColumnPromise = (async () => {
    try {
      // Self-heal old deployments where the migration did not run yet.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "levelXpAtomic" BIGINT NOT NULL DEFAULT 0'
      );
    } catch {
      // If this fails (permissions/locks), caller will safely ignore.
    } finally {
      ensureLevelXpColumnPromise = null;
    }
  })();

  await ensureLevelXpColumnPromise;
};

export const addUserXpInTx = async (
  tx: Prisma.TransactionClient,
  userId: string,
  wagerAtomic: bigint
): Promise<{ levelXpAtomic: bigint; level: number; gainedXpAtomic: bigint }> => {
  const gainedXpAtomic = coinsAtomicToXpScaled(wagerAtomic);

  try {
    if (gainedXpAtomic <= 0n) {
      const row = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { levelXpAtomic: true }
      });
      return {
        levelXpAtomic: row.levelXpAtomic,
        level: getLevelFromXp(row.levelXpAtomic),
        gainedXpAtomic: 0n
      };
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        levelXpAtomic: {
          increment: gainedXpAtomic
        }
      },
      select: {
        levelXpAtomic: true
      }
    });

    return {
      levelXpAtomic: updated.levelXpAtomic,
      level: getLevelFromXp(updated.levelXpAtomic),
      gainedXpAtomic
    };
  } catch (error) {
    // Safety fallback for deployments where the migration adding levelXpAtomic
    // hasn't run yet. Never block auth/game flows due to progression storage.
    if (isMissingLevelXpColumn(error)) {
      return {
        levelXpAtomic: 0n,
        level: 1,
        gainedXpAtomic: 0n
      };
    }
    throw error;
  }
};

export const addUserXpBestEffort = async (userId: string, wagerAtomic: bigint): Promise<void> => {
  const runIncrement = async (): Promise<void> => {
    await prisma.$transaction(async (tx) => {
      await addUserXpInTx(tx, userId, wagerAtomic);
    });
  };

  try {
    await runIncrement();
    return;
  } catch (error) {
    if (!isMissingLevelXpColumn(error)) {
      return;
    }
  }

  // If the column is missing, try to create it and retry once.
  await ensureLevelXpColumnExistsBestEffort();
  try {
    await runIncrement();
  } catch {
    // Never let progression updates block core betting flows.
  }
};

// Backward-compatible alias for existing call sites.
export const applyWagerXpInTx = addUserXpInTx;

export const getLevelFromXpAtomic = getLevelFromXp;

