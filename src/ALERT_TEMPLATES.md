# TradingView Alert JSON Templates

Update your TradingView alerts with these JSON message bodies. Use the webhook URL for your Cloudflare Worker.

## Alert Setup Instructions

1. In TradingView, create an alert on your indicator
2. Set **Alert Frequency** to "Once Per Bar Close" (or "Once Per Bar" if using fireIntrabar)
3. In the **Message** field, paste the appropriate JSON below
4. Set the **Webhook URL** to your Cloudflare Worker endpoint

---

## LONG_ENTRY Alert

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

---

## SHORT_ENTRY Alert

```json
{
  "type": "SHORT_ENTRY",
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

---

## LONG_SL Alert

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

---

## SHORT_SL Alert

```json
{
  "type": "SHORT_SL",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

---

## LONG_BE Alert

```json
{
  "type": "LONG_BE",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

---

## SHORT_BE Alert

```json
{
  "type": "SHORT_BE",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

---

## LONG_TP1 Alert

```json
{
  "type": "LONG_TP1",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

---

## SHORT_TP1 Alert

```json
{
  "type": "SHORT_TP1",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

---

## LONG_TP2 Alert

```json
{
  "type": "LONG_TP2",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

---

## SHORT_TP2 Alert

```json
{
  "type": "SHORT_TP2",
  "symbol": "{{ticker}}",
  "tf": "{{interval}}",
  "time": "{{time}}",
  "price": "{{close}}",
  "tradeId": "{{plot_5}}"
}
```

---

## Plot Reference

The plot numbers correspond to:
- `{{plot_0}}` = Alert Entry (safeAlertEntry)
- `{{plot_1}}` = Alert SL (safeAlertSL)
- `{{plot_2}}` = Alert TP1 (safeAlertTP1)
- `{{plot_3}}` = Alert TP2 (safeAlertTP2)
- `{{plot_4}}` = Alert TP3 (safeAlertTP3)
- `{{plot_5}}` = Alert Trade ID (safeAlertTradeId)

**Important Notes:**
1. These templates will ONLY send alerts when the plots are active (not NA)
2. Only ONE active trade is allowed at a time - new signals are rejected if a trade is active
3. Alerts only fire during valid trading hours (9:30 AM - 12:00 PM EST for entries)
4. Each trade gets a unique incrementing Trade ID
5. Set alert frequency to "Once Per Bar Close" to avoid duplicate alerts
