import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signPayload,
  verify as verifySignature
} from "node:crypto";
import { dirname } from "node:path";
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

type WalletAnchorRow = {
  walletId: string;
  userId: string;
  currency: string;
  balanceAtomic: bigint;
  lockedAtomic: bigint;
  chainIndex: bigint;
  currentHash: string;
};

type BetCountRow = {
  pendingCount: bigint;
  settledCount: bigint;
};

type AnchorPayload = {
  walletHeads: Array<{
    walletId: string;
    userId: string;
    currency: string;
    balanceAtomic: string;
    lockedAtomic: string;
    chainIndex: string;
    currentHash: string;
  }>;
  totals: {
    walletCount: number;
    totalBalanceAtomic: string;
    totalLockedAtomic: string;
    pendingBets: string;
    settledBets: string;
  };
};

type AnchorEntry = {
  version: "v1";
  createdAt: string;
  stateHash: string;
  previousEntryHash: string;
  signerKeyId: string;
  signature: string;
  entryHash: string;
};

const ZERO_HASH = "0".repeat(64);
const PRIVATE_KEY_ENV = process.env["INTEGRITY_AUDIT_PRIVATE_KEY"];
const PUBLIC_KEY_ENV = process.env["INTEGRITY_AUDIT_PUBLIC_KEY"];
const ANCHOR_FILE = process.env["INTEGRITY_ANCHOR_FILE"] ?? "integrity-anchors.jsonl";
const ALERT_WEBHOOK_URL = process.env["INTEGRITY_ALERT_WEBHOOK_URL"];
const IS_VERIFY_ONLY = process.argv.includes("--verify-only");
const DATABASE_URL = process.env["DATABASE_URL"];

let pool: Pool | null = null;
let prisma: PrismaClient | null = null;

const getPrisma = (): PrismaClient => {
  if (prisma) {
    return prisma;
  }

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required unless running --verify-only");
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000
  });

  prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: ["warn", "error"]
  });

  return prisma;
};

const ensureHexHash = (value: string, field: string): void => {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be lowercase 64-char hex`);
  }
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
};

const hashSha256Hex = (raw: string): string => createHash("sha256").update(raw).digest("hex");

const buildStateHash = (payload: AnchorPayload): string => hashSha256Hex(stableStringify(payload));

const buildSignedMessage = (entry: Pick<AnchorEntry, "createdAt" | "stateHash" | "previousEntryHash">): string =>
  `${entry.createdAt}|${entry.stateHash}|${entry.previousEntryHash}`;

const buildEntryHash = (
  entry: Pick<AnchorEntry, "createdAt" | "stateHash" | "previousEntryHash" | "signerKeyId" | "signature">
): string =>
  hashSha256Hex(`${entry.createdAt}|${entry.stateHash}|${entry.previousEntryHash}|${entry.signerKeyId}|${entry.signature}`);

const parsePrivateKey = (raw: string): KeyObject => {
  const normalized = raw.replace(/\\n/g, "\n").trim();
  return createPrivateKey(normalized);
};

const parsePublicKey = (raw: string): KeyObject => {
  const normalized = raw.replace(/\\n/g, "\n").trim();
  if (normalized.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(normalized);
  }

  return createPublicKey({
    key: Buffer.from(normalized, "base64"),
    format: "der",
    type: "spki"
  });
};

const deriveSignerKeyId = (publicKey: KeyObject): string => {
  const der = publicKey.export({ format: "der", type: "spki" });
  const fingerprint = createHash("sha256").update(der).digest("hex");
  return fingerprint.slice(0, 16);
};

const signEntry = (
  privateKey: KeyObject,
  entry: Pick<AnchorEntry, "createdAt" | "stateHash" | "previousEntryHash">
): string => signPayload(null, Buffer.from(buildSignedMessage(entry)), privateKey).toString("base64");

const verifyEntrySignature = (
  publicKey: KeyObject,
  entry: Pick<AnchorEntry, "createdAt" | "stateHash" | "previousEntryHash" | "signature">
): boolean => verifySignature(null, Buffer.from(buildSignedMessage(entry)), publicKey, Buffer.from(entry.signature, "base64"));

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const readAnchors = async (path: string): Promise<AnchorEntry[]> => {
  if (!(await fileExists(path))) {
    return [];
  }

  const raw = await readFile(path, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Anchor file contains invalid JSON at line ${idx + 1}`);
    }

    const entry = parsed as Partial<AnchorEntry>;
    if (
      entry.version !== "v1" ||
      typeof entry.createdAt !== "string" ||
      typeof entry.stateHash !== "string" ||
      typeof entry.previousEntryHash !== "string" ||
      typeof entry.signerKeyId !== "string" ||
      typeof entry.signature !== "string" ||
      typeof entry.entryHash !== "string"
    ) {
      throw new Error(`Anchor file line ${idx + 1} has invalid schema`);
    }

    ensureHexHash(entry.stateHash, "stateHash");
    ensureHexHash(entry.previousEntryHash, "previousEntryHash");
    ensureHexHash(entry.entryHash, "entryHash");

    return entry as AnchorEntry;
  });
};

const verifyAnchorChain = async (anchors: AnchorEntry[], publicKey: KeyObject): Promise<void> => {
  let previousEntryHash = ZERO_HASH;

  for (let i = 0; i < anchors.length; i += 1) {
    const entry = anchors[i]!;
    if (entry.previousEntryHash !== previousEntryHash) {
      throw new Error(`Anchor chain broken at position ${i + 1}: previousEntryHash mismatch`);
    }

    const expectedEntryHash = buildEntryHash(entry);
    if (entry.entryHash !== expectedEntryHash) {
      throw new Error(`Anchor chain broken at position ${i + 1}: entryHash mismatch`);
    }

    if (!verifyEntrySignature(publicKey, entry)) {
      throw new Error(`Anchor chain broken at position ${i + 1}: signature verification failed`);
    }

    previousEntryHash = entry.entryHash;
  }
};

const loadKeys = (): { privateKey: KeyObject | null; publicKey: KeyObject } => {
  if (!PRIVATE_KEY_ENV && !PUBLIC_KEY_ENV) {
    throw new Error("Set INTEGRITY_AUDIT_PUBLIC_KEY (and optionally INTEGRITY_AUDIT_PRIVATE_KEY)");
  }

  if (PRIVATE_KEY_ENV) {
    const privateKey = parsePrivateKey(PRIVATE_KEY_ENV);
    const publicKey = createPublicKey(privateKey);
    return { privateKey, publicKey };
  }

  return { privateKey: null, publicKey: parsePublicKey(PUBLIC_KEY_ENV!) };
};

const loadAnchorPayload = async (): Promise<AnchorPayload> => {
  const client = getPrisma();

  const walletRows = await client.$queryRaw<WalletAnchorRow[]>`
    SELECT
      w.id AS "walletId",
      w."userId" AS "userId",
      w."currency"::text AS "currency",
      w."balanceAtomic" AS "balanceAtomic",
      w."lockedAtomic" AS "lockedAtomic",
      COALESCE(last_entry."chainIndex", 0::bigint) AS "chainIndex",
      COALESCE(last_entry."currentHash", ${ZERO_HASH}) AS "currentHash"
    FROM "wallets" w
    LEFT JOIN LATERAL (
      SELECT wt."chainIndex", wt."currentHash"
      FROM "wallet_transactions" wt
      WHERE wt."walletId" = w.id
      ORDER BY wt."chainIndex" DESC
      LIMIT 1
    ) last_entry ON TRUE
    ORDER BY w.id ASC
  `;

  const betCounts = await client.$queryRaw<BetCountRow[]>`
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'PENDING')::bigint AS "pendingCount",
      COUNT(*) FILTER (WHERE "status" IN ('WON', 'LOST'))::bigint AS "settledCount"
    FROM "casino_bets"
  `;

  let totalBalance = 0n;
  let totalLocked = 0n;

  const walletHeads = walletRows.map((row) => {
    totalBalance += row.balanceAtomic;
    totalLocked += row.lockedAtomic;

    return {
      walletId: row.walletId,
      userId: row.userId,
      currency: row.currency,
      balanceAtomic: row.balanceAtomic.toString(),
      lockedAtomic: row.lockedAtomic.toString(),
      chainIndex: row.chainIndex.toString(),
      currentHash: row.currentHash
    };
  });

  const counts = betCounts[0] ?? { pendingCount: 0n, settledCount: 0n };

  return {
    walletHeads,
    totals: {
      walletCount: walletHeads.length,
      totalBalanceAtomic: totalBalance.toString(),
      totalLockedAtomic: totalLocked.toString(),
      pendingBets: counts.pendingCount.toString(),
      settledBets: counts.settledCount.toString()
    }
  };
};

const notifyAlert = async (message: string, details?: Record<string, unknown>): Promise<void> => {
  if (!ALERT_WEBHOOK_URL) {
    return;
  }

  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        severity: "CRITICAL",
        message,
        details,
        emittedAt: new Date().toISOString()
      })
    });
  } catch {
    // Do not fail anchor flow on alert delivery errors.
  }
};

const appendAnchor = async (entry: AnchorEntry): Promise<void> => {
  await mkdir(dirname(ANCHOR_FILE), { recursive: true });
  await appendFile(ANCHOR_FILE, `${JSON.stringify(entry)}\n`, "utf8");
};

const run = async (): Promise<void> => {
  const { privateKey, publicKey } = loadKeys();
  const signerKeyId = deriveSignerKeyId(publicKey);

  const anchors = await readAnchors(ANCHOR_FILE);
  await verifyAnchorChain(anchors, publicKey);

  const previousEntryHash = anchors.length > 0 ? anchors[anchors.length - 1]!.entryHash : ZERO_HASH;

  if (IS_VERIFY_ONLY) {
    const verificationReport = {
      ok: true,
      mode: "verify-only",
      anchorFile: ANCHOR_FILE,
      signerKeyId,
      anchorsVerified: anchors.length,
      latestEntryHash: previousEntryHash
    };
    console.log(JSON.stringify(verificationReport, null, 2));
    return;
  }

  if (!privateKey) {
    throw new Error("INTEGRITY_AUDIT_PRIVATE_KEY is required to append a new anchor");
  }

  const payload = await loadAnchorPayload();
  const stateHash = buildStateHash(payload);
  const createdAt = new Date().toISOString();
  const signature = signEntry(privateKey, {
    createdAt,
    stateHash,
    previousEntryHash
  });

  const entryHash = buildEntryHash({
    createdAt,
    stateHash,
    previousEntryHash,
    signerKeyId,
    signature
  });

  const entry: AnchorEntry = {
    version: "v1",
    createdAt,
    stateHash,
    previousEntryHash,
    signerKeyId,
    signature,
    entryHash
  };

  await appendAnchor(entry);

  const report = {
    ok: true,
    mode: "append",
    anchorFile: ANCHOR_FILE,
    signerKeyId,
    previousEntryHash,
    currentEntryHash: entryHash,
    payloadTotals: payload.totals
  };
  console.log(JSON.stringify(report, null, 2));
};

void run()
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown integrity anchor error";
    await notifyAlert("Integrity anchor verification/appending failed", { error: message, anchorFile: ANCHOR_FILE });
    console.error(
      JSON.stringify(
        {
          ok: false,
          fatal: true,
          message
        },
        null,
        2
      )
    );
    process.exitCode = 2;
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
  });
