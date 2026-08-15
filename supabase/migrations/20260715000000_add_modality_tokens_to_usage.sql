-- Add modality token breakdown columns to tokens_usage table
ALTER TABLE tokens_usage
  ADD COLUMN IF NOT EXISTS text_prompt_tokens       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audio_prompt_tokens      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS text_completion_tokens   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audio_completion_tokens  INT NOT NULL DEFAULT 0;
