export function refreshBalance() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("refreshBalance"));
  }
}

export const CASE_OPEN_BALANCE_SYNC_EVENT = "case-open-balance-sync";

export type CaseOpenBalanceSyncDetail =
  | { type: "start"; costAtomic: string }
  | { type: "end"; payoutAtomic: string }
  | { type: "cancel" };

export function syncCaseOpenBalance(detail: CaseOpenBalanceSyncDetail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<CaseOpenBalanceSyncDetail>(CASE_OPEN_BALANCE_SYNC_EVENT, { detail }));
  }
}
