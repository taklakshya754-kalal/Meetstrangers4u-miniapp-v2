-- MeetStrangers4u Explore + approved profile photo storage
-- Run once as a PostgreSQL administrator against stranger_bot.

CREATE TABLE IF NOT EXISTS public.explore_profile_photos (
  user_id BIGINT PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
  approved_file_id TEXT,
  pending_file_id TEXT,
  pending_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.explore_reactions (
  actor_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like','dislike','skip')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (actor_id, target_id),
  CHECK (actor_id <> target_id)
);
CREATE INDEX IF NOT EXISTS explore_reactions_target_like_idx
  ON public.explore_reactions(target_id) WHERE reaction='like';

CREATE TABLE IF NOT EXISTS public.explore_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  message_key SMALLINT NOT NULL CHECK (message_key BETWEEN 0 AND 9),
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS explore_messages_recipient_created_idx
  ON public.explore_messages(recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.explore_chat_requests (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  responded_at TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS explore_chat_requests_one_pending_pair_idx
  ON public.explore_chat_requests(sender_id, recipient_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS explore_chat_requests_recipient_idx
  ON public.explore_chat_requests(recipient_id, created_at DESC);

-- Bot process uses stranger_bot; Mini App calling backend uses restricted m4_call_api.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.explore_profile_photos,
  public.explore_reactions, public.explore_messages, public.explore_chat_requests TO stranger_bot;
GRANT USAGE, SELECT ON SEQUENCE public.explore_messages_id_seq, public.explore_chat_requests_id_seq TO stranger_bot;

GRANT SELECT (username, gender, age) ON public.users TO m4_call_api;
GRANT SELECT ON public.explore_profile_photos TO m4_call_api;
GRANT SELECT, INSERT, UPDATE ON public.explore_reactions TO m4_call_api;
GRANT SELECT, INSERT, UPDATE ON public.explore_messages TO m4_call_api;
GRANT SELECT, INSERT, UPDATE ON public.explore_chat_requests TO m4_call_api;
GRANT USAGE, SELECT ON SEQUENCE public.explore_messages_id_seq TO m4_call_api;
GRANT USAGE, SELECT ON SEQUENCE public.explore_chat_requests_id_seq TO m4_call_api;
