(function () {

  const { fmtShort, safeDate } = window._utils;

  window._sections.overview = async function loadOverview() {
    const { apiFetch, toast, state } = window._dash;
    const hour     = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    const titleEl = document.getElementById("overviewTitle");
    if (titleEl) titleEl.textContent = `${greeting}, ${(state.profile.name || "").split(" ")[0]}`;

    // ── Owner view ────────────────────────────────────────────────────────────
    if (state.role === "owner" && !state.viewingStation) {
      const subEl = document.getElementById("overviewSub");
      if (subEl) subEl.textContent = state.company?.name || "Your company";
      const statsEl = document.getElementById("overviewStats");
      if (statsEl) statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-val">${state.stations.length}</div><div class="stat-label">Stations</div></div>
        <div class="stat-card"><div class="stat-val">${state.managers.length}</div><div class="stat-label">Managers</div></div>
        <div class="stat-card"><div class="stat-val">${state.pompistes.length}</div><div class="stat-label">Pompistes</div></div>
      `;

      // ── Per-station breakdown ──────────────────────────────────────────────
      const chartsEl = document.getElementById("overviewCharts");
      if (chartsEl) chartsEl.innerHTML = `<div class="ov-card"><div class="ov-card-title">Station Overview</div><div id="ov-station-table"><div class="loading-state">Loading…</div></div></div>`;

      try {
        const now          = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const sitRes       = await apiFetch(`/situation?limit=200`).then(r => r.json());
        const situations   = sitRes.situations || [];
        const monthSits    = situations.filter(d => safeDate(d.logDate)?.substring(0, 7) === currentMonth);

        const stationMap   = Object.fromEntries(state.stations.map(s => [s.$id, s.name]));
        const byStation    = {};
        monthSits.forEach(d => {
          if (!byStation[d.stationId]) byStation[d.stationId] = { vente: 0, gain: 0, shifts: 0 };
          byStation[d.stationId].vente  += Number(d.totalVente)   || 0;
          byStation[d.stationId].gain   += Number(d.gainPayments) || 0;
          byStation[d.stationId].shifts += 1;
        });

        const tableEl = document.getElementById("ov-station-table");
        if (!tableEl) return;
        if (state.stations.length === 0) { tableEl.innerHTML = `<div class="empty-state">No stations yet.</div>`; return; }

        tableEl.innerHTML = `
          <table class="ov-shifts-table">
            <thead><tr>
              <th>Station</th>
              <th class="align-right">Vente (RWF)</th>
              <th class="align-right">Gain/Loss</th>
              <th class="align-right">Shifts</th>
            </tr></thead>
            <tbody>${state.stations.map(s => {
              const d     = byStation[s.$id] || { vente: 0, gain: 0, shifts: 0 };
              const hasData = d.shifts > 0;
              return `<tr>
                <td>${s.name}</td>
                <td class="align-right">${hasData ? fmtShort(d.vente) : "—"}</td>
                <td class="align-right ${d.gain >= 0 ? "stat-ok" : "stat-warn"}">${hasData ? (d.gain >= 0 ? "+" : "") + fmtShort(d.gain) : "—"}</td>
                <td class="align-right">${hasData ? d.shifts : "—"}</td>
              </tr>`;
            }).join("")}</tbody>
          </table>`;
      } catch {
        const tableEl = document.getElementById("ov-station-table");
        if (tableEl) tableEl.innerHTML = `<div class="empty-state">Could not load station data.</div>`;
      }
      return;
    }

    // ── Manager view ──────────────────────────────────────────────────────────
    const subEl = document.getElementById("overviewSub");
    if (subEl) subEl.textContent = state.station?.name || state.profile.name || "Your station";

    // Render placeholders immediately so UI isn't blank while fetching
    const statsEl  = document.getElementById("overviewStats");
    const chartsEl = document.getElementById("overviewCharts");
    if (statsEl) statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-val">${state.pompistes.length}</div><div class="stat-label">Pompistes</div></div>
      <div class="stat-card"><div class="stat-val" id="ov-pms">—</div><div class="stat-label">PMS (RWF/L)</div></div>
      <div class="stat-card"><div class="stat-val" id="ov-ago">—</div><div class="stat-label">AGO (RWF/L)</div></div>
      <div class="stat-card"><div class="stat-val" id="ov-momo">—</div><div class="stat-label">MoMo Fee</div></div>
      <div class="stat-card"><div class="stat-val" id="ov-today">—</div><div class="stat-label">Today</div></div>
      <div class="stat-card"><div class="stat-val" id="ov-month-vente">—</div><div class="stat-label">This Month (RWF)</div></div>
      <div class="stat-card"><div class="stat-val" id="ov-month-gain">—</div><div class="stat-label">Monthly Gain</div></div>
    `;
    if (chartsEl) chartsEl.innerHTML = `
      <div id="ov-low-stock"></div>
      <div id="ov-recent-shifts"></div>
    `;

    // MoMo fee is already in state — no fetch needed
    const momoEl = document.getElementById("ov-momo");
    if (momoEl) momoEl.textContent = state.station?.momoFee != null
      ? state.station.momoFee + "%" : "—";

    // ── Parallel fetch ────────────────────────────────────────────────────────
    // No date filter on situations — use most recent 31 regardless of month
    const [sitRes, stockRes, priceRes] = await Promise.allSettled([
      apiFetch(`/situation?limit=31`).then(r => r.json()),
      apiFetch(`/stock-daily?limit=20`).then(r => r.json()),
      apiFetch(`/fuel-prices`).then(r => r.json()),
    ]);

    const situations = sitRes.status   === "fulfilled" ? (sitRes.value.situations  || []) : [];
    const stockDocs  = stockRes.status === "fulfilled" ? (stockRes.value.stockDaily ?? []) : [];
    const priceDocs  = priceRes.status === "fulfilled"
      ? (priceRes.value.fuelPriceHistory ?? []) : [];

    // Derive date window from most recent situation (not today's date)
    const mostRecentDate = situations.length > 0 ? safeDate(situations[0].logDate) : null;
    const windowTo   = mostRecentDate;
    const windowFrom = mostRecentDate ? (() => {
      const d = new Date(mostRecentDate + "T00:00:00");
      d.setDate(d.getDate() - 6);
      return d.toISOString().substring(0, 10);
    })() : null;
    const mostRecentMonth = mostRecentDate ? mostRecentDate.substring(0, 7) : null;

    // ── Fuel prices (most recent per fuelType) ────────────────────────────────
    const sorted     = [...priceDocs].sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""));
    const pmsPriceDoc = sorted.find(p => p.fuelType === "PMS");
    const agoPriceDoc = sorted.find(p => p.fuelType === "AGO");
    const ovPmsEl = document.getElementById("ov-pms");
    const ovAgoEl = document.getElementById("ov-ago");
    if (ovPmsEl) ovPmsEl.textContent = pmsPriceDoc ? Number(pmsPriceDoc.price).toLocaleString() : "—";
    if (ovAgoEl) ovAgoEl.textContent = agoPriceDoc ? Number(agoPriceDoc.price).toLocaleString() : "—";

    // ── Today's status (most recent situation day) ────────────────────────────
    const todaySit = situations.find(d => safeDate(d.logDate) === mostRecentDate);
    const todayEl  = document.getElementById("ov-today");
    if (todayEl) {
      if (todaySit) {
        todayEl.textContent = todaySit.done ? "Done ✓" : "Pending";
        todayEl.className   = `stat-val ${todaySit.done ? "stat-ok" : "stat-warn"}`;
      } else {
        todayEl.textContent = "No entry";
        todayEl.className   = "stat-val stat-muted";
      }
    }

    // ── Month totals (same month as most recent situation) ────────────────────
    const monthSits  = mostRecentMonth
      ? situations.filter(d => safeDate(d.logDate)?.substring(0, 7) === mostRecentMonth)
      : situations;
    const monthVente = monthSits.reduce((s, d) => s + (Number(d.totalVente)   || 0), 0);
    const monthGain  = monthSits.reduce((s, d) => s + (Number(d.gainPayments) || 0), 0);
    const ovVenteEl  = document.getElementById("ov-month-vente");
    if (ovVenteEl) ovVenteEl.textContent = monthVente > 0 ? fmtShort(monthVente) : "—";
    const gainEl = document.getElementById("ov-month-gain");
    if (gainEl) {
      gainEl.textContent = monthGain !== 0 ? (monthGain >= 0 ? "+" : "") + fmtShort(monthGain) : "—";
      gainEl.className   = `stat-val ${monthGain >= 0 ? "stat-ok" : "stat-warn"}`;
    }

    // ── Low stock card ────────────────────────────────────────────────────────
    const LOW_PMS = 1000, LOW_AGO = 500;
    const sortedStock = [...stockDocs].sort((a, b) => (b.logDate || "").localeCompare(a.logDate || ""));
    const latestPms   = sortedStock.find(d => d.fuelType === "PMS");
    const latestAgo   = sortedStock.find(d => d.fuelType === "AGO");
    const physPms     = latestPms ? (Number(latestPms.physicalStock) || 0) : null;
    const physAgo     = latestAgo ? (Number(latestAgo.physicalStock) || 0) : null;
    const warnPms     = physPms !== null && physPms < LOW_PMS;
    const warnAgo     = physAgo !== null && physAgo < LOW_AGO;

    const lowStockEl = document.getElementById("ov-low-stock");
    if (lowStockEl && (physPms !== null || physAgo !== null)) {
      const stockRow = (label, val, threshold, warn) => {
        const pct = Math.min(100, val != null ? Math.round((val / (threshold * 4)) * 100) : 0);
        return `<div class="ov-stock-row${warn ? " ov-stock-warn" : ""}">
          <span class="ov-stock-label">${label}</span>
          <div class="ov-stock-bar-wrap"><div class="ov-stock-bar" style="width:${pct}%;background:${warn ? "var(--rp-danger)" : "var(--rp-success)"}"></div></div>
          <span class="ov-stock-val ${warn ? "stat-warn" : "stat-ok"}">${val != null ? val.toLocaleString() + " L" : "—"}${warn ? " ⚠" : ""}</span>
          <span class="ov-stock-threshold">min ${threshold.toLocaleString()} L</span>
        </div>`;
      };
      const lastDate = latestPms?.logDate ? safeDate(latestPms.logDate) : (latestAgo?.logDate ? safeDate(latestAgo.logDate) : null);
      lowStockEl.innerHTML = `
        <div class="ov-card">
          <div class="ov-card-title">Fuel Stock ${(warnPms || warnAgo) ? '<span class="ov-warn-badge">⚠ Low Stock</span>' : ''}</div>
          ${physPms !== null ? stockRow("PMS (Essence)", physPms, LOW_PMS, warnPms) : ""}
          ${physAgo !== null ? stockRow("AGO (Mazout)",  physAgo, LOW_AGO, warnAgo) : ""}
          ${lastDate ? `<div class="ov-stock-date">Last recorded: ${lastDate}</div>` : ""}
        </div>`;
    }

    // ── Recent 7 shifts — from 7 days before most recent upload → most recent ─
    const recent7  = windowFrom
      ? situations.filter(d => {
          const ds = safeDate(d.logDate);
          return ds >= windowFrom && ds <= windowTo;
        })
      : situations.slice(0, 7);
    const recentEl = document.getElementById("ov-recent-shifts");
    if (recentEl && recent7.length > 0) {
      const rows = recent7.map(d => {
        const ds      = safeDate(d.logDate);
        const date    = new Date(ds + "T00:00:00");
        const dateStr = isNaN(date) ? ds : date.toLocaleString("default", { day: "numeric", month: "short" });
        const gain    = Number(d.gainPayments) || 0;
        const status  = d.done
          ? '<span class="ov-badge ov-badge-ok">Done</span>'
          : '<span class="ov-badge ov-badge-warn">Pending</span>';
        return `<tr>
          <td>${dateStr}</td>
          <td class="align-right">${(d.totalVente).toLocaleString()}</td>
          <td class="align-right">${(d.totalPayments).toLocaleString()}</td>
          <td class="align-right ${gain >= 0 ? "stat-ok" : "stat-warn"}">${gain >= 0 ? "+" : ""}${(gain).toLocaleString()}</td>
          <td>${status}</td>
        </tr>`;
      }).join("");
      recentEl.innerHTML = `
        <div class="ov-card">
          <div class="ov-card-title">Recent Shifts</div>
          <table class="ov-shifts-table">
            <thead><tr>
              <th>Date</th>
              <th class="align-right">Vente (RWF)</th>
              <th class="align-right">Payments (RWF)</th>
              <th class="align-right">Gain/Loss</th>
              <th>Status</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }
  };

})();
