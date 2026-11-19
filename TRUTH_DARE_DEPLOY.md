# Truth or Dare deployment (isolated service)

This service is separate from the existing calling service. It binds to localhost port 3012 and must be exposed through Cloudflare Tunnel, not directly to the public internet.

## Prerequisites
- Node.js 20+
- Existing backend dependencies installed (includes `ws`)
- `BOT_TOKEN` in `/root/.stranger-bot.env` (used only to verify Telegram WebApp initData)
- Cloudflared already installed and a Cloudflare Tunnel configured

## Install on the VPS
Clone the feature branch into a **separate directory** so the existing calling backend checkout is never changed:

```bash
git clone --branch truth-dare-complete-flow https://github.com/taklakshya754-kalal/Meetstrangers4u-miniapp-v2.git /opt/meetstrangers4u-truth-dare/repo
cd /opt/meetstrangers4u-truth-dare/repo/backend
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
curl -fsS http://127.0.0.1:3012/health
```

These steps only start the isolated game service; they do not restart or modify the call service.

## Cloudflare Tunnel
In the Cloudflare Tunnel dashboard, add a public hostname:
- Hostname: `truth-dare.lxreward.xyz`
- Service: `http://127.0.0.1:3012`

The service handles both `/health` HTTP and `/ws` WebSocket paths. Use the tunnel's WebSocket support and do not expose port 3012 directly.

## Verify
```bash
journalctl -u truth-dare.service -n 80 --no-pager
curl -fsS http://127.0.0.1:3012/health
```

## Current limitations
- Match queues and rooms are memory-only: restarting the service clears them.
- Branch code now includes synchronized bottle spin, server-selected mode prompts, task completion, verifier voting, game-only Score, winner event, chat, and opt-in audio WebRTC signaling.
- Voice uses public STUN only; without a TURN relay, some restrictive networks may fail to establish peer audio.
- Rooms and scores are in memory and are cleared on service restart.
- The branch has not yet been deployed to the public Mini App or tested with two real Telegram users; do not treat it as fully production-ready until that end-to-end test is done.
