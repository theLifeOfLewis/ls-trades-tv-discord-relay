// In-memory storage for active trades (resets on worker restart)
// For production, consider using Durable Objects or KV storage
let activeTrades = new Map(); // tradeId -> { type, symbol, entry, sl, tp1, tp2, startTime }

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
    if (!webhookUrl || activeTrades.size === 0) return;

    // Check if there are active trades at market close
    for (const [tradeId, trade] of activeTrades.entries()) {
      const content = [
        "Hard Stop - Market Close 🔔",
        `Trade ID: ${tradeId}`,
        `Type: ${trade.type}`,
        `Symbol: ${trade.symbol}`,
        `Entry: ${trade.entry}`,
        "Active trade will be closed at market close."
      ].join("\n");

      await sendDiscordMessage(webhookUrl, content);
    }
  },

  async fetch(request, env, ctx) {
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
        
        // 9:30 AM = 570 minutes, 12:00 PM = 720 minutes
        return totalMinutes >= 570 && totalMinutes < 720;
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

    // Check for active trades
    const hasActiveTrade = activeTrades.size > 0;
    
    // Validate entry signals have valid position values and are within trading hours
    const isEntrySignal = type === "LONG_ENTRY" || type === "SHORT_ENTRY";
    if (isEntrySignal) {
      // Reject if there's already an active trade
      if (hasActiveTrade) {
        return new Response(
          JSON.stringify({ 
            status: "rejected", 
            reason: "Active trade already exists",
            activeTradeId: Array.from(activeTrades.keys())[0]
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
            reason: !hasValidPositions ? "Invalid position values" : "Outside trading hours (9:30 AM - 12:00 PM EST)",
            hasValidPositions,
            withinTradingHours
          }), 
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Register the new trade
      activeTrades.set(tradeId, {
        type: type === "LONG_ENTRY" ? "LONG" : "SHORT",
        symbol,
        entry,
        sl,
        tp1,
        tp2,
        startTime: payload.time || new Date().toISOString()
      });
    }

    // Handle trade invalidation (SL hit or TP2 hit = trade fully closed)
    const isTradeClose = type === "LONG_SL" || type === "SHORT_SL" || 
                         type === "LONG_TP2" || type === "SHORT_TP2";
    if (isTradeClose && tradeId) {
      activeTrades.delete(tradeId);
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
          "BE HIT",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP1 Smashed! 🔥🔥🔥 SL moved to entry. 50% Partials secured. 💰"
        ].join("\n");
        break;
      case "LONG_TP1":
      case "SHORT_TP1":
        content = [
          "TP1 HIT",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP2 Smashed! 🔥🔥🔥 Secured a little more 💰. Runner left to TP3."
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
          "TP3 Smashed! 🔥🔥🔥 Trade fully closed."
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
          "Trade invalidated. 🛑"
        ].join("\n");
        break;
      default:
        content = [
          "UNKNOWN ALERT TYPE",
          JSON.stringify(payload)
        ].join("\n");
        break;
    }

    const discordPayload = { content };
    if (embeds.length > 0) {
      discordPayload.embeds = embeds;
    }
    const discordBody = JSON.stringify(discordPayload);

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: discordBody
    });

    if (!resp.ok) {
      return new Response("Discord error", { status: 502 });
    }

    return new Response("ok", { status: 200 });
  }
};
