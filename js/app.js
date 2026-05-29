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

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    const tier = tierFor(bal);
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
    const nextAt = thresholdForTier(nextTier);
    const prevAt = tier === 0 ? 0 : thresholdForTier(tier);
    const span = Math.max(1, nextAt - prevAt);
    const pct = Math.max(0, Math.min(100, ((bal - prevAt) / span) * 100));
    const toGo = Math.max(0, nextAt - bal);

    $tierLabel.text(`Tier ${tier} / ${MAX_TIER} — drain ${state.daily_drain}`);
    $nextUnlockText.text(`${nextAt} tokens → drain ${nextDrain} (${toGo} to go)`);
    $tierProgressBar.css("width", pct + "%");
    $tierHintText.text(`Reach ${nextAt} tokens to bump daily drain to ${nextDrain}.`);
  }

  function flashTierCelebration(oldDrain, newDrain) {
    showAlert(`🎉 Tier up! Daily drain promoted from ${oldDrain} to ${newDrain}.`, "success");
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
    const { data: updated, error } = await supabase
      .from("fit_state")
      .update({ daily_drain: floor })
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
      const $workoutSummaryText = $("#workoutSummaryText");
      const $workoutPointsInput = $("#workoutPointsInput");
      const $workoutConfirmBtn = $("#workoutConfirmBtn");
      const $workoutDiscardBtn = $("#workoutDiscardBtn");

      let workoutInterval = null;
      let workoutPreroll = null;
      let workoutStartMs = 0;
      let workoutLastPhase = null;
      let workoutLastBeepSec = -1;
      let workoutSetsDone = -1;

      const pad2 = (n) => String(n).padStart(2, "0");
      const fmtClock = (totalSec) => `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;
      // Each minute = 10 points; suggestion rounds up to the next whole minute.
      const suggestPoints = (totalSec) => (totalSec <= 0 ? 0 : Math.ceil(totalSec / 60) * 10);

      // ----- Audio cues (Web Audio; unlocked on the Start user gesture) -----
      let audioCtx = null;
      function ensureAudio() {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!audioCtx && AC) audioCtx = new AC();
          if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
        } catch (_) {
          audioCtx = null;
        }
      }
      function beep(freq = 760, durationMs = 160) {
        if (!audioCtx) return;
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + durationMs / 1000 + 0.03);
      }

      function renderSets(setsDone, currentSet) {
        if (setsDone === workoutSetsDone) return;
        workoutSetsDone = setsDone;
        let html = "";
        for (let i = 1; i <= setsDone; i++) {
          const cls = i === setsDone ? "badge text-bg-success me-1 mb-1 workout-set-new" : "badge text-bg-success me-1 mb-1";
          html += `<span class="${cls}">Set ${i} ✓</span>`;
        }
        $workoutSets.html(html);
        $workoutSetStatus.text(setsDone > 0 ? `Set ${setsDone} done — now on Set ${currentSet}` : `Set ${currentSet} in progress`);
      }

      function tickWorkout() {
        const totalSec = Math.floor((Date.now() - workoutStartMs) / 1000);
        $workoutClock.text(fmtClock(totalSec));

        const secInMin = totalSec % 60;
        const inWork = secInMin < 30;
        const phase = inWork ? "work" : "rest";

        // Per-second audio cues: 3-2-1 leading into each 30s phase change, tone on switch.
        if (totalSec !== workoutLastBeepSec) {
          workoutLastBeepSec = totalSec;
          if (secInMin === 27 || secInMin === 28 || secInMin === 29) beep(760, 150);        // work ending
          else if (secInMin === 30) beep(1100, 320);                                         // rest begins
          else if (secInMin === 57 || secInMin === 58 || secInMin === 59) beep(760, 150);    // rest ending
          else if (secInMin === 0 && totalSec > 0) beep(1100, 320);                          // new set begins
        }

        if (phase !== workoutLastPhase) {
          workoutLastPhase = phase;
          if (navigator.vibrate) navigator.vibrate(inWork ? [120, 60, 120] : 80);
        }

        const setsDone = Math.floor(totalSec / 60);
        renderSets(setsDone, setsDone + 1);

        $workoutPhase.text(inWork ? "WORK" : "REST").removeClass("work rest").addClass(phase);
        const phaseLeft = inWork ? 30 - secInMin : 60 - secInMin;
        $workoutPhaseCountdown.text(inWork ? `${phaseLeft}s of work left` : `${phaseLeft}s rest — next set soon`);
        $workoutLivePoints.text(suggestPoints(totalSec));
      }

      function beginTimer() {
        workoutStartMs = Date.now();
        $workoutStopBtn.prop("disabled", false);
        tickWorkout();
        workoutInterval = setInterval(tickWorkout, 200);
      }

      function runPreroll(done) {
        let n = 3;
        $workoutPhase.text("GET READY").removeClass("rest").addClass("work");
        $workoutSetStatus.text("Starting…");
        $workoutMinuteText.text("10 reps per set · 30s work / 30s rest");
        $workoutPhaseCountdown.text("");
        $workoutSets.empty();
        $workoutLivePoints.text("0");
        $workoutClock.text(String(n));
        beep(760, 180);
        workoutPreroll = setInterval(() => {
          n -= 1;
          if (n > 0) {
            $workoutClock.text(String(n));
            beep(760, 180);
          } else {
            clearInterval(workoutPreroll);
            workoutPreroll = null;
            $workoutClock.text("GO");
            beep(1100, 360);
            setTimeout(done, 450);
          }
        }, 1000);
      }

      function startWorkout() {
        ensureAudio();
        workoutLastPhase = null;
        workoutLastBeepSec = -1;
        workoutSetsDone = -1;
        $workoutReview.hide();
        $workoutRunning.show();
        $workoutOverlay.addClass("show").attr("aria-hidden", "false");
        $workoutStopBtn.prop("disabled", true);
        runPreroll(beginTimer);
      }

      function clearWorkoutTimers() {
        if (workoutInterval) { clearInterval(workoutInterval); workoutInterval = null; }
        if (workoutPreroll) { clearInterval(workoutPreroll); workoutPreroll = null; }
      }

      function stopWorkout() {
        clearWorkoutTimers();
        const totalSec = Math.floor((Date.now() - workoutStartMs) / 1000);
        $workoutSummaryText.text(`You trained for ${fmtClock(totalSec)}`);
        $workoutPointsInput.val(suggestPoints(totalSec));
        $workoutRunning.hide();
        $workoutReview.show();
      }

      function closeWorkout() {
        clearWorkoutTimers();
        $workoutOverlay.removeClass("show").attr("aria-hidden", "true");
      }

      $startWorkoutBtn.prop("disabled", false).off("click").on("click", startWorkout);
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

  // Start
  $(init);
})();
