-- Sprint 10: Ambient Monitoring
-- Persists the latest monitoring report on the workspace row so the UI can
-- show the last-known state instantly before the next scan completes.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS last_monitoring_report       jsonb,
  ADD COLUMN IF NOT EXISTS last_monitoring_health_score integer;
