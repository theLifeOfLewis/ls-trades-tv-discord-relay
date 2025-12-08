# Cloudflare Worker Setup for 4pm EST Market Close Alert

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed (`npm install -g wrangler`)

## Setup Instructions

### 1. Create `wrangler.toml` in project root

Create a file named `wrangler.toml` in the root directory (not in src/) with this content:

```toml
name = "ls-trades-tv-discord-relay"
main = "src/worker.js"
compatibility_date = "2024-01-01"

# Cron triggers for 4pm EST market close check
# 4pm EST = 9pm UTC (standard time) or 8pm UTC (daylight saving time)
# Running both to ensure coverage during DST transitions
[triggers]
crons = ["0 20 * * *", "0 21 * * *"]
```

### 2. Deploy the Worker

```bash
# Login to Cloudflare
wrangler login

# Set your Discord webhook as a secret
wrangler secret put DISCORD_WEBHOOK_URL
# Paste your Discord webhook URL when prompted

# Deploy the worker
wrangler deploy
```

### 3. How It Works

**Webhook Handler (POST requests):**
- Receives alerts from TradingView
- Validates trading hours (9:30 AM - 12:00 PM EST for entries)
- Tracks active trades with unique IDs
- Rejects new entry signals if a trade is already active
- Removes trades from tracking when invalidated (SL hit or TP2 hit)
- Sends formatted messages to Discord

**Cron Handler (Scheduled):**
- Runs at 4pm EST every trading day
- Checks if there are any active trades
- Sends "Hard Stop - Market Close 🔔" message for each active trade
- Does NOT invalidate trades (only notifies)

### 4. Important Notes

**Trade State Management:**
- Trade state is stored in-memory and resets when the worker restarts
- For production with guaranteed persistence, consider using:
  - Cloudflare Durable Objects
  - Cloudflare KV storage
  - External database

**Time Zone Handling:**
- Worker handles EST timezone for market close
- Cron runs at both 8pm and 9pm UTC to cover DST changes
- Entry signals are validated against 9:30 AM - 12:00 PM EST

**Single Active Trade Enforcement:**
- Worker rejects entry signals if `activeTrades.size() > 0`
- Pine script prevents signals when `activeTrades.size() > 0`
- Double protection ensures only one active trade at a time

### 5. Testing

To test the cron trigger manually:

```bash
# This will run the scheduled handler locally
wrangler dev --test-scheduled
```

To test webhook handling:

```bash
# Start local development
wrangler dev

# In another terminal, send a test request
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_ENTRY",
    "symbol": "NQ",
    "tf": "5",
    "time": "2024-01-08T14:30:00.000Z",
    "entry": "17000.00",
    "sl": "16950.00",
    "tp1": "17050.00",
    "tp2": "17100.00",
    "tradeId": "1"
  }'
```

### 6. Monitoring

View worker logs:

```bash
wrangler tail
```

Check cron trigger execution in Cloudflare Dashboard:
1. Go to Workers & Pages
2. Select your worker
3. Click "Triggers" tab
4. View "Cron Triggers" section

### 7. Production Considerations

For a production system, consider:

1. **Persistent Storage**: Use Durable Objects or KV for trade state
2. **Logging**: Add structured logging for debugging
3. **Error Handling**: Implement retry logic for Discord webhook failures
4. **Rate Limiting**: Add rate limiting to prevent abuse
5. **Authentication**: Add webhook signature validation from TradingView
6. **Market Calendar**: Skip cron on weekends/holidays using a market calendar API

## Trade State Flow

1. **Entry Signal** → Creates trade in `activeTrades` Map
2. **BE/TP1/TP2 Alerts** → Updates trade state, keeps in Map
3. **SL or TP2** → Removes trade from Map (trade closed)
4. **4pm Cron** → Checks Map, sends alerts for active trades
5. **New Entry** → Rejected if Map has any trades

## Troubleshooting

**Alerts not sending:**
- Check `wrangler tail` for errors
- Verify DISCORD_WEBHOOK_URL secret is set
- Confirm TradingView alert is hitting the worker URL

**4pm message not sending:**
- Check cron is configured in wrangler.toml
- Verify worker is deployed (not just in dev mode)
- Check if there were active trades at 4pm EST

**Multiple trades being accepted:**
- Verify worker is deployed with latest code
- Check Pine script has `hasActiveTrade` check
- Review worker logs for trade state
