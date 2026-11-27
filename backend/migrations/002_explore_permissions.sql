-- Grant the existing calling API database role access to Explore tables.
-- Wallet updates remain restricted to the existing users-table permissions.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.explore_reactions TO m4_call_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.explore_messages TO m4_call_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.explore_chat_requests TO m4_call_api;
GRANT USAGE, SELECT ON SEQUENCE public.explore_reactions_id_seq TO m4_call_api;
GRANT USAGE, SELECT ON SEQUENCE public.explore_messages_id_seq TO m4_call_api;
GRANT USAGE, SELECT ON SEQUENCE public.explore_chat_requests_id_seq TO m4_call_api;
