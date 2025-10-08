-- Reset Fit Tokens data (Danger: destructive)
-- Run this in Supabase SQL Editor to clear existing app data.
-- After running, open the app; it will recreate the singleton row and start from today.

begin;

-- Clear daily reps history (chart data)
truncate table if exists public.fit_reps;

-- Clear singleton state row so app re-initializes on next load
delete from public.fit_state;

commit;

-- Notes:
-- - RLS policies do not apply when run via SQL Editor/service role.
-- - The app will recreate the 'fit_state' singleton row on first visit and
--   will credit today's amount using the new schedule (50 on Day 1, 51 on Day 2, ... capped at 100).
