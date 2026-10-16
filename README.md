# Independent Demo Telegram Approval

Not an MTN MoMo or other financial-service page.

## Deploy
Requires Node.js 18+. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in your hosting service environment, then run `npm install` and `npm start`.

## Flow
- Stage 1: five demo digit boxes; spinner after the fifth digit; Telegram gets a stage notification and Approve/Decline buttons.
- Stage 2: ordinary demo message is sent to Telegram with Approve/Decline buttons.
- Stage 3: four demo digit boxes; spinner after the fourth digit; Telegram gets a stage notification and Approve/Decline buttons.
- Approval advances; decline returns to that stage; stage 3 approval displays success.

PIN/code digits and the contact field are never sent to the server. Only ordinary stage-2 demo text is sent. Run only one server instance per bot token, otherwise Telegram long polling may return a `getUpdates` conflict.
