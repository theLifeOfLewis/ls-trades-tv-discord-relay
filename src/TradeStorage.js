// Durable Object for persistent trade storage
export class TradeStorage {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    try {
      switch (url.pathname) {
        case '/get':
          return await this.handleGet(request);
        case '/set':
          return await this.handleSet(request);
        case '/delete':
          return await this.handleDelete(request);
        case '/clear':
          return await this.handleClear(request);
        case '/cleanup':
          return await this.handleCleanup(request);
        case '/list':
          return await this.handleList(request);
        case '/check-duplicate':
          return await this.handleCheckDuplicate(request);
        case '/create-if-none-active':
          return await this.handleCreateIfNoneActive(request);
        case '/set-pending-bias':
          return await this.handleSetPendingBias(request);
        case '/get-pending-bias':
          return await this.handleGetPendingBias(request);
        case '/clear-pending-bias':
          return await this.handleClearPendingBias(request);
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  async handleGet(request) {
    const { key } = await request.json();
    const value = await this.state.storage.get(key);
    return new Response(
      JSON.stringify({ value }), 
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleSet(request) {
    const { key, value } = await request.json();
    await this.state.storage.put(key, value);
    return new Response(
      JSON.stringify({ success: true }), 
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleDelete(request) {
    const { key } = await request.json();
    await this.state.storage.delete(key);
    return new Response(
      JSON.stringify({ success: true }), 
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleClear(request) {
    await this.state.storage.deleteAll();
    return new Response(
      JSON.stringify({ success: true }), 
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleCleanup(request) {
    // Remove trades older than 24 hours, archives older than 30 days, and signals older than 10 seconds
    const now = Date.now();
    const tradeMaxAge = 24 * 60 * 60 * 1000; // 24 hours
    const archiveMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    const signalMaxAge = 10 * 1000; // 10 seconds

    // Clean up old trades
    const allTrades = await this.state.storage.list({ prefix: 'trade:' });
    let cleanedTradeCount = 0;

    for (const [key, trade] of allTrades) {
      if (trade.lastUpdate && (now - trade.lastUpdate > tradeMaxAge)) {
        await this.state.storage.delete(key);
        cleanedTradeCount++;
      }
    }

    // Clean up old archives (older than 30 days)
    const allArchives = await this.state.storage.list({ prefix: 'archive:' });
    let cleanedArchiveCount = 0;

    for (const [key, archive] of allArchives) {
      if (archive.archivedAt && (now - archive.archivedAt > archiveMaxAge)) {
        await this.state.storage.delete(key);
        cleanedArchiveCount++;
      }
    }

    // Clean up old signal duplicate markers
    const allSignals = await this.state.storage.list({ prefix: 'signal:' });
    let cleanedSignalCount = 0;

    for (const [key, timestamp] of allSignals) {
      if (now - timestamp > signalMaxAge) {
        await this.state.storage.delete(key);
        cleanedSignalCount++;
      }
    }

    // Clean up old pending biases (older than 24 hours)
    const biasMaxAge = 24 * 60 * 60 * 1000; // 24 hours
    const allBiases = await this.state.storage.list({ prefix: 'bias:' });
    let cleanedBiasCount = 0;

    for (const [key, biasData] of allBiases) {
      if (biasData.receivedAt && (now - biasData.receivedAt > biasMaxAge)) {
        await this.state.storage.delete(key);
        cleanedBiasCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        cleanedTradeCount,
        cleanedArchiveCount,
        cleanedSignalCount,
        cleanedBiasCount
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleList(request) {
    const { prefix } = await request.json().catch(() => ({}));
    const allEntries = await this.state.storage.list({ prefix: prefix || '' });
    const entries = {};

    for (const [key, value] of allEntries) {
      entries[key] = value;
    }

    return new Response(
      JSON.stringify({ entries }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleCheckDuplicate(request) {
    const { signalKey, timestamp } = await request.json();
    const WINDOW_MS = 5000; // 5 second duplicate window

    // Atomic check-and-set for duplicate detection
    const storageKey = `signal:${signalKey}`;
    const existing = await this.state.storage.get(storageKey);

    if (existing && (timestamp - existing < WINDOW_MS)) {
      return new Response(
        JSON.stringify({ isDuplicate: true, lastSeen: existing }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Store with auto-expiry using alarm (Durable Objects don't support TTL directly)
    // Instead, we'll rely on cleanup to remove old signals
    await this.state.storage.put(storageKey, timestamp);

    return new Response(
      JSON.stringify({ isDuplicate: false }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleCreateIfNoneActive(request) {
    const { key, trade } = await request.json();

    // Atomic check: Get all trades with prefix 'trade:'
    const allTrades = await this.state.storage.list({ prefix: 'trade:' });
    const activeTrades = [];

    for (const [k, v] of allTrades) {
      // Only consider trades that aren't marked as closed
      if (!v.closed) {
        activeTrades.push({ key: k, trade: v });
      }
    }

    if (activeTrades.length > 0) {
      const firstActive = activeTrades[0];
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'active_trade_exists',
          activeTrade: {
            key: firstActive.key.replace('trade:', ''),
            type: firstActive.trade.type,
            symbol: firstActive.trade.symbol,
            tf: firstActive.trade.tf
          }
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // No active trade exists, create atomically
    await this.state.storage.put(key, trade);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleSetPendingBias(request) {
    const { dateStr, biasData } = await request.json();
    const key = `bias:${dateStr}`;
    await this.state.storage.put(key, biasData);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleGetPendingBias(request) {
    const { dateStr } = await request.json();
    const key = `bias:${dateStr}`;
    const value = await this.state.storage.get(key);
    return new Response(
      JSON.stringify({ value }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  async handleClearPendingBias(request) {
    const { dateStr } = await request.json();
    const key = `bias:${dateStr}`;
    await this.state.storage.delete(key);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}
