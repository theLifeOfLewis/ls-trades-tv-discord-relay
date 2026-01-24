#!/bin/bash

# Diagnostic script to check for stale trades in the Cloudflare Worker
# Usage: ./diagnose-trades.sh <worker-url> [webhook-secret]
#
# Examples:
#   ./diagnose-trades.sh https://your-worker.workers.dev
#   ./diagnose-trades.sh https://your-worker.workers.dev your-secret --clear

WORKER_URL="${1:-https://your-worker.workers.dev}"
SECRET="${2:-}"
ACTION="${3:-}"

echo "=== Trade Storage Diagnostic ==="
echo "Worker URL: $WORKER_URL"
echo ""

# Check health endpoint for active trades
echo "--- Active Trades ---"
HEALTH_RESPONSE=$(curl -s "${WORKER_URL}/health")
echo "$HEALTH_RESPONSE" | jq .

echo ""
echo "--- Interpretation ---"
ACTIVE_COUNT=$(echo "$HEALTH_RESPONSE" | jq '.activeTradesCount')

if [ "$ACTIVE_COUNT" = "0" ]; then
    echo "✅ No active trades - storage is clean"
else
    echo "⚠️  Found $ACTIVE_COUNT active trade(s)"
    echo ""

    # Show trade details
    echo "Trade details:"
    echo "$HEALTH_RESPONSE" | jq -r '.activeTrades[] | "  - \(.type) \(.symbol) (ID: \(.id)) started: \(.startTime)"'
    echo ""

    if [ "$ACTION" = "--clear" ] && [ -n "$SECRET" ]; then
        echo "--- Clearing Trades ---"
        CLEAR_RESPONSE=$(curl -s -X POST "${WORKER_URL}/clear-trades" \
            -H "Content-Type: application/json" \
            -d "{\"secret\": \"${SECRET}\"}")
        echo "$CLEAR_RESPONSE" | jq .
    else
        echo "To clear trades immediately, run:"
        echo "  $0 $WORKER_URL YOUR_WEBHOOK_SECRET --clear"
        echo ""
        echo "Or wait for market close (5:59 PM ET) - they'll be auto-closed"
    fi
fi
