-- Submissions table: tracks aggregated rep submissions with 5-second grouping
create table if not exists public.fit_submissions (
  id bigint generated always as identity primary key,
  submitted_at timestamptz not null default now(),
  amount integer not null default 0,
  submission_date date not null default current_date
);

alter table public.fit_submissions enable row level security;

drop policy if exists "anon select submissions" on public.fit_submissions;
create policy "anon select submissions"
on public.fit_submissions
for select
to anon
using (true);

drop policy if exists "anon insert submissions" on public.fit_submissions;
create policy "anon insert submissions"
on public.fit_submissions
for insert
to anon
with check (true);

drop policy if exists "anon update submissions" on public.fit_submissions;
create policy "anon update submissions"
on public.fit_submissions
for update
to anon
using (true)
with check (true);
