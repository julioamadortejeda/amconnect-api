-- Replace {{current_datetime}}/{{timezone_offset}} placeholders with a static instruction.
-- Dynamic values are now injected as a [CONTEXT] prefix in the user message at runtime,
-- keeping systemInstruction identical across all requests → Gemini implicit caching applies.

UPDATE system_prompts
SET prompt = REPLACE(
  prompt,
  E'Advisor''s Current Local Date and Time (with timezone offset): {{current_datetime}}\nIMPORTANT: When creating or updating reminders, always resolve date/time expressions (e.g. "tomorrow", "next tuesday at 3pm", "mañana", "el martes a las 3 de la tarde") using this current local date as reference, and format the output "due_date" as an ISO 8601 string including this exact timezone offset (e.g., "YYYY-MM-DDTHH:mm:ss{{timezone_offset}}").',
  E'The advisor''s current local date/time and timezone offset are provided at the start of each message in a [CONTEXT] block. Always use these values when resolving relative date/time expressions (e.g. "tomorrow", "next tuesday at 3pm", "mañana", "el martes a las 3 de la tarde"). When setting "due_date" on reminders, use the timezone offset from [CONTEXT] and format as full ISO 8601 (e.g., "YYYY-MM-DDTHH:mm:ss-06:00").'
)
WHERE code IN ('ai_chat_system', 'policy_ingestion_system')
  AND prompt LIKE '%{{current_datetime}}%';
