export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

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

    const type   = payload.type   || "UNKNOWN";
    const symbol = payload.symbol || "UNKNOWN";
    const tf     = payload.tf     || "";
    const time   = payload.time   || "";
    const entry  = payload.entry  || "";
    const sl     = payload.sl     || "";
    const tp1    = payload.tp1    || "";
    const tp2    = payload.tp2    || "";
    const price  = payload.price  || "";

    let content = "";

    if (type === "LONG_ENTRY") {
      content = [
        "LONG ENTRY",
        `${symbol} ${tf}`,
        `Time: ${time}`,
        `Entry: ${entry}`,
        `SL: ${sl}`,
        `TP1: ${tp1}`,
        `TP2: ${tp2}`
      ].join("\n");
    } else if (type === "LONG_BE") {
      content = [
        "BE HIT",
        `${symbol} ${tf}`,
        `Time: ${time}`,
        `Price: ${price}`,
        "SL moved to entry. Partials secured."
      ].join("\n");
    } else if (type === "LONG_TP1") {
      content = [
        "TP1 HIT",
        `${symbol} ${tf}`,
        `Time: ${time}`,
        `Price: ${price}`,
        "Closed 75 percent. 25 percent runner to TP2."
      ].join("\n");
    } else if (type === "LONG_TP2") {
      content = [
        "TP2 HIT",
        `${symbol} ${tf}`,
        `Time: ${time}`,
        `Price: ${price}`,
        "Trade fully closed."
      ].join("\n");
    } else if (type === "LONG_SL") {
      content = [
        "SL HIT",
        `${symbol} ${tf}`,
        `Time: ${time}`,
        `Price: ${price}`,
        "Trade invalidated."
      ].join("\n");
    } else {
      content = [
        "UNKNOWN ALERT TYPE",
        JSON.stringify(payload)
      ].join("\n");
    }

    const discordBody = JSON.stringify({ content });

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
