(() => {
  const ORIGIN = window.location.origin;
  const resolveBaseUrl = () => {
    const ownRuntime = window.__RUNTIME_CONFIG__?.NEXT_PUBLIC_API_URL;
    const parentRuntime = (() => {
      try {
        return window.parent?.__RUNTIME_CONFIG__?.NEXT_PUBLIC_API_URL;
      } catch {
        return "";
      }
    })();
    const configured = String(parentRuntime || ownRuntime || "").trim();
    if (!configured) {
      return ORIGIN;
    }
    let normalized = configured;
    if (normalized.startsWith("/")) {
      normalized = `${ORIGIN}${normalized}`;
    }
    // Avoid mixed content and local-only misconfigurations in production.
    if (
      window.location.protocol === "https:" &&
      (normalized.startsWith("http://") || /\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(normalized))
    ) {
      return ORIGIN;
    }
    return normalized.replace(/\/$/, "");
  };
  const BASE_URL = resolveBaseUrl();
  const API_BASE = `${BASE_URL}/api/v1`;
  const WS_URL = `${BASE_URL.replace(/^http/, "ws")}/api/v1/roulette/ws?currency=USDT`;
  const ATOMIC_FACTOR = 100000000n;

  const state = {
    authed: false,
    user: null,
    chatMessages: [],
    rain: null,
    feedMode: "all",
    socket: null,
    reconnectTimer: null
  };

  const byId = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const postToParent = (payload) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, ORIGIN);
    }
  };

  const nowMs = () => Date.now();

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatRelative = (iso) => {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) {
      return "just now";
    }
    const diffSec = Math.max(0, Math.floor((nowMs() - ts) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} min ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatUsdFromAtomic = (atomic) => {
    try {
      const value = typeof atomic === "bigint" ? atomic : BigInt(String(atomic || "0"));
      const whole = value / ATOMIC_FACTOR;
      const frac = value % ATOMIC_FACTOR;
      const cents = Number((frac * 100n) / ATOMIC_FACTOR);
      const sign = value < 0n ? "-" : "";
      const wholeAbs = whole < 0n ? -whole : whole;
      const wholeText = wholeAbs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return `${sign}$${wholeText}.${String(Math.abs(cents)).padStart(2, "0")}`;
    } catch {
      return "$0.00";
    }
  };

  const atomicToNumber = (atomic) => {
    try {
      const value = typeof atomic === "bigint" ? atomic : BigInt(String(atomic || "0"));
      return Number(value) / Number(ATOMIC_FACTOR);
    } catch {
      return 0;
    }
  };

  const getToken = () => {
    try {
      return localStorage.getItem("accessToken");
    } catch {
      return null;
    }
  };

  const showToast = (message, variant = "error") => {
    if (!message || !String(message).trim()) return;
    const id = "figma-main-toast-container";
    let root = byId(id);
    if (!root) {
      root = document.createElement("div");
      root.id = id;
      root.style.position = "fixed";
      root.style.top = "80px";
      root.style.left = "50%";
      root.style.transform = "translateX(-50%)";
      root.style.width = "min(680px, calc(100vw - 32px))";
      root.style.zIndex = "100000";
      root.style.display = "flex";
      root.style.flexDirection = "column";
      root.style.gap = "8px";
      root.style.pointerEvents = "none";
      document.body.appendChild(root);
    }

    const item = document.createElement("div");
    item.textContent = message;
    item.style.padding = "12px 16px";
    item.style.borderRadius = "8px";
    item.style.color = "#fff";
    item.style.fontWeight = "700";
    item.style.fontFamily = "Gotham, sans-serif";
    item.style.fontSize = "14px";
    item.style.opacity = "0";
    item.style.transition = "opacity 180ms ease";
    item.style.background = variant === "success" ? "rgba(22,163,74,0.95)" : "rgba(220,38,38,0.95)";
    item.style.border =
      variant === "success" ? "1px solid rgba(20,83,45,0.95)" : "1px solid rgba(127,29,29,0.95)";
    item.style.boxShadow = "0 10px 24px rgba(0,0,0,0.35)";
    root.appendChild(item);
    requestAnimationFrame(() => {
      item.style.opacity = "1";
    });
    setTimeout(() => {
      item.style.opacity = "0";
      setTimeout(() => item.remove(), 220);
    }, 4500);
  };

  const request = async (path, options = {}) => {
    const needsAuth = options.needsAuth !== false;
    const withIdempotency = Boolean(options.idempotency);
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (needsAuth) {
      const token = getToken();
      if (!token) {
        throw new Error("You need to sign in first.");
      }
      headers.Authorization = `Bearer ${token}`;
    }
    if (withIdempotency) {
      headers["Idempotency-Key"] = `figma-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.message || body.error || message;
      } catch {
        // ignore parse error
      }
      throw new Error(message);
    }
    if (res.status === 204) return {};
    return res.json();
  };

  const navigate = (path) => {
    if (!path || !path.startsWith("/")) return;
    postToParent({ type: "figma-main-navigate", path });
  };

  const askAuth = (mode) => {
    postToParent({ type: "figma-main-auth", mode });
  };

  const setClickable = (el, onClick) => {
    if (!el || !(el instanceof HTMLElement)) return;
    el.style.cursor = "pointer";
    el.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    };
  };

  const refreshAuthButtons = () => {
    const signInText = qs(".main-gl-text-sign-oo2");
    const signUpText = qs(".main-gl-text-sign-up-lr2");
    const signInBtn = byId("n376");
    const signUpBtn = byId("n377");

    if (state.authed) {
      if (signInText) signInText.textContent = "Profile";
      if (signUpText) signUpText.textContent = "Wallet";
      setClickable(signInBtn, () => navigate("/profile"));
      setClickable(signUpBtn, () => navigate("/wallet"));
    } else {
      if (signInText) signInText.textContent = "Sign in";
      if (signUpText) signUpText.textContent = "Sign Up";
      setClickable(signInBtn, () => askAuth("login"));
      setClickable(signUpBtn, () => askAuth("register"));
    }
  };

  const buildChatRow = (msg) => {
    const row = document.createElement("div");
    row.className = "main-gl-frame46";
    const avatarChar = (msg.userLabel || "U").slice(0, 1).toUpperCase();
    const avatarUrl = msg.avatarUrl || "";
    row.innerHTML = `
      <div class="main-gl-frame-t5">
        ${
          avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="avatar" width="40" height="40" class="main-gl-image-q8" />`
            : `<div style="width:40px;height:40px;border-radius:12px;background:#2a2a2a;color:#fff;display:flex;align-items:center;justify-content:center;font-family:Gotham,sans-serif;font-weight:700;">${escapeHtml(
                avatarChar
              )}</div>`
        }
      </div>
      <div class="main-gl-frame-f7">
        <div class="main-gl-frame-wy">
          <div class="main-gl-frame-lx">
            <div class="main-gl-text-jake-i41"><p class="main-gl-text-jake-i42">${escapeHtml(msg.userLabel)}</p></div>
            <div class="main-gl-frame73"><div class="main-gl-text8-ou1"><p class="main-gl-text8-ou2">${escapeHtml(
              String(msg.userLevel || 1)
            )}</p></div></div>
          </div>
          <div class="main-gl-text2-min-dt1"><p class="main-gl-text2-min-dt2">${escapeHtml(
            formatRelative(msg.createdAt)
          )}</p></div>
        </div>
        <div class="main-gl-frame-v1">
          <div class="main-gl-text-it-s621"><p class="main-gl-text-it-s622">${escapeHtml(msg.message)}</p></div>
        </div>
      </div>
    `;
    return row;
  };

  const renderChat = () => {
    const list = byId("n12230");
    if (!list) return;
    list.innerHTML = "";
    const recent = state.chatMessages.slice(-60);
    for (const msg of recent) {
      list.appendChild(buildChatRow(msg));
    }
    list.style.overflowY = "auto";
    list.style.justifyContent = "flex-start";
    list.scrollTop = list.scrollHeight;

    const onlineCount = qs("#n9115 p");
    if (onlineCount) {
      onlineCount.textContent = String(Math.max(1, Math.min(9999, recent.length + 80)));
    }
  };

  const normalizeChatMessage = (raw) => ({
    id: raw.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    userId: raw.userId || "unknown",
    userLabel: raw.userLabel || raw.username || "Player",
    userLevel: raw.userLevel || raw.level || 1,
    avatarUrl: raw.avatarUrl || null,
    message: raw.message || "",
    createdAt: raw.createdAt || new Date().toISOString()
  });

  const loadChatMessages = async () => {
    try {
      const rows = await request("/chat/messages?limit=60", { needsAuth: false });
      state.chatMessages = Array.isArray(rows) ? rows.map(normalizeChatMessage) : [];
      renderChat();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not load chat");
    }
  };

  const setupChatComposer = () => {
    const inputHost = byId("n12276");
    if (!inputHost) return;

    inputHost.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 220;
    input.placeholder = "Write message...";
    input.style.width = "100%";
    input.style.background = "transparent";
    input.style.border = "none";
    input.style.outline = "none";
    input.style.color = "#ffffff";
    input.style.fontFamily = "Gotham, sans-serif";
    input.style.fontSize = "16px";
    input.style.fontWeight = "500";
    inputHost.appendChild(input);

    const send = async () => {
      const message = input.value.trim();
      if (!message) return;
      if (!state.authed) {
        askAuth("login");
        return;
      }
      try {
        const created = await request("/chat/messages", {
          method: "POST",
          body: { message },
          idempotency: true
        });
        state.chatMessages.push(normalizeChatMessage(created));
        input.value = "";
        renderChat();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not send message");
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void send();
      }
    });

    const sendBtn = byId("n12273");
    setClickable(sendBtn, () => {
      void send();
    });
  };

  const renderRain = () => {
    const amountEl = qs("#n12241 p");
    const agoEl = qs("#n12252 p");
    if (!amountEl || !agoEl || !state.rain) return;
    amountEl.textContent = formatUsdFromAtomic(state.rain.totalAmountAtomic);
    agoEl.textContent = formatRelative(state.rain.startsAt);
  };

  const loadRainState = async () => {
    if (!state.authed) return;
    try {
      const rain = await request("/chat/rain/current");
      state.rain = rain;
      renderRain();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not load rain");
    }
  };

  const setupRainActions = () => {
    const rainCard = byId("n12232");
    const plusButton = byId("n12250");

    setClickable(rainCard, async () => {
      if (!state.authed) {
        askAuth("login");
        return;
      }
      try {
        const joined = await request("/chat/rain/join", { method: "POST", idempotency: true });
        state.rain = joined;
        renderRain();
        showToast("You joined the rain", "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not join rain");
      }
    });

    setClickable(plusButton, async () => {
      if (!state.authed) {
        askAuth("login");
        return;
      }
      const value = window.prompt("Tip amount (coins, minimum 1)", "1");
      if (!value) return;
      const amountCoins = Number(value);
      if (!Number.isFinite(amountCoins) || amountCoins < 1) {
        showToast("Tip amount must be at least 1 coin.");
        return;
      }
      try {
        const result = await request("/chat/rain/tip", {
          method: "POST",
          body: { amountCoins },
          idempotency: true
        });
        state.rain = result.rain;
        renderRain();
        showToast("Rain tipped successfully", "success");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not tip rain");
      }
    });
  };

  const getFeedRows = () => {
    const rowsRoot = byId("n53231");
    if (!rowsRoot) return [];
    return Array.from(rowsRoot.children).filter((el) => el.id !== "n53322");
  };

  const fillFeedRow = (rowEl, item) => {
    const pTags = rowEl.querySelectorAll("p");
    if (pTags.length < 5) return;
    pTags[0].textContent = item.game;
    pTags[1].textContent = item.player;
    pTags[2].textContent = item.amount;
    pTags[3].textContent = item.multi;
    pTags[4].textContent = item.payout;
  };

  const buildAllFeed = async () => {
    const rows = await request("/leaderboard?limit=20", { needsAuth: false });
    const list = Array.isArray(rows?.rows) ? rows.rows : [];
    const games = ["Roulette", "Cases", "Mines", "Blackjack", "Case Battles"];
    return list.map((entry, idx) => ({
      game: games[idx % games.length],
      player: entry.userLabel || `User #${entry.publicId || idx + 1}`,
      amount: formatUsdFromAtomic(entry.balanceAtomic || "0"),
      multi: `${Math.max(0, Number(entry.level || 1) / 10).toFixed(2)}x`,
      payout: formatUsdFromAtomic(entry.balanceAtomic || "0")
    }));
  };

  const buildMyFeed = async () => {
    if (!state.authed) {
      return [];
    }
    const summary = await request("/profile/summary");
    const rows = [];
    const perGame = summary?.perGame || {};
    const addGame = (name, data) => {
      const wagered = atomicToNumber(data?.wageredAtomic || "0");
      const payout = atomicToNumber(data?.payoutAtomic || "0");
      rows.push({
        game: name,
        player: state.user?.email?.split("@")[0] || "You",
        amount: `$${wagered.toFixed(2)}`,
        multi: wagered > 0 ? `${(payout / wagered).toFixed(2)}x` : "0.00x",
        payout: `$${payout.toFixed(2)}`
      });
    };
    addGame("Roulette", perGame.roulette);
    addGame("Mines", perGame.mines);
    addGame("Blackjack", perGame.blackjack);
    return rows;
  };

  const renderFeed = async () => {
    const rows = getFeedRows();
    if (!rows.length) return;
    try {
      const baseFeed = await buildAllFeed();
      let feed = baseFeed;
      if (state.feedMode === "my") {
        const mine = await buildMyFeed();
        feed = mine.length ? [...mine, ...baseFeed] : baseFeed;
      }
      if (state.feedMode === "big") {
        feed = baseFeed
          .slice()
          .sort((a, b) => Number((b.payout || "$0").replace(/[^0-9.-]/g, "")) - Number((a.payout || "$0").replace(/[^0-9.-]/g, "")));
      }
      for (let i = 0; i < rows.length; i += 1) {
        const item = feed[i] || {
          game: "Roulette",
          player: "—",
          amount: "$0.00",
          multi: "0.00x",
          payout: "$0.00"
        };
        fillFeedRow(rows[i], item);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not load highlights");
    }
  };

  const setupFeedTabs = () => {
    const tabAll = byId("n53163");
    const tabBig = byId("n53166");
    const tabMy = byId("n53169");
    const tabViewAll = byId("n53172");

    const refreshTabStyles = () => {
      const activeStyle = (el, active) => {
        if (!el) return;
        el.style.backgroundColor = active ? "#1a1a1a" : "transparent";
        el.style.boxShadow = active ? "inset 0 1px 0 0 #252525, inset 0 -1px 0 0 #242424" : "none";
      };
      activeStyle(tabAll, state.feedMode === "all");
      activeStyle(tabBig, state.feedMode === "big");
      activeStyle(tabMy, state.feedMode === "my");
    };

    setClickable(tabAll, () => {
      state.feedMode = "all";
      refreshTabStyles();
      void renderFeed();
    });
    setClickable(tabBig, () => {
      state.feedMode = "big";
      refreshTabStyles();
      void renderFeed();
    });
    setClickable(tabMy, () => {
      if (!state.authed) {
        askAuth("login");
        return;
      }
      state.feedMode = "my";
      refreshTabStyles();
      void renderFeed();
    });
    setClickable(tabViewAll, () => navigate("/leaderboard"));

    refreshTabStyles();
  };

  const setupNavigation = () => {
    setClickable(byId("n356"), () => navigate("/"));
    setClickable(byId("n987"), () => navigate("/leaderboard"));
    setClickable(byId("n993"), () => navigate("/profile"));
    setClickable(byId("n386"), () => navigate("/affiliates"));

    setClickable(byId("n19625"), () => navigate("/cases"));
    setClickable(byId("n19626"), () => navigate("/battles"));
    setClickable(byId("n19635"), () => navigate("/roulette"));
    setClickable(byId("n19644"), () => navigate("/mines"));
    setClickable(byId("n19653"), () => navigate("/blackjack"));

    const leftMenu = byId("n27669");
    if (leftMenu) {
      const links = ["/cases", "/battles", "/roulette", "/mines", "/blackjack"];
      Array.from(leftMenu.children).forEach((node, idx) => {
        setClickable(node, () => navigate(links[idx] || "/"));
      });
    }

    const textMap = [
      { text: "Cases", href: "/cases" },
      { text: "Case Battles", href: "/battles" },
      { text: "Roulette", href: "/roulette" },
      { text: "Mines", href: "/mines" },
      { text: "BlackJack", href: "/blackjack" },
      { text: "Rewards", href: "/leaderboard" },
      { text: "Affilates", href: "/affiliates" },
      { text: "Support", href: "/support" },
      { text: "FAQ", href: "/faq" },
      { text: "Tearms of Service", href: "/terms" },
      { text: "Fairness", href: "/fairness" }
    ];
    const allPs = qsa("p");
    for (const p of allPs) {
      const raw = (p.textContent || "").trim();
      const match = textMap.find((item) => item.text === raw);
      if (match) {
        setClickable(p, () => navigate(match.href));
      }
    }
  };

  const attachSocket = () => {
    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
    const ws = new WebSocket(WS_URL);
    state.socket = ws;

    ws.onmessage = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const type = payload.type || payload.event;
      const data = payload.data || payload;

      if (type === "chat.message") {
        state.chatMessages.push(normalizeChatMessage(data));
        state.chatMessages = state.chatMessages.slice(-100);
        renderChat();
      } else if (type === "chat.cleared") {
        state.chatMessages = [];
        renderChat();
      } else if (type === "chat.userTip") {
        state.chatMessages.push(
          normalizeChatMessage({
            id: data.id,
            userId: "system",
            userLabel: "System",
            userLevel: 0,
            avatarUrl: null,
            message: `${data.fromUserLabel} tipped ${data.toUserLabel} ${formatUsdFromAtomic(data.amountAtomic)}${
              data.message ? ` · ${data.message}` : ""
            }`,
            createdAt: data.createdAt
          })
        );
        renderChat();
      } else if (type === "rain.state") {
        state.rain = { ...(state.rain || {}), ...data };
        renderRain();
      } else if (type === "rain.tipped") {
        if (state.rain && state.rain.roundId === data.roundId) {
          state.rain.tippedAmountAtomic = data.tippedAmountAtomic;
          state.rain.totalAmountAtomic = data.totalAmountAtomic;
          renderRain();
        }
      }
    };

    ws.onclose = () => {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
      }
      state.reconnectTimer = setTimeout(() => {
        attachSocket();
      }, 3000);
    };
  };

  const syncSession = async () => {
    const token = getToken();
    if (!token) {
      state.authed = false;
      state.user = null;
      refreshAuthButtons();
      void loadRainState();
      return;
    }
    try {
      const me = await request("/users/me");
      state.authed = true;
      state.user = me;
      refreshAuthButtons();
      void loadRainState();
    } catch {
      state.authed = false;
      state.user = null;
      refreshAuthButtons();
      state.rain = null;
      renderRain();
    }
  };

  const setupIncomingMessages = () => {
    window.addEventListener("message", (event) => {
      if (event.origin !== ORIGIN || !event.data || typeof event.data !== "object") {
        return;
      }
      if (event.data.type === "figma-main-session-updated") {
        state.authed = Boolean(event.data.authed);
        refreshAuthButtons();
        void loadRainState();
        void renderFeed();
      }
    });
  };

  const bootstrap = async () => {
    setupNavigation();
    setupIncomingMessages();
    setupChatComposer();
    setupRainActions();
    setupFeedTabs();
    await syncSession();
    await Promise.all([loadChatMessages(), loadRainState(), renderFeed()]);
    attachSocket();
  };

  void bootstrap();
})();
