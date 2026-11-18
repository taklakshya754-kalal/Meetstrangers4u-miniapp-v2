"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const { URL } = require("url");
const { Pool } = require("pg");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "https://meetstrangers4u-miniapp-v2.vercel.app")
    .split(",").map(v => v.trim()).filter(Boolean)
);
const SEARCH_TIMEOUT_MS = 180000;
const CONNECT_TIMEOUT_MS = 30000;
const AUTH_MAX_AGE_SECONDS = 86400;
const MINI_APP_URL = process.env.MINI_APP_URL || "https://meetstrangers4u-miniapp-v2.vercel.app/";
const PARTNER_INVITE_TTL_MS = 10 * 60 * 1000;
const BOT_CALL_INTERNAL_SECRET = process.env.BOT_CALL_INTERNAL_SECRET || "";
const BOT_PARTNER_INVITE_TTL_MS = 10 * 60 * 1000;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!process.env.DB_PASSWORD) throw new Error("DB_PASSWORD is required");

const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "stranger_bot",
  user: process.env.DB_USER || "m4_call_api",
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Telegram-Init-Data");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, service: "meetstrangers-call", time: new Date().toISOString() }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/turn-credentials") {
    try {
      const initData = req.headers["x-telegram-init-data"] || "";
      const user = validateTelegramInitData(initData);
      const secretFile = process.env.TURN_SECRET_FILE || "/root/meetstrangers-turn-secret";
      const turnSecret = fs.readFileSync(secretFile, "utf8").trim();
      if (!turnSecret) throw new Error("TURN shared secret is empty");

      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      const username = expiresAt + ":" + String(user.id);
      const credential = crypto.createHmac("sha1", turnSecret).update(username).digest("base64");

      sendJson(res, 200, {
        iceServers: [{
          urls: [
            "turn:turn.lxreward.xyz:3478?transport=udp",
            "turn:turn.lxreward.xyz:3478?transport=tcp"
          ],
          username,
          credential
        }],
        expiresAt
      });
    } catch (err) {
      const status = err.statusCode || 503;
      sendJson(res, status, {
        error: status === 401 ? "UNAUTHORIZED" : "TURN_CREDENTIALS_UNAVAILABLE",
        message: status === 401 ? "Please reopen the Mini App from Telegram." : "Calling network credentials are temporarily unavailable."
      });
      if (status !== 401) console.error("GET /api/turn-credentials:", err.message);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    try {
      const initData = req.headers["x-telegram-init-data"] || "";
      const user = validateTelegramInitData(initData);
      const result = await pool.query(
        "SELECT user_id, custom_name, country, coins FROM public.users WHERE user_id = $1 LIMIT 1",
        [String(user.id)]
      );
      if (!result.rowCount) {
        sendJson(res, 404, { error: "USER_NOT_FOUND", message: "Open the Telegram bot first, then try again." });
        return;
      }
      sendJson(res, 200, { user: result.rows[0] });
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, { error: status === 401 ? "UNAUTHORIZED" : "SERVER_ERROR", message: status === 401 ? "Please reopen the Mini App from Telegram." : "Unable to load account." });
      if (status === 500) console.error("GET /api/me:", err.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/partner-invites") {
    let callerId = null;
    try {
      const user = validateTelegramInitData(req.headers["x-telegram-init-data"] || "");
      callerId = String(user.id);
      const body = await readJsonBody(req);
      const targetId = String(body.targetId || "").trim();
      const kind = body.callType === "video" ? "video" :
        body.callType === "voice" ? "voice" : null;

      if (!kind || !/^\d{1,20}$/.test(targetId) || targetId === callerId) {
        sendJson(res, 400, {
          error: "INVALID_INVITE_DETAILS",
          message: "Enter a valid Telegram user ID and call type."
        });
        return;
      }

      if (
        partnerInviteCreatingUsers.has(callerId) ||
        partnerInviteCreatingUsers.has(targetId) ||
        botPartnerInviteCreatingUsers.has(callerId) ||
        botPartnerInviteCreatingUsers.has(targetId) ||
        botPartnerInviteByUser.has(callerId) ||
        botPartnerInviteByUser.has(targetId)
      ) {
        sendJson(res, 409, {
          error: "INVITE_ALREADY_PROCESSING",
          message: "An invitation is already being processed."
        });
        return;
      }

      if (partnerInviteByUser.has(callerId) || partnerInviteByUser.has(targetId)) {
        sendJson(res, 409, {
          error: "INVITE_ALREADY_PENDING",
          message: "One of these users already has a pending invitation."
        });
        return;
      }

      partnerInviteCreatingUsers.add(callerId);
      partnerInviteCreatingUsers.add(targetId);

      try {
        const callerWs = clients.get(callerId);

        if (!callerWs || callerWs.readyState !== WebSocket.OPEN ||
            callerWs.sessionId || callerWs.searching) {
          sendJson(res, 409, {
            error: "CALLER_BUSY",
            message: "You must be available before sending an invitation."
          });
          return;
        }

        const targetWs = clients.get(targetId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN &&
            (targetWs.sessionId || targetWs.searching)) {
          sendJson(res, 409, {
            error: "TARGET_BUSY",
            message: "This user is currently busy."
          });
          return;
        }

        const callerCoins = await getCoins(callerId);
        const targetCoins = await getCoins(targetId);

        if (callerCoins === null) {
          sendJson(res, 404, {
            error: "USER_NOT_FOUND",
            message: "Your bot account was not found. Please open the Telegram bot first."
          });
          return;
        }

        if (targetCoins === null) {
          sendJson(res, 404, {
            error: "USER_UNAVAILABLE",
            message: "User unavailable."
          });
          return;
        }

        const requiredFee = feeFor(kind);
        if (callerCoins < requiredFee || targetCoins < requiredFee) {
          sendJson(res, 409, {
            error: "INSUFFICIENT_COINS",
            message: "Both users need at least " + requiredFee + " coins for the " + kind + " Partner Call connection fee."
          });
          return;
        }

        const activeCallerWs = clients.get(callerId);
        const activeTargetWs = clients.get(targetId);

        if (!activeCallerWs || activeCallerWs.readyState !== WebSocket.OPEN ||
            activeCallerWs.sessionId || activeCallerWs.searching ||
            (activeTargetWs && activeTargetWs.readyState === WebSocket.OPEN &&
              (activeTargetWs.sessionId || activeTargetWs.searching)) ||
            partnerInviteByUser.has(callerId) || partnerInviteByUser.has(targetId) ||
            botPartnerInviteCreatingUsers.has(callerId) || botPartnerInviteCreatingUsers.has(targetId) ||
            botPartnerInviteByUser.has(callerId) || botPartnerInviteByUser.has(targetId)) {
          sendJson(res, 409, {
            error: "USER_BECAME_BUSY",
            message: "One of these users is no longer available."
          });
          return;
        }

        let code;
        do {
          code = String(crypto.randomInt(10000000, 100000000));
        } while (partnerInvites.has(code));

        const invite = {
          code, callerId, targetId, kind,
          expiresAt: Date.now() + PARTNER_INVITE_TTL_MS,
          timer: null
        };

        partnerInvites.set(code, invite);
        partnerInviteByUser.set(callerId, code);
        partnerInviteByUser.set(targetId, code);

        activeCallerWs.partnerInviteCode = code;
        if (activeTargetWs && activeTargetWs.readyState === WebSocket.OPEN) {
          activeTargetWs.partnerInviteCode = code;
        }

        invite.timer = setTimeout(() => {
          cancelPartnerInvite(code, "partner-invite-expired", "expired");
        }, PARTNER_INVITE_TTL_MS);

        try {
          await sendPartnerTelegramInvite(invite);
        } catch (err) {
          cancelPartnerInvite(code, "partner-invite-cancelled", "delivery-failed");

          if (err.code === "USER_UNAVAILABLE") {
            sendJson(res, 404, {
              error: "USER_UNAVAILABLE",
              message: "User unavailable."
            });
          } else {
            console.error("Partner invite Telegram delivery failed:", err.message);
            sendJson(res, 502, {
              error: "TELEGRAM_DELIVERY_FAILED",
              message: "Unable to deliver the invitation right now. Please try again."
            });
          }
          return;
        }

        if (!partnerInvites.has(code) && !invite.accepted) {
          sendJson(res, 409, {
            error: "INVITE_CANCELLED",
            message: "Your connection was interrupted. Please try again."
          });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          code,
          callType: kind,
          accepted: Boolean(invite.accepted),
          partnerOnline: Boolean(
            clients.get(targetId) &&
            clients.get(targetId).readyState === WebSocket.OPEN
          ),
          expiresInSeconds: Math.floor(PARTNER_INVITE_TTL_MS / 1000)
        });
      } finally {
        partnerInviteCreatingUsers.delete(callerId);
        partnerInviteCreatingUsers.delete(targetId);
      }
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, {
        error: status === 401 ? "UNAUTHORIZED" : (err.code || "SERVER_ERROR"),
        message: status === 401 ? "Please reopen the Mini App from Telegram." :
          (err.message || "Unable to create invitation.")
      });
      if (status === 500) console.error("POST /api/partner-invites:", err.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/partner-invites/cancel") {
    try {
      const user = validateTelegramInitData(req.headers["x-telegram-init-data"] || "");
      const userId = String(user.id);
      const body = await readJsonBody(req);
      const code = String(body.code || "").trim();
      const invite = partnerInvites.get(code);

      if (!invite || invite.callerId !== userId) {
        sendJson(res, 404, { error: "INVITE_NOT_FOUND", message: "Invitation not found or already expired." });
        return;
      }
      cancelPartnerInvite(code, "partner-invite-cancelled", "cancelled");
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, {
        error: status === 401 ? "UNAUTHORIZED" : "SERVER_ERROR",
        message: status === 401 ? "Please reopen the Mini App from Telegram." : "Unable to cancel invitation."
      });
      if (status === 500) console.error("POST /api/partner-invites/cancel:", err.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/bot-partner-invites") {
    try {
      if (!isValidBotCallInternalRequest(req)) {
        sendJson(res, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const body = await readJsonBody(req);
      const callerId = String(body.callerId || "").trim();
      const targetId = String(body.targetId || "").trim();
      const kind = body.callType === "video" ? "video" :
        body.callType === "voice" ? "voice" : null;
      const coverBoth = body.coverBoth === true;

      if (!/^\d{1,20}$/.test(callerId) ||
          !/^\d{1,20}$/.test(targetId) ||
          callerId === targetId || !kind) {
        sendJson(res, 400, { error: "INVALID_INVITE_DETAILS" });
        return;
      }

      if (
        botPartnerInviteCreatingUsers.has(callerId) ||
        botPartnerInviteCreatingUsers.has(targetId) ||
        botPartnerInviteByUser.has(callerId) ||
        botPartnerInviteByUser.has(targetId) ||
        partnerInviteCreatingUsers.has(callerId) ||
        partnerInviteCreatingUsers.has(targetId) ||
        partnerInviteByUser.has(callerId) ||
        partnerInviteByUser.has(targetId)
      ) {
        sendJson(res, 409, { error: "INVITE_ALREADY_PENDING" });
        return;
      }

      botPartnerInviteCreatingUsers.add(callerId);
      botPartnerInviteCreatingUsers.add(targetId);

      try {
        for (const userId of [callerId, targetId]) {
          const ws = clients.get(userId);
          if (ws && ws.readyState === WebSocket.OPEN &&
              (ws.sessionId || ws.searching)) {
            sendJson(res, 409, {
              error: userId === callerId ? "CALLER_BUSY" : "TARGET_BUSY"
            });
            return;
          }
        }

        const callerCoins = await getCoins(callerId);
        const targetCoins = await getCoins(targetId);

        if (callerCoins === null) {
          sendJson(res, 404, { error: "CALLER_NOT_FOUND" });
          return;
        }
        if (targetCoins === null) {
          sendJson(res, 404, { error: "TARGET_NOT_FOUND" });
          return;
        }

        const requiredPerUser = feeFor(kind) + rateFor(kind);
        const callerRequired = coverBoth
          ? requiredPerUser * 2
          : requiredPerUser;

        if (callerCoins < callerRequired) {
          sendJson(res, 409, {
            error: "CALLER_INSUFFICIENT_COINS",
            required: callerRequired,
            balance: callerCoins
          });
          return;
        }

        if (!coverBoth && targetCoins < requiredPerUser) {
          sendJson(res, 409, {
            error: "TARGET_NEEDS_COVER",
            required: requiredPerUser,
            balance: targetCoins
          });
          return;
        }

        let code;
        do {
          code = crypto.randomBytes(12).toString("hex");
        } while (botPartnerInvites.has(code));

        const invite = {
          code,
          callerId,
          targetId,
          kind,
          coverBoth,
          accepted: false,
          responded: false,
          expiresAt: Date.now() + BOT_PARTNER_INVITE_TTL_MS,
          timer: null
        };

        botPartnerInvites.set(code, invite);
        botPartnerInviteByUser.set(callerId, code);
        botPartnerInviteByUser.set(targetId, code);

        invite.timer = setTimeout(() => {
          cancelBotPartnerInvite(code);
        }, BOT_PARTNER_INVITE_TTL_MS);

        sendJson(res, 200, {
          ok: true,
          code,
          callType: kind,
          coverBoth,
          expiresInSeconds: Math.floor(BOT_PARTNER_INVITE_TTL_MS / 1000)
        });
      } finally {
        botPartnerInviteCreatingUsers.delete(callerId);
        botPartnerInviteCreatingUsers.delete(targetId);
      }
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, {
        error: status === 400 ? "BAD_REQUEST" : "SERVER_ERROR"
      });
      if (status === 500) console.error("POST internal bot invite:", err.message);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/bot-partner-invites/cancel") {
    try {
      if (!isValidBotCallInternalRequest(req)) {
        sendJson(res, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const body = await readJsonBody(req);
      const code = String(body.code || "").trim();
      const callerId = String(body.callerId || "").trim();
      const invite = botPartnerInvites.get(code);

      if (!invite) {
        sendJson(res, 200, { ok: true, cancelled: false });
        return;
      }

      if (callerId !== invite.callerId) {
        sendJson(res, 403, { error: "INVITE_UNAUTHORIZED" });
        return;
      }

      if (invite.responded || invite.accepted) {
        sendJson(res, 409, { error: "INVITE_ALREADY_RESPONDED" });
        return;
      }

      const cancelled = cancelBotPartnerInvite(code);

      sendJson(res, 200, { ok: true, cancelled });
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, {
        error: status === 400 ? "BAD_REQUEST" : "SERVER_ERROR"
      });
      if (status === 500) {
        console.error("POST internal bot invite cancel:", err.message);
      }
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/bot-partner-invites/respond") {
    try {
      if (!isValidBotCallInternalRequest(req)) {
        sendJson(res, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const body = await readJsonBody(req);
      const code = String(body.code || "").trim();
      const userId = String(body.userId || "").trim();
      const accept = body.accept === true;
      const invite = botPartnerInvites.get(code);

      if (!invite || invite.expiresAt <= Date.now()) {
        if (invite) cancelBotPartnerInvite(code);
        sendJson(res, 404, { error: "INVITE_NOT_FOUND" });
        return;
      }

      if (userId !== invite.targetId) {
        sendJson(res, 403, { error: "INVITE_UNAUTHORIZED" });
        return;
      }

      if (invite.responded) {
        if (accept && invite.accepted) {
          sendJson(res, 200, {
            ok: true,
            accepted: true,
            alreadyAccepted: true,
            callerId: invite.callerId,
            targetId: invite.targetId,
            callType: invite.kind,
            coverBoth: invite.coverBoth,
            code: invite.code
          });
        } else {
          sendJson(res, 409, { error: "INVITE_ALREADY_RESPONDED" });
        }
        return;
      }

      invite.responded = true;

      if (!accept) {
        cancelBotPartnerInvite(code);
        sendJson(res, 200, {
          ok: true,
          accepted: false,
          callerId: invite.callerId,
          targetId: invite.targetId
        });
        return;
      }

      invite.accepted = true;
      sendJson(res, 200, {
        ok: true,
        accepted: true,
        callerId: invite.callerId,
        targetId: invite.targetId,
        callType: invite.kind,
        coverBoth: invite.coverBoth,
        code: invite.code
      });
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, {
        error: status === 400 ? "BAD_REQUEST" : "SERVER_ERROR"
      });
      if (status === 500) console.error("POST internal bot invite respond:", err.message);
    }
    return;
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
});

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function validateTelegramInitData(initData) {
  if (!initData || typeof initData !== "string") {
    const e = new Error("Missing Telegram initData"); e.statusCode = 401; throw e;
  }
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    const e = new Error("Invalid Telegram hash"); e.statusCode = 401; throw e;
  }
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const e = new Error("Telegram signature mismatch"); e.statusCode = 401; throw e;
  }
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 60 || now - authDate > AUTH_MAX_AGE_SECONDS) {
    const e = new Error("Expired Telegram initData"); e.statusCode = 401; throw e;
  }
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch (_) {}
  if (!user || !user.id) {
    const e = new Error("Telegram user missing"); e.statusCode = 401; throw e;
  }
  return user;
}

const wss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });
const clients = new Map();          // Telegram user id -> websocket
const queues = { voice: [], video: [] };
const waitingTimers = new Map();    // websocket -> timeout
const sessions = new Map();         // session id -> in-memory live session
const partnerInvites = new Map();       // invite code -> pending invite
const partnerInviteByUser = new Map();  // Telegram user id -> invite code
const partnerInviteCreatingUsers = new Set();

// Separate storage for Telegram-bot initiated Partner Calls.
const botPartnerInvites = new Map();
const botPartnerInviteByUser = new Map();
const botPartnerInviteCreatingUsers = new Set();

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 8192) {
      const err = new Error("Request body too large");
      err.statusCode = 413;
      throw err;
    }
  }
  try {
    return JSON.parse(raw || "{}");
  } catch (_) {
    const err = new Error("Invalid JSON body");
    err.statusCode = 400;
    throw err;
  }
}

function isPartnerUserBusy(userId) {
  const ws = clients.get(String(userId));
  return !ws || ws.readyState !== WebSocket.OPEN || !!ws.sessionId || !!ws.searching;
}

function isValidBotCallInternalRequest(req) {
  const supplied = Buffer.from(String(req.headers["x-bot-call-secret"] || ""));
  const expected = Buffer.from(BOT_CALL_INTERNAL_SECRET);
  return expected.length > 0 &&
    supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

function cancelBotPartnerInvite(code) {
  const invite = botPartnerInvites.get(String(code));
  if (!invite) return false;

  botPartnerInvites.delete(invite.code);
  if (botPartnerInviteByUser.get(invite.callerId) === invite.code) {
    botPartnerInviteByUser.delete(invite.callerId);
  }
  if (botPartnerInviteByUser.get(invite.targetId) === invite.code) {
    botPartnerInviteByUser.delete(invite.targetId);
  }
  clearTimeout(invite.timer);
  return true;
}

function cancelPartnerInvite(code, eventType = "partner-invite-cancelled", reason = "cancelled") {
  const invite = partnerInvites.get(String(code));
  if (!invite) return false;

  partnerInvites.delete(invite.code);
  partnerInviteByUser.delete(invite.callerId);
  partnerInviteByUser.delete(invite.targetId);
  clearTimeout(invite.timer);

  for (const userId of [invite.callerId, invite.targetId]) {
    const ws = clients.get(userId);
    if (ws && ws.partnerInviteCode === invite.code) ws.partnerInviteCode = null;
    if (eventType && ws) send(ws, { type: eventType, code: invite.code, reason });
  }
  return true;
}

async function sendPartnerTelegramInvite(invite) {
  if (!BOT_TOKEN) throw new Error("Bot token is not configured");

  const appUrl = new URL(MINI_APP_URL);
  appUrl.searchParams.set("partner", "1");
  appUrl.searchParams.set("type", invite.kind);
  appUrl.searchParams.set("code", invite.code);

  const response = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: invite.targetId,
      text:
        "📞 You have received a Partner " + (invite.kind === "video" ? "Video" : "Voice") +
        " Call invitation on MeetStrangers4u.\n\n" +
        "Tap the button below to open the Mini App and accept the call.\n" +
        "This invitation expires in 10 minutes.",
      reply_markup: {
        inline_keyboard: [[
          { text: "Accept Partner Call", web_app: { url: appUrl.toString() } }
        ]]
      }
    }),
    signal: AbortSignal.timeout(10000)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.ok) {
    const description = String(result.description || "");

    if (/chat not found|bot was blocked by the user|user is deactivated|peer_id_invalid|user_id_invalid/i.test(description)) {
      const err = new Error("User unavailable.");
      err.code = "USER_UNAVAILABLE";
      throw err;
    }

    throw new Error(description || ("Telegram HTTP " + response.status));
  }
}

server.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return;
  }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); socket.destroy(); return;
  }
  let user;
  try { user = validateTelegramInitData(url.searchParams.get("initData") || ""); }
  catch (_) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.userId = String(user.id);
    wss.emit("connection", ws, req);
  });
});

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function sendError(ws, code, message) { send(ws, { type: "error", code, message }); }
function feeFor(kind) { return kind === "video" ? 20 : 10; }
function rateFor(kind) { return kind === "video" ? 50 : 20; }
function queueRemove(ws) {
  for (const kind of ["voice", "video"]) {
    const index = queues[kind].indexOf(ws);
    if (index !== -1) queues[kind].splice(index, 1);
  }
  const timer = waitingTimers.get(ws);
  if (timer) clearTimeout(timer);
  waitingTimers.delete(ws);
}
async function getCoins(userId) {
  const r = await pool.query("SELECT coins FROM public.users WHERE user_id=$1", [userId]);
  return r.rowCount ? Number(r.rows[0].coins || 0) : null;
}
async function debitBoth(session, amount) {
  const db = await pool.connect();
  let transactionStarted = false;
  try {
    await db.query("BEGIN");
    transactionStarted = true;
    const balances = {};
    for (const userId of session.userIds) {
      const r = await db.query(
        "UPDATE public.users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1 RETURNING coins",
        [amount, userId]
      );
      if (!r.rowCount) {
        const e = new Error("INSUFFICIENT_BALANCE"); e.code = "INSUFFICIENT_BALANCE"; throw e;
      }
      balances[userId] = Number(r.rows[0].coins);
    }
    await db.query("COMMIT");
    transactionStarted = false;
    return balances;
  } catch (err) {
    if (transactionStarted) {
      try { await db.query("ROLLBACK"); } catch (rollbackError) {
        console.error("Wallet rollback failed:", rollbackError.message);
      }
    }
    throw err;
  } finally {
    db.release();
  }
}
async function debitCallerForBoth(session, amount) {
  const total = amount * 2;
  const db = await pool.connect();
  let transactionStarted = false;

  try {
    await db.query("BEGIN");
    transactionStarted = true;

    const r = await db.query(
      "UPDATE public.users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1 RETURNING coins",
      [total, session.payerId]
    );

    if (!r.rowCount) {
      const e = new Error("INSUFFICIENT_BALANCE");
      e.code = "INSUFFICIENT_BALANCE";
      throw e;
    }

    await db.query("COMMIT");
    transactionStarted = false;
    return { [session.payerId]: Number(r.rows[0].coins) };
  } catch (err) {
    if (transactionStarted) {
      try { await db.query("ROLLBACK"); } catch (rollbackError) {
        console.error("Caller-cover-both rollback failed:", rollbackError.message);
      }
    }
    throw err;
  } finally {
    db.release();
  }
}

async function debitOne(userId, amount) {
  const r = await pool.query(
    "UPDATE public.users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1 RETURNING coins",
    [amount, userId]
  );
  if (!r.rowCount) {
    const e = new Error("INSUFFICIENT_BALANCE"); e.code = "INSUFFICIENT_BALANCE"; throw e;
  }
  return Number(r.rows[0].coins);
}
async function settleConnectionFee(session) {
  if (session.ended || session.feeSettlementStarted || session.feeSettled) return;
  session.feeGraceExpired = true;
  session.feeSettlementStarted = true;
  try {
    const balances = session.botFlow && session.coverBoth
      ? await debitCallerForBoth(session, session.fee)
      : await debitBoth(session, session.fee);

    session.feeSettled = true;
    for (const [userId, coins] of Object.entries(balances)) {
      send(clients.get(userId), { type: "wallet-update", coins });
    }
  } catch (err) {
    endSession(session, err.code === "INSUFFICIENT_BALANCE" ? "insufficient-coins" : "billing-error");
  }
}
function endSession(session, reason, notify = true, disconnectedUserId = null) {
  if (!session || session.ended) return;

  const elapsed = session.startedAt ? Date.now() - session.startedAt : 0;
  if (session.active && !session.feeSettled && !session.feeSettlementStarted && elapsed >= 2000) {
    // The grace period has elapsed: both users owe the normal connection fee.
    settleConnectionFee(session);
  }
  const chargeDisconnectingUserOnly =
    !session.botFlow &&
    session.active && !session.feeSettled && !session.feeSettlementStarted &&
    elapsed < 2000 && disconnectedUserId && session.userIds.includes(disconnectedUserId);

  session.ended = true;
  clearTimeout(session.connectTimer);
  clearTimeout(session.feeTimer);
  clearTimeout(session.billingTimer);
  clearInterval(session.billingTimer);
  sessions.delete(session.id);
  if (session.botFlow && session.botInviteCode) {
    cancelBotPartnerInvite(session.botInviteCode);
  }
  for (const userId of session.userIds) {
    const ws = clients.get(userId);
    if (notify && ws) send(ws, { type: "call-ended", sessionId: session.id, reason });
    if (ws) ws.sessionId = null;
  }

  if (chargeDisconnectingUserOnly) {
    debitOne(disconnectedUserId, session.fee).then(coins => {
      send(clients.get(disconnectedUserId), { type: "wallet-update", coins });
    }).catch(err => {
      console.error("Early disconnect fee failed:", err.message);
    });
  }
}
async function billMinute(session) {
  if (session.ended || session.billingInProgress) return;
  session.billingInProgress = true;
  try {
    const balances = session.botFlow && session.coverBoth
      ? await debitCallerForBoth(session, session.rate)
      : await debitBoth(session, session.rate);

    session.billedMinutes += 1;
    for (const userId of session.userIds) {
      if (Object.prototype.hasOwnProperty.call(balances, userId)) {
        send(clients.get(userId), { type: "wallet-update", coins: balances[userId] });
      }

      const amount = session.botFlow && session.coverBoth
        ? (userId === session.payerId ? session.rate * 2 : 0)
        : session.rate;

      send(clients.get(userId), {
        type: "minute-billed",
        minutes: session.billedMinutes,
        amount
      });
    }
  } catch (err) {
    endSession(session, err.code === "INSUFFICIENT_BALANCE" ? "insufficient-coins" : "billing-error");
  } finally {
    session.billingInProgress = false;
  }
}
async function activateSession(session) {
  if (session.ended || session.active || session.activating || session.ready.size !== 2) return;
  session.activating = true;
  clearTimeout(session.connectTimer);
  session.connectTimer = null;
  session.active = true;
  session.activating = false;
  session.startedAt = Date.now();
  for (const userId of session.userIds) {
    const coveredByCaller = session.botFlow && session.coverBoth;
    const isPayer = !coveredByCaller || userId === session.payerId;

    send(clients.get(userId), {
      type: "call-connected",
      sessionId: session.id,
      callType: session.kind,
      fee: isPayer ? session.fee * (coveredByCaller ? 2 : 1) : 0,
      perMinute: isPayer ? session.rate * (coveredByCaller ? 2 : 1) : 0
    });
  }
  session.feeTimer = setTimeout(() => {
    settleConnectionFee(session);
  }, 2000);
  // Keep the first minute charge anchored to the actual connection time.
  session.billingTimer = setTimeout(() => {
    billMinute(session);
    if (!session.ended) session.billingTimer = setInterval(() => billMinute(session), 60000);
  }, 60000);
}
async function beginSearch(ws, kind) {
  if (
    partnerInviteByUser.has(ws.userId) ||
    partnerInviteCreatingUsers.has(ws.userId) ||
    botPartnerInviteByUser.has(ws.userId) ||
    botPartnerInviteCreatingUsers.has(ws.userId)
  ) {
    sendError(ws, "PARTNER_INVITE_PENDING", "Cancel or finish your pending partner invitation before starting random search.");
    return;
  }
  if (ws.sessionId || ws.searching) return;
  ws.searching = "checking";
  const fee = feeFor(kind);
  let coins;
  try {
    coins = await getCoins(ws.userId);
  } catch (err) {
    if (ws.searching === "checking") ws.searching = null;
    throw err;
  }
  if (ws.readyState !== WebSocket.OPEN || clients.get(ws.userId) !== ws || ws.searching !== "checking") return;
  if (coins === null) { ws.searching = null; sendError(ws, "USER_NOT_FOUND", "Open the Telegram bot first, then try again."); return; }
  if (coins < 100) {
    ws.searching = null;
    send(ws, { type: "insufficient-coins", coins, required: 100, message: "You need at least 100 coins to use call features. Watch ads and earn coins to get more coins." });
    return;
  }
  ws.searching = kind;
  send(ws, { type: "searching", callType: kind, timeoutSeconds: 180 });
  const queue = queues[kind];
  let peer = null;
  while (queue.length && !peer) {
    const candidate = queue.shift();
    if (candidate !== ws && candidate.readyState === WebSocket.OPEN && candidate.searching === kind && !candidate.sessionId) peer = candidate;
  }
  if (!peer) {
    queue.push(ws);
    const timer = setTimeout(() => {
      queueRemove(ws);
      ws.searching = null;
      send(ws, { type: "search-timeout", message: "No users are available right now. Please try again after some time." });
    }, SEARCH_TIMEOUT_MS);
    waitingTimers.set(ws, timer);
    return;
  }
  queueRemove(peer);
  clearTimeout(waitingTimers.get(peer));
  waitingTimers.delete(peer);
  peer.searching = null;
  ws.searching = null;

  const id = crypto.randomUUID();
  const session = {
    id, kind, userIds: [peer.userId, ws.userId], fee, rate: rateFor(kind),
    ready: new Set(), active: false, activating: false, billingInProgress: false,
    ended: false, billedMinutes: 0,
    connectTimer: null, feeTimer: null, billingTimer: null, startedAt: null,
    feeGraceExpired: false, feeSettlementStarted: false, feeSettled: false
  };
  sessions.set(id, session);
  peer.sessionId = id; ws.sessionId = id;
  session.connectTimer = setTimeout(() => endSession(session, "connection-timeout"), CONNECT_TIMEOUT_MS);
  for (const member of [peer, ws]) send(member, { type: "matched", sessionId: id, callType: kind, peerId: member === peer ? ws.userId : peer.userId });
}
wss.on("connection", ws => {
  const previous = clients.get(ws.userId);
  if (previous && previous !== ws) {
    queueRemove(previous);
    if (previous.sessionId) endSession(sessions.get(previous.sessionId), "reconnected", true, previous.userId);
    previous.close(4001, "Replaced by a newer connection");
  }
  clients.set(ws.userId, ws);
  send(ws, { type: "ready" });

  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { sendError(ws, "BAD_MESSAGE", "Invalid message."); return; }
    try {
      if (msg.type === "join-bot-partner") {
        const code = String(msg.code || "").trim();
        const invite = botPartnerInvites.get(code);

        if (!invite || invite.expiresAt <= Date.now()) {
          if (invite) cancelBotPartnerInvite(code);
          sendError(ws, "BOT_PARTNER_INVITE_INVALID", "This invitation is invalid or expired.");
          return;
        }

        if (!invite.accepted) {
          sendError(ws, "BOT_PARTNER_INVITE_NOT_ACCEPTED", "Accept the Telegram invitation first.");
          return;
        }

        const expectedRole = ws.userId === invite.callerId ? "caller" :
          ws.userId === invite.targetId ? "target" : null;

        if (!expectedRole || msg.role !== expectedRole) {
          sendError(ws, "BOT_PARTNER_INVITE_UNAUTHORIZED", "This invitation belongs to another Telegram account.");
          return;
        }

        if (ws.sessionId || ws.searching ||
            clients.get(ws.userId) !== ws ||
            ws.readyState !== WebSocket.OPEN) {
          sendError(ws, "BOT_PARTNER_USER_BUSY", "You are not available to join this call.");
          return;
        }

        let session = invite.sessionId ? sessions.get(invite.sessionId) : null;

        if (!session) {
          const id = crypto.randomUUID();
          session = {
            id,
            kind: invite.kind,
            userIds: [invite.callerId, invite.targetId],
            fee: feeFor(invite.kind),
            rate: rateFor(invite.kind),
            botFlow: true,
            botInviteCode: code,
            coverBoth: invite.coverBoth,
            payerId: invite.callerId,
            joined: new Set(),
            ready: new Set(),
            active: false,
            activating: false,
            billingInProgress: false,
            ended: false,
            billedMinutes: 0,
            connectTimer: null,
            feeTimer: null,
            billingTimer: null,
            startedAt: null,
            feeGraceExpired: false,
            feeSettlementStarted: false,
            feeSettled: false
          };

          sessions.set(id, session);
          invite.sessionId = id;
          session.connectTimer = setTimeout(
            () => endSession(session, "connection-timeout"),
            CONNECT_TIMEOUT_MS
          );
        }

        if (session.ended || !session.userIds.includes(ws.userId) ||
            session.joined.has(ws.userId)) {
          sendError(ws, "BOT_PARTNER_JOIN_INVALID", "You have already joined or this call is no longer available.");
          return;
        }

        const peerId = session.userIds.find(id => id !== ws.userId);

        if (session.joined.has(peerId)) {
          const peerWs = clients.get(peerId);
          if (!peerWs || peerWs.readyState !== WebSocket.OPEN ||
              peerWs.sessionId !== session.id) {
            endSession(session, "partner-unavailable");
            sendError(ws, "BOT_PARTNER_USER_UNAVAILABLE", "The other user is no longer available.");
            return;
          }
        }

        session.joined.add(ws.userId);
        ws.sessionId = session.id;

        if (session.joined.size === 2) {
          const callerWs = clients.get(invite.callerId);
          const targetWs = clients.get(invite.targetId);

          if (!callerWs || !targetWs ||
              callerWs.readyState !== WebSocket.OPEN ||
              targetWs.readyState !== WebSocket.OPEN ||
              callerWs.sessionId !== session.id ||
              targetWs.sessionId !== session.id) {
            endSession(session, "partner-unavailable");
            return;
          }

          clearTimeout(session.connectTimer);
          session.connectTimer = setTimeout(
            () => endSession(session, "connection-timeout"),
            CONNECT_TIMEOUT_MS
          );

          cancelBotPartnerInvite(code);

          send(callerWs, {
            type: "matched",
            sessionId: session.id,
            callType: session.kind,
            peerId: targetWs.userId
          });

          send(targetWs, {
            type: "matched",
            sessionId: session.id,
            callType: session.kind,
            peerId: callerWs.userId
          });
        }
        return;
      }

      if (msg.type === "join-partner") {
        const code = String(msg.code || "").trim();
        const invite = partnerInvites.get(code);

        if (!invite || invite.expiresAt <= Date.now()) {
          if (invite) cancelPartnerInvite(code, "partner-invite-expired", "expired");
          sendError(ws, "PARTNER_INVITE_INVALID", "This invitation code is invalid or expired.");
          return;
        }
        if (ws.userId !== invite.targetId) {
          sendError(ws, "PARTNER_INVITE_UNAUTHORIZED", "This invitation was sent to another Telegram account.");
          return;
        }

        const callerWs = clients.get(invite.callerId);
        if (!callerWs || callerWs.readyState !== WebSocket.OPEN ||
            isPartnerUserBusy(invite.callerId) || isPartnerUserBusy(invite.targetId)) {
          cancelPartnerInvite(code, "partner-invite-cancelled", "user-unavailable");
          sendError(ws, "PARTNER_USER_UNAVAILABLE", "The other user is no longer available.");
          return;
        }

        queueRemove(callerWs);
        queueRemove(ws);
        callerWs.searching = null;
        ws.searching = null;
        invite.accepted = true;
        cancelPartnerInvite(code, null, "accepted");

        const id = crypto.randomUUID();
        const session = {
          id, kind: invite.kind, userIds: [invite.callerId, invite.targetId],
          fee: feeFor(invite.kind), rate: rateFor(invite.kind),
          ready: new Set(), active: false, activating: false, billingInProgress: false,
          ended: false, billedMinutes: 0,
          connectTimer: null, feeTimer: null, billingTimer: null, startedAt: null,
          feeGraceExpired: false, feeSettlementStarted: false, feeSettled: false
        };
        sessions.set(id, session);
        callerWs.sessionId = id;
        ws.sessionId = id;
        session.connectTimer = setTimeout(() => endSession(session, "connection-timeout"), CONNECT_TIMEOUT_MS);

        send(callerWs, {
          type: "matched", sessionId: id, callType: invite.kind, peerId: ws.userId
        });
        send(ws, {
          type: "matched", sessionId: id, callType: invite.kind, peerId: callerWs.userId
        });
        return;
      }

      if (msg.type === "cancel-partner") {
        const code = String(msg.code || ws.partnerInviteCode || "").trim();
        const invite = partnerInvites.get(code);
        if (invite && (invite.callerId === ws.userId || invite.targetId === ws.userId)) {
          cancelPartnerInvite(code, "partner-invite-cancelled", "cancelled");
        }
        return;
      }

      if (msg.type === "find") {
        const kind = msg.callType === "video" ? "video" : msg.callType === "voice" ? "voice" : null;
        if (!kind) { sendError(ws, "BAD_CALL_TYPE", "Choose voice or video."); return; }
        await beginSearch(ws, kind);
        return;
      }
      if (msg.type === "cancel-search") {
        queueRemove(ws); ws.searching = null;
        send(ws, { type: "search-cancelled" }); return;
      }
      if (msg.type === "media-ready") {
        const session = sessions.get(ws.sessionId);
        if (!session || !session.userIds.includes(ws.userId)) return;
        session.ready.add(ws.userId);
        await activateSession(session);
        return;
      }
      if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice-candidate") {
        const session = sessions.get(ws.sessionId);
        if (!session || !session.userIds.includes(ws.userId)) return;
        const peerId = session.userIds.find(id => id !== ws.userId);
        const peer = clients.get(peerId);
        if (peer && peer.sessionId === session.id) send(peer, { type: msg.type, data: msg.data, sessionId: session.id });
        return;
      }
      if (msg.type === "end-call") {
        const session = sessions.get(ws.sessionId);
        if (session && session.userIds.includes(ws.userId)) endSession(session, "ended-by-user", true, ws.userId);
        return;
      }
      sendError(ws, "UNKNOWN_MESSAGE", "Unsupported action.");
    } catch (err) {
      console.error("WebSocket message:", err.message);
      sendError(ws, "SERVER_ERROR", "The calling service encountered an error.");
    }
  });

  ws.on("close", () => {
    const isCurrentClient = clients.get(ws.userId) === ws;
    if (isCurrentClient) {
      const pendingBotCode = botPartnerInviteByUser.get(ws.userId);
      if (pendingBotCode) cancelBotPartnerInvite(pendingBotCode);

      const pendingCode = ws.partnerInviteCode || partnerInviteByUser.get(ws.userId);
      if (pendingCode) cancelPartnerInvite(pendingCode, "partner-invite-cancelled", "participant-disconnected");
    }
    queueRemove(ws);
    if (ws.searching) ws.searching = null;
    if (ws.sessionId) endSession(sessions.get(ws.sessionId), "connection-lost", true, ws.userId);
    if (isCurrentClient) clients.delete(ws.userId);
  });
  ws.on("error", err => console.error("WebSocket error:", err.message));
});

server.listen(PORT, HOST, async () => {
  try {
    await pool.query("SELECT 1");
    console.log("MeetStrangers4u calling backend listening on " + HOST + ":" + PORT);
  } catch (err) {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  }
});

async function shutdown() {
  for (const session of sessions.values()) endSession(session, "server-shutdown");
  for (const ws of wss.clients) ws.close(1001, "Server shutting down");
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
