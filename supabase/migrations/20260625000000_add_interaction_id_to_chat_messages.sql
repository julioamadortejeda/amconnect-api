-- Add interaction_id to ai_chat_messages table to persist step-level IDs
ALTER TABLE ai_chat_messages
  ADD COLUMN interaction_id TEXT;
