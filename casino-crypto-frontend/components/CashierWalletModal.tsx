import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createWithdrawal,
  getDepositAddresses,
  type CashierAddress,
  type CashierWithdrawalAsset,
  type CashierWithdrawalNetwork
} from "@/lib/api";
import { useToast } from "@/lib/toast";

type WalletTab = "deposit" | "withdraw";

type Props = {
  open: boolean;
  onClose: () => void;
  onBalanceRefresh?: () => void;
};

type MethodMeta = {
  key: string;
  asset: CashierWithdrawalAsset | "DOGE";
  network: CashierWithdrawalNetwork | "dogecoin";
  label: string;
  symbol: string;
  iconText: string;
  iconBg: string;
  iconColor?: string;
  supportsWithdraw: boolean;
};

type MethodCard = MethodMeta & {
  address: CashierAddress | null;
};

const METHOD_META: MethodMeta[] = [
  {
    key: "BTC:bitcoin",
    asset: "BTC",
    network: "bitcoin",
    label: "Bitcoin",
    symbol: "BTC",
    iconText: "B",
    iconBg: "#f7931a",
    supportsWithdraw: true
  },
  {
    key: "ETH:erc20",
    asset: "ETH",
    network: "erc20",
    label: "Ethereum",
    symbol: "ETH",
    iconText: "E",
    iconBg: "#6f46e8",
    supportsWithdraw: true
  },
  {
    key: "SOL:solana",
    asset: "SOL",
    network: "solana",
    label: "Solana",
    symbol: "SOL",
    iconText: "S",
    iconBg: "#2577ff",
    supportsWithdraw: true
  },
  {
    key: "LTC:litecoin",
    asset: "LTC",
    network: "litecoin",
    label: "Litecoin",
    symbol: "LTC",
    iconText: "L",
    iconBg: "#4f7db7",
    supportsWithdraw: true
  },
  {
    key: "USDT:trc20",
    asset: "USDT",
    network: "trc20",
    label: "USDT (TRC20)",
    symbol: "USDT",
    iconText: "T",
    iconBg: "#16a374",
    supportsWithdraw: true
  },
  {
    key: "USDT:erc20",
    asset: "USDT",
    network: "erc20",
    label: "USDT (ERC20)",
    symbol: "USDT",
    iconText: "T",
    iconBg: "#16a374",
    supportsWithdraw: true
  },
  {
    key: "USDC:erc20",
    asset: "USDC",
    network: "erc20",
    label: "USDC (ERC20)",
    symbol: "USDC",
    iconText: "$",
    iconBg: "#2775ca",
    supportsWithdraw: true
  },
  {
    key: "DOGE:dogecoin",
    asset: "DOGE",
    network: "dogecoin",
    label: "Dogecoin",
    symbol: "DOGE",
    iconText: "D",
    iconBg: "#c7a33d",
    iconColor: "#1a1a1a",
    supportsWithdraw: false
  }
];

const METHOD_META_BY_KEY = new Map(METHOD_META.map((method) => [method.key, method]));
const COIN_TO_USD = 0.6;
const MIN_WITHDRAW_USD = 5;

const WITHDRAW_USD_RATE: Record<CashierWithdrawalAsset, number> = {
  BTC: 110_000,
  ETH: 4_500,
  SOL: 200,
  LTC: 100,
  USDT: 1,
  USDC: 1
};

const toMethodKey = (asset: string, network: string): string =>
  `${asset.trim().toUpperCase()}:${network.trim().toLowerCase()}`;

const toMethodLabel = (asset: string, network: string, networkLabel: string): string => {
  const normalizedAsset = asset.trim().toUpperCase();
  const normalizedNetwork = network.trim().toLowerCase();
  if (normalizedAsset === "USDT" && normalizedNetwork === "trc20") return "USDT (TRC20)";
  if (normalizedAsset === "USDT" && normalizedNetwork === "erc20") return "USDT (ERC20)";
  if (normalizedAsset === "USDC" && normalizedNetwork === "erc20") return "USDC (ERC20)";
  if (normalizedAsset === "ETH" && normalizedNetwork === "erc20") return "Ethereum";
  if (normalizedAsset === "BTC" && normalizedNetwork === "bitcoin") return "Bitcoin";
  if (normalizedAsset === "SOL" && normalizedNetwork === "solana") return "Solana";
  if (normalizedAsset === "LTC" && normalizedNetwork === "litecoin") return "Litecoin";
  return `${normalizedAsset} (${networkLabel.toUpperCase()})`;
};

const formatCoinAmount = (value: number): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parseAmountInput = (value: string): number => {
  const normalized = value.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

export default function CashierWalletModal({ open, onClose, onBalanceRefresh }: Props) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<WalletTab>("deposit");
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<CashierAddress[]>([]);
  const [selectedDepositKey, setSelectedDepositKey] = useState<string | null>(null);
  const [selectedWithdrawKey, setSelectedWithdrawKey] = useState<string | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawCoinsInput, setWithdrawCoinsInput] = useState("");
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [bonusCode, setBonusCode] = useState("");

  const loadAddresses = useCallback(async () => {
    setLoadingAddresses(true);
    setAddressError(null);
    try {
      const response = await getDepositAddresses();
      const nextAddresses = response.addresses ?? [];
      setAddresses(nextAddresses);

      const availableKeys = new Set(nextAddresses.map((item) => toMethodKey(item.asset, item.network)));
      const firstAvailable = nextAddresses[0] ? toMethodKey(nextAddresses[0].asset, nextAddresses[0].network) : null;

      setSelectedDepositKey((prev) => (prev && availableKeys.has(prev) ? prev : firstAvailable));
      setSelectedWithdrawKey((prev) => (prev && availableKeys.has(prev) ? prev : firstAvailable));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load deposit methods.";
      setAddressError(message);
    } finally {
      setLoadingAddresses(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    setActiveTab("deposit");
    void loadAddresses();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [loadAddresses, onClose, open]);

  const addressByKey = useMemo(
    () => new Map(addresses.map((item) => [toMethodKey(item.asset, item.network), item])),
    [addresses]
  );

  const methodCards = useMemo<MethodCard[]>(() => {
    const known = METHOD_META.map<MethodCard>((method) => ({
      ...method,
      address: addressByKey.get(method.key) ?? null
    }));

    const extras: MethodCard[] = [];
    addresses.forEach((address) => {
      const key = toMethodKey(address.asset, address.network);
      if (METHOD_META_BY_KEY.has(key)) return;
      extras.push({
        key,
        asset: address.asset.trim().toUpperCase() as CashierWithdrawalAsset,
        network: address.network.trim().toLowerCase() as CashierWithdrawalNetwork,
        label: toMethodLabel(address.asset, address.network, address.networkLabel),
        symbol: address.asset.trim().toUpperCase(),
        iconText: address.asset.trim().toUpperCase().slice(0, 1),
        iconBg: "#2f3443",
        supportsWithdraw: true,
        address
      });
    });

    return [...known, ...extras];
  }, [addressByKey, addresses]);

  const availableDepositCards = methodCards.filter((item) => item.address);
  const defaultDepositCard = availableDepositCards[0] ?? null;
  const selectedDepositCard =
    methodCards.find((item) => item.key === selectedDepositKey && item.address) ?? defaultDepositCard;

  const availableWithdrawCards = methodCards.filter((item) => item.address && item.supportsWithdraw);
  const defaultWithdrawCard = availableWithdrawCards[0] ?? null;
  const selectedWithdrawCard =
    methodCards.find((item) => item.key === selectedWithdrawKey && item.address && item.supportsWithdraw) ??
    defaultWithdrawCard;

  const withdrawCoins = parseAmountInput(withdrawCoinsInput);
  const withdrawUsdEstimate = withdrawCoins * COIN_TO_USD;
  const selectedWithdrawAsset = selectedWithdrawCard?.asset as CashierWithdrawalAsset | undefined;
  const withdrawRate = selectedWithdrawAsset ? WITHDRAW_USD_RATE[selectedWithdrawAsset] ?? 1 : 1;
  const withdrawCryptoEstimate = withdrawRate > 0 ? withdrawUsdEstimate / withdrawRate : 0;

  const handleCopyAddress = useCallback(async () => {
    const address = selectedDepositCard?.address?.address?.trim();
    if (!address) {
      toast.showError("No deposit address is available for this method.");
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const input = document.createElement("input");
      input.value = address;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    toast.showSuccess("Deposit address copied successfully.");
  }, [selectedDepositCard?.address?.address, toast]);

  const handleWithdrawalSubmit = useCallback(async () => {
    if (!selectedWithdrawCard || !selectedWithdrawCard.address) {
      toast.showError("Please select a withdrawal method.");
      return;
    }

    if (!withdrawAddress.trim()) {
      toast.showError("Please enter a destination wallet address.");
      return;
    }

    if (withdrawCoins <= 0) {
      toast.showError("Please enter a valid withdrawal amount.");
      return;
    }

    if (withdrawUsdEstimate < MIN_WITHDRAW_USD) {
      toast.showError("Minimum withdrawal amount is $5.00.");
      return;
    }

    setWithdrawSubmitting(true);
    try {
      await createWithdrawal({
        asset: selectedWithdrawCard.asset as CashierWithdrawalAsset,
        network: selectedWithdrawCard.network as CashierWithdrawalNetwork,
        amountCoins: withdrawCoins.toFixed(2),
        destinationAddress: withdrawAddress.trim()
      });
      toast.showSuccess({
        title: "Withdrawal completed",
        description: "Your withdrawal request was submitted successfully."
      });
      setWithdrawAddress("");
      setWithdrawCoinsInput("");
      onBalanceRefresh?.();
      window.dispatchEvent(new Event("refreshBalance"));
    } catch (error) {
      const err = error as Error & { __appToastShown?: boolean };
      if (!err?.__appToastShown) {
        toast.showError(err instanceof Error ? err.message : "Withdrawal request failed.");
      }
    } finally {
      setWithdrawSubmitting(false);
    }
  }, [onBalanceRefresh, selectedWithdrawCard, toast, withdrawAddress, withdrawCoins, withdrawUsdEstimate]);

  const handlePromoRedeem = useCallback(() => {
    if (!promoCode.trim()) {
      toast.showError("Please enter a promo code.");
      return;
    }
    toast.showSuccess("Promo code received.");
  }, [promoCode, toast]);

  const handleBonusApply = useCallback(() => {
    if (!bonusCode.trim()) {
      toast.showError("Please enter a bonus code.");
      return;
    }
    toast.showSuccess("Deposit bonus code applied successfully.");
  }, [bonusCode, toast]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[160] grid place-items-center bg-black/75 p-3 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="grid h-[min(900px,96vh)] w-[min(1400px,97vw)] grid-cols-1 overflow-hidden rounded-[20px] border border-[#343438] bg-[#070708] shadow-[0_35px_100px_rgba(0,0,0,0.9),0_0_70px_rgba(255,20,35,0.08)] lg:grid-cols-[43%_57%]">
        <div className="relative hidden min-h-0 min-w-0 overflow-hidden border-r border-[#28282b] bg-[#050506] lg:block">
          <img
            src="/assets/wallet-modal-banner.png"
            alt="Dinoskins Wallet"
            className="h-full w-full object-cover object-center"
            draggable={false}
          />
        </div>

        <div className="min-w-0 overflow-y-auto bg-[linear-gradient(180deg,#0c0c0e,#070708)] p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[20px] font-black tracking-[0.01em] text-white">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#ff1828] text-white shadow-[0_0_18px_rgba(255,24,40,0.24)]">
                <span className="text-[15px]">⇄</span>
              </span>
              <span>MY WALLET</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#26262a] bg-[#151517] text-[20px] text-[#9999a1] transition-colors hover:border-[#ff1828] hover:text-white"
            >
              ×
            </button>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-2 rounded-[10px] border border-[#19191c] bg-[#050506] p-1">
            <button
              type="button"
              onClick={() => setActiveTab("deposit")}
              className={`h-[46px] rounded-[8px] text-[14px] font-black transition-all ${
                activeTab === "deposit"
                  ? "bg-[linear-gradient(135deg,#ff2635,#d20a18)] text-white shadow-[0_9px_26px_rgba(255,24,40,0.24)]"
                  : "text-[#8b8b93] hover:text-white"
              }`}
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("withdraw")}
              className={`h-[46px] rounded-[8px] text-[14px] font-black transition-all ${
                activeTab === "withdraw"
                  ? "bg-[linear-gradient(135deg,#ff2635,#d20a18)] text-white shadow-[0_9px_26px_rgba(255,24,40,0.24)]"
                  : "text-[#8b8b93] hover:text-white"
              }`}
            >
              Withdraw
            </button>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <p className="m-0 text-[13px] font-black uppercase tracking-[0.06em] text-white">Cryptocurrency</p>
            {loadingAddresses ? <span className="text-[12px] text-[#9f9faa]">Loading...</span> : null}
          </div>

          {addressError ? (
            <div className="mb-4 rounded-[10px] border border-[#6f1f26] bg-[#211114] px-3 py-2 text-[12px] text-[#ff8a95]">
              {addressError}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {methodCards.map((method) => {
              const selected =
                activeTab === "deposit" ? selectedDepositCard?.key === method.key : selectedWithdrawCard?.key === method.key;
              const disabled = activeTab === "deposit" ? !method.address : !method.address || !method.supportsWithdraw;
              return (
                <button
                  key={method.key}
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    if (activeTab === "deposit") setSelectedDepositKey(method.key);
                    else setSelectedWithdrawKey(method.key);
                  }}
                  disabled={disabled}
                  className={`relative flex min-h-[78px] items-center gap-3 rounded-[11px] border px-3 py-3 text-left transition ${
                    selected
                      ? "border-[#ff1828] bg-[linear-gradient(145deg,#211012,#100b0c)] shadow-[0_0_0_1px_rgba(255,24,40,0.22)_inset,0_0_22px_rgba(255,24,40,0.10)]"
                      : "border-[#29292d] bg-[linear-gradient(145deg,#141416,#0e0e10)] hover:border-[#6b252b] hover:bg-[linear-gradient(145deg,#1a1718,#101012)]"
                  } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <span
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-[20px] font-black shadow-[0_7px_16px_rgba(0,0,0,0.35)]"
                    style={{ background: method.iconBg, color: method.iconColor ?? "#ffffff" }}
                  >
                    {method.iconText}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-black text-white">{method.label}</span>
                    <span className="mt-1 block text-[10px] uppercase tracking-[0.05em] text-[#85858d]">{method.symbol}</span>
                  </span>
                  <span className="text-[18px] text-[#77777f]">{selected ? "✓" : "›"}</span>
                </button>
              );
            })}
          </div>

          {activeTab === "deposit" ? (
            <>
              {selectedDepositCard?.address ? (
                <div className="mt-5 rounded-[12px] border border-[#68151e] bg-[linear-gradient(145deg,#111216,#08090b)] p-3 shadow-[inset_0_0_22px_rgba(255,24,40,0.035)]">
                  <p className="mb-2 text-[12px] font-black uppercase tracking-[0.04em] text-white">
                    {selectedDepositCard.label} • Deposit address
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <code className="min-w-0 flex-1 truncate rounded-[10px] border border-[#2f2f34] bg-[#0a0a0c] px-3 py-2 text-[11px] font-black text-[#f3f3f5]">
                      {selectedDepositCard.address.address}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyAddress()}
                      className="inline-flex h-10 items-center justify-center rounded-[9px] bg-[linear-gradient(135deg,#ff2635,#b50715)] px-4 text-[11px] font-black text-white shadow-[0_8px_22px_rgba(255,24,40,0.18)] transition hover:brightness-110"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="mt-3 text-[11px] text-[#b5b5bd]">
                    Minimum deposit is $5. Please include network fees to avoid underpayment.
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-[12px] text-[#8f8f97]">Select an available method to reveal your personal address.</p>
              )}

              <div className="mt-5 rounded-[12px] border border-[#5f1a22] bg-[linear-gradient(180deg,#141014,#0f0d10)] p-3.5">
                <p className="mb-2 text-[14px] font-black text-white">HAVE A PROMO CODE?</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={promoCode}
                    onChange={(event) => setPromoCode(event.target.value)}
                    placeholder="ENTER PROMO CODE"
                    className="h-[38px] flex-1 rounded-[8px] border border-[#2e2f34] bg-[#0b0b0d] px-3 text-[12px] font-semibold text-white outline-none placeholder:text-[#777983] focus:border-[#ff1828]"
                  />
                  <button
                    type="button"
                    onClick={handlePromoRedeem}
                    className="h-[38px] rounded-[8px] bg-[linear-gradient(135deg,#ff2635,#d20a18)] px-4 text-[12px] font-black text-white transition hover:brightness-110"
                  >
                    Redeem
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-[12px] border border-[#5f1a22] bg-[linear-gradient(180deg,#141014,#0f0d10)] p-3.5">
                <p className="mb-2 text-[14px] font-black text-white">ACTIVATE 5% DEPOSIT BONUS</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={bonusCode}
                    onChange={(event) => setBonusCode(event.target.value)}
                    placeholder="USE CODE HERE"
                    className="h-[38px] flex-1 rounded-[8px] border border-[#2e2f34] bg-[#0b0b0d] px-3 text-[12px] font-semibold text-white outline-none placeholder:text-[#777983] focus:border-[#ff1828]"
                  />
                  <button
                    type="button"
                    onClick={handleBonusApply}
                    className="h-[38px] rounded-[8px] bg-[linear-gradient(135deg,#ff2635,#d20a18)] px-4 text-[12px] font-black text-white transition hover:brightness-110"
                  >
                    Apply
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-[#b5b5bd]">Deposit bonus is valid for 24 hours after apply.</p>
              </div>
            </>
          ) : (
            <>
              <div className="mt-5 rounded-[12px] border border-[#5f1a22] bg-[linear-gradient(180deg,#141014,#0f0d10)] p-3.5">
                <p className="mb-3 text-[14px] font-black text-white">
                  {selectedWithdrawCard ? `${selectedWithdrawCard.label} • Withdraw` : "Withdraw"}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.04em] text-[#d4d4da]">
                      Your wallet address
                    </label>
                    <input
                      value={withdrawAddress}
                      onChange={(event) => setWithdrawAddress(event.target.value)}
                      placeholder="Paste destination wallet address"
                      className="h-[40px] w-full rounded-[9px] border border-[#2e2f34] bg-[#0b0b0d] px-3 text-[13px] font-semibold text-white outline-none placeholder:text-[#777983] focus:border-[#ff1828]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.04em] text-[#d4d4da]">
                      Amount (COINS)
                    </label>
                    <input
                      value={withdrawCoinsInput}
                      onChange={(event) => setWithdrawCoinsInput(event.target.value)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="h-[40px] w-full rounded-[9px] border border-[#2e2f34] bg-[#0b0b0d] px-3 text-[13px] font-semibold text-white outline-none placeholder:text-[#777983] focus:border-[#ff1828]"
                    />
                  </div>
                  <div className="rounded-[10px] border border-[#2e2f34] bg-[#0d0d10] px-3 py-2 text-[12px] text-[#cbccd4]">
                    <p className="m-0">Estimated USD value: ${formatCoinAmount(withdrawUsdEstimate)}</p>
                    <p className="m-0">
                      Estimated {selectedWithdrawCard?.symbol ?? "asset"}: {withdrawCryptoEstimate.toFixed(8)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleWithdrawalSubmit()}
                    disabled={withdrawSubmitting || !selectedWithdrawCard}
                    className="h-[40px] w-full rounded-[9px] bg-[linear-gradient(135deg,#ff2635,#d20a18)] text-[13px] font-black text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {withdrawSubmitting ? "Submitting..." : "Withdraw"}
                  </button>
                  <p className="m-0 text-[11px] text-[#b5b5bd]">
                    Minimum withdrawal is $5. Make sure wallet address and network are correct before submitting.
                  </p>
                </div>
              </div>
            </>
          )}

          <p className="mt-5 text-center text-[10px] text-[#7d7d86]">Secure & encrypted connection</p>
        </div>
      </div>
    </div>
  );
}
