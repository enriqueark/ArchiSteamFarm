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

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const me = await getMe();
        let summary: ChatPublicProfileSummary | null = null;
        try {
          summary = await getChatProfileByUserId(me.id);
        } catch {
          summary = null;
        }
        if (cancelled) return;
        setProfile(mapProfileData(me, summary));
      } catch {
        if (!cancelled) setProfile(null);
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

    if (profile) {
      const avatar = doc.getElementById("n20731340") as HTMLImageElement | null;
      if (avatar && profile.avatarUrl) {
        avatar.src = profile.avatarUrl;
        avatar.style.objectFit = "cover";
      }

      setContainerParagraphText(doc, "n20731347", profile.username);
      setContainerParagraphText(doc, "n20731354", String(profile.level));
      setContainerParagraphText(doc, "n20731371", profile.stats.totalPlayed);
      setContainerParagraphText(doc, "n20731380", profile.stats.battles);
      setContainerParagraphText(doc, "n20731389", profile.stats.roulette);
      setContainerParagraphText(doc, "n20731398", profile.stats.cases);
      setContainerParagraphText(doc, "n20731407", profile.stats.blackjack);
      setContainerParagraphText(doc, "n20731416", profile.stats.mines);
      setContainerParagraphText(doc, "n20731441", profile.email);

      const idParagraph = doc.getElementById("n20731349")?.querySelector("p");
      if (idParagraph) {
        const spans = idParagraph.querySelectorAll("span");
        if (spans.length >= 2) {
          spans[0].textContent = "Your ID:";
          spans[1].textContent = profile.publicId !== null ? String(profile.publicId) : "N/A";
        } else {
          idParagraph.textContent = `Your ID:${profile.publicId !== null ? profile.publicId : "N/A"}`;
        }
      }

      const xpParagraph = doc.getElementById("n20731355")?.querySelector("p");
      if (xpParagraph) {
        const spans = xpParagraph.querySelectorAll("span");
        if (spans.length >= 2) {
          spans[0].textContent = profile.xpCurrent.toLocaleString("en-US");
          spans[1].textContent = `/${profile.xpTarget.toLocaleString("en-US")}XP`;
        } else {
          xpParagraph.textContent = `${profile.xpCurrent.toLocaleString("en-US")}/${profile.xpTarget.toLocaleString("en-US")}XP`;
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
  }, [profile]);

  const handleFrameLoad = useCallback(() => {
    syncFrameContent();
  }, [syncFrameContent]);

  useEffect(() => {
    syncFrameContent();
  }, [syncFrameContent]);

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
              background: "#070707"
            }}
          />
        </div>
      </div>
    </div>
  );
}
