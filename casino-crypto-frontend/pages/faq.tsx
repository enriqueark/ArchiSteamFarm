import Card from "@/components/Card";

const faqItems: Array<{ q: string; a: string }> = [
  {
    q: "How do coins work?",
    a: "Coins are the internal balance used on the platform. Deposits and withdrawals are converted against the current platform rules."
  },
  {
    q: "What is a rain?",
    a: "Rain is a periodic community reward pool in chat. Users can join, and anyone can tip additional coins to increase the amount."
  },
  {
    q: "How does Vault locking work?",
    a: "You can deposit coins into your vault and optionally lock them for fixed windows: 1 hour, 1 day, 3 days, or 7 days."
  },
  {
    q: "Is the game fair?",
    a: "Yes. Core games support provably fair verification with server seed hash, client seed, and nonce."
  }
];

export default function FaqPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">FAQ</h1>
      <p className="text-sm text-gray-400">
        This section is ready and can be replaced with your final FAQ content whenever you want.
      </p>
      <div className="space-y-3">
        {faqItems.map((item) => (
          <Card key={item.q} className="bg-[#1f2437] border-[#2a3349]">
            <h2 className="text-base font-semibold text-white">{item.q}</h2>
            <p className="mt-1 text-sm text-gray-300">{item.a}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
