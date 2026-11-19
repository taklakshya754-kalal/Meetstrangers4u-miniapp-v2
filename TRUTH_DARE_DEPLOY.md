# Truth or Dare deployment (isolated service)

This service is separate from the existing calling service. It binds to localhost port 3002 and must be exposed through Cloudflare Tunnel, not directly to the public internet.

## Prerequisites
- Node.js 20+
- Existing backend dependencies installed (includes `ws`)
- `BOT_TOKEN` in `/root/.stranger-bot.env` (used only to verify Telegram WebApp initData)
- Cloudflared already installed and a Cloudflare Tunnel configured

## Install on the VPS
From your existing repository folder:

```bash
cd /opt/meetstrangers4u-calling/repo
git fetch origin truth-dare-complete-flow
git checkout truth-dare-complete-flow
git pull origin truth-dare-complete-flow
cd backend
npm install
node --check truth-dare-server.js
```

Install the systemd unit:

```bash
cp truth-dare.service /etc/systemd/system/truth-dare.service
systemctl daemon-reload
systemctl enable truth-dare.service
systemctl start truth-dare.service
systemctl status truth-dare.service --no-pager
curl -fsS http://127.0.0.1:3002/health
```

These steps only start the isolated game service; they do not restart or modify the call service.

## Cloudflare Tunnel
In the Cloudflare Tunnel dashboard, add a public hostname:
- Hostname: `truth-dare.lxreward.xyz`
- Service: `ws://127.0.0.1:3002`

The service handles both `/health` HTTP and `/ws` WebSocket paths. Use the tunnel's WebSocket support and do not expose port 3002 directly.

## Verify
```bash
journalctl -u truth-dare.service -n 80 --no-pager
curl -fsS http://127.0.0.1:3002/health
```

## Current limitations
- Match queues and rooms are memory-only: restarting the service clears them.
- The service currently supports matchmaking, room membership, and readiness only. The full synchronized game turns, Truth/Dare prompt selection, verification voting, Score updates, bottle spin, and winner calculation are not implemented yet.
- Do not advertise this as a fully playable game until those features are added and tested.
