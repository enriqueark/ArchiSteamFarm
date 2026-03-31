import Card from "@/components/Card";

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: "By creating an account and using this platform, you agree to comply with these Terms of Service and all applicable laws."
  },
  {
    title: "2. Eligibility",
    body: "You must be of legal age in your jurisdiction and legally allowed to participate in online gaming services."
  },
  {
    title: "3. Account Responsibility",
    body: "You are responsible for account security, password confidentiality, and all activity performed through your account."
  },
  {
    title: "4. Virtual Coins",
    body: "The platform uses internal virtual credits called Coins/Gems. The current platform conversion is 1 coin = $0.70 for internal pricing logic."
  },
  {
    title: "5. Fair Play and Abuse",
    body: "Abuse, exploitation, automation, fraud, chargebacks, or intentional abuse of bugs may result in restrictions, suspensions, or permanent account closure."
  },
  {
    title: "6. Deposits and Withdrawals",
    body: "Deposits and withdrawals may be subject to verification, review, limits, risk checks, and manual approval by administrators when required."
  },
  {
    title: "7. Tips, Rain, and Social Features",
    body: "User tipping and rain participation are optional social features. The platform may limit, suspend, or disable them for security or compliance reasons."
  },
  {
    title: "8. Service Availability",
    body: "The service is provided as-is. We may update, suspend, or discontinue features at any time for maintenance, legal, or operational reasons."
  }
];

export default function TermsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
      <p className="text-sm text-gray-400">
        Basic terms for platform usage. This page can be replaced with your final legal terms later.
      </p>

      <Card className="space-y-4">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-base font-semibold text-white">{section.title}</h2>
            <p className="mt-1 text-sm text-gray-300">{section.body}</p>
          </section>
        ))}
      </Card>
    </div>
  );
}
