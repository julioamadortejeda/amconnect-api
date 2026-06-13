-- Add datetime/timezone handling instructions to both system prompts.
-- Dynamic values (current_datetime, timezone_offset, pending tasks) are injected
-- at runtime as a [CONTEXT] prefix in the user message — NOT in systemInstruction.
-- Keeping systemInstruction 100% static enables Gemini implicit caching (~90% cheaper).

UPDATE system_prompts
SET prompt = prompt || '

The advisor''s current local date/time and timezone offset are provided at the start of each message in a [CONTEXT] block. Always use these values when resolving relative date/time expressions (e.g. "tomorrow", "next tuesday at 3pm", "mañana", "el martes a las 3 de la tarde"). When setting "due_date" on reminders, use the timezone offset from [CONTEXT] and format as full ISO 8601 (e.g., "YYYY-MM-DDTHH:mm:ss-06:00").'
WHERE code IN ('ai_chat_system', 'policy_ingestion_system');
