import { useState, useEffect } from "react";

const G = '"DM Sans","Gotham",sans-serif';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "green" | "amber";
  createdAt: string;
}

interface Props {
  onClose: () => void;
  onClearBadge: () => void;
}

export default function NotificationsPanel({ onClose, onClearBadge }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("notifications");
    if (saved) try { return JSON.parse(saved); } catch { /* ignore */ }
    return [{ id: "welcome", title: "Welcome!", message: "Welcome to REDWATER Casino. Good luck!", type: "green" as const, createdAt: new Date().toISOString() }];
  });

  useEffect(() => { onClearBadge(); }, [onClearBadge]);

  const clearAll = () => { setNotifications([]); localStorage.setItem("notifications", "[]"); };

  useEffect(() => {
    if (notifications.length > 0) localStorage.setItem("notifications", JSON.stringify(notifications));
  }, [notifications]);

  const gradients: Record<string, string> = {
    green: "linear-gradient(180deg, #55ff60 0%, #55ff6000 100%)",
    amber: "linear-gradient(180deg, #ffae50 0%, #ffae5000 100%)",
  };

  const iconSvgs: Record<string, string> = {
    green: "/assets/a3e82505cf4ad3c4107b2009e42e3c19.svg",
    amber: "/assets/2a83f06154d00e448d72ded5e4bb1cb7.svg",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        position: "absolute", top: 60, right: 20,
        width: 380, padding: "0 24px 24px",
        borderRadius: 26,
        background: "linear-gradient(180deg, #161616, #0d0d0d)",
        boxShadow: "inset 0 1px 0 #252525, inset 0 -1px 0 #242424, 0 11px 43px rgba(0,0,0,.34)",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 0 12px" }}>
          <span style={{ color: "#fff", fontSize: 16, fontWeight: 500, fontFamily: G }}>Notifications</span>
          <span onClick={clearAll} style={{ color: "#828282", fontSize: 14, fontWeight: 500, fontFamily: G, cursor: "pointer" }}>Clear all</span>
        </div>

        {/* Notification items */}
        {notifications.length === 0 && (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <p style={{ color: "#555", fontSize: 13, fontFamily: G }}>No notifications</p>
          </div>
        )}
        {notifications.map((n) => (
          <div key={n.id} style={{
            display: "flex", gap: 12, padding: 14, borderRadius: 20,
            backgroundColor: "#0d0d0d",
            backgroundImage: gradients[n.type],
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
              background: n.type === "green" ? "#22c55e" : "#f59e0b",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: "#fff", fontSize: 18, lineHeight: "1" }}>✓</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: G, margin: "0 0 4px", lineHeight: "18px" }}>{n.title}</p>
              <p style={{ color: "#828282", fontSize: 13, fontWeight: 400, fontFamily: G, margin: 0, lineHeight: "17px" }}>{n.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
