import { useCallback, useEffect, useRef, useState } from "react";
import {
  getChatProfileByUserId,
  getMe,
  type ChatPublicProfileSummary,
  type User
} from "@/lib/api";

type HydratedProfile = {
  avatarUrl: string | null;
  username: string;
  publicId: number | null;
  email: string;
  level: number;
  xpCurrent: number;
  xpTarget: number;
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
const PROFILE_XP_TARGET = 1000;
const PROFILE_FETCH_RETRIES = 3;
const PROFILE_FETCH_RETRY_DELAY_MS = 350;
const FALLBACK_PROFILE: HydratedProfile = {
  avatarUrl: null,
  username: "Player",
  publicId: null,
  email: "",
  level: 1,
  xpCurrent: 0,
  xpTarget: PROFILE_XP_TARGET,
  stats: {
    totalPlayed: "0.00",
    battles: "0.00",
    roulette: "0.00",
    cases: "0.00",
    blackjack: "0.00",
    mines: "0.00"
  }
};

function toSafeInteger(input: unknown): number {
  const raw = typeof input === "string" ? input.replace(/,/g, "") : String(input ?? "0");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
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

function withCacheBust(url: string, token: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}rw_profile=${encodeURIComponent(token)}`;
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
  const level = Math.max(1, user.progression?.level ?? user.level ?? summary?.user.level ?? 1);
  const xpAbsolute = toSafeInteger(user.progression?.xp ?? user.levelXp ?? user.levelXpAtomic);
  const xpCurrent = xpAbsolute % PROFILE_XP_TARGET;
  const avatarUrl = user.avatarUrl ?? user.customAvatarUrl ?? user.providerAvatarUrl ?? null;

  return {
    avatarUrl,
    username,
    publicId,
    email: user.email,
    level,
    xpCurrent,
    xpTarget: PROFILE_XP_TARGET,
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [profile, setProfile] = useState<HydratedProfile | null>(null);
  const [profileResolved, setProfileResolved] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const cacheBustRef = useRef(`${Date.now()}`);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const me = await fetchMeWithRetry();
        let summary: ChatPublicProfileSummary | null = null;
        try {
          summary = await getChatProfileByUserId(me.id);
        } catch {
          summary = null;
        }
        if (cancelled) return;
        setProfile(mapProfileData(me, summary));
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
      if (avatar && hydratedProfile.avatarUrl) {
        avatar.src = withCacheBust(hydratedProfile.avatarUrl, cacheBustRef.current);
        avatar.style.objectFit = "cover";
      }

      setContainerParagraphText(doc, "n20731347", hydratedProfile.username);
      setContainerParagraphText(doc, "n20731354", String(hydratedProfile.level));
      setContainerParagraphText(doc, "n20731371", hydratedProfile.stats.totalPlayed);
      setContainerParagraphText(doc, "n20731380", hydratedProfile.stats.battles);
      setContainerParagraphText(doc, "n20731389", hydratedProfile.stats.roulette);
      setContainerParagraphText(doc, "n20731398", hydratedProfile.stats.cases);
      setContainerParagraphText(doc, "n20731407", hydratedProfile.stats.blackjack);
      setContainerParagraphText(doc, "n20731416", hydratedProfile.stats.mines);
      setContainerParagraphText(doc, "n20731441", hydratedProfile.email);

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
        if (spans.length >= 2) {
          spans[0].textContent = hydratedProfile.xpCurrent.toLocaleString("en-US");
          spans[1].textContent = `/${hydratedProfile.xpTarget.toLocaleString("en-US")}XP`;
        } else {
          xpParagraph.textContent = `${hydratedProfile.xpCurrent.toLocaleString("en-US")}/${hydratedProfile.xpTarget.toLocaleString("en-US")}XP`;
        }
      }
    }

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
  }, [profile, profileResolved]);

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
