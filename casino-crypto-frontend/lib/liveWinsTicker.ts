export const LIVE_WINS_REFRESH_EVENT = "liveWinsRefresh";

export function requestLiveWinsRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LIVE_WINS_REFRESH_EVENT));
}
