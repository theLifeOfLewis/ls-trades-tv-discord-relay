// Import Durable Object for persistent storage
import { TradeStorage } from './TradeStorage.js';
export { TradeStorage };

// Import Zod for schema validation
import { z } from 'zod';

// Schema definitions for webhook payloads
const BaseSchema = z.object({
  type: z.string(),
  secret: z.string(),  // Required webhook secret for authentication
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
  grade: z.enum(['A', 'A+', 'A++', 'A+++']).optional()
});

const ExitSchema = BaseSchema.extend({
  type: z.enum(['LONG_TP1', 'SHORT_TP1', 'LONG_TP2', 'SHORT_TP2', 'LONG_TP3', 'SHORT_TP3', 'LONG_SL', 'SHORT_SL']),
  symbol: z.string().optional(),
  tf: z.string().optional(),
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

const WeeklySummarySchema = BaseSchema.extend({
  type: z.enum(['WEEKLY_SUMMARY']),
  symbol: z.string(),
  time: z.string(),
  trades: z.string(),
  wins: z.string(),
  losses: z.string(),
  pointsGained: z.string(),
  pointsLost: z.string(),
  netPoints: z.string(),
  winRate: z.string()
});

// Union schema for all valid alert types
const AlertSchema = z.union([EntrySchema, ExitSchema, BiasSchema, WeeklySummarySchema]);

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

async function setPendingBias(env, dateStr, biasData) {
  const stub = getTradeStorage(env);
  await stub.fetch('https://fake-host/set-pending-bias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr, biasData })
  });
}

async function getPendingBias(env, dateStr) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch('https://fake-host/get-pending-bias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr })
  });
  const { value } = await response.json();
  return value;
}

async function clearPendingBias(env, dateStr) {
  const stub = getTradeStorage(env);
  await stub.fetch('https://fake-host/clear-pending-bias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr })
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

// Helper to calculate points based on trade direction
function calculatePoints(tradeType, entryPrice, exitPrice) {
  const entry = parseFloat(entryPrice);
  const exit = parseFloat(exitPrice);

  if (isNaN(entry) || isNaN(exit)) {
    return 0;
  }

  // For LONG: points = exit - entry
  // For SHORT: points = entry - exit
  if (tradeType === 'LONG') {
    return exit - entry;
  } else if (tradeType === 'SHORT') {
    return entry - exit;
  }

  return 0;
}

async function archiveTrade(env, tradeId, tradeData, exitData) {
  const stub = getTradeStorage(env);

  // Create archive key with date for easy querying: archive:YYYYMMDD:tradeId
  const exitDate = new Date(exitData.exitTime || Date.now());
  const dateStr = exitDate.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD format
  const archiveKey = `archive:${dateStr}:${tradeId}`;

  // Build archive object
  const archivedTrade = {
    ...tradeData,
    exitType: exitData.exitType,
    exitPrice: exitData.exitPrice,
    exitTime: exitData.exitTime,
    points: exitData.points,
    isWin: exitData.isWin,
    archivedAt: Date.now()
  };

  await stub.fetch('https://fake-host/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: archiveKey, value: archivedTrade })
  });

  return archiveKey;
}

async function getDailyArchives(env, dateStr) {
  const stub = getTradeStorage(env);
  const response = await stub.fetch('https://fake-host/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: `archive:${dateStr}:` })
  });
  const { entries } = await response.json();
  return entries;
}

function calculateDailySummary(archivedTrades) {
  const trades = Object.values(archivedTrades);

  if (trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPoints: 0
    };
  }

  const wins = trades.filter(t => t.isWin).length;
  const losses = trades.filter(t => !t.isWin).length;
  const totalPoints = trades.reduce((sum, t) => sum + (t.points || 0), 0);

  return {
    totalTrades: trades.length,
    wins,
    losses,
    totalPoints: totalPoints
  };
}

function getWeekDateRange(currentDate) {
  // Get Monday of current week (week starts Monday, ends Friday)
  const etDate = new Date(currentDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = etDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday

  // Calculate days to subtract to get to Monday
  const daysToMonday = (dayOfWeek === 0) ? 6 : (dayOfWeek - 1);

  const monday = new Date(etDate);
  monday.setDate(monday.getDate() - daysToMonday);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4); // Friday is 4 days after Monday

  // Format as YYYYMMDD
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  return {
    start: formatDate(monday),
    end: formatDate(friday),
    mondayDate: monday,
    fridayDate: friday
  };
}

async function getWeeklyArchives(env, startDateStr, endDateStr) {
  const stub = getTradeStorage(env);

  // List all archives and filter by date range
  const response = await stub.fetch('https://fake-host/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: 'archive:' })
  });
  const { entries } = await response.json();

  // Filter trades within the date range
  const weeklyTrades = {};
  for (const [key, trade] of Object.entries(entries)) {
    // Extract date from key: archive:YYYYMMDD:tradeId
    const dateMatch = key.match(/^archive:(\d{8}):/);
    if (dateMatch) {
      const tradeDate = dateMatch[1];
      if (tradeDate >= startDateStr && tradeDate <= endDateStr) {
        weeklyTrades[key] = trade;
      }
    }
  }

  return weeklyTrades;
}

function calculateWeeklySummary(archivedTrades) {
  // Same as daily summary, but labeled for weekly
  return calculateDailySummary(archivedTrades);
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

// Helper to format prices to 2 decimal places
function formatPrice(value) {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "null" ||
        trimmed.toLowerCase() === "undefined" || trimmed === "N/A") {
      return "N/A";
    }
    const num = parseFloat(trimmed);
    if (isNaN(num) || !isFinite(num)) return "N/A";
    return num.toFixed(2);
  }
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return "N/A";
  return num.toFixed(2);
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

async function sendTelegramPhotoWithRetry(botToken, chatId, photoUrl, caption, parseMode = 'HTML', maxRetries = 3) {
  if (!botToken || !chatId) {
    console.warn('Telegram not configured: missing bot token or chat ID');
    return { success: false, error: 'Telegram not configured' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
          caption: caption,
          parse_mode: parseMode
        })
      });

      if (response.ok) {
        console.log(`Telegram photo sent successfully (attempt ${attempt}/${maxRetries})`);
        return { success: true, attempt };
      }

      const responseData = await response.json();

      // Non-retryable errors (4xx except rate limits)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(`Telegram returned ${response.status}: ${responseData.description || 'Unknown error'}`);
      }

      lastError = new Error(`Telegram returned ${response.status}: ${responseData.description || 'Unknown error'}`);
      console.warn(`Telegram photo attempt ${attempt}/${maxRetries} failed: ${response.status}`);
    } catch (error) {
      lastError = error;
      console.error(`Telegram photo attempt ${attempt}/${maxRetries} failed:`, error.message);
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s)
    if (attempt < maxRetries) {
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.error(`All ${maxRetries} Telegram photo attempts failed:`, lastError?.message);
  return { success: false, error: lastError?.message || 'Unknown error' };
}

async function sendTelegramMessageWithRetry(botToken, chatId, text, parseMode = 'HTML', maxRetries = 3) {
  if (!botToken || !chatId) {
    console.warn('Telegram not configured: missing bot token or chat ID');
    return { success: false, error: 'Telegram not configured' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: parseMode,
          disable_web_page_preview: true
        })
      });

      if (response.ok) {
        console.log(`Telegram message sent successfully (attempt ${attempt}/${maxRetries})`);
        return { success: true, attempt };
      }

      const responseData = await response.json();

      // Non-retryable errors (4xx except rate limits)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(`Telegram returned ${response.status}: ${responseData.description || 'Unknown error'}`);
      }

      lastError = new Error(`Telegram returned ${response.status}: ${responseData.description || 'Unknown error'}`);
      console.warn(`Telegram attempt ${attempt}/${maxRetries} failed: ${response.status}`);
    } catch (error) {
      lastError = error;
      console.error(`Telegram attempt ${attempt}/${maxRetries} failed:`, error.message);
    }

    // Wait before retry (exponential backoff: 1s, 2s, 4s)
    if (attempt < maxRetries) {
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.error(`All ${maxRetries} Telegram attempts failed:`, lastError?.message);
  return { success: false, error: lastError?.message || 'Unknown error' };
}

function formatTelegramMessage(type, payload) {
  const { symbol, tf, entry, sl, tp1, tp2, price, tradeId, time, dateOnly, grade, profile } = payload;

  const symbolLine = tf ? `${symbol} ${tf}m` : symbol;

  // Grade emoji mapping
  const gradeEmoji = {
    'A': '⭐',
    'A+': '⭐⭐',
    'A++': '⭐⭐⭐',
    'A+++': '⭐⭐⭐⭐'
  };

  switch (type) {
    case 'LONG_ENTRY':
      let longMsg = `🟢 <b>BUY ${symbol} NOW</b>\n`;
      longMsg += `═══════════════════════\n`;
      longMsg += `🆔 Trade ID: ${tradeId}\n`;
      longMsg += `📊 ${symbolLine}\n`;
      longMsg += `🕐 ${time}\n`;
      if (grade) {
        longMsg += `${gradeEmoji[grade] || '⭐'} Grade: <b>${grade}</b>\n`;
      }
      longMsg += `\n`;
      longMsg += `📈 Entry: <code>${formatPrice(entry)}</code>\n`;
      longMsg += `🛑 SL: <code>${formatPrice(sl)}</code>\n`;
      longMsg += `🎯 TP1: <code>${formatPrice(tp1)}</code>\n`;
      longMsg += `🎯 TP2: <code>${formatPrice(tp2)}</code>`;
      return longMsg;

    case 'SHORT_ENTRY':
      let shortMsg = `🔴 <b>SELL ${symbol} NOW</b>\n`;
      shortMsg += `═══════════════════════\n`;
      shortMsg += `🆔 Trade ID: ${tradeId}\n`;
      shortMsg += `📊 ${symbolLine}\n`;
      shortMsg += `🕐 ${time}\n`;
      if (grade) {
        shortMsg += `${gradeEmoji[grade] || '⭐'} Grade: <b>${grade}</b>\n`;
      }
      shortMsg += `\n`;
      shortMsg += `📉 Entry: <code>${formatPrice(entry)}</code>\n`;
      shortMsg += `🛑 SL: <code>${formatPrice(sl)}</code>\n`;
      shortMsg += `🎯 TP1: <code>${formatPrice(tp1)}</code>\n`;
      shortMsg += `🎯 TP2: <code>${formatPrice(tp2)}</code>`;
      return shortMsg;

    case 'LONG_TP1':
    case 'SHORT_TP1':
      return `✅ <b>TP1 HIT / BREAKEVEN</b>\n\n` +
             `🆔 Trade ID: ${tradeId}\n` +
             `📊 ${symbolLine}\n` +
             `🕐 ${time}\n` +
             `💰 Price: <code>${formatPrice(price)}</code>\n\n` +
             `TP1 Smashed! 🔥 SL moved to entry. Partials secured. 💰`;

    case 'LONG_TP2':
    case 'SHORT_TP2':
      return `🎯 <b>TP2 HIT</b>\n\n` +
             `🆔 Trade ID: ${tradeId}\n` +
             `📊 ${symbolLine}\n` +
             `🕐 ${time}\n` +
             `💰 Price: <code>${formatPrice(price)}</code>\n\n` +
             `TP2 Smashed! 🔥🔥 💰`;

    case 'LONG_TP3':
    case 'SHORT_TP3':
      return `💎 <b>TP3 HIT</b>\n\n` +
             `🆔 Trade ID: ${tradeId}\n` +
             `📊 ${symbolLine}\n` +
             `🕐 ${time}\n` +
             `💰 Price: <code>${formatPrice(price)}</code>\n\n` +
             `TP3 DEMOLISHED! 🔥🔥🔥 Maximum profit secured! 💰💰💰`;

    case 'LONG_SL':
    case 'SHORT_SL':
      const isBEStop = payload.isBEStop || false;
      const slMessage = isBEStop ? 'Trade Closed at BE 🛑' : 'Trade invalidated. 🛑';
      return `🛑 <b>STOP LOSS HIT</b>\n\n` +
             `🆔 Trade ID: ${tradeId}\n` +
             `📊 ${symbolLine}\n` +
             `🕐 ${time}\n` +
             `💰 Price: <code>${formatPrice(price)}</code>\n\n` +
             slMessage;

    case 'NY_AM_BULLISH':
      return `📈 <b>NY OPENING BIAS: BULLISH</b> 🟢\n\n` +
             `Good Morning Traders, Initial bias is for Longs during the New York AM Session.\n` +
             `As reactionary traders, our bias may shift based on NYSE open activity.\n\n` +
             `📊 Symbol: ${symbol}\n` +
             `📅 Date: ${dateOnly}`;

    case 'NY_AM_BEARISH':
      return `📉 <b>NY OPENING BIAS: BEARISH</b> 🔴\n\n` +
             `Good Morning Traders, Initial bias is for Shorts during the New York AM Session.\n` +
             `As reactionary traders, our bias may shift based on NYSE open activity.\n\n` +
             `📊 Symbol: ${symbol}\n` +
             `📅 Date: ${dateOnly}`;

    case 'BIAS_FLIP_BULLISH':
      return `⚡ <b>BIAS UPDATE: NOW BULLISH</b> 🟢\n\n` +
             `Expecting a Bullish move now.\n\n` +
             `📊 Symbol: ${symbol}\n` +
             `📅 Date: ${dateOnly}`;

    case 'BIAS_FLIP_BEARISH':
      return `⚡ <b>BIAS UPDATE: NOW BEARISH</b> 🔴\n\n` +
             `Expecting a Bearish move now.\n\n` +
             `📊 Symbol: ${symbol}\n` +
             `📅 Date: ${dateOnly}`;

    case 'WEEKLY_SUMMARY':
      return `📊 <b>WEEKLY SUMMARY</b> 📈\n` +
             `═══════════════════════\n` +
             `📆 Symbol: ${symbol}\n` +
             `🕐 ${time}\n\n` +
             `📊 Total Trades: <b>${payload.trades}</b>\n` +
             `✅ Wins: <b>${payload.wins}</b>\n` +
             `❌ Losses: <b>${payload.losses}</b>\n` +
             `💰 Points Gained: <b>${payload.pointsGained}</b>\n` +
             `📉 Points Lost: <b>${payload.pointsLost}</b>\n` +
             `💵 Net Points: <b>${payload.netPoints}</b>\n` +
             `📈 Win Rate: <b>${payload.winRate}%</b>`;

    default:
      return `⚠️ <b>UNKNOWN ALERT TYPE</b>\n\n` +
             `Type: ${type}\n` +
             `Trade ID: ${tradeId}\n` +
             `Symbol: ${symbolLine}\n` +
             `Time: ${time}\n\n` +
             `Please check indicator configuration.`;
  }
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

    // Handle bias release cron (8:30am ET)
    // Note: Use "30 13" for EST (Nov-Mar), "30 12" for EDT (Mar-Nov)
    const isBiasRelease = cronType === "30 13 * * 1-5";
    if (isBiasRelease) {
      console.log(`Bias release cron triggered: ${cronType}`);

      // Get today's date in ET timezone
      const now = new Date();
      const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dateStr = etDate.toISOString().split('T')[0].replace(/-/g, '');

      // Check for pending bias alert
      const pendingBias = await getPendingBias(env, dateStr);

      if (!pendingBias) {
        console.log('No pending bias alert to release');
        return;
      }

      console.log(`Releasing pending bias alert: ${pendingBias.type}`);

      // Get webhook URLs
      const webhookUrl = env.DISCORD_WEBHOOK_URL;
      const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
      const telegramChatId = env.TELEGRAM_CHAT_ID;

      // Format time and date
      const formatDateOnly = (timestamp) => {
        if (!timestamp) return "N/A";
        try {
          const date = new Date(Number(timestamp));
          if (isNaN(date.getTime())) return "N/A";
          const options = {
            timeZone: 'America/New_York',
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          };
          return new Intl.DateTimeFormat('en-US', options).format(date);
        } catch (e) {
          return "N/A";
        }
      };

      const dateOnly = formatDateOnly(pendingBias.time);
      const { type, symbol } = pendingBias;

      // Send to Discord (using existing message format)
      if (webhookUrl) {
        let content = '';
        if (type === 'NY_AM_BULLISH') {
          content = [
            "**NY Opening Bias: BULLISH** 🟢",
            "Good Morning Traders, Initial bias is for Longs during the New York AM Session.",
            "As reactionary traders, our bias may shift based on NYSE open activity.",
            "",
            `📊 Symbol: ${symbol}`,
            `📅 Date: ${dateOnly}`
          ].join("\n");
        } else if (type === 'NY_AM_BEARISH') {
          content = [
            "**NY Opening Bias: BEARISH** 🔴",
            "Good Morning Traders, Initial bias is for Shorts during the New York AM Session.",
            "As reactionary traders, our bias may shift based on NYSE open activity.",
            "",
            `📊 Symbol: ${symbol}`,
            `📅 Date: ${dateOnly}`
          ].join("\n");
        }

        await sendDiscordMessageWithRetry(webhookUrl, { content });
        console.log(`✅ Sent ${type} bias alert for ${symbol}`);
      }

      // Send to Telegram if configured
      if (telegramBotToken && telegramChatId) {
        const emoji = type === 'NY_AM_BULLISH' ? '🟢' : '🔴';
        const direction = type === 'NY_AM_BULLISH' ? 'Longs' : 'Shorts';
        const telegramMessage =
          `${emoji} <b>NY Opening Bias: ${direction.toUpperCase()}</b>\n\n` +
          `Good Morning Traders, Initial bias is for ${direction} during the New York AM Session.\n` +
          `As reactionary traders, our bias may shift based on NYSE open activity.\n\n` +
          `📊 Symbol: ${symbol}\n` +
          `📅 Date: ${dateOnly}`;

        await sendTelegramMessageWithRetry(telegramBotToken, telegramChatId, telegramMessage);
      }

      // Track that initial bias was sent today (prevents duplicate alerts)
      const biasSentKey = `bias-sent:${dateStr}`;
      await setTrade(env, biasSentKey, {
        type: pendingBias.type,
        symbol: pendingBias.symbol,
        sentAt: new Date().toISOString(),
        source: 'cron-release',
        lastUpdate: Date.now()  // Required for cleanup
      });
      console.log(`Tracked ${pendingBias.type} as sent for today (cron release)`);

      // Clear the pending bias
      await clearPendingBias(env, dateStr);
      console.log('Bias alert released and cleared');

      return;
    }

    // Handle market close cron (5:59 PM EST = 22:59 UTC)
    const isMarketClose = cronType === "59 22 * * 1-5";
    if (!isMarketClose) {
      console.warn(`Unknown cron type: ${cronType}`);
      return;
    }

    console.log(`Market close triggered by cron: ${cronType}`);
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn("No Discord webhook URL configured for market close");
      return;
    }

    // Get today's date in YYYYMMDD format (ET timezone)
    const now = new Date();
    const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dateStr = etDate.toISOString().split('T')[0].replace(/-/g, '');
    const dayOfWeek = etDate.getDay();
    const isFriday = dayOfWeek === 5;

    // Get daily archived trades for today
    const archivedTrades = await getDailyArchives(env, dateStr);
    const dailyStats = calculateDailySummary(archivedTrades);

    // Send daily summary to Discord (skip on Friday since weekly summary will be sent)
    if (dailyStats.totalTrades > 0 && !isFriday) {
      const summaryEmbed = {
        title: '📊 End of Day Summary',
        color: 0x00FF00, // Green
        fields: [
          { name: 'Total Trades', value: String(dailyStats.totalTrades), inline: true },
          { name: 'Wins', value: String(dailyStats.wins), inline: true },
          { name: 'Losses', value: String(dailyStats.losses), inline: true },
          { name: 'Total Points', value: dailyStats.totalPoints.toFixed(2), inline: true }
        ],
        footer: { text: `Market Close - ${etDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}` },
        timestamp: new Date().toISOString()
      };

      const summaryPayload = {
        content: '**End of Day Summary** 📈',
        embeds: [summaryEmbed]
      };

      const summaryResult = await sendDiscordMessageWithRetry(webhookUrl, summaryPayload);
      if (!summaryResult.success) {
        console.error('Failed to send daily summary:', summaryResult.error);
      }
    } else {
      console.log('No completed trades today - skipping daily summary');
    }

    // Send daily summary to Telegram if configured (skip on Friday since weekly summary will be sent)
    const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = env.TELEGRAM_CHAT_ID;

    if (telegramBotToken && telegramChatId && dailyStats.totalTrades > 0 && !isFriday) {
      const telegramSummary = [
        '📊 <b>End of Day Summary</b>',
        '═══════════════════════',
        `📅 ${etDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`,
        '',
        `📈 Total Trades: <b>${dailyStats.totalTrades}</b>`,
        `✅ Wins: <b>${dailyStats.wins}</b>`,
        `❌ Losses: <b>${dailyStats.losses}</b>`,
        `💰 Total Points: <b>${dailyStats.totalPoints.toFixed(2)}</b>`
      ].join('\n');

      const telegramSummaryResult = await sendTelegramMessageWithRetry(
        telegramBotToken,
        telegramChatId,
        telegramSummary
      );

      if (!telegramSummaryResult.success) {
        console.error('Failed to send Telegram daily summary:', telegramSummaryResult.error);
      }
    }

    // Check if today is Friday (day 5) - send weekly summary
    if (isFriday) { // Friday
      console.log('Friday market close - calculating weekly summary');

      const weekRange = getWeekDateRange(now);
      const weeklyTrades = await getWeeklyArchives(env, weekRange.start, weekRange.end);
      const weeklyStats = calculateWeeklySummary(weeklyTrades);

      if (weeklyStats.totalTrades > 0) {
        // Send weekly summary to Discord
        const weeklySummaryEmbed = {
          title: '📅 End of Week Summary',
          color: 0x0099FF, // Blue
          fields: [
            { name: 'Total Trades', value: String(weeklyStats.totalTrades), inline: true },
            { name: 'Wins', value: String(weeklyStats.wins), inline: true },
            { name: 'Losses', value: String(weeklyStats.losses), inline: true },
            { name: 'Total Points', value: weeklyStats.totalPoints.toFixed(2), inline: true }
          ],
          footer: {
            text: `Week: ${weekRange.mondayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekRange.fridayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          },
          timestamp: new Date().toISOString()
        };

        const weeklySummaryPayload = {
          content: '**End of Week Summary** 📊',
          embeds: [weeklySummaryEmbed]
        };

        const weeklyResult = await sendDiscordMessageWithRetry(webhookUrl, weeklySummaryPayload);
        if (!weeklyResult.success) {
          console.error('Failed to send weekly summary:', weeklyResult.error);
        }

        // Send weekly summary to Telegram if configured
        if (telegramBotToken && telegramChatId) {
          const telegramWeeklySummary = [
            '📅 <b>End of Week Summary</b>',
            '═══════════════════════',
            `📆 Week: ${weekRange.mondayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekRange.fridayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
            '',
            `📈 Total Trades: <b>${weeklyStats.totalTrades}</b>`,
            `✅ Wins: <b>${weeklyStats.wins}</b>`,
            `❌ Losses: <b>${weeklyStats.losses}</b>`,
            `💰 Total Points: <b>${weeklyStats.totalPoints.toFixed(2)}</b>`
          ].join('\n');

          const telegramWeeklyResult = await sendTelegramMessageWithRetry(
            telegramBotToken,
            telegramChatId,
            telegramWeeklySummary
          );

          if (!telegramWeeklyResult.success) {
            console.error('Failed to send Telegram weekly summary:', telegramWeeklyResult.error);
          }
        }
      } else {
        console.log('No completed trades this week - skipping weekly summary');
      }
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
          { name: 'Entry', value: formatPrice(trade.entry), inline: true },
          { name: 'TP1', value: formatPrice(trade.tp1), inline: true },
          { name: 'TP2', value: formatPrice(trade.tp2), inline: true },
          { name: 'SL', value: formatPrice(trade.sl), inline: true },
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

    // Validate webhook secret for authentication
    const expectedSecret = env.WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.error("WEBHOOK_SECRET not configured in environment");
      return jsonResponse({ status: 'rejected', reason: 'Server configuration error' }, 500);
    }

    if (!payload.secret || payload.secret !== expectedSecret) {
      console.warn("Invalid or missing webhook secret");
      return jsonResponse({ status: 'rejected', reason: 'Unauthorized: Invalid webhook secret' }, 401);
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
        const date = new Date(Number(timestamp));
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
        // Remove comma after day and convert AM/PM to lowercase
        // Original: "Thu, Dec 17, 2025, 9:30 AM"
        // Target: "Thu, Dec 17, 2025 9:30am EST"
        const cleaned = formatted.replace(/,\s+(\d+:\d+)/, ' $1').replace(/\s+(AM|PM)/, (_, p1) => p1.toLowerCase());
        return `${cleaned} EST`;
      } catch (e) {
        return withNA(timestamp);
      }
    };

    const formatDateOnly = (timestamp) => {
      if (!timestamp) return "N/A";
      try {
        const date = new Date(Number(timestamp));
        if (isNaN(date.getTime())) return withNA(timestamp);

        const options = {
          timeZone: 'America/New_York',
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        };

        // Format: "Tue, Dec 17, 2025"
        return new Intl.DateTimeFormat('en-US', options).format(date);
      } catch (e) {
        return withNA(timestamp);
      }
    };

    const typeRaw = scrub(payload.type).toUpperCase();
    const type = typeRaw || "UNKNOWN";
    let symbol = scrub(payload.symbol) || "UNKNOWN";
    let tf = scrub(payload.tf);
    const isEntrySignal = type === "LONG_ENTRY" || type === "SHORT_ENTRY";
    const isBiasSignal = type === "NY_AM_BULLISH" || type === "NY_AM_BEARISH" || type === "BIAS_FLIP_BULLISH" || type === "BIAS_FLIP_BEARISH" || type === "WEEKLY_SUMMARY";
    
    // For non-entry signals, we'll get symbol/tf from the trade later
    // Time: prefer the TradingView-provided time when present for all signal types
    const time = (payload && payload.time) ? formatTime(payload.time) : formatTime(new Date().toISOString());
    const dateOnly = (payload && payload.time) ? formatDateOnly(payload.time) : formatDateOnly(new Date().toISOString());
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

    // Special handling for NY_AM bias alerts (delay until 8:30am ET)
    if (isBiasSignal && (type === 'NY_AM_BULLISH' || type === 'NY_AM_BEARISH')) {
      // Get current ET time
      const nowDate = new Date();
      const etNow = new Date(nowDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const etHour = etNow.getHours();
      const etMinute = etNow.getMinutes();
      const etTimeInMinutes = etHour * 60 + etMinute;
      const releaseTimeInMinutes = 8 * 60 + 30; // 8:30am

      if (etTimeInMinutes < releaseTimeInMinutes) {
        // Before 8:30am ET - queue the bias alert
        const dateStr = etNow.toISOString().split('T')[0].replace(/-/g, '');
        await setPendingBias(env, dateStr, {
          type,
          symbol,
          tf,
          time: payload.time || Date.now(),
          profile: payload.profile,
          receivedAt: Date.now(),
          payload: payload // Store full payload for later
        });

        console.log(`Queued ${type} bias alert for release at 8:30am ET`);
        return new Response(
          JSON.stringify({
            status: 'queued',
            type,
            releaseTime: '8:30am ET',
            message: 'Bias alert queued for morning release'
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // After 8:30am ET - check for duplicate before sending
      console.log(`Processing ${type} bias alert (after 8:30am ET)`);

      // Check if initial bias was already sent today (prevents duplicate alerts)
      const biasSentKey = `bias-sent:${etNow.toISOString().split('T')[0].replace(/-/g, '')}`;
      const existingBiasSent = await getTrade(env, biasSentKey);

      if (existingBiasSent) {
        console.log(`Skipping duplicate ${type} alert - initial bias already sent today at ${existingBiasSent.sentAt}`);
        return new Response(
          JSON.stringify({
            status: 'duplicate',
            type,
            message: 'Initial bias already sent today',
            previouslySentAt: existingBiasSent.sentAt
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log(`Sending ${type} bias alert immediately (after 8:30am ET)`);
    }

    // BIAS_FLIP alerts and post-8:30am NY_AM alerts continue with existing logic...

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

    // Validate trade exists for non-entry signals (but skip bias signals which don't need trades)
    let existingTrade = null;
    if (!isEntrySignal && !isBiasSignal && type !== "UNKNOWN") {
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

    // Handle trade closure (SL, TP2, TP3, or partial TP1/BE)
    const isFullClose = type === "LONG_SL" || type === "SHORT_SL" ||
                        type === "LONG_TP2" || type === "SHORT_TP2" ||
                        type === "LONG_TP3" || type === "SHORT_TP3";
    const isPartialClose = type === "LONG_TP1" || type === "SHORT_TP1";

    if (isFullClose && tradeId) {
      // Get trade data before deleting
      const trade = await getTrade(env, tradeId);
      if (trade) {
        // Calculate points
        const points = calculatePoints(trade.type, trade.entry, price);

        // Determine if win or loss
        // Win: TP1, TP2, TP3, or SL after TP1 (BE stop)
        // Loss: SL without TP1 hit
        const isBEStop = trade.partialClosed;
        const isWin = type.includes('TP') || isBEStop;

        // Archive the trade before deleting
        await archiveTrade(env, tradeId, trade, {
          exitType: type,
          exitPrice: price,
          exitTime: now,
          points: points,
          isWin: isWin
        });
      }

      // Delete active trade
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
      'A++': 0xFF0000, // Red
      'A+++': 0x9C27B0 // Purple (highest tier)
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
          `Entry: ${formatPrice(entry)}`,
          `SL: ${formatPrice(sl)}`,
          `TP1: ${formatPrice(tp1)}`,
          `TP2: ${formatPrice(tp2)}`
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
          `Entry: ${formatPrice(entry)}`,
          `SL: ${formatPrice(sl)}`,
          `TP1: ${formatPrice(tp1)}`,
          `TP2: ${formatPrice(tp2)}`
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
          `Price: ${formatPrice(price)}`,
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
          `Price: ${formatPrice(price)}`,
          "TP2 Smashed! 🔥🔥 💰"
        ].join("\n");
        break;
      case "LONG_TP3":
      case "SHORT_TP3":
        content = [
          "**Trade Update: TP3 HIT**",
          `Trade ID: ${tradeId}`,
          symbolLine,
          `Time: ${time}`,
          `Price: ${formatPrice(price)}`,
          "TP3 DEMOLISHED! 🔥🔥🔥 Maximum profit secured! 💰💰💰"
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
          `Price: ${formatPrice(price)}`,
          slMessage
        ].join("\n");
        break;
      case "NY_AM_BULLISH":
        content = [
          "**NY Opening Bias: BULLISH** 🟢",
          "Good Morning Traders, Initial bias is for Longs during the New York AM Session.",
          "As reactionary traders, our bias may shift based on NYSE open activity.",
          "",
          `📊 Symbol: ${symbol}`,
          `📅 Date: ${dateOnly}`
        ].join("\n");
        console.log(`✅ Sent NY_AM_BULLISH bias alert for ${symbol}`);
        break;
      case "NY_AM_BEARISH":
        content = [
          "**NY Opening Bias: BEARISH** 🔴",
          "Good Morning Traders, Initial bias is for Shorts during the New York AM Session.",
          "As reactionary traders, our bias may shift based on NYSE open activity.",
          "",
          `📊 Symbol: ${symbol}`,
          `📅 Date: ${dateOnly}`
        ].join("\n");
        console.log(`✅ Sent NY_AM_BEARISH bias alert for ${symbol}`);
        break;
      case "BIAS_FLIP_BULLISH":
        content = [
          "**Bias Update: Now BULLISH** 🟢⚡",
          "Expecting a Bullish move now.",
          "",
          `📊 Symbol: ${symbol}`,
          `📅 Date: ${dateOnly}`
        ].join("\n");
        console.log(`✅ Sent BIAS_FLIP_BULLISH alert for ${symbol}`);
        break;
      case "BIAS_FLIP_BEARISH":
        content = [
          "**Bias Update: Now BEARISH** 🔴⚡",
          "Expecting a Bearish move now.",
          "",
          `📊 Symbol: ${symbol}`,
          `📅 Date: ${dateOnly}`
        ].join("\n");
        console.log(`✅ Sent BIAS_FLIP_BEARISH alert for ${symbol}`);
        break;
      case "WEEKLY_SUMMARY":
        content = [
          "**📊 WEEKLY SUMMARY 📈**",
          `Symbol: ${symbol}`,
          `Time: ${time}`,
          "",
          `📊 Total Trades: **${payload.trades}**`,
          `✅ Wins: **${payload.wins}**`,
          `❌ Losses: **${payload.losses}**`,
          `💰 Points Gained: **${payload.pointsGained}**`,
          `📉 Points Lost: **${payload.pointsLost}**`,
          `💵 Net Points: **${payload.netPoints}**`,
          `📈 Win Rate: **${payload.winRate}%**`
        ].join("\n");
        console.log(`✅ Sent WEEKLY_SUMMARY for ${symbol}`);
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
    const discordResult = await sendDiscordMessageWithRetry(webhookUrl, discordPayload);

    if (!discordResult.success) {
      console.error("Failed to send Discord message after all retries:", discordResult.error);
    }

    // Send to Telegram (don't fail if Telegram is not configured)
    const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = env.TELEGRAM_CHAT_ID;

    let telegramResult = { success: false, error: 'Not configured' };
    if (telegramBotToken && telegramChatId) {
      // Build Telegram-specific payload with BE stop flag for SL messages
      const telegramPayload = {
        ...payload,
        symbol,
        tf,
        entry,
        sl,
        tp1,
        tp2,
        price,
        tradeId,
        time,
        dateOnly,
        grade,
        isBEStop: existingTrade?.partialClosed || false
      };

      const telegramMessage = formatTelegramMessage(type, telegramPayload);

      // For entry signals, send as photo with caption
      if (type === 'LONG_ENTRY') {
        telegramResult = await sendTelegramPhotoWithRetry(
          telegramBotToken,
          telegramChatId,
          BUY_IMAGE_URL,
          telegramMessage,
          'HTML'
        );
      } else if (type === 'SHORT_ENTRY') {
        telegramResult = await sendTelegramPhotoWithRetry(
          telegramBotToken,
          telegramChatId,
          SELL_IMAGE_URL,
          telegramMessage,
          'HTML'
        );
      } else {
        // For all other signals (exits, bias), send as text message
        telegramResult = await sendTelegramMessageWithRetry(
          telegramBotToken,
          telegramChatId,
          telegramMessage
        );
      }

      if (!telegramResult.success) {
        console.error("Failed to send Telegram message after all retries:", telegramResult.error);
      }
    }

    // Return error only if Discord failed (Telegram is optional)
    if (!discordResult.success) {
      return new Response(
        JSON.stringify({
          status: "error",
          reason: "Failed to send Discord message after retries",
          discord: discordResult.error,
          telegram: telegramResult.error
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // Track successful initial bias alert to prevent duplicates
    if (type === 'NY_AM_BULLISH' || type === 'NY_AM_BEARISH') {
      const nowForTracking = new Date();
      const etDateForTracking = new Date(nowForTracking.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const biasSentKey = `bias-sent:${etDateForTracking.toISOString().split('T')[0].replace(/-/g, '')}`;
      await setTrade(env, biasSentKey, {
        type,
        symbol,
        sentAt: nowForTracking.toISOString(),
        source: 'immediate',
        lastUpdate: nowForTracking.getTime()  // Required for cleanup
      });
      console.log(`Tracked ${type} as sent for today (immediate send)`);
    }

    // Success response with confirmation
    const finalActiveTrades = await getActiveTrades(env);
    const successMessage = telegramResult.success
      ? "Alert sent to Discord and Telegram"
      : "Alert sent to Discord (Telegram not configured or failed)";

    return new Response(
      JSON.stringify({
        status: "success",
        type,
        tradeId,
        activeTradesCount: Object.keys(finalActiveTrades).length,
        message: successMessage,
        discord: discordResult.success,
        telegram: telegramResult.success
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};
