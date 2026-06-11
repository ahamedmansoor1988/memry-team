-- One-off: run manually in the Supabase SQL Editor. NOT a migration.
--
-- These two messages were processed before the Sprint 32 migration existed,
-- so their decisions inserts failed but the rows were marked processed.
-- Deleting them makes the messages eligible for the slack-scan catch-up cron.

delete from slack_processed_messages
where slack_channel_id = 'C0B6PHJ7URL'
  and slack_message_ts in ('1781162345.761639', '1781162513.514639');
