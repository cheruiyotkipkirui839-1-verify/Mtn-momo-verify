require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "");
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
const requests = new Map();
const TTL = 10 * 60 * 1000;

app.use(express.json({ limit: "10kb" }));
app.use(express.static(__dirname));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/demo-request", async (req, res) => {
  const phone = String(req.body?.phone || "").trim();
  const stage = String(req.body?.stage || "");
  const message = String(req.body?.message || "").trim();
  if (!/^\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter a 9-digit demo phone number." });
  if (!["message_demo", "code_demo"].includes(stage)) return res.status(400).json({ error: "Invalid demo stage." });
  if (stage === "message_demo" && (!message || message.length > 500)) return res.status(400).json({ error: "Enter a non-sensitive message up to 500 characters." });
  if (!BOT_TOKEN || !CHAT_ID) return res.status(503).json({ error: "Telegram is not configured on the server." });

  const reference = crypto.randomBytes(4).toString("hex").toUpperCase();
  const stageLabel = stage === "message_demo" ? "First demo message" : "Second four-digit demo-code stage";
  const record = { reference, phone, stage, status: "pending", createdAt: Date.now() };
  requests.set(reference, record);
  const lines = [
    "🧪 DEMO REVIEW REQUEST", "",
    `Demo phone: +256${phone}`,
    `Stage: ${stageLabel}`,
    ...(stage === "message_demo" ? [`Message: ${message}`] : ["Demo digits: not collected or transmitted"]),
    `Reference: DEMO-${reference}`,
    "Status: PENDING",
    "",
    "Independent demo only. Never enter or send real PINs or OTPs."
  ];
  try {
    const sent = await axios.post(`${API}/sendMessage`, {
      chat_id: CHAT_ID, text: lines.join("\n"),
      reply_markup: { inline_keyboard: [[
        { text: "✅ Approve Demo", callback_data: `approve:${reference}` },
        { text: "❌ Decline Demo", callback_data: `decline:${reference}` }
      ]] }
    }, { timeout: 10000 });
    record.chatId = String(sent.data.result.chat.id);
    record.messageId = sent.data.result.message_id;
    res.json({ ok: true, reference, status: record.status });
  } catch (err) {
    requests.delete(reference);
    console.error("Telegram send failed:", err.response?.data || err.message);
    res.status(502).json({ error: "Telegram could not receive the demo request." });
  }
});

app.get("/api/demo-request/:reference", (req, res) => {
  const record = requests.get(String(req.params.reference).toUpperCase());
  if (!record || Date.now() - record.createdAt > TTL) return res.status(404).json({ error: "Demo request expired or not found." });
  res.json({ reference: record.reference, stage: record.stage, status: record.status });
});

async function handleCallback(callback) {
  const match = /^(approve|decline):([A-F0-9]+)$/.exec(String(callback.data || ""));
  if (!match) return answer(callback.id, "Invalid demo action.");
  const [, action, reference] = match;
  const record = requests.get(reference);
  if (!record) return answer(callback.id, "Demo request expired.");
  if (String(callback.message?.chat?.id) !== CHAT_ID) return answer(callback.id, "Unauthorized chat.");
  if (record.status !== "pending") return answer(callback.id, `Already ${record.status}.`);
  record.status = action === "approve" ? "approved" : "declined";
  await answer(callback.id, `Demo ${record.status}.`);
  const text = [
    "🧪 DEMO REVIEW REQUEST", "",
    `Stage: ${record.stage === "message_demo" ? "First demo message" : "Second demo-code stage"}`,
    `Reference: DEMO-${reference}`,
    `Decision: ${record.status.toUpperCase()}`,
    "",
    "No PINs or OTPs were collected or transmitted."
  ].join("\n");
  try {
    await axios.post(`${API}/editMessageText`, { chat_id: CHAT_ID, message_id: callback.message.message_id, text }, { timeout: 10000 });
  } catch (err) { console.error("Could not update Telegram message:", err.response?.data || err.message); }
}
async function answer(id, text) {
  try { await axios.post(`${API}/answerCallbackQuery`, { callback_query_id: id, text }, { timeout: 10000 }); }
  catch (err) { console.error("Callback answer failed:", err.response?.data || err.message); }
}
async function pollTelegram() {
  let offset = 0;
  console.log("Telegram polling started. Only one instance may poll this bot.");
  while (true) {
    try {
      const result = await axios.get(`${API}/getUpdates`, {
        params: { offset, timeout: 25, allowed_updates: JSON.stringify(["callback_query"]) }, timeout: 35000
      });
      for (const update of result.data.result || []) {
        offset = update.update_id + 1;
        if (update.callback_query) {
          try { await handleCallback(update.callback_query); }
          catch (err) { console.error("Callback handling failed:", err.response?.data || err.message); }
        }
      }
    } catch (err) {
      console.error("Telegram polling error:", err.response?.data || err.message);
      if (String(err.response?.data?.description || "").includes("Conflict")) {
        console.error("Another instance is polling this bot. Stop the duplicate instance."); return;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [key, item] of requests) if (now - item.createdAt > TTL) requests.delete(key);
}, 60000);
app.listen(PORT, () => {
  console.log(`Demo server listening on port ${PORT}`);
  if (BOT_TOKEN && CHAT_ID) pollTelegram();
  else console.warn("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Render environment variables.");
});
