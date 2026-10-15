require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "");
const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";

app.use(express.json({ limit: "10kb" }));
app.use(express.static(__dirname));

const reviews = new Map();
const TTL_MS = 10 * 60 * 1000;

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "demo" }));

app.post("/api/demo-request", async (req, res) => {
  const phone = String(req.body?.phone || "").trim();
  const messageText = String(req.body?.message || "").trim();

  if (!/^\d{9}$/.test(phone)) {
    return res.status(400).json({ error: "Enter a 9-digit demo phone number." });
  }
  if (!messageText || messageText.length > 500) {
    return res.status(400).json({ error: "Enter a demo message up to 500 characters." });
  }
  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(503).json({ error: "Telegram is not configured on the server." });
  }

  const reference = crypto.randomBytes(4).toString("hex").toUpperCase();
  const record = { reference, status: "pending", createdAt: Date.now() };
  reviews.set(reference, record);

  // Message text is ordinary, non-sensitive demo text only.
  const text = [
    "🧪 DEMO REVIEW REQUEST",
    "",
    `Demo phone: +256${phone}`,
    `Message: ${messageText}`,
    `Reference: DEMO-${reference}`,
    "Status: Pending review",
    "",
    "This is an independent demo. Do not submit PINs or OTPs."
  ].join("\n");

  try {
    const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve Demo", callback_data: `approve:${reference}` },
          { text: "❌ Decline Demo", callback_data: `decline:${reference}` }
        ]]
      }
    }, { timeout: 10000 });

    record.chatId = String(response.data.result.chat.id);
    record.messageId = response.data.result.message_id;
    res.json({ ok: true, reference, status: record.status });
  } catch (error) {
    reviews.delete(reference);
    console.error("Telegram send failed:", error.response?.data || error.message);
    res.status(502).json({ error: "Telegram could not receive the demo request." });
  }
});

app.get("/api/demo-request/:reference", (req, res) => {
  const record = reviews.get(String(req.params.reference).toUpperCase());
  if (!record || Date.now() - record.createdAt > TTL_MS) {
    return res.status(404).json({ error: "Demo request expired or not found." });
  }
  res.json({ reference: record.reference, status: record.status });
});

async function answerCallback(id, text) {
  await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
    callback_query_id: id,
    text
  }, { timeout: 10000 });
}

async function handleCallback(callback) {
  const data = String(callback.data || "");
  const match = /^(approve|decline):([A-F0-9]+)$/.exec(data);
  if (!match) return answerCallback(callback.id, "Invalid demo action.");

  const [, action, reference] = match;
  const record = reviews.get(reference);

  if (!record) return answerCallback(callback.id, "Demo request expired.");
  if (String(callback.message?.chat?.id) !== CHAT_ID) {
    return answerCallback(callback.id, "Unauthorized chat.");
  }
  if (record.status !== "pending") {
    return answerCallback(callback.id, `Already ${record.status}.`);
  }

  record.status = action === "approve" ? "approved" : "declined";
  await answerCallback(callback.id, `Demo ${record.status}.`);

  const finalText = [
    "🧪 DEMO REVIEW REQUEST",
    "",
    `Reference: DEMO-${reference}`,
    `Decision: ${record.status.toUpperCase()}`,
    "",
    "No PINs or OTPs were collected."
  ].join("\n");

  try {
    await axios.post(`${TELEGRAM_API}/editMessageText`, {
      chat_id: CHAT_ID,
      message_id: callback.message.message_id,
      text: finalText
    }, { timeout: 10000 });
  } catch (error) {
    console.error("Could not update Telegram message:", error.response?.data || error.message);
  }
}

async function pollTelegram() {
  let offset = 0;
  console.log("Telegram polling starting. Ensure no other process polls this bot.");

  while (true) {
    try {
      const response = await axios.get(`${TELEGRAM_API}/getUpdates`, {
        params: { offset, timeout: 25, allowed_updates: JSON.stringify(["callback_query"]) },
        timeout: 35000
      });
      for (const update of response.data.result || []) {
        offset = update.update_id + 1;
        if (update.callback_query) {
          try { await handleCallback(update.callback_query); }
          catch (error) { console.error("Callback error:", error.response?.data || error.message); }
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.response?.data || error.message);
      if (String(error.response?.data?.description || "").includes("Conflict")) {
        console.error("Another process is polling this bot. Stop the duplicate instance.");
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of reviews) {
    if (now - value.createdAt > TTL_MS) reviews.delete(key);
  }
}, 60_000);

app.listen(PORT, () => {
  console.log(`Demo server listening on port ${PORT}`);
  if (BOT_TOKEN && CHAT_ID) pollTelegram();
  else console.warn("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in hosting environment.");
});
