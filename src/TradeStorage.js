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
    // Remove trades older than 24 hours
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    const allTrades = await this.state.storage.list({ prefix: 'trade:' });
    let cleanedCount = 0;
    
    for (const [key, trade] of allTrades) {
      if (trade.lastUpdate && (now - trade.lastUpdate > maxAge)) {
        await this.state.storage.delete(key);
        cleanedCount++;
      }
    }
    
    return new Response(
      JSON.stringify({ success: true, cleanedCount }), 
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
}
