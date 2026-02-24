# FitCount (GitHub Pages + Supabase)

A minimal, mobile-friendly web app that tracks daily fitness tokens with a simple rule-set:
- Each day automatically removes tokens based on your configurable daily drain (processed when you open the page; no cron).
- You can edit the daily drain amount directly in the app.
- You click a single button to add one token per rep (+1 each click).
- Balance can go negative.
- Single-user, no auth, hosted on GitHub Pages.
- Data stored in Supabase with the anon key.

Tech: HTML + Bootstrap + jQuery + plain JS + Supabase JS v2

Files:
- index.html — UI layout
- css/styles.css — small mobile-first styles
- js/app.js — Supabase + token logic
- supabase/migrations — SQL you can run in Supabase to create tables and RLS policies
  - 20251004083249_init_fit_state.sql
  - 20251004084106_add_fit_reps.sql
  - 20251008193000_add_fit_daily_drain.sql
  - 20251008113100_reset_fit_data.sql (danger: destructive reset script)
  - 20251013084700_add_daily_drain_column.sql (adds editable daily_drain field)
  - 20260224120000_add_fit_submissions.sql (submissions tracking table)
- README.md — setup and notes (this file)


## 1) Supabase Setup

Run the SQL files in supabase/migrations in your Supabase project's SQL Editor (order is not strict, but running top-to-bottom by filename is fine). Alternatively, use the blocks below.

Core state table (single-row guarded by RLS; id = 'singleton'):
```sql
-- 1) Table
create table if not exists public.fit_state (
  id text primary key,
  start_date date not null,
  last_credited_date date not null,
  balance integer not null default 0,
  daily_drain integer not null default 100,
  updated_at timestamptz not null default now()
);

-- 2) Enable RLS
alter table public.fit_state enable row level security;

-- 3) Policies (single row: 'singleton')
drop policy if exists "anon select singleton" on public.fit_state;
create policy "anon select singleton"
on public.fit_state
for select
to anon
using (id = 'singleton');

drop policy if exists "anon insert singleton" on public.fit_state;
create policy "anon insert singleton"
on public.fit_state
for insert
to anon
with check (id = 'singleton');

drop policy if exists "anon update singleton" on public.fit_state;
create policy "anon update singleton"
on public.fit_state
for update
to anon
using (id = 'singleton')
with check (id = 'singleton');
```

Daily reps history (for the chart and auditing reps):
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

Daily drain history (audit of the automatic daily deductions based on your configured drain amount):
```sql
create table if not exists public.fit_daily_drain (
  drain_date date primary key,
  amount integer not null default 100,
  updated_at timestamptz not null default now()
);

alter table public.fit_daily_drain enable row level security;

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
```

Submissions history (tracks aggregated rep submissions per session):
```sql
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
```

Notes:
- The app will automatically create the singleton row on first run. No manual seeding required.
- We intentionally allow anon role (public) because this is single-user and uses the anon key on GitHub Pages. Policies restrict it appropriately.


## 2) Configure Client (if needed)

The app currently uses:
- SUPABASE_URL: https://mjhtmzwanpdtbxnhhscn.supabase.co
- SUPABASE_ANON_KEY: configured in js/app.js

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
  - Sets `last_credited_date = yesterday` so that the first visit will process today's drain
  - Sets `daily_drain = 100` (default value, editable in the UI)
- On each subsequent visit:
  - Computes days between `last_credited_date` and `today`
  - For each missing day, applies a drain based on the stored `daily_drain` value
  - Sums them all, decrements `balance` accordingly, sets `last_credited_date = today`
  - Also records each day's drain into `fit_daily_drain` (best-effort; non-fatal if insert fails)
- Daily Drain can be edited:
  - Change the value in the "Daily Drain" input field
  - Click "Update" to save the new drain rate
  - The new rate will apply to future daily drains
- Button “I did one rep (+1)”:
  - Increments `balance` by one (always allowed; balance can be negative)
  - Records one rep for today in `fit_reps` (insert or update today's row)

Date math is done in local time using YYYY-MM-DD, avoiding timezone drift.


## 5) Troubleshooting

- If you see a red alert:
  - Open browser console to view the precise Supabase error message.
  - Verify the tables exist and RLS policies are installed.
  - Confirm the `SUPABASE_URL` and `SUPABASE_ANON_KEY` in js/app.js are correct.

- If daily drain doesn’t apply:
  - Check that the `fit_state` singleton row exists and that `last_credited_date` is in the past relative to today.
  - Confirm policies allow select/insert/update for the anon role (SQL above).

- If reps aren’t recorded:
  - Ensure `fit_reps` table and policies are in place.
  - Check browser console for Supabase errors.

- The button is always enabled:
  - By design. You can add tokens even when the balance is negative.


## 6) Security and Scope

- This is a single-user app with no authentication, using a single row guarded by RLS to `id = 'singleton'`.
- Anyone with the site URL can interact with that single row (intended single-user scenario).
- For multi-user or private usage, add auth and per-user rows and policies.


## 7) Reps histogram

This adds a daily reps history used to render the histogram.

Notes:
- Each click of “I did one rep (+1)” increments `fit_reps` for today.
- The chart is powered by Chart.js and renders bars per date.


## 8) Today's Submissions

The app tracks submission entries in a panel at the bottom of the page.

- Each rep button click (+1, +5, +10) starts or extends a submission.
- Clicks within a **5-second window** are aggregated into a single submission entry.
- Example: clicking +10, then +1, then +1 quickly produces one entry with amount 12.
- After 5 seconds of no clicks, the aggregated submission is flushed to Supabase.
- On page load, today's submissions are fetched and displayed (time + amount).
- Data is stored in the `fit_submissions` table (see migration above).

### Fallback behavior (missing table)

If the `fit_submissions` table has not been created in Supabase (e.g. the migration
`20260224120000_add_fit_submissions.sql` has not been run), the app will:

1. **Show a visible warning alert** explaining that submissions storage is unavailable and
   directing the user to run the migration.
2. **Fall back to in-memory local storage** for the current browser session so the panel
   still updates and shows submission entries.
3. Local submissions are **not persisted** — they are lost on page reload.

To restore full persistent submissions, run the migration SQL in your Supabase SQL Editor
and reload the page.


## 9) Resetting data (danger)

Use `supabase/migrations/20251008113100_reset_fit_data.sql` in Supabase SQL Editor to clear app data:
- Truncates `fit_reps`
- Truncates `fit_daily_drain`
- Deletes the `fit_state` singleton row

After running, open the app; it will recreate the singleton row and process today’s daily drain (100 tokens) on first open.


## License

MIT
