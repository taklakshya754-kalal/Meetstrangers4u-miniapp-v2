# MeetStrangers4u Calling Backend

Separate Node.js service for Telegram Mini App authentication, wallet reads, random voice/video matchmaking, WebRTC signaling and server-side coin billing.

## Environment

Load these from a private systemd EnvironmentFile; never commit secrets:

- BOT_TOKEN
- DB_HOST=127.0.0.1
- DB_PORT=5432
- DB_NAME=stranger_bot
- DB_USER=m4_call_api
- DB_PASSWORD
- HOST=127.0.0.1
- PORT=3001
- ALLOWED_ORIGINS=https://meetstrangers4u-miniapp-v2.vercel.app

## Routes

- GET /health
- GET /api/me (requires X-Telegram-Init-Data)
- WebSocket /ws?initData=<Telegram WebApp initData>

## WebSocket messages

Client -> server:
- {"type":"find","callType":"voice"|"video"}
- {"type":"cancel-search"}
- {"type":"media-ready"}
- {"type":"offer","data":{...}}
- {"type":"answer","data":{...}}
- {"type":"ice-candidate","data":{...}}
- {"type":"end-call"}

Server -> client:
- ready, searching, matched, call-connected, wallet-update, minute-billed,
  insufficient-coins, search-timeout, search-cancelled, call-ended, error

## Pricing

Voice: 10 coins connection fee + 5 coins per completed minute.
Video: 20 coins connection fee + 10 coins per completed minute.
No connection fee is charged until both clients report WebRTC media readiness.
Each fee/minute debit is a PostgreSQL transaction that debits both participants or neither.

## Important deployment notes

- This service is separate from the Telegram bot and AdsGram server.
- It must be exposed through HTTPS/WSS using a dedicated hostname and reverse proxy/tunnel.
- WebRTC requires a configured STUN/TURN service for reliable connections across NATs. No TURN credentials are included here.
- Matchmaking queues and live session state are currently in memory; run exactly one backend instance. Restarting the service ends active calls/searches.
- Do not enable calling in the Mini App until frontend WebRTC integration, TURN configuration, and end-to-end tests are complete.
