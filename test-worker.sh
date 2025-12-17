#!/bin/bash

# Test script for LST Worker
# Tests all critical functionality after deployment

WORKER_URL="https://ls-trades-tv-discord-relay.lstrades-tv-discord-relay.workers.dev"
WEBHOOK_PATH="/webhook"

echo "======================================"
echo "LST Worker Test Suite"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to run test
run_test() {
    local test_name="$1"
    local expected_status="$2"
    local response="$3"

    TESTS_RUN=$((TESTS_RUN + 1))

    echo -e "${YELLOW}Test $TESTS_RUN: $test_name${NC}"

    # Extract status code from response (last line)
    actual_status=$(echo "$response" | tail -n 1)

    if [ "$actual_status" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASSED${NC} (HTTP $actual_status)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗ FAILED${NC} (Expected: $expected_status, Got: $actual_status)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi

    # Show response body (all but last line)
    echo "Response:"
    echo "$response" | sed '$d' | jq '.' 2>/dev/null || echo "$response" | sed '$d'
    echo ""
}

# Test 1: Health Check (POST to webhook endpoint)
echo "Running Test 1: Health Check"
response=$(curl -s -w "\n%{http_code}" -X GET "$WORKER_URL/")
run_test "Health Check (expects rejection)" "405" "$response"

# Test 2: Valid LONG_ENTRY with Grade A++
echo "Running Test 2: Valid LONG_ENTRY with Grade A++"
response=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL$WEBHOOK_PATH" \
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
    "tradeId": "10001",
    "grade": "A++"
  }')
run_test "Valid LONG_ENTRY with Grade" "200" "$response"

# Test 3: Schema Validation - Missing Required Field
echo "Running Test 3: Schema Validation (Missing 'symbol')"
response=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL$WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "LONG_ENTRY",
    "tf": "5m",
    "time": "2025-12-17T10:30:00Z",
    "entry": "21500.00",
    "sl": "21480.00",
    "tp1": "21520.00",
    "tp2": "21540.00",
    "tradeId": "10002"
  }')
run_test "Schema Validation - Missing Field" "400" "$response"

# Test 4: Schema Validation - Invalid Type
echo "Running Test 4: Schema Validation (Invalid Type)"
response=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL$WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "INVALID_TYPE",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T10:30:00Z",
    "entry": "21500.00",
    "sl": "21480.00",
    "tp1": "21520.00",
    "tp2": "21540.00",
    "tradeId": "10003"
  }')
run_test "Schema Validation - Invalid Type" "400" "$response"

# Test 5: Duplicate Detection
echo "Running Test 5: Duplicate Detection (Same alert twice)"
# First alert
response1=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL$WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SHORT_ENTRY",
    "symbol": "ES",
    "tf": "15m",
    "time": "2025-12-17T10:35:00Z",
    "entry": "6050.00",
    "sl": "6070.00",
    "tp1": "6030.00",
    "tp2": "6010.00",
    "tradeId": "10004",
    "grade": "A"
  }')
echo "First alert sent"

# Immediate duplicate (within 5 seconds)
sleep 1
response2=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL$WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SHORT_ENTRY",
    "symbol": "ES",
    "tf": "15m",
    "time": "2025-12-17T10:35:00Z",
    "entry": "6050.00",
    "sl": "6070.00",
    "tp1": "6030.00",
    "tp2": "6010.00",
    "tradeId": "10004",
    "grade": "A"
  }')
echo "Duplicate alert sent"

# Check if second was rejected
if echo "$response2" | grep -qi "duplicate" || echo "$response2" | grep -q "rejected"; then
    echo -e "${GREEN}✓ PASSED${NC} - Duplicate correctly detected"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}✗ FAILED${NC} - Duplicate not detected"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TESTS_RUN=$((TESTS_RUN + 1))
echo "Response:"
echo "$response2" | sed '$d' | jq '.' 2>/dev/null || echo "$response2" | sed '$d'
echo ""

# Test 6: Bias Alert
echo "Running Test 6: Bias Alert (NY_AM_BULLISH)"
response=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL$WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "NY_AM_BULLISH",
    "symbol": "NQ",
    "tf": "5m",
    "time": "2025-12-17T14:30:00Z",
    "currentPrice": "21505.50"
  }')
run_test "Bias Alert" "200" "$response"

# Test 7: Invalid JSON
echo "Running Test 7: Invalid JSON Payload"
response=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL$WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{invalid json}')
run_test "Invalid JSON" "400" "$response"

# Summary
echo "======================================"
echo "Test Summary"
echo "======================================"
echo -e "Total Tests Run: $TESTS_RUN"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Please review the output above.${NC}"
    exit 1
fi
