# Fit Tokens (GitHub Pages + Supabase)

A minimal, mobile-friendly web app that tracks daily fitness tokens:
- Day 1 adds 10 tokens, Day 2 adds 11, … capping at 100 per day.
- Tokens are credited when the page is opened (no cron). If multiple days passed, it credits the remaining days.
- You click a single button to spend one token per rep.
- Single-user, no auth, hosted on GitHub Pages.
- Data stored in Supabase with the anon key.

Tech: HTML + Bootstrap + jQuery + plain JS + Supabase JS v2

Files:
- index.html — UI layout
- css/styles.css — small mobile-first styles
- js/app.js — Supabase + token logic
- README.md — setup and notes (this file)


## 1) Supabase Setup

Use the SQL below to create the table and RLS policies. This restricts the app to a single row with id = 'singleton'.

1. In your Supabase project, open SQL Editor.
2. Run the block below:

```sql
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

-- Optional: disallow delete by not creating a delete policy.
-- If you do want deletes, uncomment:
-- drop policy if exists "anon delete singleton" on public.fit_state;
-- create policy "anon delete singleton"
-- on public.fit_state
-- for delete
-- to anon
-- using (id = 'singleton');
```

Notes:
- The app will automatically create the singleton row on first run. No manual seeding required.
- We intentionally allow anon role (public) because this is single-user and uses the anon key on GitHub Pages. Policies restrict it to a single row.


## 2) Configure Client (if needed)

The app currently derives your project URL from the given anon key (ref: mjhtmzwanpdtbxnhhscn), using:
- SUPABASE_URL: https://mjhtmzwanpdtbxnhhscn.supabase.co
- SUPABASE_ANON_KEY: in js/app.js

If your project ref or anon key changes:
- Edit js/app.js and update:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`


## 3) Deploy to GitHub Pages

- Push these files to your GitHub repo (root).
- In repo Settings → Pages:
  - Source: Deploy from a branch
  - Branch: main (root)
- Wait for Pages to build and publish the site URL.

You can also test locally by simply opening index.html in your browser (double-click or drag-drop).


## 4) How It Works

- On first visit:
  - Creates row: id = 'singleton'
  - Sets `start_date = today`
  - Sets `last_credited_date = yesterday` so that the first visit will credit today’s amount.
- On each subsequent visit:
  - Computes days between `last_credited_date` and `today`.
  - For each missing day i:
    - dayIndex = days since `start_date` + 1
    - add amount = min(10 + (dayIndex - 1), 100)
  - Sums them all, increments `balance`, sets `last_credited_date = today`.
- Button “I did one rep (-1)” decrements `balance` by one, if > 0.

Date math is done in local time using YYYY-MM-DD, avoiding timezone drift.


## 5) Troubleshooting

- If you see a red alert:
  - Open browser console to view the precise Supabase error message.
  - Verify the table exists and RLS policies are installed.
  - Confirm the `SUPABASE_URL` and `SUPABASE_ANON_KEY` in js/app.js are correct.

- If tokens don’t credit:
  - Check that the table row exists and that `last_credited_date` is in the past.
  - Confirm policies allow select/insert/update for the anon role (SQL above).

- If button is disabled:
  - Balance is 0; do more days to accrue tokens.


## 6) Security and Scope

- This is a single-user app with no authentication, using a single row guarded by RLS to `id = 'singleton'`.
- Anyone with the site URL can interact with that single row (intended single-user scenario).
- For multi-user or private usage, add auth and per-user rows and policies.


## 7) Reps histogram

This adds a daily reps history used to render the histogram.

Table and RLS:
```sql
create table if not exists public.fit_reps (
  rep_date date primary key,
  reps integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.fit_reps enable row level security;

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
```

Notes:
- Each click of “I did one rep (-1)” also increments fit_reps for today.
- The chart is powered by Chart.js and renders bars per date.

## License

MIT
