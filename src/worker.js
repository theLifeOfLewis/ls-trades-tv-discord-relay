// Import Durable Object for persistent storage
import { TradeStorage } from './TradeStorage.js';
export { TradeStorage };

// Import Zod for schema validation
import { z } from 'zod';

// Schema definitions for webhook payloads
const BaseSchema = z.object({
  type: z.string(),
  symbol: z.string().optional(),
  tf: z.string().optional(),
  time: z.string().optional(),
  tradeId: z.string().optional()
});

const EntrySchema = BaseSchema.extend({
  type: z.enum(['LONG_ENTRY', 'SHORT_ENTRY']),
  symbol: z.string(),
  tf: z.string(),
  time: z.string(),
  entry: z.string(),
  sl: z.string(),
  tp1: z.string(),
  tp2: z.string(),
  tradeId: z.string(),
  grade: z.enum(['A', 'A+', 'A++']).optional()
});

const ExitSchema = BaseSchema.extend({
  type: z.enum(['LONG_TP1', 'SHORT_TP1', 'LONG_TP2', 'SHORT_TP2', 'LONG_SL', 'SHORT_SL']),
  tradeId: z.string(),
  price: z.string().optional(),
  time: z.string().optional()
});

const BiasSchema = BaseSchema.extend({
  type: z.enum(['NY_AM_BULLISH', 'NY_AM_BEARISH', 'BIAS_FLIP_BULLISH', 'BIAS_FLIP_BEARISH']),
  symbol: z.string(),
  tf: z.string().optional(),
  time: z.string().optional(),
  profile: z.string().optional()
});

// Union schema for all valid alert types
const AlertSchema = z.union([EntrySchema, ExitSchema, BiasSchema]);

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
  const response = await stub.fetch('https://fake-host/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  return await response.json();
}

async function checkDuplicate(env, signalKey, timestamp) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch('https://fake-host/check-duplicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signalKey, timestamp })
  });
  const { isDuplicate } = await response.json();
  return isDuplicate;
}

async function createTradeIfNoneActive(env, tradeId, tradeData) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch('https://fake-host/create-if-none-active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: `trade:${tradeId}`, trade: tradeData })
  });
  return await response.json();
}

function validateExitMatchesTrade(exitType, tradeType) {
  // Extract direction from exit type (e.g., "LONG" from "LONG_TP1")
  const exitDirection = exitType.split('_')[0]; // "LONG", "SHORT"

  // Trade type is stored as "LONG" or "SHORT" (without _ENTRY suffix)
  if (exitDirection !== tradeType) {
    return {
      valid: false,
      error: `Exit type ${exitType} does not match trade direction ${tradeType}`
    };
  }

  return { valid: true };
}

async function sendDiscordMessageWithRetry(webhookUrl, payload, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log(`Discord webhook sent successfully (attempt ${attempt}/${maxRetries})`);
        return { success: true, attempt };
      }

      // Non-retryable errors (4xx except rate limits)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const errorText = await response.text();
        throw new Error(`Discord returned ${response.status}: ${errorText}`);
      }

      lastError = new Error(`Discord returned ${response.status}`);
      console.warn(`Discord webhook attempt ${attempt}/${maxRetries} failed: ${response.status}`);
    } catch (error) {
      lastError = error;
      console.error(`Discord webhook attempt ${attempt}/${maxRetries} failed:`, error.message);
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s)
    if (attempt < maxRetries) {
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.error(`All ${maxRetries} Discord webhook attempts failed:`, lastError?.message);
  return { success: false, error: lastError?.message || 'Unknown error' };
}

// Helper for consistent JSON responses
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default {
  async scheduled(event, env, ctx) {
    const cronType = event.cron;

    // Handle cleanup cron (daily at 1 AM UTC)
    if (cronType === "0 1 * * *") {
      console.log("Running daily cleanup...");
      const result = await cleanupOldTrades(env);
      console.log(`Cleanup completed: ${result.cleanedTradeCount} trades, ${result.cleanedSignalCount} signals removed`);
      return;
    }

    // Handle market close cron (9 PM UTC = 4 PM EST)
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn("No Discord webhook URL configured for market close");
      return;
    }

    // Get active trades from Durable Object
    const activeTrades = await getActiveTrades(env);
    const tradesList = Object.entries(activeTrades).map(([key, trade]) => ({
      id: key.replace('trade:', ''),
      ...trade
    }));

    if (tradesList.length === 0) {
      console.log("No active trades at market close");
      return;
    }

    // Batch trades into groups of 10 (Discord embed limit)
    const batches = [];
    for (let i = 0; i < tradesList.length; i += 10) {
      batches.push(tradesList.slice(i, i + 10));
    }

    console.log(`Market close: ${tradesList.length} active trade(s) in ${batches.length} batch(es)`);

    // Send batched messages with embeds
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const embeds = batch.map(trade => {
        const fields = [
          { name: 'Symbol', value: trade.symbol, inline: true },
          { name: 'Entry', value: trade.entry, inline: true },
          { name: 'TP1', value: trade.tp1, inline: true },
          { name: 'TP2', value: trade.tp2, inline: true },
          { name: 'SL', value: trade.sl, inline: true },
          { name: 'Status', value: trade.partialClosed ? 'Partial Close' : 'Active', inline: true }
        ];

        // Add grade if available
        if (trade.grade) {
          fields.push({ name: 'Grade', value: trade.grade, inline: true });
        }

        return {
          title: `${trade.type} Trade - ID: ${trade.id}`,
          fields,
          color: 0xFFAA00 // Orange
        };
      });

      const payload = {
        content: batchIndex === 0
          ? `**Hard Stop - Market Close 🔔**\n${tradesList.length} active trade(s) will be closed.`
          : `**Market Close (continued)** - Batch ${batchIndex + 1}/${batches.length}`,
        embeds
      };

      const result = await sendDiscordMessageWithRetry(webhookUrl, payload);
      if (!result.success) {
        console.error(`Failed to send market close batch ${batchIndex + 1}:`, result.error);
      }

      // Delay between batches to avoid rate limits
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Close all active trades at market close
    for (const trade of tradesList) {
      await deleteTrade(env, trade.id);
    }
    console.log(`Closed ${tradesList.length} trade(s) at market close`);
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
          timestamp: new Date().toISOString()
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    
    if (request.method !== "POST") {
      return jsonResponse({ status: 'rejected', reason: 'Method not allowed' }, 405);
    }

    const BUY_IMAGE_URL = "https://raw.githubusercontent.com/theLifeOfLewis/ls-trades-tv-discord-relay/main/assets/buy.png";
    const SELL_IMAGE_URL = "https://raw.githubusercontent.com/theLifeOfLewis/ls-trades-tv-discord-relay/main/assets/sell.png";

    // Read raw body so we can log it, then parse JSON from it
    let rawBody = "";
    try {
      rawBody = await request.text();
    } catch (e) {
      return jsonResponse({ status: 'rejected', reason: 'Invalid request body', error: String(e) }, 400);
    }

    const receivedTimestampUTC = new Date().toISOString();

    let payload = {};
    if (rawBody) {
      try {
        const parsedJson = JSON.parse(rawBody);

        // Validate payload against schema
        const validationResult = AlertSchema.safeParse(parsedJson);
        if (!validationResult.success) {
          return jsonResponse({
            status: 'rejected',
            reason: 'Invalid payload schema',
            errors: validationResult.error.issues.map(issue => ({
              field: issue.path.join('.'),
              message: issue.message,
              code: issue.code
            }))
          }, 400);
        }

        payload = validationResult.data;
      } catch (e) {
        return jsonResponse({ status: 'rejected', reason: 'Invalid JSON', rawBody, error: String(e) }, 400);
      }
    }

    // Log incoming hits for observability: raw body, headers, and received UTC timestamp
    try {
      const headersObj = Object.fromEntries(request.headers.entries());
      console.log("Incoming hit", {
        method: request.method,
        url: request.url,
        headers: headersObj,
        rawBody,
        type: payload && payload.type ? String(payload.type).trim() : "",
        tradeId: payload && payload.tradeId ? String(payload.tradeId).trim() : "",
        receivedTimestampUTC
      });
    } catch (e) {
      // Swallow logging errors so they don't affect request handling
    }

    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      return jsonResponse({ status: 'rejected', reason: 'Missing Discord webhook' }, 500);
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
    let symbol = scrub(payload.symbol) || "UNKNOWN";
    let tf = scrub(payload.tf);
    const isEntrySignal = type === "LONG_ENTRY" || type === "SHORT_ENTRY";
    
    // For non-entry signals, we'll get symbol/tf from the trade later
    // Time: prefer the TradingView-provided time when present for all signal types
    const time = (payload && payload.time) ? formatTime(payload.time) : formatTime(new Date().toISOString());
    const entry = withNA(payload.entry);
    const sl = withNA(payload.sl);
    const tp1 = withNA(payload.tp1);
    const tp2 = withNA(payload.tp2);
    const price = withNA(payload.price);
    const tradeId = scrub(payload.tradeId) || `TRADE_${Date.now()}`;

    // Create a unique key for duplicate detection
    const signalKey = `${type}_${tradeId}_${entry}_${time}`;
    const now = Date.now();

    // Check for duplicate signal using Durable Object (atomic, shared across instances)
    const isDuplicate = await checkDuplicate(env, signalKey, now);
    if (isDuplicate) {
      return new Response(
        JSON.stringify({
          status: "rejected",
          reason: "Duplicate signal detected within 5 seconds",
          signalKey
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

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

    // Validate entry signals have valid position values and are within trading hours
    if (isEntrySignal) {
      const hasValidPositions = isValidNumber(payload.entry) &&
                                isValidNumber(payload.sl) &&
                                isValidNumber(payload.tp1) &&
                                isValidNumber(payload.tp2);

      if (!hasValidPositions) {
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: "Invalid position values",
            hasValidPositions,
            receivedValues: { entry: payload.entry, sl: payload.sl, tp1: payload.tp1, tp2: payload.tp2 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Atomically register the new trade (checks for active trades and creates in single operation)
      const createResult = await createTradeIfNoneActive(env, tradeId, {
        type: type === "LONG_ENTRY" ? "LONG" : "SHORT",
        symbol,
        tf,
        entry,
        sl,
        tp1,
        tp2,
        grade: payload.grade || null,
        startTime: payload.time || new Date().toISOString(),
        lastUpdate: now
      });

      // If another trade is already active, reject this entry
      if (!createResult.success) {
        const activeInfo = createResult.activeTrade;
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: "Active trade already exists",
            activeTrade: `${activeInfo.key} (${activeInfo.type} ${activeInfo.symbol} ${activeInfo.tf ? activeInfo.tf + 'm' : ''})`
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Validate trade exists for non-entry signals
    let existingTrade = null;
    if (!isEntrySignal && type !== "UNKNOWN") {
      // For TP/SL alerts, verify the trade exists
      existingTrade = await getTrade(env, tradeId);
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

      // Validate that exit type matches trade direction
      const validation = validateExitMatchesTrade(type, existingTrade.type);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({
            status: "rejected",
            reason: validation.error,
            exitType: type,
            tradeType: existingTrade.type,
            tradeId
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Use trade's symbol and tf for the message
      symbol = existingTrade.symbol;
      tf = existingTrade.tf;

      // Update last activity timestamp
      existingTrade.lastUpdate = now;
      await setTrade(env, tradeId, existingTrade);
    }

    const symbolLine = tf ? `${symbol} ${tf}m` : symbol;

    // Handle trade closure (SL, TP2, or partial TP1/BE)
    const isFullClose = type === "LONG_SL" || type === "SHORT_SL" ||
                        type === "LONG_TP2" || type === "SHORT_TP2";
    const isPartialClose = type === "LONG_TP1" || type === "SHORT_TP1";
    
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

    // Extract grade from validated payload
    const grade = payload.grade || null;

    // Grade color mapping for Discord embeds
    const gradeColors = {
      'A': 0xFFD700,   // Gold
      'A+': 0xFF8C00,  // Dark Orange
      'A++': 0xFF0000  // Red
    };

    let content = "";
    let embeds = [];

    switch (type) {
      case "LONG_ENTRY":
        const longLines = [
          "**Buy NQ|NAS100 Now**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`
        ];
        if (grade) {
          longLines.push(`Grade: ${grade}`);
        }
        longLines.push(
          `Entry: ${entry}`,
          `SL: ${sl}`,
          `TP1: ${tp1}`,
          `TP2: ${tp2}`
        );
        content = longLines.join("\n");

        // Add image embed with grade color if available
        const longImageEmbed = { image: { url: BUY_IMAGE_URL } };
        if (grade && gradeColors[grade]) {
          longImageEmbed.color = gradeColors[grade];
        }
        embeds = [longImageEmbed];
        break;

      case "SHORT_ENTRY":
        const shortLines = [
          "**Sell NQ|NAS100 Now**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`
        ];
        if (grade) {
          shortLines.push(`Grade: ${grade}`);
        }
        shortLines.push(
          `Entry: ${entry}`,
          `SL: ${sl}`,
          `TP1: ${tp1}`,
          `TP2: ${tp2}`
        );
        content = shortLines.join("\n");

        // Add image embed with grade color if available
        const shortImageEmbed = { image: { url: SELL_IMAGE_URL } };
        if (grade && gradeColors[grade]) {
          shortImageEmbed.color = gradeColors[grade];
        }
        embeds = [shortImageEmbed];
        break;
      case "LONG_TP1":
      case "SHORT_TP1":
        content = [
          "**Trade Update: TP1 HIT / BE**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "TP1 Smashed! 🔥 SL moved to entry. Partials secured. 💰"
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
        // Check if this is BE stop (after TP1) or full SL
        const isBEStop = existingTrade && existingTrade.partialClosed;
        const slMessage = isBEStop ? "Trade Closed at BE 🛑" : "Trade invalidated. 🛑";

        content = [
          "**Trade Update: SL HIT**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          slMessage
        ].join("\n");
        break;
      case "NY_AM_BULLISH":
        content = [
          "**NY Opening Bias: BULLISH** 🟢",
          "Good Morning Trader, Expecting Longs during the New York AM Session",
          "",
          `Symbol: ${symbol}`,
          `Timeframe: ${tf}m`,
          `Time: ${time}`,
          `Profile: ${payload.profile || 'N/A'}`
        ].join("\n");
        console.log(`✅ Sent NY_AM_BULLISH bias alert for ${symbol}`);
        break;
      case "NY_AM_BEARISH":
        content = [
          "**NY Opening Bias: BEARISH** 🔴",
          "Good Morning Trader, Expecting Shorts during the New York AM Session",
          "",
          `Symbol: ${symbol}`,
          `Timeframe: ${tf}m`,
          `Time: ${time}`,
          `Profile: ${payload.profile || 'N/A'}`
        ].join("\n");
        console.log(`✅ Sent NY_AM_BEARISH bias alert for ${symbol}`);
        break;
      case "BIAS_FLIP_BULLISH":
        content = [
          "**Bias Update: Now BULLISH** 🟢⚡",
          "Expecting a Bullish move now.",
          "",
          `Symbol: ${symbol}`,
          `Timeframe: ${tf}m`,
          `Time: ${time}`,
          `Profile: ${payload.profile || 'N/A'}`
        ].join("\n");
        console.log(`✅ Sent BIAS_FLIP_BULLISH alert for ${symbol}`);
        break;
      case "BIAS_FLIP_BEARISH":
        content = [
          "**Bias Update: Now BEARISH** 🔴⚡",
          "Expecting a Bearish move now.",
          "",
          `Symbol: ${symbol}`,
          `Timeframe: ${tf}m`,
          `Time: ${time}`,
          `Profile: ${payload.profile || 'N/A'}`
        ].join("\n");
        console.log(`✅ Sent BIAS_FLIP_BEARISH alert for ${symbol}`);
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

    // Send to Discord with retry logic
    const result = await sendDiscordMessageWithRetry(webhookUrl, discordPayload);

    if (!result.success) {
      console.error("Failed to send Discord message after all retries:", result.error);
      return new Response(
        JSON.stringify({
          status: "error",
          reason: "Failed to send Discord message after retries",
          error: result.error
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
