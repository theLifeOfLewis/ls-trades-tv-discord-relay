export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const BUY_IMAGE_URL = "https://github.com/theLifeOfLewis/ls-trades-tv-discord-relay/blob/main/assets/buy.png?raw=1";
    const SELL_IMAGE_URL = "https://github.com/theLifeOfLewis/ls-trades-tv-discord-relay/blob/main/assets/sell.png?raw=1";

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response("Invalid JSON", { status: 400 });
    }

    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      return new Response("Missing Discord webhook", { status: 500 });
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

    const typeRaw = scrub(payload.type).toUpperCase();
    const type = typeRaw || "UNKNOWN";
    const symbol = scrub(payload.symbol) || "UNKNOWN";
    const tf = scrub(payload.tf);
    const symbolLine = [symbol, tf].filter(Boolean).join(" ") || symbol;
    const time = withNA(payload.time);
    const entry = withNA(payload.entry);
    const sl = withNA(payload.sl);
    const tp1 = withNA(payload.tp1);
    const tp2 = withNA(payload.tp2);
    const price = withNA(payload.price);

    let content = "";
    let embeds = [];

    switch (type) {
      case "LONG_ENTRY":
        content = [
          "LONG ENTRY",
          symbolLine,
          `Time: ${time}`,
          `Entry: ${entry}`,
          `SL: ${sl}`,
          `TP1: ${tp1}`,
          `TP2: ${tp2}`
        ].join("\n");
        embeds = [{ image: { url: BUY_IMAGE_URL } }];
        break;
      case "SHORT_ENTRY":
        content = [
          "SHORT ENTRY",
          symbolLine,
          `Time: ${time}`,
          `Entry: ${entry}`,
          `SL: ${sl}`,
          `TP1: ${tp1}`,
          `TP2: ${tp2}`
        ].join("\n");
        embeds = [{ image: { url: SELL_IMAGE_URL } }];
        break;
      case "LONG_BE":
      case "SHORT_BE":
        content = [
          "BE HIT",
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "SL moved to entry. Partials secured."
        ].join("\n");
        break;
      case "LONG_TP1":
      case "SHORT_TP1":
        content = [
          "TP1 HIT",
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "Closed 75 percent. 25 percent runner to TP2."
        ].join("\n");
        break;
      case "LONG_TP2":
      case "SHORT_TP2":
        content = [
          "TP2 HIT",
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "Trade fully closed."
        ].join("\n");
        break;
      case "LONG_SL":
      case "SHORT_SL":
        content = [
          "SL HIT",
          symbolLine,
          `Time: ${time}`,
          `Price: ${price}`,
          "Trade invalidated."
        ].join("\n");
        break;
      default:
        content = [
          "UNKNOWN ALERT TYPE",
          JSON.stringify(payload)
        ].join("\n");
        break;
    }

    const discordPayload = { content };
    if (embeds.length > 0) {
      discordPayload.embeds = embeds;
    }
    const discordBody = JSON.stringify(discordPayload);

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: discordBody
    });

    if (!resp.ok) {
      return new Response("Discord error", { status: 502 });
    }

    return new Response("ok", { status: 200 });
  }
};
