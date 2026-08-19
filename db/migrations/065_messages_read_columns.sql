-- Migration 065: Add read-tracking columns missing from prior migrations
-- Fixes silent failures in POST /api/chats/{id}/read and POST /api/chats/{id}/messages

-- chats: track when the tenant last read this conversation
ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

-- messages: track per-message read timestamp and which staff member sent it
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL;
