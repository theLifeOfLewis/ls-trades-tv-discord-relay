var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/TradeStorage.js
var TradeStorage = class {
  static {
    __name(this, "TradeStorage");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case "/get":
          return await this.handleGet(request);
        case "/set":
          return await this.handleSet(request);
        case "/delete":
          return await this.handleDelete(request);
        case "/clear":
          return await this.handleClear(request);
        case "/cleanup":
          return await this.handleCleanup(request);
        case "/list":
          return await this.handleList(request);
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
  async handleGet(request) {
    const { key } = await request.json();
    const value = await this.state.storage.get(key);
    return new Response(
      JSON.stringify({ value }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  async handleSet(request) {
    const { key, value } = await request.json();
    await this.state.storage.put(key, value);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  async handleDelete(request) {
    const { key } = await request.json();
    await this.state.storage.delete(key);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  async handleClear(request) {
    await this.state.storage.deleteAll();
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  async handleCleanup(request) {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1e3;
    const allTrades = await this.state.storage.list({ prefix: "trade:" });
    let cleanedCount = 0;
    for (const [key, trade] of allTrades) {
      if (trade.lastUpdate && now - trade.lastUpdate > maxAge) {
        await this.state.storage.delete(key);
        cleanedCount++;
      }
    }
    return new Response(
      JSON.stringify({ success: true, cleanedCount }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
  async handleList(request) {
    const { prefix } = await request.json().catch(() => ({}));
    const allEntries = await this.state.storage.list({ prefix: prefix || "" });
    const entries = {};
    for (const [key, value] of allEntries) {
      entries[key] = value;
    }
    return new Response(
      JSON.stringify({ entries }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};

// src/worker.js
var recentSignals = /* @__PURE__ */ new Map();
var DUPLICATE_WINDOW_MS = 5e3;
function cleanupRecentSignals() {
  const now = Date.now();
  for (const [key, timestamp] of recentSignals.entries()) {
    if (now - timestamp > DUPLICATE_WINDOW_MS) {
      recentSignals.delete(key);
    }
  }
}
__name(cleanupRecentSignals, "cleanupRecentSignals");
function getTradeStorage(env) {
  const id = env.TRADE_STORAGE.idFromName("global-trades");
  return env.TRADE_STORAGE.get(id);
}
__name(getTradeStorage, "getTradeStorage");
async function getActiveTrades(env) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch("https://fake-host/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "trade:" })
  });
  const { entries } = await response.json();
  return entries;
}
__name(getActiveTrades, "getActiveTrades");
async function getTrade(env, tradeId) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch("https://fake-host/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: `trade:${tradeId}` })
  });
  const { value } = await response.json();
  return value;
}
__name(getTrade, "getTrade");
async function setTrade(env, tradeId, tradeData) {
  const stub = getTradeStorage(env);
  await stub.fetch("https://fake-host/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: `trade:${tradeId}`, value: tradeData })
  });
}
__name(setTrade, "setTrade");
async function deleteTrade(env, tradeId) {
  const stub = getTradeStorage(env);
  await stub.fetch("https://fake-host/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: `trade:${tradeId}` })
  });
}
__name(deleteTrade, "deleteTrade");
async function cleanupOldTrades(env) {
  const stub = getTradeStorage(env);
  await stub.fetch("https://fake-host/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
}
__name(cleanupOldTrades, "cleanupOldTrades");
async function sendDiscordMessage(webhookUrl, content, embeds = []) {
  const discordPayload = { content };
  if (embeds.length > 0) {
    discordPayload.embeds = embeds;
  }
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordPayload)
  });
  return resp.ok;
}
__name(sendDiscordMessage, "sendDiscordMessage");
var worker_default = {
  async scheduled(event, env, ctx) {
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;
    const activeTrades = await getActiveTrades(env);
    if (Object.keys(activeTrades).length === 0) return;
    for (const [key, trade] of Object.entries(activeTrades)) {
      const tradeId = key.replace("trade:", "");
      const content = [
        "Hard Stop - Market Close \u{1F514}",
        `Trade ID: ${tradeId}`,
        `Type: ${trade.type}`,
        `Symbol: ${trade.symbol}`,
        `Entry: ${trade.entry}`,
        "Active trade will be closed at market close."
      ].join("\n");
      await sendDiscordMessage(webhookUrl, content);
    }
    await cleanupOldTrades(env);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const activeTrades2 = await getActiveTrades(env);
      const tradesList = Object.entries(activeTrades2).map(([key, t]) => ({
        id: key.replace("trade:", ""),
        type: t.type,
        symbol: t.symbol,
        tf: t.tf,
        startTime: t.startTime,
        partialClosed: t.partialClosed || false
      }));
      return new Response(
        JSON.stringify({
          status: "ok",
          activeTradesCount: tradesList.length,
          activeTrades: tradesList,
          recentSignalsCount: recentSignals.size,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const BUY_IMAGE_URL = "https://raw.githubusercontent.com/theLifeOfLewis/ls-trades-tv-discord-relay/main/assets/buy.png";
    const SELL_IMAGE_URL = "https://raw.githubusercontent.com/theLifeOfLewis/ls-trades-tv-discord-relay/main/assets/sell.png";
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response("Invalid JSON", { status: 400 });
    }
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      return new Response("Missing Discord webhook", { status: 500 });
    }
    const scrub = /* @__PURE__ */ __name((value) => {
      if (value === null || value === void 0) return "";
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") {
          return "";
        }
        return trimmed;
      }
      if (Number.isNaN(value)) return "";
      return String(value);
    }, "scrub");
    const withNA = /* @__PURE__ */ __name((value, fallback = "N/A") => {
      const cleaned = scrub(value);
      return cleaned === "" ? fallback : cleaned;
    }, "withNA");
    const isValidNumber = /* @__PURE__ */ __name((value) => {
      const cleaned = scrub(value);
      if (cleaned === "" || cleaned === "N/A") return false;
      const num = parseFloat(cleaned);
      return !isNaN(num) && isFinite(num);
    }, "isValidNumber");
    const isWithinTradingHours = /* @__PURE__ */ __name((timestamp) => {
      if (!timestamp) return false;
      try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return false;
        const estTime = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "numeric",
          hour12: false
        }).format(date);
        const [hours, minutes] = estTime.split(":").map(Number);
        const totalMinutes = hours * 60 + minutes;
        return totalMinutes >= 585 && totalMinutes < 660;
      } catch (e) {
        return false;
      }
    }, "isWithinTradingHours");
    const formatTime = /* @__PURE__ */ __name((timestamp) => {
      if (!timestamp) return "N/A";
      try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return withNA(timestamp);
        const options = {
          timeZone: "America/New_York",
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        };
        const formatted = new Intl.DateTimeFormat("en-US", options).format(date);
        return `${formatted} EST`;
      } catch (e) {
        return withNA(timestamp);
      }
    }, "formatTime");
    const typeRaw = scrub(payload.type).toUpperCase();
    const type = typeRaw || "UNKNOWN";
    const symbol = scrub(payload.symbol) || "UNKNOWN";
    const tf = scrub(payload.tf);
    const symbolLine = tf ? `${symbol} ${tf}m` : symbol;
    const time = formatTime(payload.time);
    const entry = withNA(payload.entry);
    const sl = withNA(payload.sl);
    const tp1 = withNA(payload.tp1);
    const tp2 = withNA(payload.tp2);
    const price = withNA(payload.price);
    const tradeId = scrub(payload.tradeId) || `TRADE_${Date.now()}`;
    cleanupRecentSignals();
    const signalKey = `${type}_${tradeId}_${entry}_${time}`;
    const now = Date.now();
    if (recentSignals.has(signalKey)) {
      const lastSeen = recentSignals.get(signalKey);
      if (now - lastSeen < DUPLICATE_WINDOW_MS) {
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: "Duplicate signal detected within 5 seconds",
            signalKey
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    recentSignals.set(signalKey, now);
    if (tradeId && !tradeId.startsWith("TRADE_") && (isNaN(parseInt(tradeId)) || parseInt(tradeId) <= 0)) {
      return new Response(
        JSON.stringify({
          status: "rejected",
          reason: "Invalid trade ID format",
          tradeId
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const activeTrades = await getActiveTrades(env);
    const hasActiveTrade = Object.keys(activeTrades).length > 0;
    const isEntrySignal = type === "LONG_ENTRY" || type === "SHORT_ENTRY";
    if (isEntrySignal) {
      if (hasActiveTrade) {
        const activeTradesList = Object.entries(activeTrades).map(([key, t]) => `${key.replace("trade:", "")} (${t.type} ${t.symbol} ${t.tf ? t.tf + "m" : ""})`).join(", ");
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: "Active trade already exists",
            activeTrades: activeTradesList
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      const hasValidPositions = isValidNumber(payload.entry) && isValidNumber(payload.sl) && isValidNumber(payload.tp1) && isValidNumber(payload.tp2);
      const withinTradingHours = isWithinTradingHours(payload.time);
      if (!hasValidPositions || !withinTradingHours) {
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: !hasValidPositions ? "Invalid position values" : "Outside trading hours (9:30 AM - 12:00 PM EST)",
            hasValidPositions,
            withinTradingHours,
            receivedValues: { entry: payload.entry, sl: payload.sl, tp1: payload.tp1, tp2: payload.tp2 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      await setTrade(env, tradeId, {
        type: type === "LONG_ENTRY" ? "LONG" : "SHORT",
        symbol,
        tf,
        entry,
        sl,
        tp1,
        tp2,
        startTime: payload.time || (/* @__PURE__ */ new Date()).toISOString(),
        lastUpdate: now
      });
    }
    if (!isEntrySignal && type !== "UNKNOWN") {
      const existingTrade = await getTrade(env, tradeId);
      if (!existingTrade) {
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: "No active trade found with this ID",
            tradeId,
            type
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      existingTrade.lastUpdate = now;
      await setTrade(env, tradeId, existingTrade);
    }
    const isFullClose = type === "LONG_SL" || type === "SHORT_SL" || type === "LONG_TP3" || type === "SHORT_TP3";
    const isPartialClose = type === "LONG_TP1" || type === "SHORT_TP1" || type === "LONG_BE" || type === "SHORT_BE" || type === "LONG_TP2" || type === "SHORT_TP2";
    if (isFullClose && tradeId) {
      await deleteTrade(env, tradeId);
    } else if (isPartialClose && tradeId) {
      const trade = await getTrade(env, tradeId);
      if (trade) {
        trade.partialClosed = true;
        trade.partialCloseType = type;
        trade.partialCloseTime = now;
        await setTrade(env, tradeId, trade);
      }
    }
    let content = "";
    let embeds = [];
    switch (type) {
      case "LONG_ENTRY":
        content = [
          "Buy NQ|NAS100 Now",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Entry: ${entry}`,
          `SL: ${sl}`,
          `TP1: ${tp1}`,
          `TP2: ${tp2}`
        ].join("\n");
        embeds = [{ image: { url: BUY_IMAGE_URL } }];
        break;
      case "SHORT_ENTRY":
        content = [
          "Sell NQ|NAS100 Now",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Entry: ${entry}`,
          `SL: ${sl}`,
          `TP1: ${tp1}`,
          `TP2: ${tp2}`
        ].join("\n");
        embeds = [{ image: { url: SELL_IMAGE_URL } }];
        break;
      case "LONG_BE":
      case "SHORT_BE":
        content = [
          "TP1 HIT / BE",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP1 Smashed! \u{1F525}\u{1F525}\u{1F525} SL moved to entry. 50% Partials secured. \u{1F4B0}"
        ].join("\n");
        break;
      case "LONG_TP1":
      case "SHORT_TP1":
        content = [
          "TP1 HIT / BE",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP1 Smashed! \u{1F525}\u{1F525}\u{1F525} SL moved to entry. 50% Partials secured. \u{1F4B0}"
        ].join("\n");
        break;
      case "LONG_TP2":
      case "SHORT_TP2":
        content = [
          "TP2 HIT",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP2 Smashed! \u{1F525}\u{1F525}\u{1F525} Secured a little more \u{1F4B0}. Runner left to TP3."
        ].join("\n");
        break;
      case "LONG_TP3":
      case "SHORT_TP3":
        content = [
          "TP3 HIT",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP3 Smashed! \u{1F525}\u{1F525}\u{1F525} Trade fully closed."
        ].join("\n");
        break;
      case "LONG_SL":
      case "SHORT_SL":
        content = [
          "SL HIT",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "Trade invalidated. \u{1F6D1}"
        ].join("\n");
        break;
      default:
        console.warn("Unknown alert type received:", type, "Payload:", payload);
        content = [
          "\u26A0\uFE0F UNKNOWN ALERT TYPE",
          `Type: ${type}`,
          `Trade ID: ${tradeId}`,
          `Symbol: ${symbolLine}`,
          `Time: ${time}`,
          "Please check indicator configuration."
        ].join("\n");
        break;
    }
    const discordPayload = { content };
    if (embeds.length > 0) {
      discordPayload.embeds = embeds;
    }
    const discordBody = JSON.stringify(discordPayload);
    let resp;
    try {
      resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: discordBody
      });
    } catch (error) {
      console.error("Failed to send Discord message:", error);
      return new Response(
        JSON.stringify({
          status: "error",
          reason: "Failed to connect to Discord",
          error: error.message
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("Discord webhook error:", resp.status, errorText);
      return new Response(
        JSON.stringify({
          status: "error",
          reason: "Discord webhook rejected the message",
          httpStatus: resp.status,
          details: errorText
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    const finalActiveTrades = await getActiveTrades(env);
    return new Response(
      JSON.stringify({
        status: "success",
        type,
        tradeId,
        activeTradesCount: Object.keys(finalActiveTrades).length,
        message: "Alert sent to Discord"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};
export {
  TradeStorage,
  worker_default as default
};
//# sourceMappingURL=worker.js.map
