# Implementation Summary: Trade ID System & Single Active Trade

## Overview

This implementation adds three major features:
1. **Trade ID Logging** - Each trade gets a unique incrementing ID
2. **4pm EST Market Close Alert** - Sends Discord message for active trades at market close
3. **Single Active Trade Enforcement** - Prevents new signals when a trade is active

---

## Changes Made

### 1. Worker.js Changes

**Added:**
- In-memory trade tracking using `Map<tradeId, tradeData>`
- Trade ID extraction from payload (`tradeId` field)
- Active trade check that rejects new entry signals
- Trade registration on entry signals
- Trade cleanup on SL/TP2 (full close)
- Trade ID included in all Discord messages
- `scheduled()` handler for 4pm EST cron trigger
- Helper function `sendDiscordMessage()` for reusability

**Behavior:**
- Entry signals check if `activeTrades.size() > 0` and reject if true
- Returns JSON response: `{"status": "rejected", "reason": "Active trade already exists"}`
- Trade is added to Map on entry with all position details
- Trade is removed from Map when SL or TP2 hits (trade invalidated)
- At 4pm EST, checks for active trades and sends "Hard Stop - Market Close 🔔" message

### 2. Pine Script Changes

**Added:**
- New plot: `safeAlertTradeId` (plot_5) - outputs trade ID when alert fires
- Enhanced alert conditions with plot validation using `not na(safeAlert...)`
- Single active trade enforcement already existed via `hasActiveTrade` check

**Updated Alert Conditions:**
```pine
// Before
alertcondition(isLongSignal, "LONG_ENTRY", "LONG_ENTRY")

// After
bool hasValidLongEntry = isLongSignal and activeTrades.size() > 0 and not na(safeAlertEntry)
alertcondition(hasValidLongEntry, "LONG_ENTRY", "LONG_ENTRY")
```

**Benefits:**
- Alerts only fire when plots are active (valid signal state)
- Prevents stale/duplicate alerts
- Trade ID is available in TradingView alert placeholders as `{{plot_5}}`

### 3. New Files Created

**ALERT_TEMPLATES.md**
- Complete JSON templates for all 10 alert types
- Placeholder mapping documentation
- Setup instructions for TradingView

**CLOUDFLARE_SETUP.md**
- Wrangler.toml configuration
- Deployment instructions
- Cron trigger explanation
- Testing procedures
- Production considerations

---

## JSON Alert Templates

### Entry Signals (include tradeId)

```json
{
  "type": "LONG_ENTRY",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "entry": "{{plot_0}}",
  "sl": "{{plot_1}}",
  "tp1": "{{plot_2}}",
  "tp2": "{{plot_3}}",
  "tradeId": "{{plot_5}}"
}
```

### Exit Signals (include tradeId and price)

```json
{
  "type": "LONG_SL",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

**All Templates Available In:** `ALERT_TEMPLATES.md`

---

## Cloudflare Setup Required

### 1. Create `wrangler.toml` in project root:

```toml
name = "ls-trades-tv-discord-relay"
main = "src/worker.js"
compatibility_date = "2024-01-01"

[triggers]
crons = ["0 20 * * *", "0 21 * * *"]
```

### 2. Deploy:

```bash
wrangler login
wrangler secret put DISCORD_WEBHOOK_URL
wrangler deploy
```

**Detailed Instructions In:** `CLOUDFLARE_SETUP.md`

---

## How It Works

### Trade Lifecycle

1. **Signal Fires** (9:30 AM - 12:00 PM EST)
   - Pine script checks `hasActiveTrade` → if false, allows signal
   - Alert fires with trade ID (e.g., `tradeId: 1`)
   - Worker receives entry, checks `activeTrades.size()` → if 0, accepts
   - Worker adds trade to Map: `activeTrades.set("1", {...})`
   - Discord message sent with Trade ID

2. **Trade Updates** (BE, TP1, TP2)
   - Alerts include same trade ID
   - Worker receives updates
   - Trade remains in Map
   - Discord updates sent

3. **Trade Closes** (SL or TP2)
   - Alert fires with trade ID
   - Worker detects close event
   - Trade removed from Map: `activeTrades.delete("1")`
   - Discord invalidation/completion message sent

4. **Market Close** (4:00 PM EST daily)
   - Cron trigger fires
   - Worker checks `activeTrades.size()`
   - If > 0, sends "Hard Stop - Market Close 🔔" for each active trade
   - Does NOT remove trades (just notification)

5. **New Signal Attempt**
   - If Map has trades → Worker rejects with 200 status
   - Pine script won't generate signal if `activeTrades.size() > 0`
   - Double protection ensures single active trade

### Time Filters

**Entry Signals:**
- Must be within 9:30 AM - 12:00 PM EST
- Validated in worker using `isWithinTradingHours()`

**Market Close:**
- Cron runs at 8pm UTC (DST) and 9pm UTC (standard time)
- Covers EST 4pm in both timezone scenarios

---

## Plot Number Reference

| Plot | Variable | Description |
|------|----------|-------------|
| plot_0 | safeAlertEntry | Entry price |
| plot_1 | safeAlertSL | Stop loss price |
| plot_2 | safeAlertTP1 | First target (BE level) |
| plot_3 | safeAlertTP2 | Second target |
| plot_4 | safeAlertTP3 | Third target |
| plot_5 | safeAlertTradeId | Unique trade ID |

---

## Key Features

### ✅ Trade ID System
- Increments with each new trade: 1, 2, 3...
- Resets when worker restarts (in-memory storage)
- Included in all Discord messages
- Trackable via TradingView plot

### ✅ 4pm Market Close Alert
- Automatic cron-based notification
- Runs daily at 4pm EST (8pm/9pm UTC)
- Only sends if active trades exist
- Includes trade details

### ✅ Single Active Trade Enforcement
- **Pine Script Level:** Checks `hasActiveTrade` before signal
- **Worker Level:** Rejects if `activeTrades.size() > 0`
- **Alert Level:** Only fires when plots are active (not NA)
- Triple protection prevents multiple concurrent trades

### ✅ Alert Plot Enforcement
- Alerts only fire when corresponding plots have values
- Prevents stale alerts from old signals
- Ensures data integrity in webhook payloads

---

## Testing Checklist

- [ ] Deploy worker with cron triggers
- [ ] Update all 10 TradingView alerts with new JSON templates
- [ ] Test entry signal acceptance (no active trade)
- [ ] Test entry signal rejection (with active trade)
- [ ] Test SL invalidation removes trade from Map
- [ ] Test TP2 completion removes trade from Map
- [ ] Verify 4pm cron sends message for active trade
- [ ] Verify 4pm cron doesn't send when no active trades
- [ ] Check trade IDs increment correctly
- [ ] Verify Discord messages include trade ID

---

## Production Recommendations

For production use, consider upgrading from in-memory storage:

1. **Cloudflare Durable Objects** - Persistent state with strong consistency
2. **Cloudflare KV** - Simple key-value storage (eventual consistency)
3. **External Database** - PostgreSQL, MongoDB, etc.

Benefits:
- Trade state survives worker restarts
- Better audit trail
- Historical trade tracking
- Multi-region resilience

---

## Files Modified/Created

**Modified:**
- `/src/worker.js` - Trade tracking, cron handler, validation
- `/Users/lewisselby/Documents/XAU/lst.pine` - Trade ID plot, enhanced alerts

**Created:**
- `/src/ALERT_TEMPLATES.md` - TradingView JSON templates
- `/src/CLOUDFLARE_SETUP.md` - Deployment guide
- `/src/IMPLEMENTATION_SUMMARY.md` - This file

**Required (not in workspace):**
- `/wrangler.toml` - Cloudflare Worker configuration (create in project root)

---

## Next Steps

1. Create `wrangler.toml` in project root (see CLOUDFLARE_SETUP.md)
2. Deploy worker: `wrangler deploy`
3. Update TradingView alerts with new JSON (see ALERT_TEMPLATES.md)
4. Test entry signal with no active trade (should accept)
5. Test second entry signal (should reject)
6. Test trade invalidation (SL/TP2)
7. Wait for 4pm EST to verify cron trigger
8. Monitor with `wrangler tail`

---

## Support & Troubleshooting

See `CLOUDFLARE_SETUP.md` for detailed troubleshooting guide.

Common issues:
- **Cron not firing**: Verify wrangler.toml exists and worker is deployed
- **Multiple trades**: Check both Pine script and worker logs
- **Missing trade ID**: Verify `{{plot_5}}` in TradingView alert
- **Wrong time zone**: Cron uses UTC, converted to EST in logic
