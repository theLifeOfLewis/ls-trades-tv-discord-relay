// Import Durable Object for persistent storage
import { TradeStorage } from './TradeStorage.js';
export { TradeStorage };

// Duplicate prevention still uses in-memory (acceptable for short-lived data)
let recentSignals = new Map(); // signalKey -> timestamp (for duplicate prevention)
const DUPLICATE_WINDOW_MS = 5000; // 5 seconds to prevent duplicate signals

// Clean up old entries from recentSignals to prevent memory leak
function cleanupRecentSignals() {
  const now = Date.now();
  for (const [key, timestamp] of recentSignals.entries()) {
    if (now - timestamp > DUPLICATE_WINDOW_MS) {
      recentSignals.delete(key);
    }
  }
}

// Helper to get Durable Object instance
function getTradeStorage(env) {
  const id = env.TRADE_STORAGE.idFromName('global-trades');
  return env.TRADE_STORAGE.get(id);
}

// Helper functions for Durable Object operations
async function getActiveTrades(env) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch('https://fake-host/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: 'trade:' })
  });
  const { entries } = await response.json();
  return entries;
}

async function getTrade(env, tradeId) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch('https://fake-host/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `trade:${tradeId}` })
  });
  const { value } = await response.json();
  return value;
}

async function setTrade(env, tradeId, tradeData) {
  const stub = getTradeStorage(env);
  await stub.fetch('https://fake-host/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `trade:${tradeId}`, value: tradeData })
  });
}

async function deleteTrade(env, tradeId) {
  const stub = getTradeStorage(env);
  await stub.fetch('https://fake-host/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `trade:${tradeId}` })
  });
}

async function cleanupOldTrades(env) {
  const stub = getTradeStorage(env);
  await stub.fetch('https://fake-host/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

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

export default {
  async scheduled(event, env, ctx) {
    // This runs on a cron schedule for 4pm EST market close check
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    // Get active trades from Durable Object
    const activeTrades = await getActiveTrades(env);
    if (Object.keys(activeTrades).length === 0) return;

    // Check if there are active trades at market close
    for (const [key, trade] of Object.entries(activeTrades)) {
      const tradeId = key.replace('trade:', '');
      const content = [
        "**Hard Stop - Market Close 🔔**",
        `Trade ID: ${tradeId}`,
        `Type: ${trade.type}`,
        `Symbol: ${trade.symbol}`,
        `Entry: ${trade.entry}`,
        "Active trade will be closed at market close."
      ].join("\n");

      await sendDiscordMessage(webhookUrl, content);
    }
    
    // Close all active trades at market close
    for (const [key] of Object.entries(activeTrades)) {
      await deleteTrade(env, key.replace('trade:', ''));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (request.method === "GET" && url.pathname === "/health") {
      const activeTrades = await getActiveTrades(env);
      const tradesList = Object.entries(activeTrades).map(([key, t]) => ({
        id: key.replace('trade:', ''),
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
          timestamp: new Date().toISOString()
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

    const scrub = (value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") {
          return "";
        }
        return trimmed;
      }
      if (Number.isNaN(value)) return "";
      return String(value);
    };

    const withNA = (value, fallback = "N/A") => {
      const cleaned = scrub(value);
      return cleaned === "" ? fallback : cleaned;
    };

    const isValidNumber = (value) => {
      const cleaned = scrub(value);
      if (cleaned === "" || cleaned === "N/A") return false;
      const num = parseFloat(cleaned);
      return !isNaN(num) && isFinite(num);
    };

    const isWithinTradingHours = (timestamp) => {
      if (!timestamp) return false;
      try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return false;
        // Get EST time components
        const estTime = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false
        }).format(date);
        const [hours, minutes] = estTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;
        // 9:34 AM = 574 minutes, 11:00 AM = 660 minutes
        return totalMinutes >= 574 && totalMinutes <= 660;
      } catch (e) {
        return false;
      }
    };

    const formatTime = (timestamp) => {
      if (!timestamp) return "N/A";
      try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return withNA(timestamp);
        
        const options = {
          timeZone: 'America/New_York',
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        };
        
        const formatted = new Intl.DateTimeFormat('en-US', options).format(date);
        return `${formatted} EST`;
      } catch (e) {
        return withNA(timestamp);
      }
    };

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

    // Clean up old recent signals periodically
    cleanupRecentSignals();

    // Create a unique key for duplicate detection
    const signalKey = `${type}_${tradeId}_${entry}_${time}`;
    const now = Date.now();
    
    // Check for duplicate signal within time window
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
    
    // Record this signal
    recentSignals.set(signalKey, now);

    // Validate tradeId format (should be a number from Pine Script)
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

    // Check for active trades
    const activeTrades = await getActiveTrades(env);
    const hasActiveTrade = Object.keys(activeTrades).length > 0;
    
    // Validate entry signals have valid position values and are within trading hours
    const isEntrySignal = type === "LONG_ENTRY" || type === "SHORT_ENTRY";
    if (isEntrySignal) {
      // Reject if there's already an active trade
      if (hasActiveTrade) {
        const activeTradesList = Object.entries(activeTrades)
          .map(([key, t]) => `${key.replace('trade:', '')} (${t.type} ${t.symbol} ${t.tf ? t.tf + 'm' : ''})`)
          .join(", ");
        
        return new Response(
          JSON.stringify({ 
            status: "rejected", 
            reason: "Active trade already exists",
            activeTrades: activeTradesList
          }), 
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      const hasValidPositions = isValidNumber(payload.entry) && 
                                isValidNumber(payload.sl) && 
                                isValidNumber(payload.tp1) && 
                                isValidNumber(payload.tp2);
      
      const withinTradingHours = isWithinTradingHours(payload.time);
      
      if (!hasValidPositions || !withinTradingHours) {
        return new Response(
          JSON.stringify({ 
            status: "rejected", 
            reason: !hasValidPositions ? "Invalid position values" : "Outside trading hours (9:34 AM - 11:00 AM EST)",
            hasValidPositions,
            withinTradingHours,
            receivedValues: { entry: payload.entry, sl: payload.sl, tp1: payload.tp1, tp2: payload.tp2 }
          }), 
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Register the new trade in Durable Object
      await setTrade(env, tradeId, {
        type: type === "LONG_ENTRY" ? "LONG" : "SHORT",
        symbol,
        tf,
        entry,
        sl,
        tp1,
        tp2,
        startTime: payload.time || new Date().toISOString(),
        lastUpdate: now
      });
    }

    // Validate trade exists for non-entry signals
    if (!isEntrySignal && type !== "UNKNOWN") {
      // For TP/SL alerts, verify the trade exists
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
      
      // Update last activity timestamp
      existingTrade.lastUpdate = now;
      await setTrade(env, tradeId, existingTrade);
    }

    // Handle trade closure (SL, TP2, or partial TP1/BE)
    const isFullClose = type === "LONG_SL" || type === "SHORT_SL" || 
                        type === "LONG_TP2" || type === "SHORT_TP2";
    const isPartialClose = type === "LONG_TP1" || type === "SHORT_TP1" ||
                           type === "LONG_BE" || type === "SHORT_BE";
    
    if (isFullClose && tradeId) {
      await deleteTrade(env, tradeId);
    } else if (isPartialClose && tradeId) {
      // Keep trade active but mark partial closure
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
          "**Buy NQ|NAS100 Now**",
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
          "**Sell NQ|NAS100 Now**",
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
          "**Trade Update: TP1 HIT / BE**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP1 Smashed! 🔥 SL moved to entry. 50% Partials secured. 💰"
        ].join("\n");
        break;
      case "LONG_TP1":
      case "SHORT_TP1":
        content = [
          "**Trade Update: TP1 HIT / BE*",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP1 Smashed! 🔥 SL moved to entry. 50% Partials secured. 💰"
        ].join("\n");
        break;
      case "LONG_TP2":
      case "SHORT_TP2":
        content = [
          "**Trade Update: TP2 HIT**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP2 Smashed! 🔥🔥 Trade fully closed. 💰"
        ].join("\n");
        break;
      case "LONG_SL":
      case "SHORT_SL":
        content = [
          "**Trade Update: SL HIT**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "Trade invalidated. 🛑"
        ].join("\n");
        break;
      default:
        // Log unknown alert types for debugging
        console.warn("Unknown alert type received:", type, "Payload:", payload);
        content = [
          "**⚠️ UNKNOWN ALERT TYPE**",
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

    // Success response with confirmation
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
