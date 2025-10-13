-- Add daily_drain column to fit_state table
alter table public.fit_state
add column if not exists daily_drain integer not null default 100;
