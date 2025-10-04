// Fit Tokens App (plain JS + jQuery + Supabase)
// Single-user, no auth. Hosted on GitHub Pages. Data stored in Supabase.
// Daily schedule: Day 1 adds 10, Day 2 adds 11, ... up to max 100/day.
// On page open, credit any days since last_credited_date up to today.

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
  const $minusOneBtn = $("#minusOneBtn");
  const $todaysAddText = $("#todaysAddText");
  const $addedSinceText = $("#addedSinceText");
  const $lastCreditedText = $("#lastCreditedText");
  const $startDateText = $("#startDateText");
  const $alertContainer = $("#alertContainer");
  const $alert = $("#alert");
  const $loading = $("#loading");
  const $repsChartCanvas = $("#repsChart");
  let repsChart = null;

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

  // ====== Token schedule ======
  // Day 1 => 10, Day 2 => 11, ... Day n => min(10 + (n-1), 100)
  function perDayAdd(dayIndex) {
    return Math.min(10 + (dayIndex - 1), 100);
  }

  function dayIndexFromStart(startYmd, ymd) {
    // If ymd == start => index 1
    return daysBetweenYMD(startYmd, ymd) + 1;
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
    // state: { id, start_date, last_credited_date, balance }
    // extras: { addedNow }
    const now = new Date();
    $todayText.text(now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));

    const today = todayYMD();
    const todaysIndex = dayIndexFromStart(state.start_date, today);
    const todaysAdd = perDayAdd(todaysIndex);

    $todaysAddText.text(todaysAdd.toString());
    $addedSinceText.text((extras.addedNow || 0).toString());
    $lastCreditedText.text(state.last_credited_date);
    $startDateText.text(state.start_date);
    $balanceText.text(state.balance.toString());

    // Enable / disable button
    $minusOneBtn.prop("disabled", state.balance <= 0);
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
            backgroundColor: "rgba(13,110,253,0.6)",
            borderRadius: 2
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { autoSkip: true, maxRotation: 0 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
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

  async function refreshRepsChart() {
    try {
      const rows = await loadRepsHistory();
      renderRepsChart(rows);
    } catch (e) {
      console.warn("Unable to load reps history:", e);
    }
  }

  async function incrementTodaysReps() {
    const today = todayYMD();
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
        .update({ reps: existing.reps + 1 })
        .eq("rep_date", today);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await supabase
        .from("fit_reps")
        .insert({ rep_date: today, reps: 1 });
      if (insErr) throw insErr;
    }
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
      const lastCredited = addDaysYMD(start, -1); // so that today's credit will occur on first run
      const { data: inserted, error: insErr } = await supabase
        .from("fit_state")
        .insert([{ id: "singleton", start_date: start, last_credited_date: lastCredited, balance: 0 }])
        .select()
        .single();

      if (insErr) throw insErr;
      return inserted;
    }

    return data;
  }

  async function creditIfNeeded(state) {
    const today = todayYMD();
    const daysToCredit = daysBetweenYMD(state.last_credited_date, today);

    if (daysToCredit <= 0) {
      return { state, addedNow: 0 };
    }

    let sum = 0;
    for (let i = 1; i <= daysToCredit; i++) {
      const day = addDaysYMD(state.last_credited_date, i);
      const index = dayIndexFromStart(state.start_date, day);
      sum += perDayAdd(index);
    }

    const newBalance = state.balance + sum;

    const { data: updated, error: updErr } = await supabase
      .from("fit_state")
      .update({ balance: newBalance, last_credited_date: today })
      .eq("id", "singleton")
      .select()
      .single();

    if (updErr) throw updErr;

    return { state: updated, addedNow: sum };
  }

  async function decrementOne(state) {
    if (state.balance <= 0) {
      showAlert("No tokens to spend. Do your reps to keep up!", "info");
      return state;
    }

    const newBal = state.balance - 1;

    const { data: updated, error } = await supabase
      .from("fit_state")
      .update({ balance: newBal })
      .eq("id", "singleton")
      .select()
      .single();

    if (error) {
      showAlert(`Error updating balance: ${error.message}`, "danger");
      return state;
    }

    // Record one rep for today
    try {
      await incrementTodaysReps();
    } catch (e) {
      console.warn("Failed to record rep:", e);
      showAlert("Saved balance, but failed to record today's rep history.", "warning");
    }

    return updated;
  }

  // ====== App init ======
  async function init() {
    setLoading(true);
    hideAlert();

    try {
      let state = await ensureStateRow();
      const { state: creditedState, addedNow } = await creditIfNeeded(state);
      state = creditedState;

      refreshUI(state, { addedNow });
      await refreshRepsChart();

      // Wire up button
      $minusOneBtn.off("click").on("click", async () => {
        $minusOneBtn.prop("disabled", true);
        try {
          const updated = await decrementOne(state);
          state = updated;
          refreshUI(state, { addedNow: 0 });
          await refreshRepsChart();
        } finally {
          $minusOneBtn.prop("disabled", state.balance <= 0);
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
