# MoMo-style demo with Telegram review

Independent demo only; not an official MTN service.

- Full-screen spinner appears after the five-digit simulated entry and while waiting for Telegram review on both review stages.
- Telegram receives a request for the first ordinary message and the second demo-code stage, each with Approve Demo / Decline Demo inline buttons.
- Approval advances to the next stage; decline returns to the same stage for re-entry.
- The five-digit and four-digit demo entries are immediately cleared and never sent to the server or Telegram.
- The first stage's ordinary non-sensitive message is sent to Telegram.

## Render
Build command: `npm install`
Start command: `npm start`
Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Render environment variables.
Only one running instance should poll a bot with `getUpdates`; stop duplicate services if you see a polling conflict.
