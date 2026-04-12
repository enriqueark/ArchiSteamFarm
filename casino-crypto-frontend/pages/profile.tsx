import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  getChatProfileByUserId,
  getMe,
  setMyProfileVisibility,
  type ChatPublicProfileSummary,
  type User
} from "@/lib/api";
import { useToast } from "@/lib/toast";

type HydratedProfile = {
  avatarUrl: string | null;
  username: string;
  publicId: number | null;
  email: string;
  level: number;
  profileVisible: boolean;
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
  profileVisible: true,
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

function injectRuntimeProfileStyles(doc: Document) {
  const styleId = "rw-profile-runtime-overrides";
  const existing = doc.getElementById(styleId) as HTMLStyleElement | null;
  if (existing) return;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `
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
  `;
  doc.head.appendChild(style);
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
    profileVisible: summary?.user.profileVisible ?? true,
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
  const router = useRouter();
  const toast = useToast();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [profile, setProfile] = useState<HydratedProfile | null>(null);
  const [profileResolved, setProfileResolved] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
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
        avatar.onerror = () => {
          avatar.onerror = null;
          avatar.src = avatarFallback;
        };
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
      setContainerParagraphText(
        doc,
        "n20731455",
        privacyBusy ? "Saving..." : hydratedProfile.profileVisible ? "Deactivate privacy" : "Activate privacy"
      );

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
    bindAction("n20731455", () => {
      void toggleProfileVisibility();
    });
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
