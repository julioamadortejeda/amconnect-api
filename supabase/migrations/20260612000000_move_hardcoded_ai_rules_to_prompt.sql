-- Move static AI chat rules from ai_chat.service.ts hardcoded systemPrompt += to DB prompt.
-- These two rules were previously appended at runtime in code; moving them here means
-- they can be updated via migration without redeploying the Edge Function.

UPDATE system_prompts
SET prompt = prompt || '

CRITICAL RULE FOR REMINDERS/TASKS: Do NOT automatically or eagerly search for, resolve, or link a client (contact_id) or a policy (policy_id) to a reminder unless the user explicitly names a client as the target/assignee of the reminder or explicitly requests to link a specific policy. If the user refers to themselves (e.g., using words or pronouns like "me", "mi", "mis", "tengo que", "recuérdame", "mi póliza"), detect it as a general/personal task and keep contact_id and policy_id null/undefined. Under no circumstances should you query policies or contacts in the background to try to find a matching client/policy to link to a general reminder unless a specific client''s name is explicitly mentioned in the request. Keep contact_id and policy_id undefined/null in these cases.

CRITICAL UPDATE RULE: When a user asks to append details, notes, or updates to an existing reminder (e.g. "agrégale que...", "ponle como nota..."), do NOT append these to or rewrite the reminder''s "description" field. Keep the "description" as a concise summary, and send those new details/notes as the "comment" parameter to add a new comment to the reminder''s comment history.'
WHERE code = 'ai_chat_system';
