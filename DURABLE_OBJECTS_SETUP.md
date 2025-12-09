# Cloudflare Worker Setup with Durable Objects

This document explains how to set up persistent storage for the Discord relay worker using Cloudflare Durable Objects.

## Files Modified

1. **src/worker.js** - Updated to use Durable Objects instead of in-memory Map
2. **src/TradeStorage.js** - New Durable Object class for persistent storage
3. **wrangler.toml** - Configuration for Durable Objects (see below)

## Changes Made

### In-Memory → Durable Objects Migration

**Before:**
```javascript
let activeTrades = new Map(); // Lost on worker restart
```

**After:**
```javascript
// Persistent storage via Durable Objects
const activeTrades = await getActiveTrades(env);
await setTrade(env, tradeId, tradeData);
await deleteTrade(env, tradeId);
```

## wrangler.toml Configuration

Add this to your `wrangler.toml` file in the worker directory:

```toml
name = "ls-trades-tv-discord-relay"
main = "src/worker.js"
compatibility_date = "2024-12-09"

# Durable Objects bindings
[[durable_objects.bindings]]
name = "TRADE_STORAGE"
class_name = "TradeStorage"
script_name = "ls-trades-tv-discord-relay"

# Durable Object migrations
[[migrations]]
tag = "v1"
new_classes = ["TradeStorage"]

# Cron trigger for market close checks (4:00 PM EST = 9:00 PM UTC in winter)
[triggers]
crons = ["0 21 * * 1-5"]  # 9 PM UTC, Monday-Friday
```

## Deployment Steps

1. **Update wrangler.toml** with the configuration above
2. **Deploy the worker:**
   ```bash
   cd /path/to/ls-trades-tv-discord-relay
   npx wrangler deploy
   ```

3. **Set the webhook URL secret:**
   ```bash
   npx wrangler secret put DISCORD_WEBHOOK_URL
   ```

## Benefits

✅ **Persistent Storage**: Active trades survive worker restarts
✅ **Automatic Cleanup**: Trades older than 24 hours are removed
✅ **Regional Replication**: Durable Objects provide strong consistency
✅ **No Extra Cost**: First 1M requests/month are free

## API Changes

All operations are now asynchronous:

```javascript
// Get all active trades
const trades = await getActiveTrades(env);

// Get specific trade
const trade = await getTrade(env, tradeId);

// Save trade
await setTrade(env, tradeId, tradeData);

// Delete trade
await deleteTrade(env, tradeId);

// Cleanup old trades
await cleanupOldTrades(env);
```

## Testing

1. **Health check:**
   ```bash
   curl https://your-worker.workers.dev/health
   ```

2. **Verify persistence:**
   - Create a trade via alert
   - Check `/health` endpoint
   - Redeploy worker: `npx wrangler deploy`
   - Check `/health` again - trade should still exist

## Cost Considerations

- **Durable Objects**: $0.15 per million requests after free tier
- **Free Tier**: 1 million requests/month
- **Typical Usage**: ~100-500 requests/day = well within free tier

## Migration Notes

- Existing in-memory trades will be lost on first deployment
- New trades will be persisted automatically
- `recentSignals` Map still uses in-memory (by design, only needed for 5 seconds)

## Troubleshooting

**Error: "Durable Object not found"**
- Ensure wrangler.toml has the correct configuration
- Run `npx wrangler deploy` to apply migrations

**Trades not persisting:**
- Check Cloudflare dashboard → Workers → Durable Objects
- Verify TRADE_STORAGE binding is present
- Check worker logs for errors

**Performance issues:**
- Durable Objects are single-threaded per instance
- For high volume, consider sharding by date or symbol
