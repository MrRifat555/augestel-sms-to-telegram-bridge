export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("Augestel Bridge is running!");
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const raw = await request.text();
      const signature = request.headers.get("X-Augestel-Signature");

      if (!signature || !env.PANEL_WEBHOOK_SECRET) {
        return new Response("Missing signature", { status: 401 });
      }

      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.PANEL_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signed = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(raw)
      );

      const hex = Array.from(new Uint8Array(signed))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      if (signature !== `sha256=${hex}`) {
        return new Response("Invalid signature", { status: 401 });
      }

      const event = JSON.parse(raw);

      if (event.event !== "message.received") {
        return new Response("Ignored", { status: 200 });
      }

      await env.SMS_QUEUE.send({ raw });
      return new Response("Queued", { status: 200 });

    } catch (error) {
      console.error(error);
      return new Response("Server error", { status: 500 });
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const event = JSON.parse(message.body.raw);

        const text = [
          "📩 New SMS",
          `Number: ${event.data?.number ?? "Unknown"}`,
          `Message: ${event.data?.message ?? "Unknown"}`
        ].join("\n");

        const response = await fetch(
          `https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: env.TG_CHAT,
              text
            })
          }
        );

        if (!response.ok) throw new Error("Telegram send failed");
        message.ack();

      } catch (error) {
        console.error(error);
        message.retry();
      }
    }
  }
};
