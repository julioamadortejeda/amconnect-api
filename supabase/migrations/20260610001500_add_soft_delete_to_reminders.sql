-- Add is_active and deleted_at columns to reminders table for logical deletion (soft delete)
ALTER TABLE reminders 
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN deleted_at timestamptz;
