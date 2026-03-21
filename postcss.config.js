import { useEffect, useState, useRef, useCallback } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import {
  getHealthLive,
  getHealthReady,
  getMe,
  logout,
  getApiUrl,
  getWsUrl,
  type HealthLive,
  type HealthReady,
  type User,
} from "@/lib/api";
import { CasinoSocket, type SocketEvent } from "@/lib/socket";

export default function Dashboard() {
  const [live, setLive] = useState<HealthLive | null>(null);
  const [ready, setReady] = useState<HealthReady | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<CasinoSocket | null>(null);

  const addEvent = (msg: string) => {
    setEvents((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  };

  const checkHealth = useCallback(async () => {
    try {
      const l = await getHealthLive();
      setLive(l);
      addEvent(`Health live: ${l.status}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Health check failed");
    }
    try {
      const r = await getHealthReady();
      setReady(r);
      addEvent(`Health ready: ${r.status} (pg=${r.checks.postgres}, redis=${r.checks.redis})`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ready check failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    checkHealth();
    getMe().then(setUser).catch(() => {});

    const sock = new CasinoSocket("USDT");
    socketRef.current = sock;

    sock.subscribe((ev: SocketEvent) => {
      switch (ev.type) {
        case "open":
          setWsStatus("connected");
          addEvent("WebSocket connected");
          break;
        case "close":
          setWsStatus("disconnected");
          addEvent("WebSocket disconnected");
          break;
        case "error":
          setWsStatus("error");
          addEvent("WebSocket error");
          break;
        case "roulette.round":
          addEvent(`Round #${ev.data.roundNumber} — ${ev.data.status}`);
          break;
        case "roulette.betTotals":
          addEvent(`Bet totals update for round ${ev.data.roundId}`);
          break;
        case "pong":
          addEvent("pong received");
          break;
      }
    });

    sock.connect();
    return () => sock.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkHealth]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-3">
          {user && <span className="text-sm text-gray-400">{user.email}</span>}
          <Button variant="secondary" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Connection Status">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">API URL</span>
              <span className="font-mono text-xs">{getApiUrl()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">WS URL</span>
              <span className="font-mono text-xs">{getWsUrl()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">WebSocket</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  wsStatus === "connected"
                    ? "bg-green-900 text-green-300"
                    : wsStatus === "error"
                      ? "bg-red-900 text-red-300"
                      : "bg-gray-800 text-gray-400"
                }`}
              >
                {wsStatus}
              </span>
            </div>
          </div>
        </Card>

        <Card title="API Health">
          <div className="space-y-2 text-sm">
            {live && (
              <div className="flex justify-between">
                <span className="text-gray-400">Live</span>
                <span className="text-green-400">{live.status}</span>
              </div>
            )}
            {ready && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">Ready</span>
                  <span className={ready.status === "ready" ? "text-green-400" : "text-yellow-400"}>
                    {ready.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Postgres</span>
                  <span>{ready.checks.postgres ? "OK" : "DOWN"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Redis</span>
                  <span>{ready.checks.redis ? "OK" : "DOWN"}</span>
                </div>
              </>
            )}
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <Button variant="secondary" className="w-full mt-2" onClick={checkHealth}>
              Refresh
            </Button>
          </div>
        </Card>

        <Card title="User Info">
          {user ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">ID</span>
                <span className="font-mono text-xs">{user.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Role</span>
                <span>{user.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status</span>
                <span>{user.status}</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Loading...</p>
          )}
        </Card>
      </div>

      <Card title="Latest Events">
        <div className="max-h-80 overflow-y-auto space-y-1 font-mono text-xs">
          {events.length === 0 && <p className="text-gray-500">No events yet...</p>}
          {events.map((e, i) => (
            <div key={i} className="text-gray-400 border-b border-gray-800 py-1">
              {e}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
