export function refreshBalance() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("refreshBalance"));
  }
}
