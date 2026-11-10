"use strict";

const http = require("http");
const crypto = require("crypto");
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
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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
function rateFor(kind) { return kind === "video" ? 10 : 5; }
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
  try {
    await db.query("BEGIN");
    for (const userId of session.userIds) {
      const r = await db.query(
        "UPDATE public.users SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1 RETURNING coins",
        [amount, userId]
      );
      if (!r.rowCount) {
        const e = new Error("INSUFFICIENT_BALANCE"); e.code = "INSUFFICIENT_BALANCE"; throw e;
      }
    }
    await db.query("COMMIT");
    const balances = {};
    for (const userId of session.userIds) {
      const r = await db.query("SELECT coins FROM public.users WHERE user_id=$1", [userId]);
      balances[userId] = Number(r.rows[0].coins);
    }
    return balances;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}
function endSession(session, reason, notify = true) {
  if (!session || session.ended) return;
  session.ended = true;
  clearTimeout(session.connectTimer);
  clearInterval(session.billingTimer);
  sessions.delete(session.id);
  for (const userId of session.userIds) {
    const ws = clients.get(userId);
    if (notify && ws) send(ws, { type: "call-ended", sessionId: session.id, reason });
    if (ws) ws.sessionId = null;
  }
}
async function activateSession(session) {
  if (session.ended || session.active || session.ready.size !== 2) return;
  try {
    const balances = await debitBoth(session, session.fee);
    if (session.ended) return;
    session.active = true;
    session.startedAt = Date.now();
    for (const userId of session.userIds) {
      send(clients.get(userId), { type: "call-connected", sessionId: session.id, callType: session.kind, coins: balances[userId], fee: session.fee, perMinute: session.rate });
    }
    session.billingTimer = setInterval(async () => {
      if (session.ended) return;
      try {
        const nextBalances = await debitBoth(session, session.rate);
        session.billedMinutes += 1;
        for (const userId of session.userIds) {
          send(clients.get(userId), { type: "wallet-update", coins: nextBalances[userId] });
          send(clients.get(userId), { type: "minute-billed", minutes: session.billedMinutes, amount: session.rate });
        }
      } catch (err) {
        endSession(session, err.code === "INSUFFICIENT_BALANCE" ? "insufficient-coins" : "billing-error");
      }
    }, 60000);
  } catch (err) {
    endSession(session, err.code === "INSUFFICIENT_BALANCE" ? "insufficient-coins" : "billing-error");
  }
}
async function beginSearch(ws, kind) {
  if (ws.sessionId || ws.searching) return;
  const fee = feeFor(kind);
  const coins = await getCoins(ws.userId);
  if (coins === null) { sendError(ws, "USER_NOT_FOUND", "Open the Telegram bot first, then try again."); return; }
  if (coins < fee) {
    send(ws, { type: "insufficient-coins", coins, required: fee, message: "Insufficient coins. Watch ads and earn coins." });
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
    ready: new Set(), active: false, ended: false, billedMinutes: 0,
    connectTimer: null, billingTimer: null, startedAt: null
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
    if (previous.sessionId) endSession(sessions.get(previous.sessionId), "reconnected");
    previous.close(4001, "Replaced by a newer connection");
  }
  clients.set(ws.userId, ws);
  send(ws, { type: "ready" });

  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { sendError(ws, "BAD_MESSAGE", "Invalid message."); return; }
    try {
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
        if (session && session.userIds.includes(ws.userId)) endSession(session, "ended-by-user");
        return;
      }
      sendError(ws, "UNKNOWN_MESSAGE", "Unsupported action.");
    } catch (err) {
      console.error("WebSocket message:", err.message);
      sendError(ws, "SERVER_ERROR", "The calling service encountered an error.");
    }
  });

  ws.on("close", () => {
    queueRemove(ws);
    if (ws.searching) ws.searching = null;
    if (ws.sessionId) endSession(sessions.get(ws.sessionId), "connection-lost");
    if (clients.get(ws.userId) === ws) clients.delete(ws.userId);
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
