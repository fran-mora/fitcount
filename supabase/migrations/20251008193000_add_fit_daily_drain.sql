-- Daily drain history (audit of automatic -100/day deductions) ---------------

create table if not exists public.fit_daily_drain (
  drain_date date primary key,
  amount integer not null default 100,
  updated_at timestamptz not null default now()
);

alter table public.fit_daily_drain enable row level security;

-- Allow anon role to read/insert/update drain history
drop policy if exists "anon select drain" on public.fit_daily_drain;
create policy "anon select drain"
on public.fit_daily_drain
for select
to anon
using (true);

drop policy if exists "anon insert drain" on public.fit_daily_drain;
create policy "anon insert drain"
on public.fit_daily_drain
for insert
to anon
with check (true);

drop policy if exists "anon update drain" on public.fit_daily_drain;
create policy "anon update drain"
on public.fit_daily_drain
for update
to anon
using (true)
with check (true);

-- (No delete policy on purpose)
