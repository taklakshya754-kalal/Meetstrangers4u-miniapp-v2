"use strict";

/**
 * Isolated Truth or Dare matchmaking service.
 * Runs separately from the calling service. In-memory rooms/queues; no wallet writes.
 */
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.TRUTH_DARE_PORT || 3012);
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
const users = new Map();  // telegram userId -> socket
const playersByUser = new Map(); // active player session per telegram user
const privateInvites = new Map(); // one-time invite tokens
const INVITE_TTL_MS = 15 * 60 * 1000;
const BOT_USERNAME = process.env.TRUTH_DARE_BOT_USERNAME || "Meetstrangers4u_bot";
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
  const urlPath=new URL(req.url,"http://localhost").pathname;
  if (req.method === "GET" && urlPath==="/invite/decline") {
    const token=new URL(req.url,"http://localhost").searchParams.get("token")||"";
    const inv=privateInvites.get(token);
    if(inv&&inv.status==="pending"&&Date.now()<inv.expiresAt){
      inv.status="declined";
      privateInvites.delete(token);
      const room=rooms.get(inv.roomId);
      if(room&&room.status==="inviting"){
        room.inviteIds.delete(inv.inviteeId);
        const host=room.players.find(p=>p.id===inv.hostId);
        const inviteeName=inv.inviteeName||"User ID "+inv.inviteeId;
        if(room.playerCount===2){
          if(host)send(host.ws,"invite-declined",{inviteeId:inv.inviteeId,inviteeName,closeRoom:true});
          for(const p of room.players){p.roomId=null;p.ready=false;if(p.id!==inv.hostId)send(p.ws,"room-closed",{reason:"invite-declined"});}
          room.status="closed";rooms.delete(room.id);
          for(const [pendingToken,pending] of privateInvites)if(pending.roomId===room.id)privateInvites.delete(pendingToken);
        }else if(host){
          send(host.ws,"invite-declined",{inviteeId:inv.inviteeId,inviteeName,closeRoom:false,players:room.players.map(safePlayer),pendingInviteCount:[...privateInvites.values()].filter(v=>v.roomId===room.id&&v.status==="pending").length});
        }
      }
    }
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end("<!doctype html><html><meta name='viewport' content='width=device-width'><body style='font-family:system-ui;background:#10152b;color:#eef;padding:32px'><h2>Invitation declined</h2><p>Return to your Telegram chat.</p></body></html>");
  }
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


async function sendPrivateInvite(invite) {
  if(process.env.TRUTH_DARE_TEST_MODE==="1")return false;
  const startLink="https://meetstrangers4u-miniapp-v2.vercel.app/?tdjoin=tdjoin_"+invite.token;
  const declineLink="https://truth-dare.lxreward.xyz/invite/decline?token="+encodeURIComponent(invite.token);
  const payload={chat_id:invite.inviteeId,text:"🎲 You have been invited to a private Truth or Dare room!\n\nPlayers: "+invite.playerCount+" · Mode: "+invite.mode+"\nInvitation expires in 15 minutes.",reply_markup:{inline_keyboard:[[{text:"Accept & Join",web_app:{url:startLink}},{text:"Decline",url:declineLink}]]}};
  const response=await fetch("https://api.telegram.org/bot"+BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({ok:false}));
  return !!data.ok;
}
function registerPrivateInvite(room,host,inviteeId){
  const token=crypto.randomBytes(24).toString("hex");
  const active=playersByUser.get(inviteeId);
  const inv={token,roomId:room.id,hostId:host.id,inviteeId,inviteeName:active?.name||null,playerCount:room.playerCount,mode:room.mode,status:"pending",expiresAt:Date.now()+INVITE_TTL_MS};
  privateInvites.set(token,inv);room.inviteIds.add(inviteeId);
  const expiry=setTimeout(()=>{const current=privateInvites.get(token);if(current&&current.status==="pending")privateInvites.delete(token);},INVITE_TTL_MS);expiry.unref?.();
  return inv;
}
function makePrivateRoom(host,inviteIds,mode) {
  const roomId=crypto.randomBytes(12).toString("hex"),count=inviteIds.length+1;
  const room={id:roomId,playerCount:count,mode,status:"inviting",createdAt:Date.now(),players:[host],isPrivate:true,inviteIds:new Set(inviteIds)};
  rooms.set(roomId,room);host.roomId=roomId;host.queueKey=null;host.host=true;host.ready=false;
  for(const inviteeId of inviteIds)registerPrivateInvite(room,host,inviteeId);
  send(host.ws,"custom-room-created",{roomId,playerCount:count,mode,players:room.players.map(safePlayer),...(process.env.TRUTH_DARE_TEST_MODE==="1"?{testInviteTokens:[...privateInvites.values()].filter(v=>v.roomId===roomId).map(v=>v.token)}:{})});
  const expireRoom=setTimeout(()=>{const active=rooms.get(roomId);if(!active||active.status!=="inviting")return;for(const p of active.players){p.roomId=null;p.ready=false;send(p.ws,"room-closed",{reason:"invite-expired"});}for(const [token,inv] of privateInvites)if(inv.roomId===roomId)privateInvites.delete(token);rooms.delete(roomId);},INVITE_TTL_MS);expireRoom.unref?.();
  (async()=>{let sent=0,failed=0;for(const id of inviteIds){const inv=[...privateInvites.values()].find(v=>v.roomId===roomId&&v.inviteeId===id&&v.status==="pending");if(inv&&await sendPrivateInvite(inv))sent++;else failed++;}send(host.ws,"custom-invites-sent",{sent,failed});})();
}
function joinPrivateRoom(player,token) {
  const invite=privateInvites.get(token);
  if(!invite||invite.status!=="pending"||Date.now()>invite.expiresAt)return send(player.ws,"error",{code:"INVITE_EXPIRED"});
  if(invite.inviteeId!==player.id)return send(player.ws,"error",{code:"INVITE_WRONG_USER"});
  const room=rooms.get(invite.roomId);
  if(!room||!room.isPrivate||!["inviting","lobby"].includes(room.status))return send(player.ws,"error",{code:"ROOM_UNAVAILABLE"});
  if(player.roomId||player.queueKey)return send(player.ws,"error",{code:"PLAYER_BUSY"});
  if(room.players.length>=room.playerCount)return send(player.ws,"error",{code:"ROOM_FULL"});
  if(room.players.some(p=>p.id===player.id))return send(player.ws,"error",{code:"ALREADY_JOINED"});
  privateInvites.delete(token);player.roomId=room.id;player.queueKey=null;player.host=false;player.ready=false;room.players.push(player);
  send(player.ws,"custom-joined",{roomId:room.id,playerCount:room.playerCount,mode:room.mode,players:room.players.map(safePlayer)});
  const host=room.players[0];send(host.ws,"custom-room-updated",{roomId:room.id,players:room.players.map(safePlayer),pendingInviteCount:[...privateInvites.values()].filter(v=>v.roomId===room.id&&v.status==="pending").length});
  if(room.players.length===room.playerCount){room.status="lobby";for(const [pendingToken,pending] of privateInvites)if(pending.roomId===room.id)privateInvites.delete(pendingToken);broadcast(room,"room-formed",{roomId:room.id,playerCount:room.playerCount,mode:room.mode,players:room.players.map(safePlayer),hostId:room.players[0].id});}else if(room.status==="lobby"){broadcast(room,"room-formed",{roomId:room.id,playerCount:room.playerCount,mode:room.mode,players:room.players.map(safePlayer),hostId:room.players[0].id});}
}

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
function safePlayer(p) { return { id: p.id, name: p.name, host: p.host, ready: p.ready, voiceActive: !!p.voiceActive }; }

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
  if (playersByUser.get(player.id) === player) playersByUser.delete(player.id);
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

// Server-authoritative gameplay state. Wallet/coin systems are intentionally not referenced.
const PROMPTS = {
  normal: {
    truth: [
      "What is a harmless habit you hope nobody notices?",
      "What is the funniest misunderstanding you have had?",
      "Which song do you secretly enjoy?",
      "What is one small thing that instantly improves your mood?",
      "What was your most awkward first impression?",
      "What is a skill you wish you could learn overnight?",
      "What is the strangest food combination you like?",
      "What is a silly fear you had as a child?"
    ],
    dare: [
      "Do your best dramatic movie entrance for 10 seconds.",
      "Speak like a news reporter until your next turn.",
      "Make up a two-line song about the room.",
      "Do a slow-motion celebration for 10 seconds.",
      "Describe your day using only three emojis, then explain.",
      "Give the group a funny nickname (keep it friendly).",
      "Try to make everyone laugh with a silly face.",
      "Narrate your next 20 seconds like a sports commentator."
    ]
  },
  advanced: {
    truth: [
      "What is a goal you have been postponing, and why?",
      "What is a lesson you learned the hard way?",
      "What is something you are proud of but rarely mention?",
      "When did you last step outside your comfort zone?",
      "What quality do you value most in a close friend?",
      "What is one opinion you changed recently?",
      "What is a challenge you handled better than expected?",
      "What is a promise to yourself you want to keep?"
    ],
    dare: [
      "Give a 30-second motivational speech to your future self.",
      "Perform a dramatic reading of a random sentence in chat.",
      "Invent a handshake and explain its three steps.",
      "Tell a short story with five words chosen by the room.",
      "Do a 20-second plank only if comfortable; otherwise act one out.",
      "Show a talent or describe it if you prefer not to use camera.",
      "Give a sincere compliment to each player in the room.",
      "Create an imaginary product and pitch it in 30 seconds."
    ]
  },
  dark: {
    truth: [
      "What is your most harmless villain origin story?",
      "Which mildly embarrassing moment still haunts you?",
      "What is the most chaotic thing in your browser bookmarks (skip details if private)?",
      "What ridiculous conspiracy would you invent about your own life?",
      "What is a petty hill you would defend for no reason?",
      "What is your most cursed but harmless shower thought?",
      "What would your warning label say?",
      "What is the funniest way you have sabotaged your own plans?"
    ],
    dare: [
      "Deliver a villain monologue about losing your charger.",
      "Roast your own profile description gently for 15 seconds.",
      "Pretend your phone is giving you a performance review.",
      "Describe a banana like it is a terrifying movie villain.",
      "Give a dramatic apology to an imaginary houseplant.",
      "Read your next message as if you are a haunted elevator.",
      "Make a fake breaking-news headline about yourself.",
      "Invent a useless superpower and demonstrate it."
    ]
  }
};
function initGame(room) {
  room.game = { scores: Object.fromEntries(room.players.map(p => [p.id, 0])), round: 0, phase: "spin", turnId: null, challenge: null, votes: {}, chatAt: new Map() };
  room.status = "game";
  broadcast(room, "game-state", { roomId: room.id, mode: room.mode, round: 0, phase: "spin", scores: room.game.scores, targetScore: 1000, players: room.players.map(safePlayer) });
}
function playerInGame(room, player) { return !!room && room.status === "game" && room.game && room.players.some(p => p.id === player.id); }
function spinBottle(room, player) {
  const game = room.game;
  if (!playerInGame(room, player) || game.phase !== "spin") return send(player.ws, "error", { code: "TURN_BUSY" });
  game.round++;
  const chosen = room.players[crypto.randomInt(room.players.length)];
  game.turnId = chosen.id; game.phase = "choose"; game.challenge = null; game.votes = {};
  broadcast(room, "bottle-spin", { round: game.round, selectedId: chosen.id, selectedName: chosen.name, spinMs: 4200, scores: game.scores });
}
function choosePrompt(room, player, type) {
  const game = room.game;
  if (!playerInGame(room, player) || game.phase !== "choose" || game.turnId !== player.id) return send(player.ws, "error", { code: "NOT_YOUR_TURN" });
  if (type !== "truth" && type !== "dare") return send(player.ws, "error", { code: "INVALID_CHOICE" });
  const pool = PROMPTS[room.mode][type];
  const prompt = pool[crypto.randomInt(pool.length)];
  game.challenge = { id: crypto.randomBytes(8).toString("hex"), type, text: prompt, playerId: player.id, playerName: player.name };
  game.phase = "task";
  broadcast(room, "challenge", { round: game.round, challenge: game.challenge });
}
function submitTask(room, player) {
  const game = room.game;
  if (!playerInGame(room, player) || game.phase !== "task" || game.turnId !== player.id || !game.challenge) return send(player.ws, "error", { code: "NOT_YOUR_TURN" });
  game.phase = "verify"; game.votes = {};
  broadcast(room, "task-submitted", { round: game.round, challenge: game.challenge, requiredVotes: room.playerCount === 2 ? 1 : 2, votes: {} });
}
function finishRound(room, accepted, skipped, reason) {
  const game = room.game, challenge = game.challenge;
  if (!challenge) return;
  let delta = skipped ? (challenge.type === "truth" ? -25 : -50) : accepted ? (challenge.type === "truth" ? 25 : 50) : 0;
  game.scores[challenge.playerId] = Math.max(-1000, (game.scores[challenge.playerId] || 0) + delta);
  const scores = game.scores;
  const winner = Object.entries(scores).find(([id, score]) => score >= 1000);
  game.phase = winner ? "finished" : "spin";
  game.challenge = null; game.votes = {};
  const ranked = room.players.map(p => ({ id: p.id, name: p.name, score: scores[p.id] || 0 })).sort((a,b)=>b.score-a.score);
  broadcast(room, "challenge-result", { round: game.round, playerId: challenge.playerId, challengeType: challenge.type, accepted: !!accepted, skipped: !!skipped, delta, reason: reason || null, scores, ranked, nextPhase: game.phase });
  if (winner) broadcast(room, "game-over", { winner: ranked[0], ranked, targetScore: 1000 });
}
function castVote(room, player, vote) {
  const game = room.game, challenge = game.challenge;
  if (!playerInGame(room, player) || game.phase !== "verify" || !challenge) return send(player.ws, "error", { code: "NO_VOTE_PENDING" });
  if (player.id === challenge.playerId) return send(player.ws, "error", { code: "CANNOT_VERIFY_SELF" });
  if (vote !== "yes" && vote !== "no") return send(player.ws, "error", { code: "INVALID_VOTE" });
  if (Object.prototype.hasOwnProperty.call(game.votes, player.id)) return send(player.ws, "error", { code: "VOTE_ALREADY_CAST" });
  game.votes[player.id] = vote;
  const voters = room.players.length - 1, required = room.playerCount === 2 ? 1 : 2;
  const yes = Object.values(game.votes).filter(v => v === "yes").length, no = Object.values(game.votes).filter(v => v === "no").length;
  broadcast(room, "verification-update", { votes: game.votes, yes, no, required });
  if (yes >= required) return finishRound(room, true, false, "verified");
  if (no > voters - required) return finishRound(room, false, false, "verification-failed");
}
function relayChat(room, player, textValue) {
  const game = room.game;
  if (!playerInGame(room, player) || typeof textValue !== "string") return send(player.ws, "error", { code: "INVALID_CHAT" });
  const message = textValue.trim().slice(0, 240);
  if (!message) return;
  const last = game.chatAt.get(player.id) || 0;
  if (Date.now() - last < 900) return send(player.ws, "error", { code: "CHAT_RATE_LIMIT" });
  game.chatAt.set(player.id, Date.now());
  broadcast(room, "chat-message", { id: crypto.randomBytes(6).toString("hex"), playerId: player.id, playerName: player.name, text: message, at: Date.now() });
}

function relayRtcSignal(room, player, targetId, signal) {
  if (!room || !["inviting","lobby","game"].includes(room.status) || !room.players.some(p=>p.id===player.id) || typeof targetId !== "string" || !signal || typeof signal !== "object") return send(player.ws, "error", { code: "INVALID_RTC_SIGNAL" });
  if (JSON.stringify(signal).length > 8192) return send(player.ws, "error", { code: "RTC_SIGNAL_TOO_LARGE" });
  const target = room.players.find(p => p.id === targetId && p.id !== player.id);
  if (!target) return send(player.ws, "error", { code: "RTC_PEER_NOT_FOUND" });
  const allowed = signal.type === "offer" || signal.type === "answer" || Object.prototype.hasOwnProperty.call(signal, "candidate");
  if (!allowed) return send(player.ws, "error", { code: "INVALID_RTC_SIGNAL" });
  send(target.ws, "rtc-signal", { from: player.id, signal });
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  let user;
  try { user = validateInitData(url.searchParams.get("initData") || ""); }
  catch (_) { ws.close(1008, "Unauthorized"); return; }

  const previous = users.get(user.id);
  const existingPlayer=playersByUser.get(user.id);
  const connectionUrl=new URL(req.url,"http://localhost");
  const customIntent=connectionUrl.searchParams.has("customRoom")||connectionUrl.searchParams.has("inviteToken");
  if(customIntent&&existingPlayer&&(existingPlayer.roomId||existingPlayer.queueKey)){
    send(ws,"error",{code:"PLAYER_BUSY"});
    ws.close(4003,"Player busy");
    return;
  }
  if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) previous.close(4001, "New connection");
  const player = { id: user.id, name: user.name, ws, host: false, ready: false, roomId: null, queueKey: null };
  users.set(user.id, ws);
  playersByUser.set(user.id,player);
  send(ws, "connected", { userId: user.id });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return send(ws, "error", { code: "BAD_MESSAGE" }); }
    if (!msg || typeof msg.type !== "string") return send(ws, "error", { code: "BAD_MESSAGE" });
    if(msg.type==="create-custom-room"){
      const mode=String(msg.mode||""),raw=Array.isArray(msg.inviteIds)?msg.inviteIds:[];
      if(!VALID_MODES.has(mode)||raw.length<1||raw.length>4)return send(ws,"error",{code:"INVALID_CUSTOM_SETTINGS"});
      const inviteIds=[...new Set(raw.map(x=>String(x)))];
      if(inviteIds.length!==raw.length||inviteIds.some(x=>!/^\d{5,16}$/.test(x)||x===player.id))return send(ws,"error",{code:"INVALID_INVITE_IDS"});
      if(player.roomId||player.queueKey)return send(ws,"error",{code:"PLAYER_BUSY"});
      if(inviteIds.some(id=>{const active=playersByUser.get(id);return active&&(active.roomId||active.queueKey);}))return send(ws,"error",{code:"INVITEE_BUSY"});
      makePrivateRoom(player,inviteIds,mode);return;
    }
    if(msg.type==="join-custom-room")return joinPrivateRoom(player,String(msg.token||""));
    if(msg.type==="host-add-invite"){
      const inviteeId=String(msg.inviteeId||""),room=rooms.get(player.roomId);
      if(!room||!room.isPrivate||!["inviting","lobby"].includes(room.status)||!player.host)return send(ws,"error",{code:"HOST_ONLY_INVITE"});
      if(!/^\d{5,16}$/.test(inviteeId)||inviteeId===player.id)return send(ws,"error",{code:"INVALID_INVITE_ID"});
      if(room.players.some(p=>p.id===inviteeId)||room.inviteIds.has(inviteeId))return send(ws,"error",{code:"ALREADY_INVITED"});
      const pendingCount=[...privateInvites.values()].filter(v=>v.roomId===room.id&&v.status==="pending").length;
      if(room.players.length+pendingCount>=room.playerCount)return send(ws,"error",{code:"ROOM_FULL"});
      const active=playersByUser.get(inviteeId);if(active&&(active.roomId||active.queueKey))return send(ws,"error",{code:"INVITEE_BUSY"});
      const inv=registerPrivateInvite(room,player,inviteeId);
      (async()=>{const sent=await sendPrivateInvite(inv);if(!sent&&process.env.TRUTH_DARE_TEST_MODE!=="1"){privateInvites.delete(inv.token);room.inviteIds.delete(inviteeId);}send(ws,"custom-invite-sent",{inviteeId,sent,...(process.env.TRUTH_DARE_TEST_MODE==="1"?{testInviteToken:inv.token}:{})});})();return;
    }
    if(msg.type==="voice-status"){
      const room=rooms.get(player.roomId);
      if(!room||!["inviting","lobby","game"].includes(room.status)||!room.players.some(p=>p.id===player.id))return send(ws,"error",{code:"VOICE_ROOM_UNAVAILABLE"});
      player.voiceActive=msg.active===true;
      broadcast(room,player.voiceActive?"voice-joined":"voice-left",{playerId:player.id,players:room.players.map(safePlayer)});return;
    }
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
        initGame(room);
      }
      return;
    }
    if (msg.type === "leave-room") {
      detachPlayer(player, "left");
      send(ws, "left-room");
      return;
    }
    const room = rooms.get(player.roomId);
    if (msg.type === "spin") return spinBottle(room, player);
    if (msg.type === "choose-challenge") return choosePrompt(room, player, String(msg.choice || ""));
    if (msg.type === "submit-task") return submitTask(room, player);
    if (msg.type === "skip-challenge") {
      if (!playerInGame(room, player) || room.game.phase !== "task" || room.game.turnId !== player.id) return send(ws, "error", { code: "NOT_YOUR_TURN" });
      return finishRound(room, false, true, "skipped");
    }
    if (msg.type === "verify-vote") return castVote(room, player, String(msg.vote || ""));
    if (msg.type === "chat") return relayChat(room, player, msg.text);
    if (msg.type === "rtc-signal") return relayRtcSignal(room, player, String(msg.to || ""), msg.signal);
    send(ws, "error", { code: "UNKNOWN_ACTION" });
  });

  ws.on("close", () => detachPlayer(player, "disconnected"));
  ws.on("error", () => detachPlayer(player, "socket-error"));
});

server.listen(PORT, HOST, () => {
  console.log("Truth or Dare matchmaking listening on " + HOST + ":" + PORT);
});
