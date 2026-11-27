"use strict";

const QUICK_MESSAGES = [
  "Hey! I'd love to get to know you. 👋",
  "Hi! How's your day going?",
  "You seem interesting. Want to connect?",
  "What's something that always makes you smile? 😊",
  "I'd love to learn about your culture.",
  "Hey! What do you enjoy doing in your free time?",
  "Hi! Always happy to make new friends.",
  "Your profile caught my attention. 😊",
  "Would you like to have a friendly chat?",
  "Hello! Sending positive vibes your way. ✨"
];

const USER_ID_RE = /^\d{1,20}$/;

function apiError(res, status, error, message) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error, message }));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function telegramNotify(botToken, userId, text, requestId, miniAppUrl) {
  const url = new URL(miniAppUrl);
  if (requestId) url.searchParams.set("explore_request", String(requestId));
  url.searchParams.set("screen", "explore");
  const response = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: userId,
      text,
      reply_markup: { inline_keyboard: [[{
        text: "Open MeetStrangers4u",
        web_app: { url: url.toString() }
      }]] }
    }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const err = new Error(result.description || "Telegram notification failed");
    err.code = "TELEGRAM_DELIVERY_FAILED";
    throw err;
  }
}

async function serveApprovedPhoto(res, pool, botToken, userId) {
  const photo = await pool.query(
    "SELECT approved_file_id FROM public.explore_profile_photos WHERE user_id=$1 AND approved_file_id IS NOT NULL",
    [userId]
  );
  if (!photo.rowCount) return apiError(res, 404, "PHOTO_NOT_FOUND", "Approved profile photo not found.");

  const fileInfoResponse = await fetch("https://api.telegram.org/bot" + botToken + "/getFile?file_id=" +
    encodeURIComponent(photo.rows[0].approved_file_id), { signal: AbortSignal.timeout(10000) });
  const fileInfo = await fileInfoResponse.json().catch(() => ({}));
  if (!fileInfoResponse.ok || !fileInfo.ok || !fileInfo.result?.file_path) {
    return apiError(res, 502, "PHOTO_UNAVAILABLE", "Profile photo is temporarily unavailable.");
  }

  const imageResponse = await fetch("https://api.telegram.org/file/bot" + botToken + "/" + fileInfo.result.file_path, {
    signal: AbortSignal.timeout(15000)
  });
  if (!imageResponse.ok) return apiError(res, 502, "PHOTO_UNAVAILABLE", "Profile photo is temporarily unavailable.");
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) return apiError(res, 415, "INVALID_PHOTO", "Invalid profile image.");
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(bytes.length),
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(bytes);
}

async function handleExploreRequest(ctx) {
  const { req, res, url, pool, validateTelegramInitData, readJsonBody, botToken, miniAppUrl } = ctx;
  if (!url.pathname.startsWith("/api/explore/")) return false;

  let user;
  try {
    user = validateTelegramInitData(req.headers["x-telegram-init-data"] || "");
  } catch (err) {
    apiError(res, err.statusCode || 401, "UNAUTHORIZED", "Please reopen the Mini App from Telegram.");
    return true;
  }

  const actorId = String(user.id);
  if (!USER_ID_RE.test(actorId)) {
    apiError(res, 401, "UNAUTHORIZED", "Invalid Telegram account.");
    return true;
  }

  try {
    const photoMatch = url.pathname.match(/^\/api\/explore\/photo\/(\d{1,20})$/);
    if (req.method === "GET" && photoMatch) {
      await serveApprovedPhoto(res, pool, botToken, photoMatch[1]);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/explore/profiles") {
      const result = await pool.query(
        `SELECT u.user_id::text AS user_id,
                COALESCE(NULLIF(u.custom_name,''), NULLIF(u.username,''), 'MeetStrangers4u Member') AS display_name,
                u.gender, u.age, u.country,
                (SELECT COUNT(*)::int FROM public.explore_reactions r
                  WHERE r.target_id=u.user_id AND r.reaction='like') AS likes_received
           FROM public.users u
           JOIN public.explore_profile_photos p ON p.user_id=u.user_id AND p.approved_file_id IS NOT NULL
          WHERE u.user_id <> $1
            AND NOT EXISTS (SELECT 1 FROM public.explore_reactions seen
                             WHERE seen.actor_id=$1 AND seen.target_id=u.user_id)
          ORDER BY p.updated_at DESC, u.user_id
          LIMIT 30`,
        [actorId]
      );
      sendJson(res, 200, {
        profiles: result.rows.map(row => ({
          ...row,
          photoUrl: "/api/explore/photo/" + row.user_id
        }))
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/explore/summary") {
      const [likes, messages, balance, ownPhoto] = await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM public.explore_reactions WHERE target_id=$1 AND reaction='like'", [actorId]),
        pool.query("SELECT COUNT(*)::int AS count FROM public.explore_messages WHERE recipient_id=$1 AND read_at IS NULL", [actorId]),
        pool.query("SELECT coins FROM public.users WHERE user_id=$1 LIMIT 1", [actorId]),
        pool.query("SELECT 1 FROM public.explore_profile_photos WHERE user_id=$1 AND approved_file_id IS NOT NULL", [actorId])
      ]);
      if (!balance.rowCount) return apiError(res, 404, "USER_NOT_FOUND", "Open the Telegram bot first.");
      sendJson(res, 200, {
        likes: likes.rows[0].count,
        unreadMessages: messages.rows[0].count,
        coins: Number(balance.rows[0].coins || 0),
        hasProfilePhoto: Boolean(ownPhoto.rowCount)
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/explore/inbox") {
      const result = await pool.query(
        "UPDATE public.explore_messages SET read_at=NOW() WHERE recipient_id=$1 AND read_at IS NULL RETURNING id,sender_id,message_text,created_at,read_at",
        [actorId]
      );
      const older = await pool.query(
        "SELECT id,sender_id,message_text,created_at,read_at FROM public.explore_messages WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 100",
        [actorId]
      );
      const merged = new Map([...older.rows, ...result.rows].map(row => [row.id, row]));
      sendJson(res, 200, { messages: [...merged.values()].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)) });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/explore/reactions") {
      const body = await readJsonBody(req);
      const targetId = String(body.targetId || "").trim();
      const reaction = String(body.reaction || "");
      if (!USER_ID_RE.test(targetId) || targetId === actorId || !["like", "dislike", "skip"].includes(reaction)) {
        return apiError(res, 400, "INVALID_REACTION", "Choose a valid profile and action.");
      }
      const target = await pool.query(
        "SELECT 1 FROM public.users u JOIN public.explore_profile_photos p ON p.user_id=u.user_id AND p.approved_file_id IS NOT NULL WHERE u.user_id=$1",
        [targetId]
      );
      if (!target.rowCount) return apiError(res, 404, "USER_UNAVAILABLE", "This profile is no longer available.");
      await pool.query(
        "INSERT INTO public.explore_reactions (actor_id,target_id,reaction) VALUES ($1,$2,$3) ON CONFLICT (actor_id,target_id) DO UPDATE SET reaction=EXCLUDED.reaction, updated_at=NOW()",
        [actorId, targetId, reaction]
      );
      if (reaction === "like") {
        telegramNotify(botToken, targetId, "❤️ Someone liked your profile on MeetStrangers4u!", null, miniAppUrl)
          .catch(err => console.error("Explore like notification:", err.message));
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/explore/messages") {
      const body = await readJsonBody(req);
      const targetId = String(body.targetId || "").trim();
      const messageKey = Number(body.messageKey);
      if (!USER_ID_RE.test(targetId) || targetId === actorId ||
          !Number.isInteger(messageKey) || messageKey < 0 || messageKey >= QUICK_MESSAGES.length) {
        return apiError(res, 400, "INVALID_MESSAGE", "Choose one of the available messages.");
      }
      const target = await pool.query(
        "SELECT 1 FROM public.users u JOIN public.explore_profile_photos p ON p.user_id=u.user_id AND p.approved_file_id IS NOT NULL WHERE u.user_id=$1",
        [targetId]
      );
      if (!target.rowCount) return apiError(res, 404, "USER_UNAVAILABLE", "This profile is no longer available.");
      const messageText = QUICK_MESSAGES[messageKey];
      const inserted = await pool.query(
        "INSERT INTO public.explore_messages (sender_id,recipient_id,message_key,message_text) VALUES ($1,$2,$3,$4) RETURNING id, created_at",
        [actorId, targetId, messageKey, messageText]
      );
      telegramNotify(botToken, targetId, "💌 You received a new message on MeetStrangers4u:\n\n" + messageText, inserted.rows[0].id, miniAppUrl)
        .catch(err => console.error("Explore message notification:", err.message));
      sendJson(res, 200, { ok: true, message: { id: inserted.rows[0].id, text: messageText, createdAt: inserted.rows[0].created_at } });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/explore/chat-requests") {
      const body = await readJsonBody(req);
      const targetId = String(body.targetId || "").trim();
      if (!USER_ID_RE.test(targetId) || targetId === actorId) {
        return apiError(res, 400, "INVALID_TARGET", "Choose a valid profile.");
      }
      const db = await pool.connect();
      let request;
      try {
        await db.query("BEGIN");
        const target = await db.query(
          "SELECT 1 FROM public.users u JOIN public.explore_profile_photos p ON p.user_id=u.user_id AND p.approved_file_id IS NOT NULL WHERE u.user_id=$1 FOR SHARE",
          [targetId]
        );
        if (!target.rowCount) {
          await db.query("ROLLBACK");
          return apiError(res, 404, "USER_UNAVAILABLE", "This profile is no longer available.");
        }
        const debit = await db.query(
          "UPDATE public.users SET coins=coins-50 WHERE user_id=$1 AND coins>=50 RETURNING coins",
          [actorId]
        );
        if (!debit.rowCount) {
          await db.query("ROLLBACK");
          return apiError(res, 409, "INSUFFICIENT_COINS", "You need 50 coins to send a chat request.");
        }
        const created = await db.query(
          "INSERT INTO public.explore_chat_requests (sender_id,recipient_id) VALUES ($1,$2) RETURNING id, expires_at",
          [actorId, targetId]
        );
        request = { id: created.rows[0].id, expiresAt: created.rows[0].expires_at, coins: Number(debit.rows[0].coins) };
        await db.query("COMMIT");
      } catch (err) {
        try { await db.query("ROLLBACK"); } catch (_) {}
        if (err.code === "23505") return apiError(res, 409, "REQUEST_PENDING", "You or this member already has a pending chat request.");
        throw err;
      } finally {
        db.release();
      }
      telegramNotify(botToken, targetId, "🤝 Someone wants to connect with you on MeetStrangers4u. This request expires in 10 minutes.", request.id, miniAppUrl)
        .catch(err => console.error("Explore chat request notification:", err.message));
      sendJson(res, 200, { ok: true, request, coins: request.coins });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/explore/chat-requests/respond") {
      const body = await readJsonBody(req);
      const requestId = Number(body.requestId);
      const accept = body.accept === true;
      if (!Number.isSafeInteger(requestId) || requestId <= 0) {
        return apiError(res, 400, "INVALID_REQUEST", "This chat request is invalid.");
      }
      const updated = await pool.query(
        "UPDATE public.explore_chat_requests SET status=$1, responded_at=NOW() WHERE id=$2 AND recipient_id=$3 AND status='pending' AND expires_at>NOW() RETURNING id,sender_id,recipient_id",
        [accept ? "accepted" : "declined", requestId, actorId]
      );
      if (!updated.rowCount) {
        await pool.query("UPDATE public.explore_chat_requests SET status='expired' WHERE id=$1 AND recipient_id=$2 AND status='pending' AND expires_at<=NOW()", [requestId, actorId]);
        return apiError(res, 404, "REQUEST_EXPIRED", "This request has expired or was already answered.");
      }
      const row = updated.rows[0];
      telegramNotify(
        botToken,
        row.sender_id,
        accept ? "✅ Your chat request was accepted! Open MeetStrangers4u to continue." : "Your chat request was declined.",
        row.id,
        miniAppUrl
      ).catch(err => console.error("Explore response notification:", err.message));
      sendJson(res, 200, { ok: true, accepted: accept });
      return true;
    }

    apiError(res, 404, "NOT_FOUND", "Explore endpoint not found.");
    return true;
  } catch (err) {
    console.error("Explore API:", err.message);
    const status = err.statusCode || 500;
    apiError(res, status, err.code || "SERVER_ERROR", status === 401 ? "Please reopen the Mini App from Telegram." : "Explore is temporarily unavailable.");
    return true;
  }
}

module.exports = { handleExploreRequest };
