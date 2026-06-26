-- Body measurements table: one row per measurement session.
-- All fields except id + measured_at are nullable so the user can log only what they
-- measured that day. Most-recent non-null value per field is the "current" measurement.
create table if not exists public.fit_measurements (
  id bigint generated always as identity primary key,
  measured_at timestamptz not null default now(),
  weight_kg numeric,
  height_cm numeric,
  waist_cm numeric,
  hip_cm numeric,
  chest_cm numeric,
  arm_cm numeric,
  thigh_cm numeric,
  calf_cm numeric,
  forearm_cm numeric,
  neck_cm numeric,
  notes text
);

alter table public.fit_measurements enable row level security;

drop policy if exists "anon select measurements" on public.fit_measurements;
create policy "anon select measurements"
on public.fit_measurements
for select
to anon
using (true);

drop policy if exists "anon insert measurements" on public.fit_measurements;
create policy "anon insert measurements"
on public.fit_measurements
for insert
to anon
with check (true);

drop policy if exists "anon update measurements" on public.fit_measurements;
create policy "anon update measurements"
on public.fit_measurements
for update
to anon
using (true)
with check (true);

drop policy if exists "anon delete measurements" on public.fit_measurements;
create policy "anon delete measurements"
on public.fit_measurements
for delete
to anon
using (true);
