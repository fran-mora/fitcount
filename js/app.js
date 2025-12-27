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
  const $rewardsText = $("#rewardsText");
  const $rewardsContainer = $("#rewardsContainer");
  const $spendAmountInput = $("#spendAmountInput");
  const $spendBtn = $("#spendBtn");
  const $modalRewardsBalance = $("#modalRewardsBalance");
  let repsChart = null;
  let rewardsModal = null;

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

    const rewards = parseFloat(state.rewards_balance) || 0;
    $rewardsText.text(rewards.toFixed(1));

    if (rewards < 0) {
      $rewardsText.removeClass("text-success").addClass("text-danger");
    } else {
      $rewardsText.removeClass("text-danger").addClass("text-success");
    }

    // Enable rep buttons (balance can be negative)
    $rep1Btn.prop("disabled", false);
    $rep5Btn.prop("disabled", false);
    $rep10Btn.prop("disabled", false);
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
        .insert([{ id: "singleton", start_date: start, last_credited_date: lastProcessed, balance: 0, daily_drain: 100, rewards_balance: 0 }])
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

    // Update balance only (tokens). Do NOT touch rewards_balance.
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

    const currentRewards = parseFloat(state.rewards_balance) || 0;
    const rewardsInc = inc * 0.5;
    const newRewards = currentRewards + rewardsInc;

    const { data: updated, error } = await supabase
      .from("fit_state")
      .update({ balance: newBal, rewards_balance: newRewards })
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

  // Backward compatibility helper (unused now, but kept just in case)
  async function incrementOne(state) {
    return incrementBy(state, 1);
  }

  async function spendRewards(state, amount) {
    const currentRewards = parseFloat(state.rewards_balance) || 0;
    const newRewards = currentRewards - amount;

    const { data: updated, error } = await supabase
      .from("fit_state")
      .update({ rewards_balance: newRewards })
      .eq("id", "singleton")
      .select("*")
      .single();

    if (error) throw error;
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

      refreshUI(state, { drainedNow });
      await refreshRepsChart();

      rewardsModal = new bootstrap.Modal(document.getElementById("rewardsModal"));

      // Wire up rewards interaction
      $rewardsContainer.off("click").on("click", () => {
        const r = parseFloat(state.rewards_balance) || 0;
        $modalRewardsBalance.text(r.toFixed(1));
        $spendAmountInput.val("");
        rewardsModal.show();
      });

      $spendBtn.off("click").on("click", async () => {
        const val = $spendAmountInput.val();
        const amt = parseFloat(val);
        if (isNaN(amt) || amt === 0) {
          showAlert("Please enter a valid amount (not 0)", "warning");
          return;
        }

        $spendBtn.prop("disabled", true);
        try {
          const updated = await spendRewards(state, amt);
          state = updated;
          refreshUI(state);
          rewardsModal.hide();
          showAlert(`Spent ${amt} minutes.`, "success");
          setTimeout(hideAlert, 2000);
        } catch (e) {
          console.error(e);
          showAlert(`Error spending rewards: ${e.message}`, "danger");
        } finally {
          $spendBtn.prop("disabled", false);
        }
      });

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
          refreshUI(state, { drainedNow: 0 });
          await refreshRepsChart();
        } finally {
          setRepButtonsDisabled(false);
        }
      };

      $rep1Btn.off("click").on("click", handleAdd(1));
      $rep5Btn.off("click").on("click", handleAdd(5));
      $rep10Btn.off("click").on("click", handleAdd(10));

      // Wire up daily drain update button
      $updateDrainBtn.off("click").on("click", async () => {
        $updateDrainBtn.prop("disabled", true);
        try {
          const newDrain = parseInt($dailyDrainInput.val(), 10);
          if (isNaN(newDrain) || newDrain < 0) {
            showAlert("Please enter a valid number (0 or greater)", "warning");
            return;
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
