-- Daily reps history for histogram ------------------------------------------

create table if not exists public.fit_reps (
  rep_date date primary key,
  reps integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.fit_reps enable row level security;

-- Allow anon role to read/insert/update reps history
drop policy if exists "anon select reps" on public.fit_reps;
create policy "anon select reps"
on public.fit_reps
for select
to anon
using (true);

drop policy if exists "anon insert reps" on public.fit_reps;
create policy "anon insert reps"
on public.fit_reps
for insert
to anon
with check (true);

drop policy if exists "anon update reps" on public.fit_reps;
create policy "anon update reps"
on public.fit_reps
for update
to anon
using (true)
with check (true);

-- (No delete policy on purpose)
