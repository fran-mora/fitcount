-- Add rewards_balance column to fit_state table
alter table public.fit_state
add column if not exists rewards_balance numeric not null default 0;
