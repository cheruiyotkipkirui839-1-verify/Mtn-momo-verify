# MoMo-style Demo

This is an independent demo interface, not an official MTN service.

## Features
- Responsive blue/yellow demo styling inspired by the provided layout.
- Phone-number test field reveals a simulated five-digit interaction after 9 digits.
- Demo digits are cleared in the browser and are never sent to the server.
- A non-sensitive free-text demo message can be sent to Telegram.
- Telegram has Approve Demo and Decline Demo inline buttons.
- Approval advances to a four-digit demo-code screen; decline lets the user submit a new message.
- The four-digit demo code remains in the browser and is never sent to Telegram.

## Local run
1. Install Node.js.
2. Run `npm install`.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your environment (or create `.env` from `.env.example`).
4. Run `npm start`.
5. Open `http://localhost:3000`.

Only one process should use Telegram `getUpdates` polling for this bot. Stop duplicate instances if Telegram reports a conflict.
