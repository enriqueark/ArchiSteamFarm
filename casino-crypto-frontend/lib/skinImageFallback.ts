const FALLBACK_SKIN_IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1a2230"/><stop offset="100%" stop-color="#0f1623"/></linearGradient></defs><rect width="320" height="320" rx="28" fill="url(#g)"/><rect x="24" y="24" width="272" height="272" rx="20" fill="none" stroke="#314258" stroke-width="4"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#8fa5bf" font-family="Arial,sans-serif" font-size="28" font-weight="700">NO IMAGE</text></svg>';
export const FALLBACK_SKIN_IMAGE_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  FALLBACK_SKIN_IMAGE_SVG
)}`;

const isDataImageUrl = (value: string): boolean => /^data:image\//i.test(value);
const isBlobUrl = (value: string): boolean => /^blob:/i.test(value);

export const resolveRenderableSkinImageUrl = (url: string | null | undefined): string => {
  const raw = url?.trim();
  if (!raw) return FALLBACK_SKIN_IMAGE_URL;
  if (isDataImageUrl(raw) || isBlobUrl(raw)) {
    return raw;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
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
