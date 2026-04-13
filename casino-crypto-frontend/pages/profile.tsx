import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  getChatProfileByPublicId,
  getChatProfileByUserId,
  getMyGameHistory,
  getMe,
  getProfileSummary,
  type ProfileSummary,
  setMyProfileVisibility,
  type ChatPublicProfileSummary,
  type User
} from "@/lib/api";
import { useToast } from "@/lib/toast";
import { getLevelProgressFromXpAtomic } from "@/lib/levelProgress";
import { getGameVolume, setGameVolume } from "@/lib/gameAudio";

type HydratedProfile = {
  avatarUrl: string | null;
  username: string;
  publicId: number | null;
  email: string;
  level: number;
  profileVisible: boolean;
  xpAtomic: string;
  xpCurrent: number;
  xpTarget: number;
  xpRatio: number;
  stats: {
    totalPlayed: string;
    battles: string;
    roulette: string;
    cases: string;
    blackjack: string;
    mines: string;
  };
};

const PROFILE_CANVAS_WIDTH = 1286;
const PROFILE_FETCH_RETRIES = 3;
const PROFILE_FETCH_RETRY_DELAY_MS = 350;
const FALLBACK_PROFILE: HydratedProfile = {
  avatarUrl: null,
  username: "Player",
  publicId: null,
  email: "",
  level: 1,
  profileVisible: true,
  xpAtomic: "0",
  xpCurrent: 0,
  xpTarget: 1000,
  xpRatio: 0,
  stats: {
    totalPlayed: "0.00",
    battles: "0.00",
    roulette: "0.00",
    cases: "0.00",
    blackjack: "0.00",
    mines: "0.00"
  }
};

const LEVEL_BADGE_TIERS = [
  { max: 19, color: "#53ff87", bg: "linear-gradient(180deg, #53ff8738, #53ff87)" },
  { max: 39, color: "#53a3ff", bg: "linear-gradient(180deg, #53a3ff38, #53a3ff)" },
  { max: 59, color: "#ffc353", bg: "linear-gradient(180deg, #ffc35338, #ffc353)" },
  { max: 79, color: "#c053ff", bg: "linear-gradient(180deg, #c053ff38, #c053ff)" },
  { max: 99, color: "#ff5353", bg: "linear-gradient(180deg, #ff535338, #ff5353)" }
] as const;

function getLevelBadgeTier(level: number) {
  return LEVEL_BADGE_TIERS.find((tier) => level <= tier.max) ?? LEVEL_BADGE_TIERS[LEVEL_BADGE_TIERS.length - 1];
}

function renderLevelBadge(doc: Document, level: number) {
  const levelPill = replaceElementWithDiv(doc, "n20731353");
  if (!levelPill) return;

  levelPill.innerHTML = "";
  levelPill.style.marginTop = "0";
  levelPill.style.transform = "translateY(0)";

  if (level >= 100) {
    levelPill.style.position = "relative";
    levelPill.style.display = "inline-flex";
    levelPill.style.alignItems = "center";
    levelPill.style.justifyContent = "center";
    levelPill.style.minWidth = "30px";
    levelPill.style.height = "22px";
    levelPill.style.padding = "0 8px";
    levelPill.style.borderRadius = "6px";
    levelPill.style.border = "none";
    levelPill.style.background = "transparent";
    levelPill.style.boxShadow = "none";

    const border = doc.createElement("span");
    border.style.position = "absolute";
    border.style.inset = "0";
    border.style.borderRadius = "6px";
    border.style.padding = "1px";
    border.style.background =
      "linear-gradient(90deg, #ff5353, #ffb753, #53ff87, #53a3ff, #c053ff, #ff53a3, #ff5353)";
    border.style.backgroundSize = "300% 100%";
    border.style.animation = "rainbowBorder 4s linear infinite";
    border.style.webkitMask = "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)";
    border.style.webkitMaskComposite = "xor";
    border.style.maskComposite = "exclude";
    levelPill.appendChild(border);

    const fill = doc.createElement("span");
    fill.style.position = "absolute";
    fill.style.inset = "1px";
    fill.style.borderRadius = "5px";
    fill.style.background =
      "linear-gradient(90deg, #ff535325, #ffb75325, #53ff8725, #53a3ff25, #c053ff25, #ff53a325, #ff535325)";
    fill.style.backgroundSize = "300% 100%";
    fill.style.animation = "rainbowBorder 4s linear infinite";
    levelPill.appendChild(fill);

    const text = doc.createElement("span");
    text.textContent = String(level);
    text.style.position = "relative";
    text.style.zIndex = "1";
    text.style.fontSize = "11px";
    text.style.fontWeight = "700";
    text.style.fontFamily = "\"DM Sans\",\"Gotham\",sans-serif";
    text.style.lineHeight = "1";
    text.style.background =
      "linear-gradient(90deg, #ff5353, #ffb753, #53ff87, #53a3ff, #c053ff, #ff53a3, #ff5353)";
    text.style.backgroundSize = "300% 100%";
    text.style.animation = "rainbowBorder 4s linear infinite";
    text.style.webkitBackgroundClip = "text";
    text.style.webkitTextFillColor = "transparent";
    text.style.backgroundClip = "text";
    text.style.filter = "drop-shadow(0 0 4px rgba(255,255,255,0.3))";
    levelPill.appendChild(text);
    return;
  }

  const tier = getLevelBadgeTier(level);
  levelPill.textContent = String(level);
  levelPill.style.display = "inline-flex";
  levelPill.style.alignItems = "center";
  levelPill.style.justifyContent = "center";
  levelPill.style.minWidth = "24px";
  levelPill.style.height = "18px";
  levelPill.style.padding = "0 6px";
  levelPill.style.borderRadius = "5px";
  levelPill.style.border = `1px solid ${tier.color}`;
  levelPill.style.background = tier.bg;
  levelPill.style.fontSize = "10px";
  levelPill.style.fontWeight = "700";
  levelPill.style.fontFamily = "\"DM Sans\",\"Gotham\",sans-serif";
  levelPill.style.color = tier.color;
  levelPill.style.lineHeight = "1";
  levelPill.style.boxShadow = `0 0 8px ${tier.color}40, inset 0 0 4px ${tier.color}20`;
  levelPill.style.animation = "levelPulse 2s ease-in-out infinite";
  levelPill.style.textShadow = `0 0 6px ${tier.color}80`;
}

function renderPrivacyToggle(doc: Document, enabled: boolean, busy: boolean) {
  const toggle = replaceElementWithDiv(doc, "n20731455");
  if (!toggle) return;

  toggle.innerHTML = "";
  toggle.className = "";
  toggle.style.marginLeft = "auto";
  toggle.style.width = "48px";
  toggle.style.minWidth = "48px";
  toggle.style.maxWidth = "48px";
  toggle.style.height = "22px";
  toggle.style.minHeight = "0";
  toggle.style.maxHeight = "22px";
  toggle.style.position = "relative";
  toggle.style.display = "flex";
  toggle.style.alignItems = "center";
  toggle.style.justifyContent = enabled ? "flex-end" : "flex-start";
  toggle.style.padding = "1px";
  toggle.style.gap = "0";
  toggle.style.boxSizing = "border-box";
  toggle.style.borderRadius = "999px";
  toggle.style.border = enabled ? "1px solid #f75154" : "1px solid #4a4a4a";
  toggle.style.background = "#232323";
  toggle.style.overflow = "hidden";
  toggle.style.cursor = busy ? "default" : "pointer";
  toggle.style.opacity = busy ? "0.65" : "1";
  toggle.style.transition = "border-color 160ms ease, box-shadow 160ms ease, opacity 160ms ease";
  toggle.style.boxShadow = enabled ? "0 0 8px rgba(247,81,84,0.45)" : "none";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");

  const thumb = doc.createElement("span");
  thumb.style.width = "16px";
  thumb.style.height = "16px";
  thumb.style.borderRadius = "50%";
  thumb.style.background = "#ffffff";
  thumb.style.boxShadow = "0 1px 3px rgba(0,0,0,0.35)";
  thumb.style.pointerEvents = "none";
  toggle.appendChild(thumb);
}

function toCoinsDisplay(input: unknown): string {
  const raw = typeof input === "string" ? input.replace(/,/g, "") : String(input ?? "0");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCoins(input: string | null | undefined): number {
  if (!input) return 0;
  const parsed = Number(input.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCoinsFixed(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function getHistoryWageredByMode() {
  const modeTotals = {
    MINES: 0,
    BLACKJACK: 0,
    ROULETTE: 0,
    CASES: 0,
    BATTLES: 0
  } as const;
  const totals: Record<keyof typeof modeTotals, number> = {
    MINES: 0,
    BLACKJACK: 0,
    ROULETTE: 0,
    CASES: 0,
    BATTLES: 0
  };
  let offset = 0;
  const limit = 100;
  for (let page = 0; page < 20; page += 1) {
    const response = await getMyGameHistory({ limit, offset, mode: "ALL" });
    const items = response.items ?? [];
    items.forEach((item) => {
      if (item.gameMode in totals) {
        totals[item.gameMode as keyof typeof modeTotals] += parseCoins(item.wagerCoins);
      }
    });
    if (!response.pagination?.hasMore) break;
    offset += limit;
  }
  return totals;
}

function setContainerParagraphText(doc: Document, containerId: string, text: string) {
  const container = doc.getElementById(containerId);
  if (!container) return;
  const paragraph = container.querySelector("p");
  if (paragraph) {
    paragraph.textContent = text;
    return;
  }
  container.textContent = text;
}

function normalizeEmbeddedAssetPaths(doc: Document) {
  const assetsPrefix = "/profile-content/assets/";
  const images = doc.querySelectorAll<HTMLImageElement>("img[src]");
  images.forEach((image) => {
    const src = image.getAttribute("src");
    if (!src) return;
    if (src.startsWith("assets/")) {
      image.setAttribute("src", `${assetsPrefix}${src.slice("assets/".length)}`);
      return;
    }
    if (src.startsWith("./assets/")) {
      image.setAttribute("src", `${assetsPrefix}${src.slice("./assets/".length)}`);
    }
  });
}

function injectRuntimeProfileStyles(doc: Document) {
  const styleId = "rw-profile-runtime-overrides";
  const existing = doc.getElementById(styleId) as HTMLStyleElement | null;
  if (existing) return;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `
    @keyframes levelPulse {
      0%, 100% { filter: brightness(1); box-shadow: 0 0 6px currentColor; }
      50% { filter: brightness(1.3); box-shadow: 0 0 14px currentColor; }
    }
    @keyframes rainbowBorder {
      0% { background-position: 0% 50%; }
      100% { background-position: 300% 50%; }
    }
    #n20731350 {
      display: flex !important;
      flex-direction: column !important;
      gap: 8px !important;
    }
    #n20731351 {
      width: 1035px !important;
      max-width: 1035px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 16px !important;
    }
    #n20731353 {
      margin-top: 0 !important;
      transform: translateY(0) !important;
    }
    #n20731355 {
      margin-top: 0 !important;
      transform: translateY(0) !important;
    }
    #n20731356 {
      width: 1035px !important;
      max-width: 1035px !important;
      display: block !important;
      border-radius: 999px !important;
      overflow: hidden !important;
      background: #232323 !important;
    }
    #n20731419, #n20731424, #n20731429, #n20731434 {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto !important;
      column-gap: 24px !important;
      align-items: center !important;
    }
    #n20731434 {
      grid-template-columns: minmax(0, 1fr) 506px !important;
    }
    #n20731438 {
      width: 100% !important;
      justify-content: flex-end !important;
    }
    #n20731423, #n20731428, #n20731433, #n20731442, #n20731455, #n20731478 {
      margin-left: auto !important;
      overflow: hidden !important;
    }
    #n20731423 a, #n20731428 a, #n20731433 a, #n20731442 a, #n20731455 a, #n20731478 a {
      display: block !important;
      width: 100% !important;
      text-decoration: none !important;
      outline: none !important;
      box-shadow: none !important;
      -webkit-tap-highlight-color: transparent !important;
    }
    #n20731423 a:focus, #n20731428 a:focus, #n20731433 a:focus, #n20731442 a:focus, #n20731455 a:focus, #n20731478 a:focus {
      outline: none !important;
      box-shadow: none !important;
    }
    #n20731447 {
      background: #232323 !important;
      border-radius: 999px !important;
      overflow: hidden !important;
      position: relative !important;
    }
    #n20731447::before, #n20731447::after {
      content: none !important;
      display: none !important;
    }
    #n20731444 {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      align-items: start !important;
      column-gap: 28px !important;
    }
    #n20731445, #n20731451 {
      width: 100% !important;
      max-width: none !important;
      display: grid !important;
      grid-template-columns: 1fr auto !important;
      align-items: start !important;
      column-gap: 20px !important;
    }
    #n20731445 {
      justify-content: stretch !important;
    }
    #n20731451 {
      justify-content: stretch !important;
    }
    #n20731446, #n20731452 {
      margin-top: 0 !important;
    }
    #n20731447, #n20731455 {
      margin-top: 2px !important;
      justify-self: end !important;
      align-self: start !important;
    }
    #n20731359 {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 20px !important;
      width: 1245px !important;
      max-width: 1245px !important;
    }
    #n20731359 > div {
      width: 100% !important;
      max-width: none !important;
    }
  `;
  doc.head.appendChild(style);
}

function forceStatValue(doc: Document, id: string, text: string) {
  const container = doc.getElementById(id);
  if (!container) return;
  let paragraph = container.querySelector("p");
  if (!paragraph) {
    paragraph = doc.createElement("p");
    container.innerHTML = "";
    container.appendChild(paragraph);
  }
  paragraph.textContent = text;
  paragraph.setAttribute(
    "style",
    "margin:0;color:#ffc353;font-size:18px;font-weight:700;line-height:18px;font-family:'Gotham',sans-serif;text-align:left;"
  );
}

function replaceElementWithDiv(doc: Document, id: string): HTMLDivElement | null {
  const original = doc.getElementById(id);
  if (!original) return null;
  // Avoid instanceof checks here: iframe elements live in a different JS realm.
  if (original.tagName.toLowerCase() === "div") {
    // Keep existing runtime handlers/styles across re-hydrations.
    return original as HTMLDivElement;
  }
  const replacement = doc.createElement("div");
  replacement.id = original.id;
  replacement.className = original.className;
  replacement.setAttribute("style", (original.getAttribute("style") ?? ""));
  original.parentNode?.replaceChild(replacement, original);
  return replacement;
}

function forceXpProgress(doc: Document, ratio: number) {
  const bar = replaceElementWithDiv(doc, "n20731356");
  if (!bar) return;
  bar.innerHTML = "";
  bar.style.width = "1035px";
  bar.style.maxWidth = "1035px";
  bar.style.height = "12px";
  bar.style.borderRadius = "999px";
  bar.style.background = "#232323";
  bar.style.position = "relative";
  bar.style.overflow = "hidden";

  const fill = doc.createElement("div");
  fill.style.position = "absolute";
  fill.style.left = "0";
  fill.style.top = "0";
  fill.style.bottom = "0";
  fill.style.width = `${Math.max(0, Math.min(100, ratio * 100)).toFixed(3)}%`;
  fill.style.background = "linear-gradient(90deg, #ac2e30 0%, #f75154 100%)";
  bar.appendChild(fill);
}

function forceVolumeProgress(doc: Document, ratio: number) {
  const bar = replaceElementWithDiv(doc, "n20731447");
  if (!bar) return;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const clampedPercent = (clampedRatio * 100).toFixed(3);
  bar.style.width = "251px";
  bar.style.maxWidth = "251px";
  bar.style.height = "22px";
  bar.style.borderRadius = "999px";
  bar.style.background = "#232323";
  bar.style.position = "relative";
  bar.style.overflow = "hidden";
  bar.style.touchAction = "none";

  let fill = bar.querySelector<HTMLDivElement>('[data-rw-volume="fill"]');
  if (!fill) {
    fill = doc.createElement("div");
    fill.setAttribute("data-rw-volume", "fill");
    fill.style.position = "absolute";
    fill.style.left = "0";
    fill.style.top = "0";
    fill.style.bottom = "0";
    fill.style.background = "linear-gradient(90deg, #ac2e30 0%, #f75154 100%)";
    fill.style.borderRadius = "999px";
    fill.style.pointerEvents = "none";
    bar.appendChild(fill);
  }
  fill.style.width = `${clampedPercent}%`;

  let thumb = bar.querySelector<HTMLDivElement>('[data-rw-volume="thumb"]');
  if (!thumb) {
    thumb = doc.createElement("div");
    thumb.setAttribute("data-rw-volume", "thumb");
    thumb.style.position = "absolute";
    thumb.style.top = "50%";
    thumb.style.width = "14px";
    thumb.style.height = "14px";
    thumb.style.borderRadius = "999px";
    thumb.style.background = "#ffffff";
    thumb.style.transform = "translate(-50%, -50%)";
    thumb.style.boxShadow = "0 0 0 2px rgba(247,81,84,0.45)";
    thumb.style.pointerEvents = "none";
    bar.appendChild(thumb);
  }
  const barWidth = bar.getBoundingClientRect().width || 251;
  const thumbRadiusPx = 7;
  const thumbTravelPx = Math.max(0, barWidth - thumbRadiusPx * 2);
  const thumbLeftPx = thumbRadiusPx + clampedRatio * thumbTravelPx;
  thumb.style.left = `${thumbLeftPx}px`;
}

function withCacheBust(url: string, token: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}rw_profile=${encodeURIComponent(token)}`;
}

function buildInitialAvatarDataUrl(seed: string): string {
  const initials = (seed || "P").trim().slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="191" height="191" viewBox="0 0 191 191"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1f1f1f"/><stop offset="100%" stop-color="#0d0d0d"/></linearGradient></defs><circle cx="95.5" cy="95.5" r="95.5" fill="url(#g)"/><circle cx="95.5" cy="95.5" r="92" fill="none" stroke="#2a2a2a" stroke-width="3"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" fill="#f2f2f2" font-size="66" font-family="Arial, sans-serif" font-weight="700">${initials || "P"}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchMeWithRetry(): Promise<User> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < PROFILE_FETCH_RETRIES; attempt += 1) {
    try {
      return await getMe();
    } catch (error) {
      lastError = error;
      if (attempt < PROFILE_FETCH_RETRIES - 1) {
        await sleep(PROFILE_FETCH_RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to load profile");
}

function mapProfileData(user: User, summary: ChatPublicProfileSummary | null): HydratedProfile {
  const usernameFromAuth = user.username?.trim() || user.email.split("@")[0] || "Player";
  const username = summary?.user.username?.trim() || usernameFromAuth;
  const publicId = user.publicId ?? summary?.user.publicId ?? null;
  const xpAtomic = String(user.progression?.xpAtomic ?? user.levelXpAtomic ?? "0");
  const xpProgress = getLevelProgressFromXpAtomic(xpAtomic);
  const level = Math.max(1, user.progression?.level ?? user.level ?? summary?.user.level ?? xpProgress.level);
  let xpCurrent = xpProgress.current;
  let xpTarget = xpProgress.target;
  let xpRatio = xpProgress.ratio;
  if (level >= 100) {
    const total = Math.max(1, xpProgress.current, xpProgress.target);
    xpCurrent = total;
    xpTarget = total;
    xpRatio = 1;
  }
  const avatarUrl = user.avatarUrl ?? user.customAvatarUrl ?? user.providerAvatarUrl ?? null;

  return {
    avatarUrl,
    username,
    publicId,
    email: user.email,
    level,
    profileVisible: summary?.user.profileVisible ?? true,
    xpAtomic,
    xpCurrent,
    xpTarget,
    xpRatio,
    stats: {
      totalPlayed: toCoinsDisplay(summary?.stats.wageredTotalCoins),
      battles: toCoinsDisplay(summary?.stats.wageredByMode.caseBattlesCoins),
      roulette: toCoinsDisplay(summary?.stats.wageredByMode.rouletteCoins),
      cases: toCoinsDisplay(summary?.stats.wageredByMode.caseOpeningCoins),
      blackjack: toCoinsDisplay(summary?.stats.wageredByMode.blackjackCoins),
      mines: toCoinsDisplay(summary?.stats.wageredByMode.minesCoins)
    }
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const toast = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [profile, setProfile] = useState<HydratedProfile | null>(null);
  const [profileResolved, setProfileResolved] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const isDraggingVolumeRef = useRef(false);
  const hasHydratedStatsFallbackRef = useRef(false);
  const cacheBustRef = useRef(`${Date.now()}`);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const me = await fetchMeWithRetry();
        const summaryPromise = (async () => {
          try {
            if (typeof me.publicId === "number" && me.publicId > 0) {
              return await getChatProfileByPublicId(me.publicId);
            }
            return await getChatProfileByUserId(me.id);
          } catch {
            try {
              return await getChatProfileByUserId(me.id);
            } catch {
              return null;
            }
          }
        })();
        const profileSummaryPromise = getProfileSummary().catch(() => null);

        const [summary, profileSummary] = await Promise.all([summaryPromise, profileSummaryPromise]);
        if (cancelled) return;
        const mapped = mapProfileData(me, summary);
        if (profileSummary) {
          const totalPlayedFromSummary = parseCoins(profileSummary.totals.wageredCoins);
          const minesFromSummary = parseCoins(profileSummary.perGame.mines.wageredCoins);
          const blackjackFromSummary = parseCoins(profileSummary.perGame.blackjack.wageredCoins);
          const rouletteFromSummary = parseCoins(profileSummary.perGame.roulette.wageredCoins);
          mapped.stats.mines = toCoinsFixed(minesFromSummary);
          mapped.stats.blackjack = toCoinsFixed(blackjackFromSummary);
          mapped.stats.roulette = toCoinsFixed(rouletteFromSummary);
          mapped.stats.totalPlayed = toCoinsFixed(totalPlayedFromSummary);
        }
        setProfile(mapped);
        setProfileResolved(true);

        // Heavy paginated history fallback runs in background so first paint is fast.
        if (!hasHydratedStatsFallbackRef.current) {
          hasHydratedStatsFallbackRef.current = true;
          void (async () => {
            let historyTotals:
              | {
                  MINES: number;
                  BLACKJACK: number;
                  ROULETTE: number;
                  CASES: number;
                  BATTLES: number;
                }
              | null = null;
            try {
              historyTotals = await getHistoryWageredByMode();
            } catch {
              historyTotals = null;
            }
            if (!historyTotals || cancelled) return;
            setProfile((current) => {
              if (!current) return current;
              const next = { ...current, stats: { ...current.stats } };
              const currentCases = parseCoins(current.stats.cases);
              const currentBattles = parseCoins(current.stats.battles);
              if (currentCases <= 0) next.stats.cases = toCoinsFixed(historyTotals.CASES);
              if (currentBattles <= 0) next.stats.battles = toCoinsFixed(historyTotals.BATTLES);
              const shouldBackfillPrimaryModes =
                !profileSummary ||
                (parseCoins(current.stats.mines) <= 0 &&
                  parseCoins(current.stats.blackjack) <= 0 &&
                  parseCoins(current.stats.roulette) <= 0);
              if (shouldBackfillPrimaryModes) {
                next.stats.mines = toCoinsFixed(historyTotals.MINES);
                next.stats.blackjack = toCoinsFixed(historyTotals.BLACKJACK);
                next.stats.roulette = toCoinsFixed(historyTotals.ROULETTE);
              }
              const totalPlayedCurrent = parseCoins(current.stats.totalPlayed);
              if (totalPlayedCurrent <= 0 || !profileSummary) {
                next.stats.totalPlayed = toCoinsFixed(
                  historyTotals.MINES +
                    historyTotals.BLACKJACK +
                    historyTotals.ROULETTE +
                    historyTotals.CASES +
                    historyTotals.BATTLES
                );
              }
              return next;
            });
          })();
        }
      } catch {
        if (!cancelled) setProfile(FALLBACK_PROFILE);
      } finally {
        if (!cancelled) setProfileResolved(true);
      }
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleProfileVisibility = useCallback(async () => {
    if (!profile || privacyBusy) return;
    setPrivacyBusy(true);
    const nextVisibility = !profile.profileVisible;
    try {
      await setMyProfileVisibility(nextVisibility);
      setProfile((current) =>
        current
          ? {
              ...current,
              profileVisible: nextVisibility
            }
          : current
      );
      toast.showSuccess(nextVisibility ? "Privacy mode activated" : "Privacy mode deactivated");
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : "Failed to update privacy mode");
    } finally {
      setPrivacyBusy(false);
    }
  }, [privacyBusy, profile, toast]);

  const syncFrameContent = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;

    const html = doc.documentElement;
    const body = doc.body;

    html.style.background = "#070707";
    body.style.background = "#070707";
    body.style.margin = "0";
    body.style.width = `${PROFILE_CANVAS_WIDTH}px`;
    body.style.minWidth = `${PROFILE_CANVAS_WIDTH}px`;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    normalizeEmbeddedAssetPaths(doc);
    injectRuntimeProfileStyles(doc);

    const root = doc.getElementById("n20731272");
    const footer = doc.getElementById("n20731273");
    if (root && footer && root.lastElementChild !== footer) {
      root.appendChild(footer);
    }

    // Hold the imported frame hidden until data hydration is resolved.
    if (!profileResolved) return;

    const hydratedProfile = profile ?? FALLBACK_PROFILE;
    if (hydratedProfile) {
      const avatar = doc.getElementById("n20731340") as HTMLImageElement | null;
      const avatarFallback = buildInitialAvatarDataUrl(hydratedProfile.username || hydratedProfile.email || "P");
      if (avatar) {
        avatar.src = hydratedProfile.avatarUrl
          ? withCacheBust(hydratedProfile.avatarUrl, cacheBustRef.current)
          : avatarFallback;
        avatar.style.objectFit = "cover";
        avatar.style.width = "120px";
        avatar.style.height = "120px";
        avatar.style.borderRadius = "120px";
        avatar.style.marginTop = "12px";
        avatar.style.marginLeft = "10px";
        avatar.onerror = () => {
          avatar.onerror = null;
          avatar.src = avatarFallback;
        };
      }

      setContainerParagraphText(doc, "n20731347", hydratedProfile.username);
      forceStatValue(doc, "n20731371", hydratedProfile.stats.totalPlayed);
      forceStatValue(doc, "n20731380", hydratedProfile.stats.battles);
      forceStatValue(doc, "n20731389", hydratedProfile.stats.roulette);
      forceStatValue(doc, "n20731398", hydratedProfile.stats.cases);
      forceStatValue(doc, "n20731407", hydratedProfile.stats.blackjack);
      forceStatValue(doc, "n20731416", hydratedProfile.stats.mines);
      setContainerParagraphText(doc, "n20731441", hydratedProfile.email);
      renderPrivacyToggle(doc, hydratedProfile.profileVisible, privacyBusy);

      const idParagraph = doc.getElementById("n20731349")?.querySelector("p");
      if (idParagraph) {
        const spans = idParagraph.querySelectorAll("span");
        if (spans.length >= 2) {
          spans[0].textContent = "Your ID:";
          spans[1].textContent =
            hydratedProfile.publicId !== null ? String(hydratedProfile.publicId) : "N/A";
        } else {
          idParagraph.textContent = `Your ID:${
            hydratedProfile.publicId !== null ? hydratedProfile.publicId : "N/A"
          }`;
        }
      }

      const xpParagraph = doc.getElementById("n20731355")?.querySelector("p");
      if (xpParagraph) {
        const spans = xpParagraph.querySelectorAll("span");
        const xpCurrentFormatted = hydratedProfile.xpCurrent.toLocaleString("en-US", { maximumFractionDigits: 0 });
        const xpTargetFormatted = hydratedProfile.xpTarget.toLocaleString("en-US", { maximumFractionDigits: 0 });
        if (spans.length >= 2) {
          spans[0].textContent = xpCurrentFormatted;
          spans[1].textContent = `/${xpTargetFormatted}XP`;
        } else {
          xpParagraph.textContent = `${xpCurrentFormatted}/${xpTargetFormatted}XP`;
        }
      }

      forceXpProgress(doc, hydratedProfile.xpRatio);
      renderLevelBadge(doc, hydratedProfile.level);

      const statsSection = doc.getElementById("n20731359");
      if (statsSection) {
        statsSection.style.paddingRight = "0";
        const cards = Array.from(statsSection.children) as HTMLElement[];
        cards.forEach((card) => {
          card.style.maxWidth = "none";
          card.style.width = "100%";
          card.style.gap = "14px";
          card.style.justifyContent = "space-between";
          card.style.alignItems = "center";
        });
      }

      // Keep wager values visible inside each stats card.
      const statRows = ["n20731360", "n20731372", "n20731381", "n20731390", "n20731399", "n20731408"];
      statRows.forEach((rowId) => {
        const row = doc.getElementById(rowId);
        if (!row) return;
        row.style.gap = "14px";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
      });
      const statValueHolders = ["n20731368", "n20731377", "n20731386", "n20731395", "n20731404", "n20731413"];
      statValueHolders.forEach((holderId) => {
        const holder = doc.getElementById(holderId);
        if (!holder) return;
        holder.style.marginLeft = "0";
        holder.style.flexShrink = "0";
        holder.style.minWidth = "88px";
        holder.style.justifyContent = "flex-end";
      });
    }

    const updateVolumeVisual = (nextVolume: number) => {
      forceVolumeProgress(doc, nextVolume);
    };
    updateVolumeVisual(getGameVolume());

    const bindVolumeSlider = () => {
      const volumeTrack = replaceElementWithDiv(doc, "n20731447");
      if (!volumeTrack) return;
      const setFromClientX = (clientX: number) => {
        const rect = volumeTrack.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const next = setGameVolume(ratio);
        updateVolumeVisual(next);
      };
      volumeTrack.style.cursor = "pointer";
      volumeTrack.style.touchAction = "none";
      const stopDragging = (event?: PointerEvent) => {
        if (event) {
          try {
            volumeTrack.releasePointerCapture(event.pointerId);
          } catch {}
        }
        isDraggingVolumeRef.current = false;
      };
      volumeTrack.onpointerdown = (event: PointerEvent) => {
        event.preventDefault();
        try {
          volumeTrack.setPointerCapture(event.pointerId);
        } catch {}
        isDraggingVolumeRef.current = true;
        setFromClientX(event.clientX);
      };
      volumeTrack.onpointermove = (event: PointerEvent) => {
        if (!isDraggingVolumeRef.current) return;
        setFromClientX(event.clientX);
      };
      volumeTrack.onpointerup = (event: PointerEvent) => stopDragging(event);
      volumeTrack.onpointercancel = (event: PointerEvent) => stopDragging(event);
      volumeTrack.onlostpointercapture = () => {
        isDraggingVolumeRef.current = false;
      };
    };
    bindVolumeSlider();

    const bindAction = (containerId: string, handler: () => void) => {
      const container = doc.getElementById(containerId);
      if (!container) return;
      container.style.cursor = "pointer";
      const anchors = container.querySelectorAll("a");
      anchors.forEach((anchor) => {
        anchor.setAttribute("href", "#");
        anchor.style.cursor = "pointer";
      });
      const clickHandler = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        handler();
      };
      container.onclick = clickHandler;
      anchors.forEach((anchor) => {
        anchor.onclick = clickHandler;
      });
    };

    bindAction("n20731423", () => {
      void router.push("/support");
    });
    bindAction("n20731428", () => {
      void router.push("/support");
    });
    bindAction("n20731433", () => {
      window.open("https://discord.com", "_blank", "noopener,noreferrer");
    });
    bindAction("n20731442", () => {
      toast.showError("Email verification is not available yet.");
    });
    const bindPrivacyToggle = () => {
      const toggle = doc.getElementById("n20731455");
      if (!toggle) return;
      toggle.onclick = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (privacyBusy) return;
        void toggleProfileVisibility();
      };
    };
    bindPrivacyToggle();
    bindAction("n20731478", () => {
      toast.showError("Please contact support for account lock actions.");
    });

    const syncHeight = () => {
      const contentHeight = Math.max(
        html.scrollHeight,
        body.scrollHeight,
        root?.scrollHeight ?? 0
      );
      frame.style.height = `${contentHeight}px`;
    };

    syncHeight();
    window.requestAnimationFrame(syncHeight);
    window.setTimeout(syncHeight, 80);
    window.setTimeout(syncHeight, 220);
    Array.from(doc.images).forEach((image) => {
      if (!image.complete) {
        image.addEventListener("load", syncHeight, { once: true });
      }
    });
    setContentReady(true);
  }, [privacyBusy, profile, profileResolved, router, toast, toggleProfileVisibility]);

  const handleFrameLoad = useCallback(() => {
    setFrameLoaded(true);
    syncFrameContent();
  }, [syncFrameContent]);

  useEffect(() => {
    if (!frameLoaded) return;
    syncFrameContent();
  }, [frameLoaded, syncFrameContent]);

  const showIframe = frameLoaded && profileResolved && contentReady;

  return (
    <div className="-mx-5 -my-4 bg-[#070707]">
      <div className="overflow-x-auto">
        <div className="flex justify-center" style={{ minWidth: PROFILE_CANVAS_WIDTH }}>
          <iframe
            ref={iframeRef}
            title="Profile content"
            src="/profile-content/content-qr.html"
            onLoad={handleFrameLoad}
            style={{
              width: PROFILE_CANVAS_WIDTH,
              minWidth: PROFILE_CANVAS_WIDTH,
              minHeight: 1889,
              border: 0,
              display: "block",
              background: "#070707",
              visibility: showIframe ? "visible" : "hidden"
            }}
          />
        </div>
      </div>
    </div>
  );
}
