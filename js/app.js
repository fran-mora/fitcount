// FitCount App (plain JS + jQuery + Supabase)
// Single-user, no auth. Hosted on GitHub Pages. Data stored in Supabase.
// New rules:
// - Each day automatically removes tokens based on daily_drain setting (editable).
// - Each rep adds +1 token via the button.
// - Balance can go negative.

(() => {
  "use strict";

  // ====== Configure Supabase ======
  // Project ref is embedded in the anon JWT (ref: "mjhtmzwanpdtbxnhhscn").
  // Supabase URL pattern: https://<ref>.supabase.co
  const SUPABASE_URL = "https://mhjtmzwanpdtbxnhhscn.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oanRtendhbnBkdGJ4bmhoc2NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0NzE4NjEsImV4cCI6MjA3NTA0Nzg2MX0.M1T2lzqxMIFmfFO3iYR19GRrVVKxSDKxtLwDLvwzN4o";

  // persistSession + autoRefreshToken are on by default; spelled out for clarity. The
  // localStorage-backed session means a Home Screen PWA stays signed in indefinitely.
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
  });

  // ====== DOM elements ======
  const $todayText = $("#todayText");
  const $balanceText = $("#balanceText");
  const $rep1Btn = $("#rep1Btn");
  const $rep5Btn = $("#rep5Btn");
  const $rep10Btn = $("#rep10Btn");
  const $dailyDrainInput = $("#dailyDrainInput"); // Input for daily drain amount
  const $updateDrainBtn = $("#updateDrainBtn"); // Button to update daily drain
  const $addedSinceText = $("#addedSinceText"); // Shows total drained since last visit
  const $lastCreditedText = $("#lastCreditedText"); // Last processed up to
  const $startDateText = $("#startDateText");
  const $alertContainer = $("#alertContainer");
  const $alert = $("#alert");
  const $loading = $("#loading");
  const $repsChartCanvas = $("#repsChart");
  const $last5DaysList = $("#last5DaysList");
  const $submissionsList = $("#submissionsList");
  const $tierLabel = $("#tierLabel");
  const $nextUnlockText = $("#nextUnlockText");
  const $tierProgressBar = $("#tierProgressBar");
  const $tierHintText = $("#tierHintText");
  const $tierCard = $(".tier-card");
  const $drainFloorText = $("#drainFloorText");
  let repsChart = null;

  // ====== Tier ladder ======
  // Base drain 110 → at balance >= 200 unlock drain 120; every +100 tokens unlocks +10 drain,
  // capped at MAX_DRAIN. One-way ratchet: drain never auto-decreases.
  const BASE_DRAIN = 110;
  const MAX_DRAIN = 200;
  const TIER_STEP = 10;            // drain bump per tier
  const TOKEN_STEP = 100;          // tokens needed per tier
  const FIRST_THRESHOLD = 200;     // balance needed to unlock tier 1
  const MAX_TIER = (MAX_DRAIN - BASE_DRAIN) / TIER_STEP; // = 9

  function tierFor(balance) {
    if (balance < FIRST_THRESHOLD) return 0;
    const t = Math.floor((balance - (FIRST_THRESHOLD - TOKEN_STEP)) / TOKEN_STEP);
    return Math.max(0, Math.min(MAX_TIER, t));
  }

  function autoMinDrain(balance) {
    return BASE_DRAIN + tierFor(balance) * TIER_STEP;
  }

  function thresholdForTier(t) {
    // Tier 0 unlocked at -inf; tier t (>=1) unlocked at FIRST_THRESHOLD + (t-1)*TOKEN_STEP
    return FIRST_THRESHOLD + (t - 1) * TOKEN_STEP;
  }

  // ====== Theme helpers (sync Bootstrap color mode with OS preference) ======
  function isDarkModeActive() {
    return document.documentElement.getAttribute("data-bs-theme") === "dark";
  }

  function applyThemeFromSystem() {
    try {
      const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
      const isDark = mq && mq.matches;
      document.documentElement.setAttribute("data-bs-theme", isDark ? "dark" : "light");
      return isDark;
    } catch (_) {
      return isDarkModeActive();
    }
  }

  function getChartColors() {
    // Keep chart readable in both themes using Bootstrap CSS variables.
    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue("--bs-body-color").trim() || "#212529";

    // A slightly softer grid line looks better in both modes.
    const gridColor = isDarkModeActive() ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.10)";

    return { textColor, gridColor };
  }

  function applyChartTheme() {
    if (!repsChart) return;
    const { textColor, gridColor } = getChartColors();

    // Chart.js v4: update scale tick/grid colors and redraw.
    repsChart.options.scales.x.ticks.color = textColor;
    repsChart.options.scales.y.ticks.color = textColor;
    repsChart.options.scales.y.grid.color = gridColor;
    repsChart.update();
  }

  function onThemeChange() {
    applyThemeFromSystem();
    applyChartTheme();
  }

  // ====== Local date helpers (avoid timezone bugs) ======
  function toYMDLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseYMDLocal(ymd) {
    // ymd is "YYYY-MM-DD"
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function todayYMD() {
    return toYMDLocal(new Date());
  }

  function addDaysYMD(ymd, days) {
    const dt = parseYMDLocal(ymd);
    dt.setDate(dt.getDate() + days);
    return toYMDLocal(dt);
  }

  function daysBetweenYMD(fromYmd, toYmd) {
    // Whole days difference (to - from), local midnight to local midnight
    const a = parseYMDLocal(fromYmd);
    const b = parseYMDLocal(toYmd);
    const msPerDay = 24 * 60 * 60 * 1000;
    const diff = Math.floor((b - a) / msPerDay);
    return diff;
  }

  // ====== UI helpers ======
  function setLoading(visible) {
    if (visible) $loading.show();
    else $loading.hide();
  }

  function showAlert(msg, type = "warning") {
    $alert.removeClass().addClass(`alert alert-${type} py-2 px-3 small mb-0`).text(msg);
    $alertContainer.show();
  }

  function hideAlert() {
    $alertContainer.hide();
    $alert.text("");
  }

  function refreshUI(state, extras = {}) {
    // state: { id, start_date, last_credited_date, balance, daily_drain }
    // extras: { drainedNow }
    const now = new Date();
    $todayText.text(now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));

    // Show the current daily drain value in the input
    $dailyDrainInput.val(state.daily_drain || 100);
    // Show how many tokens were drained since last visit (positive number)
    $addedSinceText.text((extras.drainedNow || 0).toString());

    $lastCreditedText.text(state.last_credited_date);
    $startDateText.text(state.start_date);
    $balanceText.text(state.balance.toString());

    renderTier(state);

    // Enable rep buttons (balance can be negative)
    $rep1Btn.prop("disabled", false);
    $rep5Btn.prop("disabled", false);
    $rep10Btn.prop("disabled", false);
  }

  function drainTierFor(daily_drain) {
    const d = daily_drain || BASE_DRAIN;
    return Math.max(0, Math.min(MAX_TIER, Math.round((d - BASE_DRAIN) / TIER_STEP)));
  }

  function applyTierColor(state) {
    // Color follows max(balance-tier, drain-tier) so the accent never regresses once your
    // drain has ratcheted up, even if today's drain pulls your balance below the threshold.
    const colorTier = Math.max(tierFor(state.balance), drainTierFor(state.daily_drain));
    document.documentElement.setAttribute("data-tier", String(colorTier));
  }

  function renderTier(state) {
    const bal = state.balance;
    // Tier is driven by daily_drain (the ratcheted, authoritative source). Balance is
    // the progress meter toward the next tier-up; it gets reset to 0 on every tier-up.
    const tier = drainTierFor(state.daily_drain);
    const floor = autoMinDrain(bal);

    applyTierColor(state);

    $drainFloorText.text(floor);
    $dailyDrainInput.attr("min", floor);

    if (tier >= MAX_TIER) {
      $tierLabel.text(`Tier ${MAX_TIER} / ${MAX_TIER} — MAX (drain ${MAX_DRAIN})`);
      $nextUnlockText.text("Maxed out");
      $tierProgressBar.css("width", "100%");
      $tierHintText.text(`Top tier reached. Daily drain is locked at the maximum of ${MAX_DRAIN}.`);
      $tierCard.addClass("tier-maxed");
      return;
    }

    $tierCard.removeClass("tier-maxed");

    const nextTier = tier + 1;
    const nextDrain = BASE_DRAIN + nextTier * TIER_STEP;
    const nextAt = thresholdForTier(nextTier); // absolute balance needed (grind from 0)
    const pct = Math.max(0, Math.min(100, (bal / nextAt) * 100));
    const toGo = Math.max(0, nextAt - bal);

    $tierLabel.text(`Tier ${tier} / ${MAX_TIER} — drain ${state.daily_drain}`);
    $nextUnlockText.text(`${nextAt} tokens → drain ${nextDrain} (${toGo} to go)`);
    $tierProgressBar.css("width", pct + "%");
    $tierHintText.text(`Reach ${nextAt} tokens to bump drain to ${nextDrain} — balance resets to 0.`);
  }

  function flashTierCelebration(oldDrain, newDrain) {
    showAlert(`🎉 Tier up! Drain ${oldDrain} → ${newDrain}. Threshold deducted — grind on.`, "success");
    setTimeout(hideAlert, 4000);
    $tierCard.addClass("tier-bump-flash");
    setTimeout(() => $tierCard.removeClass("tier-bump-flash"), 1300);
  }

  // ====== Reps history (Chart) ======
  async function loadRepsHistory() {
    const { data, error } = await supabase
      .from("fit_reps")
      .select("*")
      .order("rep_date", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function renderRepsChart(rows) {
    if (!$repsChartCanvas.length) return;
    const ctx = $repsChartCanvas[0].getContext("2d");
    const labels = rows.map((r) => r.rep_date);
    const values = rows.map((r) => r.reps);

    const { textColor, gridColor } = getChartColors();
    const tierRgb = (getComputedStyle(document.documentElement)
      .getPropertyValue("--tier-color-rgb").trim()) || "13,110,253";
    const barColor = `rgba(${tierRgb}, 0.6)`;

    if (repsChart) {
      repsChart.destroy();
    }

    repsChart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Reps",
            data: values,
            backgroundColor: barColor,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { autoSkip: true, maxRotation: 0, color: textColor },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: textColor },
            grid: { color: gridColor },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} reps`,
            },
          },
        },
      },
    });
  }

  function renderLast5Days(rows) {
    if (!$last5DaysList.length) return;
    $last5DaysList.empty();

    const today = new Date();
    const listItems = [];

    // Last 5 days including today
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ymd = toYMDLocal(d);

      const row = rows.find((r) => r.rep_date === ymd);
      const count = row ? row.reps : 0;

      let label = ymd;
      if (i === 0) label = "Today";
      else if (i === 1) label = "Yesterday";
      else {
        // Format: "Mon, Oct 4"
        label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      }

      const html = `
        <li class="list-group-item d-flex justify-content-between align-items-center bg-transparent">
          <span>${label}</span>
          <span class="badge bg-primary rounded-pill">${count}</span>
        </li>
      `;
      listItems.push(html);
    }

    $last5DaysList.append(listItems);
  }

  async function refreshRepsChart() {
    try {
      const rows = await loadRepsHistory();
      renderRepsChart(rows);
      renderLast5Days(rows);
    } catch (e) {
      console.warn("Unable to load reps history:", e);
    }
  }

  async function incrementTodaysReps(amount = 1) {
    const today = todayYMD();
    const inc = Number(amount) || 1;
    // Read existing count
    const { data: existing, error: selErr } = await supabase
      .from("fit_reps")
      .select("reps")
      .eq("rep_date", today)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
      const { error: updErr } = await supabase
        .from("fit_reps")
        .update({ reps: existing.reps + inc })
        .eq("rep_date", today);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await supabase
        .from("fit_reps")
        .insert({ rep_date: today, reps: inc });
      if (insErr) throw insErr;
    }
  }

  // ====== Submissions (5-second aggregation with local fallback) ======
  const AGGREGATION_WINDOW_MS = 5000;
  let pendingSubmission = null; // { amount, timer }
  let submissionsUseLocal = false; // true when fit_submissions table is unavailable
  let localSubmissions = []; // in-memory fallback for current day

  function isTableMissingError(err) {
    if (!err) return false;
    const msg = (err.message || err.code || "").toLowerCase();
    return msg.includes("pgrst205") || msg.includes("not found") || msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
  }

  function showSubmissionsUnavailableAlert() {
    showAlert(
      "Submissions storage unavailable: the fit_submissions table is missing in Supabase. " +
      "Run the migration in supabase/migrations/20260224120000_add_fit_submissions.sql to enable persistent submissions. " +
      "Using local (in-memory) fallback for this session.",
      "warning"
    );
  }

  async function loadTodaysSubmissions() {
    if (submissionsUseLocal) {
      return localSubmissions;
    }
    const today = todayYMD();
    const { data, error } = await supabase
      .from("fit_submissions")
      .select("*")
      .eq("submission_date", today)
      .order("submitted_at", { ascending: false });

    if (error) {
      if (isTableMissingError(error)) {
        submissionsUseLocal = true;
        showSubmissionsUnavailableAlert();
        return localSubmissions;
      }
      throw error;
    }
    return data || [];
  }

  function renderSubmissions(rows) {
    if (!$submissionsList.length) return;
    $submissionsList.empty();

    if (!rows.length) {
      $submissionsList.append('<div class="text-muted small text-center py-2">No submissions yet today.</div>');
      return;
    }

    const items = rows.map((r) => {
      const t = new Date(r.submitted_at);
      const time = t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `
        <li class="list-group-item d-flex justify-content-between align-items-center bg-transparent">
          <span class="small">${time}</span>
          <span class="badge bg-primary rounded-pill">+${r.amount}</span>
        </li>`;
    });

    $submissionsList.append('<ul class="list-group list-group-flush small">' + items.join("") + "</ul>");
  }

  async function refreshSubmissions() {
    try {
      const rows = await loadTodaysSubmissions();
      renderSubmissions(rows);
    } catch (e) {
      console.warn("Unable to load submissions:", e);
    }
  }

  async function flushSubmission(amount) {
    const today = todayYMD();

    if (submissionsUseLocal) {
      localSubmissions.unshift({ submitted_at: new Date().toISOString(), amount, submission_date: today });
      renderSubmissions(localSubmissions);
      return;
    }

    const { error } = await supabase
      .from("fit_submissions")
      .insert({ amount, submission_date: today });

    if (error) {
      if (isTableMissingError(error)) {
        submissionsUseLocal = true;
        showSubmissionsUnavailableAlert();
        localSubmissions.unshift({ submitted_at: new Date().toISOString(), amount, submission_date: today });
        renderSubmissions(localSubmissions);
        return;
      }
      console.warn("Failed to save submission:", error);
      showAlert("Failed to save submission: " + error.message, "danger");
    }

    await refreshSubmissions();
  }

  function trackSubmission(amount) {
    if (pendingSubmission) {
      clearTimeout(pendingSubmission.timer);
      pendingSubmission.amount += amount;
    } else {
      pendingSubmission = { amount };
    }
    pendingSubmission.timer = setTimeout(() => {
      const total = pendingSubmission.amount;
      pendingSubmission = null;
      flushSubmission(total);
    }, AGGREGATION_WINDOW_MS);
  }

  // ====== Data layer ======
  async function ensureStateRow() {
    const { data, error } = await supabase
      .from("fit_state")
      .select("*")
      .eq("id", "singleton")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      const start = todayYMD();
      // so that today's drain will occur on first run
      const lastProcessed = addDaysYMD(start, -1);
      const { data: inserted, error: insErr } = await supabase
        .from("fit_state")
        .insert([{ id: "singleton", start_date: start, last_credited_date: lastProcessed, balance: 0, daily_drain: 100 }])
        .select()
        .single();

      if (insErr) throw insErr;
      return inserted;
    }

    return data;
  }

  async function processDrainIfNeeded(state) {
    const today = todayYMD();
    const daysToProcess = daysBetweenYMD(state.last_credited_date, today);

    if (daysToProcess <= 0) {
      return { state, drainedNow: 0 };
    }

    const dailyDrain = state.daily_drain || 100;

    // Build drain history rows
    const drainRows = [];
    for (let i = 1; i <= daysToProcess; i++) {
      const day = addDaysYMD(state.last_credited_date, i);
      drainRows.push({ drain_date: day, amount: dailyDrain });
    }

    // Upsert drain history (not fatal if it fails)
    try {
      const { error: upsertErr } = await supabase
        .from("fit_daily_drain")
        .upsert(drainRows);
      if (upsertErr) {
        console.warn("Failed to upsert drain history:", upsertErr);
      }
    } catch (e) {
      console.warn("Error recording drain history:", e);
    }

    const totalDrain = daysToProcess * dailyDrain;
    const newBalance = state.balance - totalDrain;

    // Update balance (tokens).
    const { data: updated, error: updErr } = await supabase
      .from("fit_state")
      .update({ balance: newBalance, last_credited_date: today })
      .eq("id", "singleton")
      .select("*")
      .single();

    if (updErr) throw updErr;

    return { state: updated, drainedNow: totalDrain };
  }

  async function incrementBy(state, amount) {
    const inc = Number(amount) || 1;
    const newBal = state.balance + inc;

    const { data: updated, error } = await supabase
      .from("fit_state")
      .update({ balance: newBal })
      .eq("id", "singleton")
      .select("*")
      .single();

    if (error) {
      showAlert(`Error updating balance: ${error.message}`, "danger");
      return state;
    }

    // Record reps for today
    try {
      await incrementTodaysReps(inc);
    } catch (e) {
      console.warn("Failed to record reps:", e);
      showAlert("Saved balance, but failed to record today's reps history.", "warning");
    }

    return updated;
  }

  async function updateDailyDrain(state, newDrain) {
    const { data: updated, error } = await supabase
      .from("fit_state")
      .update({ daily_drain: newDrain })
      .eq("id", "singleton")
      .select("*")
      .single();

    if (error) {
      showAlert(`Error updating daily drain: ${error.message}`, "danger");
      return state;
    }

    showAlert("Daily drain updated successfully!", "success");
    setTimeout(hideAlert, 3000);
    return updated;
  }

  // One-way ratchet: if the balance qualifies for a higher drain than currently set,
  // raise the drain to the floor and notify. Never lowers automatically.
  async function maybeAutoBumpDrain(state) {
    const floor = autoMinDrain(state.balance);
    if (floor <= (state.daily_drain || 0)) return state;

    const oldDrain = state.daily_drain;
    // Tier-up: deduct the threshold of the new tier from balance so any overflow
    // carries through (e.g., reaching balance 250 with tier-1 threshold=200 leaves 50).
    // Skipping multiple tiers in one increment is handled correctly because
    // thresholdForTier(N) equals the cumulative cost from 0 to tier N.
    const newDrainTier = Math.round((floor - BASE_DRAIN) / TIER_STEP);
    const threshold = thresholdForTier(newDrainTier);
    const newBalance = Math.max(0, state.balance - threshold);

    const { data: updated, error } = await supabase
      .from("fit_state")
      .update({ daily_drain: floor, balance: newBalance })
      .eq("id", "singleton")
      .select("*")
      .single();

    if (error) {
      console.warn("Failed to auto-bump daily drain:", error);
      return state;
    }

    flashTierCelebration(oldDrain, floor);
    return updated;
  }

  // ====== Progress photos ======
  // Photos live in private Supabase Storage bucket "fit-photos"; metadata (created_at,
  // balance, daily_drain, storage_path) lives in table public.fit_photos. RLS gates both.
  const PHOTO_BUCKET = "fit-photos";
  const PHOTO_MAX_DIM = 1024;
  const PHOTO_JPEG_QUALITY = 0.7;

  // Resize an uploaded image to fit within MAX_DIM x MAX_DIM, return a JPEG Blob.
  function resizePhotoFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Failed to decode image"));
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error("Canvas encode failed")),
            "image/jpeg",
            PHOTO_JPEG_QUALITY
          );
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Resolve a stored object to a short-lived signed URL. Re-issued per render so the
  // bucket can stay private (no public reads).
  async function signedUrlFor(path, expiresSec = 3600) {
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(path, expiresSec);
    if (error) throw error;
    return data.signedUrl;
  }

  async function fetchPhotos() {
    const { data, error } = await supabase
      .from("fit_photos")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function renderPhotosStrip() {
    const $strip = $("#photosStrip");
    let photos;
    try {
      photos = await fetchPhotos();
    } catch (err) {
      $strip.html(`<div class="text-danger small">Failed to load photos: ${err.message}</div>`);
      return;
    }
    if (!photos.length) {
      $strip.html(`<div class="text-muted small text-center py-2">No photos yet — snap one to start tracking shape vs. drain over time.</div>`);
      return;
    }
    $strip.empty();
    for (const p of photos) {
      let url;
      try { url = await signedUrlFor(p.storage_path); }
      catch (_) { continue; }
      const dateStr = new Date(p.created_at).toLocaleDateString();
      const $img = $(`<img class="photo-thumb" loading="lazy" alt="${dateStr}" title="${dateStr} · bal ${p.balance} · drain ${p.daily_drain}" />`);
      $img.attr("src", url);
      $img.on("click", () => openPhotoModal(p, url));
      $strip.append($img);
    }
  }

  function openPhotoModal(photo, url) {
    const dateStr = new Date(photo.created_at).toLocaleString();
    $("#photoModalImg").attr("src", url);
    $("#photoModalMeta").html(
      `<div><strong>${dateStr}</strong></div>` +
      `<div>Balance: ${photo.balance} · Daily drain: ${photo.daily_drain}</div>`
    );
    $("#photoDeleteBtn").off("click").on("click", async () => {
      if (!window.confirm("Delete this photo?")) return;
      await deletePhoto(photo);
      closePhotoModal();
      await renderPhotosStrip();
    });
    $("#photoModal").addClass("show").attr("aria-hidden", "false");
  }
  function closePhotoModal() {
    $("#photoModal").removeClass("show").attr("aria-hidden", "true");
    $("#photoModalImg").attr("src", "");
  }

  async function deletePhoto(photo) {
    // Best-effort: remove object then row. If storage removal fails we still drop the
    // row so the gallery isn't stuck on a broken thumbnail.
    try { await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]); } catch (_) {}
    await supabase.from("fit_photos").delete().eq("id", photo.id);
  }

  async function uploadPhoto(file) {
    const $uploading = $("#photosUploading");
    $uploading.show();
    try {
      const blob = await resizePhotoFile(file);
      // Read current fit_state at upload time for the metadata snapshot. Fresher than
      // closing over `state` inside init(), which could go stale across many ops.
      const { data: cur, error: curErr } = await supabase
        .from("fit_state").select("balance, daily_drain").eq("id", "singleton").single();
      if (curErr) throw curErr;

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${ts}-${rand}.jpg`;

      const { error: upErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase
        .from("fit_photos")
        .insert({ balance: cur.balance, daily_drain: cur.daily_drain, storage_path: path });
      if (insErr) {
        // Roll back the storage object so we don't leave orphans.
        try { await supabase.storage.from(PHOTO_BUCKET).remove([path]); } catch (_) {}
        throw insErr;
      }
      await renderPhotosStrip();
    } catch (err) {
      console.error(err);
      window.alert("Photo upload failed: " + (err.message || err));
    } finally {
      $uploading.hide();
    }
  }

  async function setupPhotos() {
    $("#photoFileInput").off("change").on("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await uploadPhoto(file);
      // Clear so re-selecting the same file still fires change.
      e.target.value = "";
    });
    $("#photoCloseBtn").off("click").on("click", closePhotoModal);
    $("#photoModal").off("click").on("click", (e) => {
      if (e.target === document.getElementById("photoModal")) closePhotoModal();
    });
    await renderPhotosStrip();
  }

  // ====== App init ======
  async function init() {
    // Keep theme in sync with system preference (including when user changes it while the page is open)
    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq) {
      // Safari uses addListener/removeListener, modern browsers use addEventListener
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onThemeChange);
      else if (typeof mq.addListener === "function") mq.addListener(onThemeChange);
    }

    applyThemeFromSystem();

    setLoading(true);
    hideAlert();

    try {
      let state = await ensureStateRow();
      const { state: processedState, drainedNow } = await processDrainIfNeeded(state);
      state = processedState;

      // Apply ratchet at boot (in case the user's balance already qualifies for a higher tier)
      state = await maybeAutoBumpDrain(state);

      refreshUI(state, { drainedNow });
      await refreshRepsChart();
      await refreshSubmissions();
      await setupPhotos();

      // Wire up rep buttons
      function setRepButtonsDisabled(disabled) {
        $rep1Btn.prop("disabled", disabled);
        $rep5Btn.prop("disabled", disabled);
        $rep10Btn.prop("disabled", disabled);
      }

      const handleAdd = (amt) => async () => {
        setRepButtonsDisabled(true);
        try {
          const updated = await incrementBy(state, amt);
          state = updated;
          // Ratchet check after every rep — this is where tier-ups happen
          state = await maybeAutoBumpDrain(state);
          refreshUI(state, { drainedNow: 0 });
          await refreshRepsChart();
          trackSubmission(amt);
        } finally {
          setRepButtonsDisabled(false);
        }
      };

      $rep1Btn.off("click").on("click", handleAdd(1));
      $rep5Btn.off("click").on("click", handleAdd(5));
      $rep10Btn.off("click").on("click", handleAdd(10));

      // ===== Interval workout (10 reps/min, 30s work / 30s rest) =====
      const $startWorkoutBtn = $("#startWorkoutBtn");
      const $workoutOverlay = $("#workoutOverlay");
      const $workoutSetup = $("#workoutSetup");
      const $workoutWarmupInput = $("#workoutWarmupInput");
      const $workoutGoBtn = $("#workoutGoBtn");
      const $workoutSetupCancelBtn = $("#workoutSetupCancelBtn");
      const $workoutRunning = $("#workoutRunning");
      const $workoutReview = $("#workoutReview");
      const $workoutClock = $("#workoutClock");
      const $workoutPhase = $("#workoutPhase");
      const $workoutSetStatus = $("#workoutSetStatus");
      const $workoutMinuteText = $("#workoutMinuteText");
      const $workoutPhaseCountdown = $("#workoutPhaseCountdown");
      const $workoutSets = $("#workoutSets");
      const $workoutLivePoints = $("#workoutLivePoints");
      const $workoutStopBtn = $("#workoutStopBtn");
      const $workoutAddRestBtn = $("#workoutAddRestBtn");
      const $workoutExtraRest = $("#workoutExtraRest");
      const $workoutSummaryText = $("#workoutSummaryText");
      const $workoutPointsInput = $("#workoutPointsInput");
      const $workoutConfirmBtn = $("#workoutConfirmBtn");
      const $workoutDiscardBtn = $("#workoutDiscardBtn");

      let workoutInterval = null;
      let workoutPreroll = null;
      let workoutWarmupInterval = null;
      let workoutStartMs = 0;
      let workoutLastPhase = null;
      let workoutLastBeepSec = -1;
      let workoutSetsDone = -1;
      let workoutActive = false;
      let workoutInWarmup = false;
      let wakeLockSentinel = null;
      // Extra-rest pause: while extraRestEndsMs > 0 the main clock is frozen and a secondary
      // countdown ticks down. extraRestStartedMs marks when the current pause began; on pause
      // end we shift workoutStartMs forward by (end - start) so the main clock resumes exactly
      // where it was. Subsequent +15 clicks while paused just extend extraRestEndsMs.
      let extraRestEndsMs = 0;
      let extraRestStartedMs = 0;

      function resetExtraRest() {
        extraRestEndsMs = 0;
        extraRestStartedMs = 0;
        $workoutExtraRest.hide().text("");
      }

      const WARMUP_LS_KEY = "fitcount.warmupMinutes";
      function getStoredWarmupMinutes() {
        try {
          const v = parseInt(localStorage.getItem(WARMUP_LS_KEY) || "2", 10);
          if (isNaN(v) || v < 0 || v > 30) return 2;
          return v;
        } catch (_) { return 2; }
      }
      function storeWarmupMinutes(v) {
        try { localStorage.setItem(WARMUP_LS_KEY, String(v)); } catch (_) {}
      }

      // Keep the screen awake while the workout is running. Uses the Screen Wake Lock API
      // (iOS Safari ≥16.4, Chrome Android, Chrome desktop). Must be called inside a user
      // gesture initially; the lock auto-releases on page hide and must be re-acquired on
      // visibility return.
      async function requestWakeLock() {
        try {
          if ("wakeLock" in navigator && !wakeLockSentinel) {
            wakeLockSentinel = await navigator.wakeLock.request("screen");
            wakeLockSentinel.addEventListener("release", () => { wakeLockSentinel = null; });
          }
        } catch (_) { wakeLockSentinel = null; }
      }
      async function releaseWakeLock() {
        try {
          if (wakeLockSentinel) { await wakeLockSentinel.release(); wakeLockSentinel = null; }
        } catch (_) { wakeLockSentinel = null; }
      }
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && workoutActive) requestWakeLock();
      });

      const pad2 = (n) => String(n).padStart(2, "0");
      const fmtClock = (totalSec) => `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;

      // Schedule walker. Each set is 30s work + 30s rest; after every 5th set there's an extra
      // 30s bonus rest, and after every 10th set the bonus is 60s instead.
      // Returns: { set, phase: 'work'|'rest'|'bonus_rest', secsLeft, setsDone, bonusTotal }.
      function bonusAfterSet(n) {
        if (n % 10 === 0) return 60;
        if (n % 5 === 0) return 30;
        return 0;
      }
      function workoutScheduleAt(totalSec) {
        let t = 0, set = 1;
        while (set < 1000) {
          if (totalSec < t + 30) return { set, phase: "work", secsLeft: t + 30 - totalSec, setsDone: set - 1, bonusTotal: 0 };
          t += 30;
          // Badge for set N appears as soon as its work phase ends — so setsDone=set during rest.
          if (totalSec < t + 30) return { set, phase: "rest", secsLeft: t + 30 - totalSec, setsDone: set, bonusTotal: 0 };
          t += 30;
          const bonus = bonusAfterSet(set);
          if (bonus > 0 && totalSec < t + bonus) return { set, phase: "bonus_rest", secsLeft: t + bonus - totalSec, setsDone: set, bonusTotal: bonus };
          t += bonus;
          set += 1;
        }
        return { set: 999, phase: "rest", secsLeft: 0, setsDone: 999, bonusTotal: 0 };
      }
      function nextPhaseAfter(st) {
        if (st.phase === "work") return "rest";
        if (st.phase === "rest") return bonusAfterSet(st.set) > 0 ? "bonus_rest" : "work";
        return "work"; // bonus_rest → work
      }
      // 10 points per set; partial credit granted the moment a set's work begins (matches
      // the prior "ceil(minutes) * 10" generosity). Bonus rest doesn't add points.
      function suggestPointsFromState(totalSec, st) {
        if (totalSec <= 0) return 0;
        if (st.phase === "bonus_rest") return st.setsDone * 10;
        return st.set * 10;
      }
      const suggestPoints = (totalSec) => suggestPointsFromState(totalSec, workoutScheduleAt(totalSec));

      // ----- Audio cues -----
      // Primary path: Web Audio (oscillator + gain envelope). On iOS this uses the
      // "ambient" audio-session category, which MIXES with background music
      // (Spotify/podcasts) instead of pausing it.
      // Fallback path: HTMLAudio with baked-in WAV tones. iOS forces this into the
      // "playback" category, which pauses other audio — only used if AudioContext is
      // unavailable (very old browsers). The old iOS PWA Web-Audio-silence bug that
      // motivated HTMLAudio-by-default was fixed in iOS 16.4 (Apr 2023).
      function makeToneWavDataUrl(freqHz, durationMs, peakGain = 0.75) {
        const sr = 22050;
        const samples = Math.max(1, Math.floor(sr * durationMs / 1000));
        const buf = new ArrayBuffer(44 + samples * 2);
        const dv = new DataView(buf);
        const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
        writeStr(0, "RIFF"); dv.setUint32(4, 36 + samples * 2, true);
        writeStr(8, "WAVE"); writeStr(12, "fmt ");
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
        dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
        dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
        writeStr(36, "data"); dv.setUint32(40, samples * 2, true);
        const attack  = Math.min(samples >> 1, Math.floor(sr * 0.008));
        const release = Math.min(samples >> 1, Math.floor(sr * 0.04));
        for (let i = 0; i < samples; i++) {
          let env = 1;
          if (i < attack) env = i / attack;
          else if (i > samples - release) env = (samples - i) / release;
          const s = Math.sin(2 * Math.PI * freqHz * i / sr) * env * peakGain;
          dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true);
        }
        const bytes = new Uint8Array(buf);
        let bin = ""; const CHUNK = 0x8000;
        for (let off = 0; off < bytes.length; off += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(off, off + CHUNK));
        }
        return "data:audio/wav;base64," + btoa(bin);
      }

      // Two distinct cue palettes: brighter/urgent tones lead into WORK, mellower/calmer
      // tones lead into REST. Each phase gets its own tick (3-2-1 countdown) and accent (the
      // phase-change moment itself).
      const cueWorkTick    = new Audio(makeToneWavDataUrl(920, 180));   // rest ending, work coming
      const cueWorkAccent  = new Audio(makeToneWavDataUrl(1400, 340));  // WORK begins (new set)
      const cueRestTick    = new Audio(makeToneWavDataUrl(620, 180));   // work ending, rest coming
      const cueRestAccent  = new Audio(makeToneWavDataUrl(880, 340));   // REST begins
      // Tone metadata used by the Web Audio path (preferred over HTMLAudio so
      // background music keeps playing).
      cueWorkTick.cueTone   = { freq: 920,  ms: 180 };
      cueWorkAccent.cueTone = { freq: 1400, ms: 340 };
      cueRestTick.cueTone   = { freq: 620,  ms: 180 };
      cueRestAccent.cueTone = { freq: 880,  ms: 340 };
      // Separate silent unlock element so we never touch the cue elements before their
      // first real play. Touching them in the gesture (e.g. play+pause) created a race that
      // killed the very first "3" beep in earlier versions.
      const silentUnlockAudio = new Audio(makeToneWavDataUrl(440, 10, 0)); // 10 ms of silence
      [cueWorkTick, cueWorkAccent, cueRestTick, cueRestAccent, silentUnlockAudio].forEach((a) => {
        a.preload = "auto";
        a.playsInline = true;
      });

      // Web Audio context — created lazily on the Start gesture so iOS unlocks it.
      let audioCtx = null;
      let useWebAudio = false;

      function ensureAudioCtx() {
        if (audioCtx) return audioCtx;
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return null;
          audioCtx = new Ctx();
          return audioCtx;
        } catch (_) { return null; }
      }

      function playToneWebAudio(freqHz, durationMs, peak = 0.5) {
        if (!audioCtx) return false;
        try {
          if (audioCtx.state === "suspended") audioCtx.resume();
          const now = audioCtx.currentTime;
          const dur = durationMs / 1000;
          const attack = 0.008;
          const release = Math.min(dur / 2, 0.04);
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.value = freqHz;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(peak, now + attack);
          gain.gain.setValueAtTime(peak, now + Math.max(attack, dur - release));
          gain.gain.linearRampToValueAtTime(0, now + dur);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + dur + 0.02);
          return true;
        } catch (_) { return false; }
      }

      // Inside the Start user gesture, prime the audio path. Web Audio is preferred
      // because it mixes with background music; we only fall back to HTMLAudio
      // priming if AudioContext can't be created. Touching HTMLAudio at all would
      // flip iOS into "playback" mode and pause Spotify, so we skip it when we don't
      // need it.
      function primeBeepAudio() {
        const ctx = ensureAudioCtx();
        if (ctx) {
          try {
            const p = ctx.resume();
            if (p && typeof p.catch === "function") p.catch(() => {});
            // One-sample silent buffer to fully unlock the context inside the gesture.
            const buf = ctx.createBuffer(1, 1, 22050);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.start(0);
            useWebAudio = true;
            return;
          } catch (_) { useWebAudio = false; }
        }
        // Fallback: prime HTMLAudio (will pause background music on iOS).
        try {
          silentUnlockAudio.currentTime = 0;
          const p = silentUnlockAudio.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch (_) { /* ignore */ }
        [cueWorkTick, cueWorkAccent, cueRestTick, cueRestAccent].forEach((a) => {
          try {
            a.muted = true;
            const p = a.play();
            const restore = () => { try { a.pause(); a.currentTime = 0; a.muted = false; } catch (_) {} };
            if (p && typeof p.then === "function") p.then(restore).catch(restore);
            else restore();
          } catch (_) { a.muted = false; }
        });
      }

      function playCue(audio) {
        if (useWebAudio && audio && audio.cueTone) {
          if (playToneWebAudio(audio.cueTone.freq, audio.cueTone.ms)) return;
        }
        try {
          audio.currentTime = 0;
          const p = audio.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch (_) { /* ignore */ }
      }

      // Renders only the completed-set badges; status text is set in tickWorkout because
      // bonus rests need different wording.
      function renderSets(setsDone) {
        if (setsDone === workoutSetsDone) return;
        workoutSetsDone = setsDone;
        let html = "";
        for (let i = 1; i <= setsDone; i++) {
          const cls = i === setsDone ? "badge text-bg-success me-1 mb-1 workout-set-new" : "badge text-bg-success me-1 mb-1";
          html += `<span class="${cls}">Set ${i} ✓</span>`;
        }
        $workoutSets.html(html);
      }

      function tickWorkout() {
        // Extra-rest pause: freeze the main clock and show a secondary countdown.
        if (extraRestEndsMs > 0) {
          const now = Date.now();
          const msLeft = extraRestEndsMs - now;
          if (msLeft > 0) {
            $workoutExtraRest.show().text(`+${Math.ceil(msLeft / 1000)}s extra rest`);
            return;
          }
          // Pause finished: shift workoutStartMs forward by the pause duration so the main
          // clock picks up exactly where it left off, then fall through to normal rendering.
          workoutStartMs += (now - extraRestStartedMs);
          extraRestEndsMs = 0;
          extraRestStartedMs = 0;
          $workoutExtraRest.hide().text("");
          playCue(cueWorkTick);
          if (navigator.vibrate) navigator.vibrate(60);
        }
        const totalSec = Math.floor((Date.now() - workoutStartMs) / 1000);
        const st = workoutScheduleAt(totalSec);
        $workoutClock.text(fmtClock(totalSec));

        // Countdown ticks in the 3s leading into the next phase. Skip when the next phase is
        // a bonus rest (no urgency to herald more rest).
        if (totalSec !== workoutLastBeepSec) {
          workoutLastBeepSec = totalSec;
          if (st.secsLeft >= 1 && st.secsLeft <= 3) {
            const next = nextPhaseAfter(st);
            if (next === "work") playCue(cueWorkTick);
            else if (next === "rest") playCue(cueRestTick);
            // bonus_rest as next: no tick
          }
        }

        // Phase-entry accent + vibration. Bonus rest re-plays the rest accent so the user
        // hears that something changed (and reads the BONUS REST label on screen).
        if (st.phase !== workoutLastPhase) {
          workoutLastPhase = st.phase;
          if (st.phase === "work") {
            playCue(cueWorkAccent);
            if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
          } else if (st.phase === "rest") {
            playCue(cueRestAccent);
            if (navigator.vibrate) navigator.vibrate(80);
          } else { // bonus_rest
            playCue(cueRestAccent);
            if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          }
        }

        renderSets(st.setsDone);

        const phaseClass = st.phase === "work" ? "work" : "rest";
        const phaseLabel = st.phase === "work" ? "WORK" : st.phase === "rest" ? "REST" : "BONUS REST";
        $workoutPhase.text(phaseLabel).removeClass("work rest").addClass(phaseClass);

        let countdownText;
        if (st.phase === "work") countdownText = `${st.secsLeft}s of work left`;
        else if (st.phase === "rest") countdownText = `${st.secsLeft}s rest — next set soon`;
        else countdownText = `${st.secsLeft}s bonus rest`;
        $workoutPhaseCountdown.text(countdownText);

        let statusText;
        if (st.phase === "bonus_rest") {
          statusText = `Set ${st.set} done — ${st.bonusTotal}s bonus rest before Set ${st.set + 1}`;
        } else if (st.phase === "rest") {
          statusText = `Set ${st.set} done — resting`;
        } else if (st.setsDone > 0) {
          statusText = `Set ${st.setsDone} done — now on Set ${st.set}`;
        } else {
          statusText = `Set ${st.set} in progress`;
        }
        $workoutSetStatus.text(statusText);

        $workoutLivePoints.text(suggestPointsFromState(totalSec, st));
      }

      function beginTimer() {
        workoutStartMs = Date.now();
        $workoutStopBtn.prop("disabled", false);
        $workoutAddRestBtn.show();
        tickWorkout();
        workoutInterval = setInterval(tickWorkout, 200);
      }

      function runPreroll(done) {
        // Pre-roll leads into WORK, so use the work-incoming palette.
        $workoutPhase.text("GET READY").removeClass("rest").addClass("work");
        $workoutSetStatus.text("Starting…");
        $workoutMinuteText.text("10 reps per set · 30s work / 30s rest");
        $workoutPhaseCountdown.text("");
        $workoutSets.empty();
        $workoutLivePoints.text("0");
        $workoutClock.text("3");
        // 300 ms warm-up before the first beep: lets iOS's audio engine spin up and the
        // primeBeepAudio() play+pause cycles settle, so all three preroll ticks land at
        // uniform 1 s spacing. Without this, the first beep is delayed by ~150 ms while
        // ticks 2 and 3 are on time, making the 1→2 gap feel shorter than the 2→3 gap.
        setTimeout(() => {
          playCue(cueWorkTick);
          let n = 3;
          workoutPreroll = setInterval(() => {
            n -= 1;
            if (n > 0) {
              $workoutClock.text(String(n));
              playCue(cueWorkTick);
            } else {
              clearInterval(workoutPreroll);
              workoutPreroll = null;
              $workoutClock.text("GO");
              playCue(cueWorkAccent);
              setTimeout(done, 450);
            }
          }, 1000);
        }, 300);
      }

      // Warm-up before the workout. Counts down silently; the preroll's 3-2-1-GO
      // gives the audible transition into the first WORK. No points accrue during warm-up.
      function runWarmup(minutes, done) {
        const totalSec = minutes * 60;
        const startMs = Date.now();
        workoutInWarmup = true;
        workoutLastBeepSec = -1;
        $workoutSetup.hide();
        $workoutRunning.show();
        $workoutPhase.text("WARM-UP").removeClass("work").addClass("rest");
        $workoutSetStatus.text("Warm-up — no points");
        $workoutMinuteText.text(`${minutes} min warm-up · workout starts after`);
        $workoutPhaseCountdown.text("");
        $workoutSets.empty();
        $workoutLivePoints.text("0");
        $workoutStopBtn.prop("disabled", false);
        const tick = () => {
          const elapsed = Math.floor((Date.now() - startMs) / 1000);
          const left = Math.max(0, totalSec - elapsed);
          $workoutClock.text(fmtClock(left));
          $workoutPhaseCountdown.text(left === 0 ? "Workout starting…" : `${left}s of warm-up left`);
          if (left <= 0) {
            clearInterval(workoutWarmupInterval); workoutWarmupInterval = null;
            workoutInWarmup = false;
            $workoutStopBtn.prop("disabled", true);
            done();
          }
        };
        tick();
        workoutWarmupInterval = setInterval(tick, 200);
      }

      // Click on the top-level Start button: just open the overlay on the Setup panel.
      // Audio prime + wake lock happen on the Go-button gesture so iOS unlocks correctly.
      function startWorkout() {
        $workoutWarmupInput.val(getStoredWarmupMinutes());
        $workoutReview.hide();
        $workoutRunning.hide();
        $workoutSetup.show();
        $workoutOverlay.addClass("show").attr("aria-hidden", "false");
      }

      function clearWorkoutTimers() {
        if (workoutInterval) { clearInterval(workoutInterval); workoutInterval = null; }
        if (workoutPreroll) { clearInterval(workoutPreroll); workoutPreroll = null; }
        if (workoutWarmupInterval) { clearInterval(workoutWarmupInterval); workoutWarmupInterval = null; }
      }

      function stopWorkout() {
        clearWorkoutTimers();
        workoutActive = false;
        releaseWakeLock();
        $workoutAddRestBtn.hide();
        // Stop pressed during warm-up: no workout happened, no review screen.
        if (workoutInWarmup) {
          workoutInWarmup = false;
          resetExtraRest();
          $workoutOverlay.removeClass("show").attr("aria-hidden", "true");
          return;
        }
        // Stop pressed mid-extra-rest: exclude the in-progress paused span from training time.
        let effectiveNow = Date.now();
        if (extraRestEndsMs > 0) effectiveNow -= (Date.now() - extraRestStartedMs);
        resetExtraRest();
        const totalSec = Math.max(0, Math.floor((effectiveNow - workoutStartMs) / 1000));
        $workoutSummaryText.text(`You trained for ${fmtClock(totalSec)}`);
        $workoutPointsInput.val(suggestPoints(totalSec));
        $workoutRunning.hide();
        $workoutReview.show();
      }

      function closeWorkout() {
        clearWorkoutTimers();
        workoutActive = false;
        workoutInWarmup = false;
        resetExtraRest();
        $workoutAddRestBtn.hide();
        releaseWakeLock();
        $workoutOverlay.removeClass("show").attr("aria-hidden", "true");
      }

      $workoutAddRestBtn.off("click").on("click", () => {
        if (!workoutActive || workoutInWarmup) return;
        const now = Date.now();
        if (extraRestEndsMs <= now) {
          extraRestStartedMs = now;
          extraRestEndsMs = now + 15000;
        } else {
          extraRestEndsMs += 15000;
        }
        const secsLeft = Math.ceil((extraRestEndsMs - Date.now()) / 1000);
        $workoutExtraRest.show().text(`+${secsLeft}s extra rest`);
        playCue(cueRestTick);
        if (navigator.vibrate) navigator.vibrate(40);
      });

      $startWorkoutBtn.prop("disabled", false).off("click").on("click", startWorkout);
      $workoutGoBtn.off("click").on("click", () => {
        const raw = parseInt($workoutWarmupInput.val(), 10);
        const minutes = Math.max(0, Math.min(30, isNaN(raw) ? 0 : raw));
        storeWarmupMinutes(minutes);
        primeBeepAudio(); // iOS PWA: must play+pause inside the user gesture
        requestWakeLock();
        workoutActive = true;
        // Seed lastPhase to 'work' so tickWorkout doesn't re-play the work accent at t=0.
        workoutLastPhase = "work";
        workoutLastBeepSec = -1;
        workoutSetsDone = -1;
        $workoutStopBtn.prop("disabled", true);
        if (minutes > 0) {
          runWarmup(minutes, () => runPreroll(beginTimer));
        } else {
          $workoutSetup.hide();
          $workoutRunning.show();
          runPreroll(beginTimer);
        }
      });
      $workoutSetupCancelBtn.off("click").on("click", closeWorkout);
      $workoutStopBtn.off("click").on("click", stopWorkout);
      $workoutDiscardBtn.off("click").on("click", closeWorkout);
      $workoutConfirmBtn.off("click").on("click", async () => {
        const pts = parseInt($workoutPointsInput.val(), 10);
        if (isNaN(pts) || pts < 0) {
          showAlert("Enter a valid number of points (0 or greater)", "warning");
          return;
        }
        $workoutConfirmBtn.prop("disabled", true);
        try {
          if (pts > 0) {
            state = await incrementBy(state, pts);
            state = await maybeAutoBumpDrain(state);
            refreshUI(state, { drainedNow: 0 });
            await refreshRepsChart();
            trackSubmission(pts);
          }
          closeWorkout();
        } finally {
          $workoutConfirmBtn.prop("disabled", false);
        }
      });

      // Wire up daily drain update button
      $updateDrainBtn.off("click").on("click", async () => {
        $updateDrainBtn.prop("disabled", true);
        try {
          let newDrain = parseInt($dailyDrainInput.val(), 10);
          if (isNaN(newDrain) || newDrain < 0) {
            showAlert("Please enter a valid number (0 or greater)", "warning");
            return;
          }
          const floor = autoMinDrain(state.balance);
          if (newDrain < floor) {
            showAlert(`Drain cannot go below the current tier floor of ${floor}. Snapped up.`, "warning");
            setTimeout(hideAlert, 3500);
            newDrain = floor;
          }
          if (newDrain > MAX_DRAIN) {
            showAlert(`Drain capped at the maximum of ${MAX_DRAIN}.`, "warning");
            setTimeout(hideAlert, 3500);
            newDrain = MAX_DRAIN;
          }
          const updated = await updateDailyDrain(state, newDrain);
          state = updated;
          refreshUI(state, { drainedNow: 0 });
        } finally {
          $updateDrainBtn.prop("disabled", false);
        }
      });
    } catch (err) {
      console.error(err);
      showAlert(`Initialization error: ${err.message || err}`, "danger");
    } finally {
      setLoading(false);
    }
  }

  // ====== Auth gate ======
  // Boot flow: check for an existing session. If present, render the app and call init().
  // Otherwise show the login overlay and wait for a successful sign-in. Sign-out clears
  // the session and re-shows the overlay. We do NOT call init() twice in the same page
  // lifecycle (init wires DOM events that don't tolerate re-binding cleanly).
  let appInitialized = false;

  function showAuthOverlay(msg) {
    $("#authOverlay").attr("aria-hidden", "false").css("display", "flex");
    $("#appRoot").hide();
    if (msg) $("#authError").text(msg).show();
    else $("#authError").hide().text("");
  }
  function hideAuthOverlay() {
    $("#authOverlay").attr("aria-hidden", "true").css("display", "none");
    $("#appRoot").show();
    $("#authError").hide().text("");
  }

  async function boot() {
    $("#authForm").off("submit").on("submit", async (e) => {
      e.preventDefault();
      const email = $("#authEmailInput").val().trim();
      const password = $("#authPasswordInput").val();
      const $btn = $("#authSubmitBtn");
      $btn.prop("disabled", true).text("Signing in…");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      $btn.prop("disabled", false).text("Sign in");
      if (error) {
        $("#authError").text(error.message || "Sign-in failed").show();
        return;
      }
      $("#authPasswordInput").val("");
      hideAuthOverlay();
      if (!appInitialized) {
        appInitialized = true;
        init();
      }
    });

    $("#signOutLink").off("click").on("click", async (e) => {
      e.preventDefault();
      await supabase.auth.signOut();
      // Full reload so all in-memory state (intervals, charts, supabase client cache)
      // is discarded cleanly. Cheaper than tearing down by hand.
      window.location.reload();
    });

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      hideAuthOverlay();
      appInitialized = true;
      init();
    } else {
      showAuthOverlay();
    }
  }

  $(boot);
})();
