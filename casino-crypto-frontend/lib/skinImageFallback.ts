const BLOCKED_SKIN_IMAGE_HOSTS = new Set([
  "cdn.rain.gg",
  "cfdn.wiki.skin.club",
  "cfdn.skin.club",
  "cdn.csgoskins.gg"
]);

export const FALLBACK_SKIN_IMAGE_URL =
  "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_CNk7uW-V6JsJPWsAm6Xyfo45-c5GXDnwB534DuEwtuoIHOfaAYiAsYjF-QItUaxmoC0MO_h5ALcjJUFk3sEzfdk4w";

export const resolveRenderableSkinImageUrl = (url: string | null | undefined): string => {
  const raw = url?.trim();
  if (!raw) return FALLBACK_SKIN_IMAGE_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return FALLBACK_SKIN_IMAGE_URL;
    }
    if (BLOCKED_SKIN_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return FALLBACK_SKIN_IMAGE_URL;
    }
    return parsed.toString();
  } catch {
    return FALLBACK_SKIN_IMAGE_URL;
  }
};

export const handleSkinImageError = (event: { currentTarget: HTMLImageElement }): void => {
  const img = event.currentTarget;
  if (!img) return;
  if (img.dataset.skinFallbackApplied === "1") {
    img.onerror = null;
    img.style.visibility = "hidden";
    return;
  }
  img.dataset.skinFallbackApplied = "1";
  img.src = FALLBACK_SKIN_IMAGE_URL;
};
