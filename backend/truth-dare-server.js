"use strict";

/**
 * Isolated Truth or Dare matchmaking service.
 * Runs separately from the calling service. In-memory rooms/queues; no wallet writes.
 */
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.TRUTH_DARE_PORT || 3002);
const HOST = process.env.TRUTH_DARE_HOST || "127.0.0.1";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "https://meetstrangers4u-miniapp-v2.vercel.app")
    .split(",").map(v => v.trim()).filter(Boolean)
);
const AUTH_MAX_AGE_SECONDS = 86400;
const VALID_MODES = new Set(["normal", "advanced", "dark"]);
const VALID_COUNTS = new Set([2, 3, 4, 5]);
const queues = new Map(); // config key -> waiting player records
const rooms = new Map();  // roomId -> room state
const users = new Map();  // telegram userId -> socket\nconst playersByUser = new Map(); // active player session per telegram user
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required for Truth or Dare authentication");

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ ok: true, service: "truth-dare-matchmaking" }));
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND" }));
});

const wss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});

function validateInitData(initData) {
  if (!initData || typeof initData !== "string" || initData.length > 4096) throw new Error("BAD_AUTH");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const userRaw = params.get("user");
  if (!hash || !/^([a-f0-9]{64})$/i.test(hash) || !authDate || !userRaw) throw new Error("BAD_AUTH");
  const checkString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secret).update(checkString).digest();
  const supplied = Buffer.from(hash, "hex");
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) throw new Error("BAD_AUTH");
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60 || now - authDate > AUTH_MAX_AGE_SECONDS) throw new Error("AUTH_EXPIRED");
  const user = JSON.parse(userRaw);
  if (!user || !user.id) throw new Error("BAD_AUTH");
  return { id: String(user.id), name: String(user.first_name || "Player").slice(0, 40) };
}

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}
function broadcast(room, type, payload = {}) {
  for (const p of room.players) send(p.ws, type, payload);
}
function configKey(count, mode) { return count + ":" + mode; }
function safePlayer(p) { return { id: p.id, name: p.name, host: p.host, ready: p.ready }; }

function removeFromQueue(player) {
  for (const [key, list] of queues) {
    const filtered = list.filter(p => p.id !== player.id);
    if (filtered.length !== list.length) {
      if (filtered.length) queues.set(key, filtered);
      else queues.delete(key);
    }
  }
}
function detachPlayer(player, reason) {
  removeFromQueue(player);
  if (player.roomId) {
    const room = rooms.get(player.roomId);
    if (room) {
      room.players = room.players.filter(p => p.id !== player.id);
      broadcast(room, "player-left", { playerId: player.id, reason, players: room.players.map(safePlayer) });
      if (room.players.length < room.playerCount) {
        broadcast(room, "room-closed", { reason: "player-left-before-start" });
        for (const p of room.players) { p.roomId = null; p.ready = false; }
        rooms.delete(room.id);
      } else if (room.players.length === 0) {
        rooms.delete(room.id);
      }
    }
  }
  if (users.get(player.id) === player.ws) users.delete(player.id);
  player.roomId = null;
  player.queueKey = null;
}
function formRoom(list, count, mode) {
  const id = crypto.randomBytes(12).toString("hex");
  const room = { id, playerCount: count, mode, status: "lobby", createdAt: Date.now(), players: list };
  rooms.set(id, room);
  list.forEach((p, i) => { p.roomId = id; p.queueKey = null; p.host = i === 0; p.ready = false; });
  broadcast(room, "room-formed", { roomId: id, playerCount: count, mode, players: room.players.map(safePlayer), hostId: room.players[0].id });
}

function enterQueue(player, count, mode) {
  const key = configKey(count, mode);
  removeFromQueue(player);
  player.roomId = null; player.queueKey = key; player.host = false; player.ready = false;
  const list = queues.get(key) || [];
  if (!list.some(p => p.id === player.id)) list.push(player);
  queues.set(key, list);
  send(player.ws, "queue-joined", { playerCount: count, mode, waiting: list.length });
  while (list.length >= count) {
    const group = list.splice(0, count);
    if (list.length) queues.set(key, list); else queues.delete(key);
    formRoom(group, count, mode);
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  let user;
  try { user = validateInitData(url.searchParams.get("initData") || ""); }
  catch (_) { ws.close(1008, "Unauthorized"); return; }

  const previous = users.get(user.id);
  if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) previous.close(4001, "New connection");
  const player = { id: user.id, name: user.name, ws, host: false, ready: false, roomId: null, queueKey: null };
  users.set(user.id, ws);
  send(ws, "connected", { userId: user.id });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return send(ws, "error", { code: "BAD_MESSAGE" }); }
    if (!msg || typeof msg.type !== "string") return send(ws, "error", { code: "BAD_MESSAGE" });
    if (msg.type === "queue") {
      const count = Number(msg.playerCount), mode = String(msg.mode || "");
      if (!VALID_COUNTS.has(count) || !VALID_MODES.has(mode)) return send(ws, "error", { code: "INVALID_SETTINGS" });
      if (player.roomId) return send(ws, "error", { code: "ALREADY_IN_ROOM" });
      enterQueue(player, count, mode);
      return;
    }
    if (msg.type === "cancel-queue") {
      removeFromQueue(player); player.queueKey = null;
      send(ws, "queue-cancelled");
      return;
    }
    if (msg.type === "ready") {
      const room = rooms.get(player.roomId);
      if (!room || room.status !== "lobby") return send(ws, "error", { code: "ROOM_NOT_AVAILABLE" });
      player.ready = msg.ready === true;
      broadcast(room, "ready-update", { players: room.players.map(safePlayer) });
      if (room.players.length === room.playerCount && room.players.every(p => p.ready)) {
        room.status = "starting";
        broadcast(room, "game-start", { roomId: room.id, mode: room.mode, players: room.players.map(safePlayer), targetScore: 1000 });
      }
      return;
    }
    if (msg.type === "leave-room") {
      detachPlayer(player, "left");
      send(ws, "left-room");
      return;
    }
    send(ws, "error", { code: "UNKNOWN_ACTION" });
  });

  ws.on("close", () => detachPlayer(player, "disconnected"));
  ws.on("error", () => detachPlayer(player, "socket-error"));
});

server.listen(PORT, HOST, () => {
  console.log("Truth or Dare matchmaking listening on " + HOST + ":" + PORT);
});
