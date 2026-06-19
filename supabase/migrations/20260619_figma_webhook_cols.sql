-- Add Figma webhook tracking columns
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS figma_webhook_id_comment  text,
  ADD COLUMN IF NOT EXISTS figma_webhook_id_resolved text,
  ADD COLUMN IF NOT EXISTS figma_webhook_passcode    text;
