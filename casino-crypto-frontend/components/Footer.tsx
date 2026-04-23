import Link from "next/link";

const paymentIcons = [
  "/assets/1903346205e1d7861e96e48ef729ecb4.svg",
  "/assets/7ce9248d8ed70dcea02d587203a69379.svg",
  "/assets/8ccb1d8b0cc81c1b72e2ca61d0244f1e.svg",
  "/assets/f3e31c4e22d3356b101fb1ca2772558e.svg",
  "/assets/ea741470ab21c5753b5aa5b3f7159e37.svg",
  "/assets/469022e761f0ce059a4dbe7681ec4853.svg",
  "/assets/74ba8ca43e6f43bc7bcae3d0ffe144a5.svg",
  "/assets/0233322853161dd2c7fd57043a803cbb.svg",
  "/assets/88393c3b45f1b8ff20baa4b2f154f643.svg",
  "/assets/35903d683ebe29f6d6e095f24da6013e.svg",
];

const footerLinks: Record<string, Array<{ label: string; href: string }>> = {
  Games: [
    { label: "Cases", href: "/cases" },
    { label: "Case Battles", href: "/case-battles" },
    { label: "Roulette", href: "/roulette" },
    { label: "Mines", href: "/mines" },
    { label: "BlackJack", href: "#" },
  ],
  Platform: [
    { label: "Rewards", href: "#" },
    { label: "Affiliates", href: "#" },
    { label: "Blog", href: "#" },
    { label: "Support", href: "#" },
    { label: "FAQ", href: "#" },
    { label: "Partnerships", href: "#" },
  ],
  "About us": [
    { label: "Terms of Service", href: "#" },
    { label: "Privacy Policy", href: "#" },
    { label: "AML Policy", href: "#" },
    { label: "Cookies Policy", href: "#" },
    { label: "Self-Exclusion", href: "#" },
    { label: "Fairness", href: "#" },
  ],
  Community: [
    { label: "Twitter", href: "#" },
    { label: "Discord", href: "#" },
    { label: "Telegram", href: "#" },
    { label: "Kick", href: "#" },
  ],
};

export default function Footer() {
  return (
    <footer style={{ padding: "32px 0 24px" }}>
      <div style={{ display: "flex", gap: 40 }}>
        <div style={{ width: 280, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <img src="/assets/dinoskins-logo.png" alt="DinoSkins logo" style={{ height: 30, width: "auto", display: "block" }} />
          </div>
          <p style={{ fontSize: 12, color: "#828282", marginBottom: 12 }}>&copy; All rights reserved 2026</p>
          <p style={{ fontSize: 11, color: "#828282", lineHeight: "18px", marginBottom: 16 }}>
            Upgrader is operated by Innospace LTD, Organization number 646564, Voukourestiou, 25 Neptune House, 1st Floor, Office 11, Zakaki, 3045, Limassol, Cyprus.
          </p>
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#828282", margin: "0 0 4px" }}>Support: <span style={{ color: "#fff" }}>support@redwater.gg</span></p>
            <p style={{ fontSize: 12, color: "#828282", margin: 0 }}>Partners: <span style={{ color: "#fff" }}>partners@redwater.gg</span></p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 42, height: 42, borderRadius: "50%", border: "2px solid #f34950",
              color: "#f34950", fontSize: 14, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>18+</span>
            <p style={{ fontSize: 10, color: "#828282", lineHeight: "14px", margin: 0 }}>By accessing this site, you confirm that you are over 18 years old.</p>
          </div>
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 16 }}>{title}</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} style={{ fontSize: 14, color: "#828282", textDecoration: "none" }}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
        {paymentIcons.map((src, i) => (
          <img key={i} src={src} alt="" style={{ width: 70, height: 48, objectFit: "contain" }} />
        ))}
      </div>
    </footer>
  );
}
