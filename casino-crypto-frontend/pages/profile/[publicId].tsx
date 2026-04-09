import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getMe, type User } from "@/lib/api";

const G = '"DM Sans","Gotham",sans-serif';

export default function PublicProfilePage() {
  const router = useRouter();
  const { publicId } = router.query;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicId) return;
    setLoading(true);
    getMe().then((u) => {
      setUser(u);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [publicId]);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400, color: "#828282", fontFamily: G }}>
      Loading profile...
    </div>
  );

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", fontFamily: G, marginBottom: 20 }}>Profile</h1>

      <div style={{ background: "#1a1a1a", borderRadius: 16, padding: 24, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#828282", margin: "0 0 16px", fontFamily: G }}>User Info</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "#111", borderRadius: 12, padding: "12px 16px" }}>
            <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>Public ID</p>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, margin: 0, fontFamily: G }}>#{publicId}</p>
          </div>
          <div style={{ background: "#111", borderRadius: 12, padding: "12px 16px" }}>
            <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>Username</p>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, margin: 0, fontFamily: G }}>{user?.email?.split("@")[0] || "Unknown"}</p>
          </div>
          <div style={{ background: "#111", borderRadius: 12, padding: "12px 16px" }}>
            <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>Role</p>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, margin: 0, fontFamily: G }}>{user?.role || "PLAYER"}</p>
          </div>
          <div style={{ background: "#111", borderRadius: 12, padding: "12px 16px" }}>
            <p style={{ color: "#828282", fontSize: 11, margin: "0 0 4px", fontFamily: G }}>Member since</p>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, margin: 0, fontFamily: G }}>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</p>
          </div>
        </div>
      </div>

      <div style={{ background: "#1a1a1a", borderRadius: 16, padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#828282", margin: "0 0 12px", fontFamily: G }}>Statistics</h2>
        <p style={{ color: "#555", fontSize: 13, fontFamily: G }}>Detailed statistics will be available soon.</p>
      </div>
    </div>
  );
}
