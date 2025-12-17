#!/bin/bash

# Comprehensive test for all critical worker fixes
# Tests full trade lifecycle and edge cases

WORKER_URL="https://ls-trades-tv-discord-relay.lstrades-tv-discord-relay.workers.dev/webhook"

echo "=========================================="
echo "LST Worker Comprehensive Test"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test 1: Create a LONG trade
echo -e "${BLUE}Test 1: Creating LONG_ENTRY trade${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_ENTRY",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T10:30:00Z",
    "entry": "21500.00",
    "sl": "21480.00",
    "tp1": "21520.00",
    "tp2": "21540.00",
    "tradeId": "20001",
    "grade": "A++"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ Trade created successfully${NC}\n"
else
    echo -e "${YELLOW}⚠ Trade creation may have failed (could be existing trade)${NC}\n"
fi

# Test 2: Try to create another LONG trade (should be rejected - one trade at a time)
echo -e "${BLUE}Test 2: Attempting second LONG_ENTRY (should be rejected)${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_ENTRY",
    "symbol": "ES",
    "tf": "15m",
    "time": "2025-12-17T10:35:00Z",
    "entry": "6000.00",
    "sl": "5980.00",
    "tp1": "6020.00",
    "tp2": "6040.00",
    "tradeId": "20002",
    "grade": "A"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q "Active trade already exists"; then
    echo -e "${GREEN}✓ Correctly rejected second entry${NC}\n"
else
    echo -e "${RED}✗ Failed to prevent concurrent trades${NC}\n"
fi

# Test 3: Send LONG_TP1 for the active trade
echo -e "${BLUE}Test 3: Sending LONG_TP1 exit${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_TP1",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T10:45:00Z",
    "tradeId": "20001"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ TP1 processed successfully${NC}\n"
else
    echo -e "${RED}✗ TP1 processing failed${NC}\n"
fi

# Test 4: Try to send SHORT_TP1 for a LONG trade (should be rejected - wrong direction)
echo -e "${BLUE}Test 4: Sending SHORT_TP1 for LONG trade (should be rejected)${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SHORT_TP1",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T10:46:00Z",
    "tradeId": "20001"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q "does not match"; then
    echo -e "${GREEN}✓ Correctly rejected wrong direction${NC}\n"
else
    echo -e "${RED}✗ Failed to validate trade direction${NC}\n"
fi

# Test 5: Send LONG_TP2 to close the trade
echo -e "${BLUE}Test 5: Sending LONG_TP2 to close trade${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_TP2",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T11:00:00Z",
    "tradeId": "20001"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ TP2 processed, trade closed${NC}\n"
else
    echo -e "${RED}✗ TP2 processing failed${NC}\n"
fi

# Test 6: Now create a SHORT trade (should succeed since previous is closed)
echo -e "${BLUE}Test 6: Creating SHORT_ENTRY after previous trade closed${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SHORT_ENTRY",
    "symbol": "ES",
    "tf": "5m",
    "time": "2025-12-17T11:05:00Z",
    "entry": "6050.00",
    "sl": "6070.00",
    "tp1": "6030.00",
    "tp2": "6010.00",
    "tradeId": "20003",
    "grade": "A+"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ SHORT trade created successfully${NC}\n"
else
    echo -e "${RED}✗ SHORT trade creation failed${NC}\n"
fi

# Test 7: Send SHORT_SL to close with stop loss
echo -e "${BLUE}Test 7: Sending SHORT_SL${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SHORT_SL",
    "symbol": "ES",
    "tf": "5m",
    "time": "2025-12-17T11:10:00Z",
    "tradeId": "20003"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ SL processed, trade closed${NC}\n"
else
    echo -e "${RED}✗ SL processing failed${NC}\n"
fi

# Test 8: Test duplicate detection
echo -e "${BLUE}Test 8: Testing duplicate detection (same alert twice)${NC}"
response1=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_ENTRY",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T11:15:00Z",
    "entry": "21510.00",
    "sl": "21490.00",
    "tp1": "21530.00",
    "tp2": "21550.00",
    "tradeId": "20004",
    "grade": "A"
  }')
echo "First alert:"
echo "$response1" | jq '.'

sleep 1

response2=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_ENTRY",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T11:15:00Z",
    "entry": "21510.00",
    "sl": "21490.00",
    "tp1": "21530.00",
    "tp2": "21550.00",
    "tradeId": "20004",
    "grade": "A"
  }')
echo "Duplicate alert:"
echo "$response2" | jq '.'

if echo "$response2" | grep -q "Duplicate signal detected"; then
    echo -e "${GREEN}✓ Duplicate correctly detected${NC}\n"
else
    echo -e "${RED}✗ Duplicate detection failed${NC}\n"
fi

# Test 9: Test bias alert
echo -e "${BLUE}Test 9: Testing bias alert (NY_AM_BULLISH)${NC}"
response=$(curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "NY_AM_BULLISH",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T14:30:00Z",
    "currentPrice": "21515.00"
  }')
echo "$response" | jq '.'

if echo "$response" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓ Bias alert processed${NC}\n"
else
    echo -e "${YELLOW}⚠ Bias alert may require active trade${NC}\n"
fi

echo "=========================================="
echo "Comprehensive test completed!"
echo "=========================================="
