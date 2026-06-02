# FitCount — Auth + Photos Setup (one-time)

You need to do four things in the Supabase dashboard, then run one SQL block. After that, the auth gate + progress-photos feature shipped in the latest commit will work.

Until you complete these steps, **the app will be locked behind a sign-in screen that has no valid user** — so don't deploy / pull to your phone until you're done, or you'll be locked out.

Project: `mhjtmzwanpdtbxnhhscn` (URL: https://mhjtmzwanpdtbxnhhscn.supabase.co)

---

## 1. Enable email auth + disable public signups

1. Open the Supabase dashboard → your project → **Authentication → Providers**.
2. Click **Email**.
3. Settings:
   - **Enable Email provider**: ON
   - **Confirm email**: OFF (no inbox round-trip for a one-user app)
   - **Secure email change**: leave default
4. Save.
5. Go to **Authentication → Sign In / Up** (or "URL Configuration" / "Settings" depending on dashboard version). Find the toggle named one of:
   - "Allow new users to sign up"
   - "Enable sign ups"
   - "Disable signups"
   
   **Turn it OFF** (i.e., signups disabled). This is the lock that makes "authenticated" effectively mean "you".

## 2. Create your user

1. **Authentication → Users → Add user → Create new user**.
2. Email: your email.
3. Password: a strong one (use a password manager).
4. **Auto Confirm User**: ON (so you don't need to click an email link).
5. Create.

Remember the email + password — that's what you'll type into the sign-in screen the first time.

## 3. Create the photos bucket

1. **Storage → Create bucket**.
2. Name: `fit-photos` (must be exactly this).
3. **Public bucket**: OFF (keep it private — the app uses signed URLs).
4. Create.

## 4. Run this SQL once

**SQL Editor → New query**, paste, run:

```sql
-- ===== fit_photos table =====
create table if not exists public.fit_photos (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  balance      integer not null,
  daily_drain  integer not null,
  storage_path text not null
);

create index if not exists fit_photos_created_at_desc
  on public.fit_photos (created_at desc);

-- ===== Enable RLS on every table =====
alter table public.fit_state        enable row level security;
alter table public.fit_reps         enable row level security;
alter table public.fit_submissions  enable row level security;
alter table public.fit_daily_drain  enable row level security;
alter table public.fit_photos       enable row level security;

-- ===== Policies: authenticated users get full access =====
-- Signups are disabled in the dashboard, so "authenticated" == you.
-- Drop-then-create so this script is idempotent.
drop policy if exists "auth full access" on public.fit_state;
create policy "auth full access" on public.fit_state
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access" on public.fit_reps;
create policy "auth full access" on public.fit_reps
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access" on public.fit_submissions;
create policy "auth full access" on public.fit_submissions
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access" on public.fit_daily_drain;
create policy "auth full access" on public.fit_daily_drain
  for all to authenticated using (true) with check (true);

drop policy if exists "auth full access" on public.fit_photos;
create policy "auth full access" on public.fit_photos
  for all to authenticated using (true) with check (true);

-- ===== Storage policies: only authenticated can read/write fit-photos =====
drop policy if exists "auth read fit-photos"   on storage.objects;
drop policy if exists "auth write fit-photos"  on storage.objects;
drop policy if exists "auth update fit-photos" on storage.objects;
drop policy if exists "auth delete fit-photos" on storage.objects;

create policy "auth read fit-photos"
  on storage.objects for select
  to authenticated using (bucket_id = 'fit-photos');

create policy "auth write fit-photos"
  on storage.objects for insert
  to authenticated with check (bucket_id = 'fit-photos');

create policy "auth update fit-photos"
  on storage.objects for update
  to authenticated using (bucket_id = 'fit-photos');

create policy "auth delete fit-photos"
  on storage.objects for delete
  to authenticated using (bucket_id = 'fit-photos');
```

---

## Verify it worked

1. Open the deployed FitCount in a fresh browser tab (or your PWA). You should see the **Sign in** screen.
2. Enter your email + password. The app should appear.
3. Try **+ Photo** in the new Progress Photos card. Snap or pick an image. It should appear as a thumbnail.
4. Tap the thumbnail. You should see the full image with the date + balance + drain snapshotted at upload time.

## If anything breaks

- **"Invalid login credentials"**: password typo, or user not created in step 2.
- **App loads forever after sign-in**: probably an RLS policy issue. Open browser devtools → Network → look for a Supabase request returning empty / 403. The most likely culprit is one of the `fit_*` tables not having a policy.
- **Photo upload fails with 403 / "new row violates row-level security"**: the storage policies didn't apply. Re-run the bottom half of the SQL block.
- **Locked out completely**: open the Supabase dashboard, run `update auth.users set encrypted_password = crypt('newpass', gen_salt('bf')) where email='your@email';` to reset, or delete + recreate the user.

## Notes on staying signed in

- Add FitCount to your iOS Home Screen (Share → Add to Home Screen) and launch from the icon. That puts the PWA in standalone mode where iOS does not apply the 7-day storage-eviction rule.
- As long as the app is opened occasionally (every few weeks), the Supabase refresh-token chain stays alive and you'll never re-enter the password.
- PWA crashes do not clear localStorage — the session survives.
