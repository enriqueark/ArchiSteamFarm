import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getWallets } from "@/lib/api";
import { useAuthUI } from "@/lib/auth-ui";

const COIN_DECIMALS = 8;
const CURRENCIES = ["BTC", "ETH", "USDT", "USDC"] as const;
type WalletMode = "deposit" | "withdraw";

type DeltaNotice = {
  id: number;
  sign: "+" | "-";
  amount: string;
};

const toCoins = (atomic: string): number => {
  const value = Number(atomic);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value / 10 ** COIN_DECIMALS;
};

const formatCoins = (value: number): string => {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export default function BalanceControl() {
  const { authed, openAuth } = useAuthUI();
  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<WalletMode>("deposit");
  const [selectedCurrency, setSelectedCurrency] = useState<(typeof CURRENCIES)[number]>("USDT");
  const [amount, setAmount] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [targetBalance, setTargetBalance] = useState(0);
  const [displayBalance, setDisplayBalance] = useState(0);
  const [deltaNotices, setDeltaNotices] = useState<DeltaNotice[]>([]);

  const previousBalanceRef = useRef<number | null>(null);
  const displayBalanceRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const deltaNoticeIdRef = useRef(0);

  const depositAddressByCurrency = useMemo(
    () => ({
      BTC: "bc1q-casino-btc-demo-address",
      ETH: "0xCasinoEthDemoAddress00000001",
      USDT: "TQCasinoUsdtDemoAddress00000001",
      USDC: "0xCasinoUsdcDemoAddress00000001"
    }),
    []
  );

  const showDeltaNotice = useCallback((delta: number) => {
    if (Math.abs(delta) < 0.0000001) {
      return;
    }
    const id = ++deltaNoticeIdRef.current;
    const item: DeltaNotice = {
      id,
      sign: delta > 0 ? "+" : "-",
      amount: formatCoins(Math.abs(delta))
    };
    setDeltaNotices((prev) => [...prev.slice(-2), item]);
    setTimeout(() => {
      setDeltaNotices((prev) => prev.filter((existing) => existing.id !== id));
    }, 1800);
  }, []);

  useEffect(() => {
    if (!authed) {
      previousBalanceRef.current = null;
      setTargetBalance(0);
      return;
    }

    let cancelled = false;
    const fetchBalance = async () => {
      try {
        const wallets = await getWallets();
        if (cancelled) {
          return;
        }
        const nextBalance = wallets.reduce((sum, wallet) => sum + toCoins(wallet.balanceAtomic), 0);
        const previous = previousBalanceRef.current;
        setTargetBalance(nextBalance);
        if (previous !== null) {
          showDeltaNotice(nextBalance - previous);
        }
        previousBalanceRef.current = nextBalance;
      } catch {
        // Ignore transient wallet fetch failures.
      }
    };

    void fetchBalance();
    const timer = setInterval(() => {
      void fetchBalance();
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authed, showDeltaNotice]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const start = displayBalanceRef.current;
    const end = targetBalance;
    const durationMs = 900;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.max(0, Math.min(1, elapsed / durationMs));
      const eased = 1 - (1 - progress) ** 3;
      const next = start + (end - start) * eased;
      displayBalanceRef.current = next;
      setDisplayBalance(next);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        displayBalanceRef.current = end;
        setDisplayBalance(end);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [targetBalance]);

  const openPanel = () => {
    if (!authed) {
      openAuth("register");
      return;
    }
    setHint(null);
    setPanelOpen(true);
  };

  const handleAction = () => {
    if (!authed) {
      openAuth("register");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setHint("Enter a valid amount first.");
      return;
    }
    if (mode === "withdraw" && withdrawAddress.trim().length < 10) {
      setHint("Enter a valid destination wallet address.");
      return;
    }
    setHint(
      mode === "deposit"
        ? "Deposit gateway UI ready. Blockchain processing will be connected next."
        : "Withdraw UI ready. Blockchain processing will be connected next."
    );
  };

  return (
    <>
      <div className="relative">
        <div className="flex items-center overflow-hidden rounded-md border border-red-900/70 bg-gray-950/90 shadow-[0_0_14px_rgba(220,38,38,0.18)]">
          <div className="flex min-w-[130px] items-center justify-center gap-2 border-r border-red-900/70 px-3 py-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-600/20 text-[11px] text-red-300">
              $
            </span>
            <span className="tabular-nums text-sm font-semibold text-gray-100">{formatCoins(displayBalance)}</span>
          </div>
          <button
            type="button"
            className="bg-red-600 px-4 py-1.5 text-xs font-bold tracking-wide text-white transition-colors hover:bg-red-500"
            onClick={openPanel}
          >
            DEPOSIT
          </button>
        </div>
        <div className="pointer-events-none absolute left-1/2 top-full mt-1 min-h-5 -translate-x-1/2">
          {deltaNotices.map((item) => (
            <div
              key={item.id}
              className={`balance-delta-notice text-xs font-semibold ${
                item.sign === "+" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {item.sign}
              {item.amount}
            </div>
          ))}
        </div>
      </div>

      {panelOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close wallet modal"
            className="absolute inset-0 bg-black/75 backdrop-blur-[1px]"
            onClick={() => setPanelOpen(false)}
          />

          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="relative z-10 w-full max-w-xl rounded-xl border border-red-900/60 bg-gray-950 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.6)]">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="absolute right-3 top-3 text-lg text-gray-500 hover:text-gray-200"
                aria-label="Close"
              >
                X
              </button>

              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold tracking-wide text-red-400">
                  {mode === "deposit" ? "DEPOSIT" : "WITHDRAW"}
                </h3>
                <button
                  type="button"
                  className="rounded border border-red-800/80 px-2.5 py-1 text-xs font-semibold tracking-wide text-red-300 hover:bg-red-900/30"
                  onClick={() => setMode((prev) => (prev === "deposit" ? "withdraw" : "deposit"))}
                >
                  {mode === "deposit" ? "WITHDRAW" : "DEPOSIT"}
                </button>
              </div>

              <p className="mb-3 text-sm text-gray-400">
                Choose your preferred crypto method. Deposit and withdraw use the same currencies.
              </p>

              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CURRENCIES.map((currency) => (
                  <button
                    key={currency}
                    type="button"
                    onClick={() => setSelectedCurrency(currency)}
                    className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                      selectedCurrency === currency
                        ? "border-red-500 bg-red-600/20 text-red-200"
                        : "border-gray-800 bg-gray-900 text-gray-300 hover:border-red-700/70 hover:text-red-200"
                    }`}
                  >
                    {currency}
                  </button>
                ))}
              </div>

              <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                {mode === "deposit" ? (
                  <>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Deposit address ({selectedCurrency})
                    </label>
                    <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-300">
                      {depositAddressByCurrency[selectedCurrency]}
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Destination address ({selectedCurrency})
                    </label>
                    <input
                      value={withdrawAddress}
                      onChange={(event) => setWithdrawAddress(event.target.value)}
                      className="w-full rounded border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-red-600"
                      placeholder="Paste destination wallet address"
                    />
                  </>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Amount (COINS)
                  </label>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="w-full rounded border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-red-600"
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAction}
                  className="w-full rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
                >
                  {mode === "deposit" ? `Continue deposit (${selectedCurrency})` : `Continue withdraw (${selectedCurrency})`}
                </button>

                {hint && <p className="text-xs text-gray-400">{hint}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
