-- Add timezone/datetime context instructions to both system prompts.
-- Uses {{current_datetime}} and {{timezone_offset}} placeholders that ai_chat.service.ts
-- substitutes at runtime before sending to the model. Static instruction text lives here
-- in DB; dynamic per-request values are injected in code via string replacement.

UPDATE system_prompts
SET prompt = prompt || '

Advisor''s Current Local Date and Time (with timezone offset): {{current_datetime}}
IMPORTANT: When creating or updating reminders, always resolve date/time expressions (e.g. "tomorrow", "next tuesday at 3pm", "mañana", "el martes a las 3 de la tarde") using this current local date as reference, and format the output "due_date" as an ISO 8601 string including this exact timezone offset (e.g., "YYYY-MM-DDTHH:mm:ss{{timezone_offset}}").'
WHERE code IN ('ai_chat_system', 'policy_ingestion_system');
