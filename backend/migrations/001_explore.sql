-- MeetStrangers4u Explore feature schema
-- Apply to stranger_bot before enabling Explore API routes.
-- User IDs are stored as text to match Telegram IDs without coupling to users.user_id type.

CREATE TABLE IF NOT EXISTS public.explore_reactions (
  id BIGSERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike', 'skip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT explore_reactions_not_self CHECK (actor_id <> target_id),
  CONSTRAINT explore_reactions_unique_pair UNIQUE (actor_id, target_id)
);

CREATE INDEX IF NOT EXISTS explore_reactions_target_like_idx
  ON public.explore_reactions (target_id, created_at DESC)
  WHERE reaction = 'like';

CREATE TABLE IF NOT EXISTS public.explore_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  message_key SMALLINT NOT NULL CHECK (message_key BETWEEN 0 AND 9),
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  CONSTRAINT explore_messages_not_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS explore_messages_inbox_idx
  ON public.explore_messages (recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.explore_chat_requests (
  id BIGSERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  coin_cost INTEGER NOT NULL DEFAULT 50 CHECK (coin_cost = 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  responded_at TIMESTAMPTZ,
  CONSTRAINT explore_chat_requests_not_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS explore_chat_requests_recipient_pending_idx
  ON public.explore_chat_requests (recipient_id, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS explore_chat_requests_sender_pending_idx
  ON public.explore_chat_requests (sender_id, expires_at)
  WHERE status = 'pending';

-- A user may have at most one active incoming or outgoing request at a time.
CREATE UNIQUE INDEX IF NOT EXISTS explore_chat_requests_sender_active_idx
  ON public.explore_chat_requests (sender_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS explore_chat_requests_recipient_active_idx
  ON public.explore_chat_requests (recipient_id)
  WHERE status = 'pending';
