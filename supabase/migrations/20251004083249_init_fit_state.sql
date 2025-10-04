-- Fit Tokens schema + RLS (single-row 'singleton') --------------------------

-- 1) Table
create table if not exists public.fit_state (
  id text primary key,
  start_date date not null,
  last_credited_date date not null,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 2) Enable RLS
alter table public.fit_state enable row level security;

-- 3) Policies (single row: 'singleton')

-- Allow anon to read ONLY the singleton row
drop policy if exists "anon select singleton" on public.fit_state;
create policy "anon select singleton"
on public.fit_state
for select
to anon
using (id = 'singleton');

-- Allow anon to insert ONLY the singleton row
drop policy if exists "anon insert singleton" on public.fit_state;
create policy "anon insert singleton"
on public.fit_state
for insert
to anon
with check (id = 'singleton');

-- Allow anon to update ONLY the singleton row
drop policy if exists "anon update singleton" on public.fit_state;
create policy "anon update singleton"
on public.fit_state
for update
to anon
using (id = 'singleton')
with check (id = 'singleton');

-- Optional: disallow delete by omitting a delete policy.
-- If you want deletes, uncomment below:
-- drop policy if exists "anon delete singleton" on public.fit_state;
-- create policy "anon delete singleton"
-- on public.fit_state
-- for delete
-- to anon
-- using (id = 'singleton');
