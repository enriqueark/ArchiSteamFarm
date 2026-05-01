import { useCallback, useEffect, useRef, useState } from "react";
import {
  changeMyPassword,
  clearSession,
  getChatProfileByPublicId,
  getChatProfileByUserId,
  getMyGameHistory,
  getMe,
  getProfileSummary,
  getSecuritySettings,
  getTwoFactorState,
  setSelfExclusion,
  setTradeUrl,
  setMyProfileVisibility,
  updateUsername,
  type ChatPublicProfileSummary,
  type SecuritySettingsResponse,
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
  steamTradeUrl: string | null;
  usernameNextChangeAt: string | null;
  canChangeUsername: boolean;
  selfExcludeUntil: string | null;
  selfExclusionActive: boolean;
  stats: {
    totalPlayed: string;
    battles: string;
    roulette: string;
    cases: string;
    blackjack: string;
    mines: string;
  };
};

type PasswordModalState = {
  open: boolean;
  currentPassword: string;
  newPassword: string;
  twoFactorCode: string;
  twoFactorEnabled: boolean;
  loading: boolean;
  error: string | null;
};

type TradeUrlModalState = {
  open: boolean;
  tradeUrl: string;
  loading: boolean;
  error: string | null;
};

type UsernameModalState = {
  open: boolean;
  username: string;
  nextChangeAt: string | null;
  loading: boolean;
  error: string | null;
};

type SelfExclusionModalState = {
  open: boolean;
  durationDays: 1 | 3 | 7 | 14 | 30;
  confirmationText: string;
  loading: boolean;
  error: string | null;
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
  steamTradeUrl: null,
  usernameNextChangeAt: null,
  canChangeUsername: true,
  selfExcludeUntil: null,
  selfExclusionActive: false,
  stats: {
    totalPlayed: "0.00",
    battles: "0.00",
    roulette: "0.00",
    cases: "0.00",
    blackjack: "0.00",
    mines: "0.00"
  }
};

const PASSWORD_MODAL_INITIAL_STATE: PasswordModalState = {
  open: false,
  currentPassword: "",
  newPassword: "",
  twoFactorCode: "",
  twoFactorEnabled: false,
  loading: false,
  error: null
};

const TRADE_URL_MODAL_INITIAL_STATE: TradeUrlModalState = {
  open: false,
  tradeUrl: "",
  loading: false,
  error: null
};

const USERNAME_MODAL_INITIAL_STATE: UsernameModalState = {
  open: false,
  username: "",
  nextChangeAt: null,
  loading: false,
  error: null
};

const SELF_EXCLUSION_MODAL_INITIAL_STATE: SelfExclusionModalState = {
  open: false,
  durationDays: 1,
  confirmationText: "",
  loading: false,
  error: null
};

const LEVEL_BADGE_TIERS = [
  { max: 19, color: "#53ff87", bg: "linear-gradient(180deg, #53ff8738, #53ff87)" },
  { max: 39, color: "#53a3ff", bg: "linear-gradient(180deg, #53a3ff38, #53a3ff)" },
  { max: 59, color: "#ffc353", bg: "linear-gradient(180deg, #ffc35338, #ffc353)" },
  { max: 79, color: "#c053ff", bg: "linear-gradient(180deg, #c053ff38, #c053ff)" },
  { max: 99, color: "#ff5353", bg: "linear-gradient(180deg, #ff535338, #ff5353)" }
] as const;

const USERNAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SELF_EXCLUSION_DURATIONS = [1, 3, 7, 14, 30] as const;
const PROFILE_STATS_MODE_ICON_ROWS = [
  {
    wrapperId: "n20731361",
    iconId: "n20731362",
    labelId: "n20731367",
    iconSrc: "/profile-content/assets/defd613977a95cf065b4b6c4f87da488.svg"
  },
  {
    wrapperId: "n20731373",
    iconId: "n20731374",
    labelId: "n20731376",
    iconSrc: "/assets/7739c95aea952fc2e80b31e6dd1cf73d.svg"
  },
  {
    wrapperId: "n20731382",
    iconId: "n20731383",
    labelId: "n20731385",
    iconSrc: "/assets/35ad40f1a702c98648f4437ed2fd02b6.svg"
  },
  {
    wrapperId: "n20731391",
    iconId: "n20731392",
    labelId: "n20731394",
    iconSrc: "/assets/e2aff152f333aa01b1f9280bef464454.svg"
  },
  {
    wrapperId: "n20731400",
    iconId: "n20731401",
    labelId: "n20731403",
    iconSrc: "/assets/90cdff650ad513d6be72c3f0d3a9eea3.svg"
  },
  {
    wrapperId: "n20731409",
    iconId: "n20731410",
    labelId: "n20731412",
    iconSrc: "/assets/8ffba4817b8664c5480ee873923615b0.svg"
  }
] as const;
const PROFILE_STATS_LEGACY_CIRCLE_IDS = [
  "n20731369",
  "n20731378",
  "n20731387",
  "n20731396",
  "n20731405",
  "n20731414"
] as const;

function isValidSteamTradeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    if (!/steamcommunity\.com$/i.test(parsed.hostname)) return false;
    if (!/\/tradeoffer\/new\/?/i.test(parsed.pathname)) return false;
    const partner = parsed.searchParams.get("partner")?.trim() ?? "";
    const token = parsed.searchParams.get("token")?.trim() ?? "";
    return /^\d+$/.test(partner) && token.length >= 5;
  } catch {
    return false;
  }
}

function formatDateTime(input: string | null): string {
  if (!input) return "N/A";
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) return "N/A";
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

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

  if (!toggle.querySelector('[data-rw-privacy="fill"]')) {
    toggle.innerHTML = "";
  }
  toggle.className = "";
  toggle.style.marginLeft = "auto";
  toggle.style.width = "56px";
  toggle.style.minWidth = "56px";
  toggle.style.maxWidth = "56px";
  toggle.style.height = "22px";
  toggle.style.minHeight = "0";
  toggle.style.maxHeight = "22px";
  toggle.style.position = "relative";
  toggle.style.display = "block";
  toggle.style.padding = "0";
  toggle.style.gap = "0";
  toggle.style.boxSizing = "border-box";
  toggle.style.borderRadius = "999px";
  toggle.style.border = "none";
  toggle.style.background = "#232323";
  toggle.style.overflow = "hidden";
  toggle.style.cursor = busy ? "default" : "pointer";
  toggle.style.opacity = busy ? "0.65" : "1";
  toggle.style.transition = "opacity 160ms ease, box-shadow 180ms ease";
  toggle.style.boxShadow = "none";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", enabled ? "true" : "false");

  let fill = toggle.querySelector<HTMLSpanElement>('[data-rw-privacy="fill"]');
  if (!fill) {
    fill = doc.createElement("span");
    fill.setAttribute("data-rw-privacy", "fill");
    fill.style.position = "absolute";
    fill.style.left = "0";
    fill.style.top = "0";
    fill.style.bottom = "0";
    fill.style.background = "linear-gradient(90deg, #ac2e30 0%, #f75154 100%)";
    fill.style.borderRadius = "999px";
    fill.style.pointerEvents = "none";
    fill.style.transition = "width 220ms ease, box-shadow 220ms ease";
    toggle.appendChild(fill);
  }
  fill.style.width = enabled ? "100%" : "0%";
  fill.style.boxShadow = enabled ? "0 0 10px rgba(247,81,84,0.5), inset 0 0 8px rgba(247,81,84,0.35)" : "none";

  let thumb = toggle.querySelector<HTMLSpanElement>('[data-rw-privacy="thumb"]');
  if (!thumb) {
    thumb = doc.createElement("span");
    thumb.setAttribute("data-rw-privacy", "thumb");
    thumb.style.position = "absolute";
    thumb.style.top = "50%";
    thumb.style.width = "14px";
    thumb.style.height = "14px";
    thumb.style.borderRadius = "50%";
    thumb.style.background = "#ffffff";
    thumb.style.transform = "translate(-50%, -50%)";
    thumb.style.pointerEvents = "none";
    thumb.style.transition = "left 220ms ease, box-shadow 220ms ease";
    toggle.appendChild(thumb);
  }
  thumb.style.boxShadow = enabled
    ? "0 0 0 2px rgba(247,81,84,0.45), 0 1px 3px rgba(0,0,0,0.35)"
    : "0 1px 3px rgba(0,0,0,0.35)";
  const barWidth = toggle.getBoundingClientRect().width || 56;
  const thumbRadiusPx = 7;
  const thumbTravelPx = Math.max(0, barWidth - thumbRadiusPx * 2);
  const thumbLeftPx = thumbRadiusPx + (enabled ? thumbTravelPx : 0);
  thumb.style.left = `${thumbLeftPx}px`;
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
      display: flex !important;
      flex-direction: column !important;
      align-items: flex-start !important;
      gap: 8px !important;
    }
    #n20731446, #n20731452 {
      margin-top: 0 !important;
      width: 100% !important;
    }
    #n20731447, #n20731455 {
      margin-top: -32px !important;
      justify-self: start !important;
      align-self: flex-start !important;
    }
    #n20731451 {
      align-items: flex-start !important;
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
  paragraph.innerHTML = "";
  paragraph.setAttribute(
    "style",
    "margin:0;display:inline-flex;align-items:center;gap:6px;color:#ffc353;font-size:16px;font-weight:700;line-height:16px;font-family:'Gotham',sans-serif;text-align:left;white-space:nowrap;"
  );

  const coin = doc.createElement("img");
  coin.setAttribute("src", "/assets/coin-dino-original.png");
  coin.setAttribute("alt", "");
  coin.setAttribute(
    "style",
    "width:28px;height:28px;object-fit:contain;flex-shrink:0;"
  );

  const value = doc.createElement("span");
  value.textContent = text;
  value.setAttribute("style", "display:inline-block;");

  paragraph.appendChild(coin);
  paragraph.appendChild(value);
}

function normalizeProfileStatsModeRows(doc: Document) {
  PROFILE_STATS_MODE_ICON_ROWS.forEach(({ wrapperId, iconId, labelId, iconSrc }) => {
    const wrapper = doc.getElementById(wrapperId) as HTMLElement | null;
    if (wrapper) {
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.justifyContent = "flex-start";
      wrapper.style.gap = "11px";
    }

    const icon = doc.getElementById(iconId) as HTMLImageElement | null;
    if (icon) {
      icon.src = iconSrc;
      icon.style.width = "32px";
      icon.style.height = "32px";
      icon.style.minWidth = "32px";
      icon.style.maxWidth = "32px";
      icon.style.objectFit = "contain";
      icon.style.background = "transparent";
      icon.style.boxShadow = "none";
      icon.style.borderRadius = "0";
      icon.style.filter = "none";
    }

    const labelContainer = doc.getElementById(labelId) as HTMLElement | null;
    if (labelContainer) {
      labelContainer.style.width = "auto";
      labelContainer.style.maxWidth = "none";
      labelContainer.style.margin = "0";
      labelContainer.style.display = "flex";
      labelContainer.style.alignItems = "center";
      const label = labelContainer.querySelector("p");
      if (label) {
        label.setAttribute(
          "style",
          "margin:0;color:#b2b2b2;font-size:16px;font-weight:500;line-height:16px;font-family:'Gotham',sans-serif;text-align:left;white-space:nowrap;"
        );
      }
    }
  });
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
  const usernameChangedAtMs = user.usernameChangedAt ? Date.parse(user.usernameChangedAt) : Number.NaN;
  const usernameNextChangeAt =
    Number.isFinite(usernameChangedAtMs)
      ? new Date(usernameChangedAtMs + USERNAME_COOLDOWN_MS).toISOString()
      : null;
  const selfExcludeUntil = user.selfExclusion?.until ?? null;
  const selfExclusionUntilMs = selfExcludeUntil ? Date.parse(selfExcludeUntil) : Number.NaN;
  const selfExclusionActive =
    typeof user.selfExclusion?.active === "boolean"
      ? user.selfExclusion.active
      : Number.isFinite(selfExclusionUntilMs) && selfExclusionUntilMs > Date.now();

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
    steamTradeUrl: user.steamTradeUrl ?? null,
    usernameNextChangeAt,
    canChangeUsername:
      !usernameNextChangeAt || Date.parse(usernameNextChangeAt) <= Date.now(),
    selfExcludeUntil,
    selfExclusionActive,
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
  const toast = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [profile, setProfile] = useState<HydratedProfile | null>(null);
  const [profileResolved, setProfileResolved] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [passwordModal, setPasswordModal] = useState<PasswordModalState>(PASSWORD_MODAL_INITIAL_STATE);
  const [tradeUrlModal, setTradeUrlModal] = useState<TradeUrlModalState>(TRADE_URL_MODAL_INITIAL_STATE);
  const [usernameModal, setUsernameModal] = useState<UsernameModalState>(USERNAME_MODAL_INITIAL_STATE);
  const [selfExclusionModal, setSelfExclusionModal] = useState<SelfExclusionModalState>(
    SELF_EXCLUSION_MODAL_INITIAL_STATE
  );
  const [selfExclusionDuration, setSelfExclusionDuration] = useState<1 | 3 | 7 | 14 | 30>(1);
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
        const securitySettingsPromise = getSecuritySettings().catch(() => null);

        const [summary, profileSummary, securitySettings] = await Promise.all([
          summaryPromise,
          profileSummaryPromise,
          securitySettingsPromise
        ]);
        if (cancelled) return;
        const mapped = mapProfileData(me, summary);
        if (securitySettings) {
          const exclusionUntil = securitySettings.selfExcludeUntil ?? mapped.selfExcludeUntil;
          mapped.steamTradeUrl = securitySettings.tradeUrl ?? mapped.steamTradeUrl;
          mapped.username = securitySettings.username?.trim() || mapped.username;
          mapped.usernameNextChangeAt = securitySettings.usernameNextChangeAt;
          mapped.canChangeUsername = securitySettings.canChangeUsername;
          mapped.selfExcludeUntil = exclusionUntil;
          mapped.selfExclusionActive = securitySettings.selfExclusionActive;
        }
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

  const closeChangePasswordModal = useCallback(() => {
    setPasswordModal(PASSWORD_MODAL_INITIAL_STATE);
  }, []);

  const openChangePasswordModal = useCallback(async () => {
    setPasswordModal({
      ...PASSWORD_MODAL_INITIAL_STATE,
      open: true,
      loading: true
    });
    try {
      const twoFactorState = await getTwoFactorState();
      setPasswordModal((current) => ({
        ...current,
        open: true,
        loading: false,
        error: null,
        twoFactorEnabled: Boolean(twoFactorState?.enabled)
      }));
    } catch {
      setPasswordModal((current) => ({
        ...current,
        open: true,
        loading: false,
        twoFactorEnabled: false,
        error: "Could not verify 2FA status. You can still try to change your password."
      }));
    }
  }, []);

  const submitPasswordChange = useCallback(async () => {
    if (passwordModal.loading) return;

    const currentPassword = passwordModal.currentPassword;
    const newPassword = passwordModal.newPassword;
    const twoFactorCode = passwordModal.twoFactorCode.trim();

    if (!currentPassword || !newPassword) {
      setPasswordModal((current) => ({
        ...current,
        error: "Current password and new password are required."
      }));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordModal((current) => ({
        ...current,
        error: "New password must be at least 8 characters."
      }));
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordModal((current) => ({
        ...current,
        error: "New password must be different from current password."
      }));
      return;
    }
    if (passwordModal.twoFactorEnabled && !/^\d{6}$/.test(twoFactorCode)) {
      setPasswordModal((current) => ({
        ...current,
        error: "A valid 6-digit 2FA code is required."
      }));
      return;
    }

    setPasswordModal((current) => ({
      ...current,
      loading: true,
      error: null
    }));

    try {
      const response = await changeMyPassword({
        currentPassword,
        newPassword,
        ...(passwordModal.twoFactorEnabled ? { twoFactorCode } : {})
      });
      const changed = Boolean(response?.success ?? response?.changed ?? true);
      if (!changed) {
        throw new Error("Password could not be changed.");
      }
      toast.showSuccess("Password updated. Please sign in again.");
      clearSession();
      setPasswordModal(PASSWORD_MODAL_INITIAL_STATE);
      window.setTimeout(() => {
        window.location.assign("/");
      }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update password.";
      setPasswordModal((current) => ({
        ...current,
        loading: false,
        error: message
      }));
    }
  }, [passwordModal, toast]);

  const updateSecuritySettingsOnProfile = useCallback((settings: SecuritySettingsResponse) => {
    setProfile((current) => {
      if (!current) return current;
      return {
        ...current,
        username: settings.username?.trim() || current.username,
        steamTradeUrl: settings.tradeUrl ?? current.steamTradeUrl,
        usernameNextChangeAt: settings.usernameNextChangeAt ?? null,
        canChangeUsername: settings.canChangeUsername,
        selfExcludeUntil: settings.selfExcludeUntil,
        selfExclusionActive: settings.selfExclusionActive
      };
    });
  }, []);

  const closeTradeUrlModal = useCallback(() => {
    setTradeUrlModal(TRADE_URL_MODAL_INITIAL_STATE);
  }, []);

  const openTradeUrlModal = useCallback(() => {
    setTradeUrlModal({
      open: true,
      tradeUrl: profile?.steamTradeUrl ?? "",
      loading: false,
      error: null
    });
  }, [profile?.steamTradeUrl]);

  const submitTradeUrl = useCallback(async () => {
    if (tradeUrlModal.loading) return;
    const value = tradeUrlModal.tradeUrl.trim();
    if (!value) {
      setTradeUrlModal((current) => ({ ...current, error: "Steam trade URL is required." }));
      return;
    }
    if (!isValidSteamTradeUrl(value)) {
      setTradeUrlModal((current) => ({ ...current, error: "Please enter a valid Steam trade URL." }));
      return;
    }

    setTradeUrlModal((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await setTradeUrl(value);
      setProfile((current) =>
        current
          ? {
              ...current,
              steamTradeUrl: response.tradeUrl
            }
          : current
      );
      toast.showSuccess("Steam trade URL updated.");
      setTradeUrlModal(TRADE_URL_MODAL_INITIAL_STATE);
    } catch (error) {
      setTradeUrlModal((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Could not save Steam trade URL."
      }));
    }
  }, [toast, tradeUrlModal]);

  const closeUsernameModal = useCallback(() => {
    setUsernameModal(USERNAME_MODAL_INITIAL_STATE);
  }, []);

  const openUsernameModal = useCallback(() => {
    setUsernameModal({
      open: true,
      username: profile?.username ?? "",
      nextChangeAt: profile?.usernameNextChangeAt ?? null,
      loading: false,
      error: null
    });
  }, [profile?.username, profile?.usernameNextChangeAt]);

  const submitUsernameChange = useCallback(async () => {
    if (usernameModal.loading) return;
    const nextUsername = usernameModal.username.trim();
    if (nextUsername.length < 3 || nextUsername.length > 20) {
      setUsernameModal((current) => ({
        ...current,
        error: "Username must be between 3 and 20 characters."
      }));
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(nextUsername)) {
      setUsernameModal((current) => ({
        ...current,
        error: "Use only letters, numbers, dots, hyphens, and underscores."
      }));
      return;
    }

    const currentUsername = profile?.username?.trim() ?? "";
    const changingUsername = nextUsername !== currentUsername;
    if (!profile?.canChangeUsername && changingUsername) {
      setUsernameModal((current) => ({
        ...current,
        error: `You can change your username again at ${formatDateTime(profile?.usernameNextChangeAt ?? null)}.`
      }));
      return;
    }

    setUsernameModal((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await updateUsername(nextUsername);
      const nextChangeAt = response.nextChangeAt ?? null;
      setProfile((current) =>
        current
          ? {
              ...current,
              username: response.username,
              usernameNextChangeAt: nextChangeAt,
              canChangeUsername: !nextChangeAt || Date.parse(nextChangeAt) <= Date.now()
            }
          : current
      );
      toast.showSuccess("Username updated.");
      setUsernameModal(USERNAME_MODAL_INITIAL_STATE);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update username.";
      try {
        const security = await getSecuritySettings();
        updateSecuritySettingsOnProfile(security);
      } catch {
        // best effort
      }
      setUsernameModal((current) => ({
        ...current,
        loading: false,
        error: message
      }));
    }
  }, [profile, toast, updateSecuritySettingsOnProfile, usernameModal]);

  const closeSelfExclusionModal = useCallback(() => {
    setSelfExclusionModal(SELF_EXCLUSION_MODAL_INITIAL_STATE);
  }, []);

  const openSelfExclusionModal = useCallback(() => {
    setSelfExclusionModal({
      open: true,
      durationDays: selfExclusionDuration,
      confirmationText: "",
      loading: false,
      error: null
    });
  }, [selfExclusionDuration]);

  const submitSelfExclusion = useCallback(async () => {
    if (selfExclusionModal.loading) return;
    if (selfExclusionModal.confirmationText.trim().toUpperCase() !== "CONFIRM") {
      setSelfExclusionModal((current) => ({
        ...current,
        error: 'Type "CONFIRM" exactly to continue.'
      }));
      return;
    }

    setSelfExclusionModal((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await setSelfExclusion({
        durationDays: selfExclusionModal.durationDays,
        confirmationText: selfExclusionModal.confirmationText
      });
      setProfile((current) =>
        current
          ? {
              ...current,
              selfExcludeUntil: response.until,
              selfExclusionActive: true
            }
          : current
      );
      setSelfExclusionDuration(selfExclusionModal.durationDays);
      toast.showSuccess(`Account locked until ${formatDateTime(response.until)}.`);
      setSelfExclusionModal(SELF_EXCLUSION_MODAL_INITIAL_STATE);
    } catch (error) {
      setSelfExclusionModal((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Could not lock account."
      }));
    }
  }, [selfExclusionModal, toast]);

  const showAnyModal =
    passwordModal.open || tradeUrlModal.open || usernameModal.open || selfExclusionModal.open;

  useEffect(() => {
    if (!showAnyModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showAnyModal]);

  useEffect(() => {
    if (!showAnyModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selfExclusionModal.open && !selfExclusionModal.loading) {
        closeSelfExclusionModal();
        return;
      }
      if (usernameModal.open && !usernameModal.loading) {
        closeUsernameModal();
        return;
      }
      if (tradeUrlModal.open && !tradeUrlModal.loading) {
        closeTradeUrlModal();
        return;
      }
      if (passwordModal.open && !passwordModal.loading) {
        closeChangePasswordModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeChangePasswordModal,
    closeSelfExclusionModal,
    closeTradeUrlModal,
    closeUsernameModal,
    passwordModal.loading,
    passwordModal.open,
    selfExclusionModal.loading,
    selfExclusionModal.open,
    showAnyModal,
    tradeUrlModal.loading,
    tradeUrlModal.open,
    usernameModal.loading,
    usernameModal.open
  ]);

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

    // Remove embedded footer from iframe so page uses shared app footer only.
    const embeddedFooter = doc.getElementById("n20731273");
    embeddedFooter?.remove();
    const frameRoot = doc.getElementById("n20731272");
    if (frameRoot) {
      frameRoot.style.minHeight = "0";
      frameRoot.style.height = "auto";
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
        avatar.style.marginTop = "24px";
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
      setContainerParagraphText(doc, "n20731423", "SET PASSWORD");
      setContainerParagraphText(doc, "n20731428", "SET TRADE URL");
      setContainerParagraphText(doc, "n20731431", "Change username");
      setContainerParagraphText(
        doc,
        "n20731432",
        hydratedProfile.canChangeUsername
          ? "Change your username (max 20 characters). You can change it once every 24 hours."
          : `Username cooldown active. Next change: ${formatDateTime(hydratedProfile.usernameNextChangeAt)}`
      );
      setContainerParagraphText(doc, "n20731433", "Change username");
      setContainerParagraphText(doc, "n20731464", "Self exclusion");
      setContainerParagraphText(doc, "n20731478", "LOCK ACCOUNT");
      renderPrivacyToggle(doc, hydratedProfile.profileVisible, privacyBusy);
      setContainerParagraphText(
        doc,
        "n20731479",
        hydratedProfile.selfExclusionActive && hydratedProfile.selfExcludeUntil
          ? `Self-exclusion active until ${formatDateTime(
              hydratedProfile.selfExcludeUntil
            )}. Wagering, withdrawals, and tips are disabled until expiry.`
          : "If you want to lock your account for longer periods, please contact support."
      );
      const durationButtonMap: Array<{ containerId: string; labelId: string; days: 1 | 3 | 7 | 14 | 30 }> = [
        { containerId: "n20731468", labelId: "n20731469", days: 1 },
        { containerId: "n20731470", labelId: "n20731471", days: 3 },
        { containerId: "n20731472", labelId: "n20731473", days: 7 },
        { containerId: "n20731474", labelId: "n20731475", days: 14 },
        { containerId: "n20731476", labelId: "n20731477", days: 30 }
      ];
      durationButtonMap.forEach(({ containerId, labelId, days }) => {
        const chip = doc.getElementById(containerId) as HTMLElement | null;
        const label = doc.getElementById(labelId) as HTMLElement | null;
        if (!chip) return;
        const selected = selfExclusionDuration === days;
        chip.style.border = selected ? "1px solid rgba(247,81,84,0.75)" : "1px solid rgba(49,49,49,0.95)";
        chip.style.background = selected
          ? "linear-gradient(180deg, rgba(247,81,84,0.30), rgba(172,46,48,0.35))"
          : "linear-gradient(180deg, rgba(23,23,23,0.98), rgba(14,14,14,0.98))";
        chip.style.boxShadow = selected ? "0 0 14px rgba(247,81,84,0.22)" : "none";
        chip.style.cursor = hydratedProfile.selfExclusionActive ? "default" : "pointer";
        chip.style.transition = "background 180ms ease, border-color 180ms ease, box-shadow 180ms ease";
        if (label) {
          label.style.color = selected ? "#ffd3d4" : "#c8c8c8";
        }
      });

      const idContainer = doc.getElementById("n20731349");
      if (idContainer) {
        idContainer.style.maxWidth = "none";
        idContainer.style.whiteSpace = "nowrap";
      }
      const idParagraph = idContainer?.querySelector("p");
      if (idParagraph) {
        const spans = idParagraph.querySelectorAll("span");
        idParagraph.style.display = "inline-flex";
        idParagraph.style.alignItems = "center";
        idParagraph.style.gap = "2px";
        idParagraph.style.whiteSpace = "nowrap";
        if (spans.length >= 2) {
          spans[0].textContent = "ID: ";
          spans[0].style.display = "inline";
          spans[1].textContent =
            hydratedProfile.publicId !== null ? String(hydratedProfile.publicId) : "N/A";
          spans[1].style.display = "inline";
        } else {
          idParagraph.textContent = `ID: ${
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
        holder.style.display = "flex";
        holder.style.alignItems = "center";
        holder.style.gap = "8px";
        holder.style.flexShrink = "0";
        holder.style.minWidth = "88px";
        holder.style.justifyContent = "flex-end";
      });
      PROFILE_STATS_LEGACY_CIRCLE_IDS.forEach((id) => {
        doc.getElementById(id)?.remove();
      });
      normalizeProfileStatsModeRows(doc);

      const selfExclusionOptions: Array<{ days: 1 | 3 | 7 | 14 | 30; id: string }> = [
        { days: 1, id: "n20731468" },
        { days: 3, id: "n20731470" },
        { days: 7, id: "n20731472" },
        { days: 14, id: "n20731474" },
        { days: 30, id: "n20731476" }
      ];
      selfExclusionOptions.forEach(({ days, id }) => {
        const option = doc.getElementById(id) as HTMLElement | null;
        if (!option) return;
        const selected = selfExclusionDuration === days;
        option.style.cursor = hydratedProfile.selfExclusionActive ? "default" : "pointer";
        option.style.borderRadius = "10px";
        option.style.border = selected ? "1px solid #f75154" : "1px solid #2d2d2d";
        option.style.background = selected
          ? "linear-gradient(180deg, rgba(247,81,84,0.22) 0%, rgba(172,46,48,0.22) 100%)"
          : "#151515";
        option.style.transition = "border-color 160ms ease, background 160ms ease";
        option.onclick = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          if (hydratedProfile.selfExclusionActive) return;
          setSelfExclusionDuration(days);
        };
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
      void openChangePasswordModal();
    });
    bindAction("n20731428", () => {
      openTradeUrlModal();
    });
    bindAction("n20731433", () => {
      openUsernameModal();
    });
    bindAction("n20731442", () => {
      toast.showError("Email verification is not available yet.");
    });
    bindAction("n20731468", () => {
      if (profile?.selfExclusionActive) return;
      setSelfExclusionDuration(1);
    });
    bindAction("n20731470", () => {
      if (profile?.selfExclusionActive) return;
      setSelfExclusionDuration(3);
    });
    bindAction("n20731472", () => {
      if (profile?.selfExclusionActive) return;
      setSelfExclusionDuration(7);
    });
    bindAction("n20731474", () => {
      if (profile?.selfExclusionActive) return;
      setSelfExclusionDuration(14);
    });
    bindAction("n20731476", () => {
      if (profile?.selfExclusionActive) return;
      setSelfExclusionDuration(30);
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
      if (profile?.selfExclusionActive) {
        toast.showError(
          `Self-exclusion is active until ${formatDateTime(profile.selfExcludeUntil)} and cannot be reversed.`
        );
        return;
      }
      openSelfExclusionModal();
    });

    const root = doc.getElementById("n20731272");

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
  }, [
    openChangePasswordModal,
    openSelfExclusionModal,
    openTradeUrlModal,
    openUsernameModal,
    privacyBusy,
    profile,
    profileResolved,
    selfExclusionDuration,
    toast,
    toggleProfileVisibility
  ]);

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
    <div className="-mx-5 -my-4 bg-[#070707] pb-8">
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
              border: 0,
              display: "block",
              background: "#070707",
              marginBottom: 24,
              visibility: showIframe ? "visible" : "hidden"
            }}
          />
        </div>
      </div>
      {passwordModal.open ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4"
          onMouseDown={() => {
            if (!passwordModal.loading) {
              closeChangePasswordModal();
            }
          }}
        >
          <div
            className="w-full max-w-[460px] rounded-[18px] border border-[#2d2d2d] bg-[#101010] shadow-[0_20px_80px_rgba(0,0,0,0.65),0_0_28px_rgba(247,81,84,0.12)]"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="border-b border-[#282828] px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="m-0 text-[22px] font-semibold leading-[22px] text-white">
                  Change Password
                </h2>
                <button
                  type="button"
                  aria-label="Close modal"
                  disabled={passwordModal.loading}
                  className="h-8 w-8 rounded-full border border-[#353535] bg-[#1a1a1a] text-[16px] leading-none text-[#b8b8b8] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={closeChangePasswordModal}
                >
                  ✕
                </button>
              </div>
              <p className="mt-3 text-[13px] leading-[18px] text-[#8f8f8f]">
                Keep your account secure by setting a strong password. If your account has 2FA
                enabled, confirmation code is required.
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#f75154]">
                  Current password
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={passwordModal.currentPassword}
                  disabled={passwordModal.loading}
                  onChange={(event) =>
                    setPasswordModal((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                      error: null
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitPasswordChange();
                    }
                  }}
                  className="h-11 w-full rounded-[10px] border border-[#2e2e2e] bg-[#161616] px-3 text-[14px] text-white outline-none transition focus:border-[#f75154]/70"
                  placeholder="Enter your current password"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#f75154]">
                  New password
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={passwordModal.newPassword}
                  disabled={passwordModal.loading}
                  onChange={(event) =>
                    setPasswordModal((current) => ({
                      ...current,
                      newPassword: event.target.value,
                      error: null
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitPasswordChange();
                    }
                  }}
                  className="h-11 w-full rounded-[10px] border border-[#2e2e2e] bg-[#161616] px-3 text-[14px] text-white outline-none transition focus:border-[#f75154]/70"
                  placeholder="At least 8 characters"
                />
              </label>

              {passwordModal.twoFactorEnabled ? (
                <label className="block">
                  <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#f75154]">
                    2FA code
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={passwordModal.twoFactorCode}
                    disabled={passwordModal.loading}
                    onChange={(event) => {
                      const value = event.target.value.replace(/\D/g, "").slice(0, 6);
                      setPasswordModal((current) => ({
                        ...current,
                        twoFactorCode: value,
                        error: null
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitPasswordChange();
                      }
                    }}
                    className="h-11 w-full rounded-[10px] border border-[#2e2e2e] bg-[#161616] px-3 text-[14px] text-white outline-none transition focus:border-[#f75154]/70"
                    placeholder="6-digit code"
                  />
                </label>
              ) : null}

              {passwordModal.error ? (
                <p className="m-0 rounded-[10px] border border-[#f75154]/30 bg-[#2a1213] px-3 py-2 text-[12px] leading-[16px] text-[#ffa7a8]">
                  {passwordModal.error}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#282828] px-6 py-4">
              <button
                type="button"
                disabled={passwordModal.loading}
                onClick={closeChangePasswordModal}
                className="h-10 rounded-[10px] border border-[#3a3a3a] bg-[#191919] px-4 text-[13px] font-semibold text-[#c7c7c7] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={passwordModal.loading}
                onClick={() => {
                  void submitPasswordChange();
                }}
                className="h-10 rounded-[10px] border border-[#f75154]/60 bg-[linear-gradient(180deg,#f75154_0%,#ac2e30_100%)] px-5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_16px_rgba(247,81,84,0.28)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {passwordModal.loading ? "Updating..." : "Update Password"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {tradeUrlModal.open ? (
        <div
          className="fixed inset-0 z-[201] flex items-center justify-center bg-black/70 px-4"
          onMouseDown={() => {
            if (!tradeUrlModal.loading) {
              closeTradeUrlModal();
            }
          }}
        >
          <div
            className="w-full max-w-[520px] rounded-[18px] border border-[#2d2d2d] bg-[#101010] shadow-[0_20px_80px_rgba(0,0,0,0.65),0_0_28px_rgba(247,81,84,0.12)]"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="border-b border-[#282828] px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="m-0 text-[22px] font-semibold leading-[22px] text-white">Set Trade URL</h2>
                <button
                  type="button"
                  aria-label="Close modal"
                  disabled={tradeUrlModal.loading}
                  className="h-8 w-8 rounded-full border border-[#353535] bg-[#1a1a1a] text-[16px] leading-none text-[#b8b8b8] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={closeTradeUrlModal}
                >
                  ✕
                </button>
              </div>
              <p className="mt-3 text-[13px] leading-[18px] text-[#8f8f8f]">
                Add your Steam trade URL so you can deposit or withdraw skins. You can edit this
                value at any time.
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#f75154]">
                  Steam trade URL
                </span>
                <input
                  type="url"
                  autoComplete="off"
                  value={tradeUrlModal.tradeUrl}
                  disabled={tradeUrlModal.loading}
                  onChange={(event) =>
                    setTradeUrlModal((current) => ({
                      ...current,
                      tradeUrl: event.target.value,
                      error: null
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitTradeUrl();
                    }
                  }}
                  className="h-11 w-full rounded-[10px] border border-[#2e2e2e] bg-[#161616] px-3 text-[14px] text-white outline-none transition focus:border-[#f75154]/70"
                  placeholder="https://steamcommunity.com/tradeoffer/new/?partner=...&token=..."
                />
              </label>

              {tradeUrlModal.error ? (
                <p className="m-0 rounded-[10px] border border-[#f75154]/30 bg-[#2a1213] px-3 py-2 text-[12px] leading-[16px] text-[#ffa7a8]">
                  {tradeUrlModal.error}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#282828] px-6 py-4">
              <button
                type="button"
                disabled={tradeUrlModal.loading}
                onClick={closeTradeUrlModal}
                className="h-10 rounded-[10px] border border-[#3a3a3a] bg-[#191919] px-4 text-[13px] font-semibold text-[#c7c7c7] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={tradeUrlModal.loading}
                onClick={() => {
                  void submitTradeUrl();
                }}
                className="h-10 rounded-[10px] border border-[#f75154]/60 bg-[linear-gradient(180deg,#f75154_0%,#ac2e30_100%)] px-5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_16px_rgba(247,81,84,0.28)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {tradeUrlModal.loading ? "Saving..." : "Save URL"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {usernameModal.open ? (
        <div
          className="fixed inset-0 z-[202] flex items-center justify-center bg-black/70 px-4"
          onMouseDown={() => {
            if (!usernameModal.loading) {
              closeUsernameModal();
            }
          }}
        >
          <div
            className="w-full max-w-[520px] rounded-[18px] border border-[#2d2d2d] bg-[#101010] shadow-[0_20px_80px_rgba(0,0,0,0.65),0_0_28px_rgba(247,81,84,0.12)]"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="border-b border-[#282828] px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="m-0 text-[22px] font-semibold leading-[22px] text-white">
                  Change Username
                </h2>
                <button
                  type="button"
                  aria-label="Close modal"
                  disabled={usernameModal.loading}
                  className="h-8 w-8 rounded-full border border-[#353535] bg-[#1a1a1a] text-[16px] leading-none text-[#b8b8b8] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={closeUsernameModal}
                >
                  ✕
                </button>
              </div>
              <p className="mt-3 text-[13px] leading-[18px] text-[#8f8f8f]">
                Your username can contain up to 20 characters and may be changed once every 24
                hours.
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#f75154]">
                  New username
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={20}
                  value={usernameModal.username}
                  disabled={usernameModal.loading}
                  onChange={(event) =>
                    setUsernameModal((current) => ({
                      ...current,
                      username: event.target.value,
                      error: null
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitUsernameChange();
                    }
                  }}
                  className="h-11 w-full rounded-[10px] border border-[#2e2e2e] bg-[#161616] px-3 text-[14px] text-white outline-none transition focus:border-[#f75154]/70"
                  placeholder="Enter your username"
                />
              </label>

              {!profile?.canChangeUsername ? (
                <p className="m-0 rounded-[10px] border border-[#3a3a3a] bg-[#181818] px-3 py-2 text-[12px] leading-[16px] text-[#b8b8b8]">
                  Cooldown active. Next change available at{" "}
                  <span className="font-semibold text-[#ffd2d3]">
                    {formatDateTime(usernameModal.nextChangeAt)}
                  </span>
                  .
                </p>
              ) : null}

              {usernameModal.error ? (
                <p className="m-0 rounded-[10px] border border-[#f75154]/30 bg-[#2a1213] px-3 py-2 text-[12px] leading-[16px] text-[#ffa7a8]">
                  {usernameModal.error}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#282828] px-6 py-4">
              <button
                type="button"
                disabled={usernameModal.loading}
                onClick={closeUsernameModal}
                className="h-10 rounded-[10px] border border-[#3a3a3a] bg-[#191919] px-4 text-[13px] font-semibold text-[#c7c7c7] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={usernameModal.loading}
                onClick={() => {
                  void submitUsernameChange();
                }}
                className="h-10 rounded-[10px] border border-[#f75154]/60 bg-[linear-gradient(180deg,#f75154_0%,#ac2e30_100%)] px-5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_16px_rgba(247,81,84,0.28)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {usernameModal.loading ? "Saving..." : "Save Username"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {selfExclusionModal.open ? (
        <div
          className="fixed inset-0 z-[203] flex items-center justify-center bg-black/70 px-4"
          onMouseDown={() => {
            if (!selfExclusionModal.loading) {
              closeSelfExclusionModal();
            }
          }}
        >
          <div
            className="w-full max-w-[560px] rounded-[18px] border border-[#2d2d2d] bg-[#101010] shadow-[0_20px_80px_rgba(0,0,0,0.65),0_0_28px_rgba(247,81,84,0.12)]"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="border-b border-[#282828] px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="m-0 text-[22px] font-semibold leading-[22px] text-white">
                  Confirm Self Exclusion
                </h2>
                <button
                  type="button"
                  aria-label="Close modal"
                  disabled={selfExclusionModal.loading}
                  className="h-8 w-8 rounded-full border border-[#353535] bg-[#1a1a1a] text-[16px] leading-none text-[#b8b8b8] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={closeSelfExclusionModal}
                >
                  ✕
                </button>
              </div>
              <p className="mt-3 text-[13px] leading-[18px] text-[#8f8f8f]">
                This action is irreversible for the selected period. During self-exclusion you
                cannot wager, withdraw, or send tips.
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#f75154]">
                  Duration
                </span>
                <div className="flex flex-wrap gap-2">
                  {SELF_EXCLUSION_DURATIONS.map((days) => {
                    const selected = selfExclusionModal.durationDays === days;
                    return (
                      <button
                        key={days}
                        type="button"
                        disabled={selfExclusionModal.loading}
                        onClick={() =>
                          setSelfExclusionModal((current) => ({
                            ...current,
                            durationDays: days,
                            error: null
                          }))
                        }
                        className={`h-9 rounded-[9px] px-3 text-[12px] font-semibold transition ${
                          selected
                            ? "border border-[#f75154]/70 bg-[#2a1213] text-[#ffd5d6]"
                            : "border border-[#333] bg-[#171717] text-[#bcbcbc] hover:text-white"
                        }`}
                      >
                        {days} day{days > 1 ? "s" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#f75154]">
                  Type CONFIRM
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  value={selfExclusionModal.confirmationText}
                  disabled={selfExclusionModal.loading}
                  onChange={(event) =>
                    setSelfExclusionModal((current) => ({
                      ...current,
                      confirmationText: event.target.value,
                      error: null
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitSelfExclusion();
                    }
                  }}
                  className="h-11 w-full rounded-[10px] border border-[#2e2e2e] bg-[#161616] px-3 text-[14px] text-white outline-none transition focus:border-[#f75154]/70"
                  placeholder='Type "CONFIRM"'
                />
              </label>

              {selfExclusionModal.error ? (
                <p className="m-0 rounded-[10px] border border-[#f75154]/30 bg-[#2a1213] px-3 py-2 text-[12px] leading-[16px] text-[#ffa7a8]">
                  {selfExclusionModal.error}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#282828] px-6 py-4">
              <button
                type="button"
                disabled={selfExclusionModal.loading}
                onClick={closeSelfExclusionModal}
                className="h-10 rounded-[10px] border border-[#3a3a3a] bg-[#191919] px-4 text-[13px] font-semibold text-[#c7c7c7] transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selfExclusionModal.loading}
                onClick={() => {
                  void submitSelfExclusion();
                }}
                className="h-10 rounded-[10px] border border-[#f75154]/60 bg-[linear-gradient(180deg,#f75154_0%,#ac2e30_100%)] px-5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_16px_rgba(247,81,84,0.28)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {selfExclusionModal.loading ? "Locking..." : "Confirm Lock"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
