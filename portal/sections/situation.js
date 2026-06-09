(function () {

  let calMonth   = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  let activeDate = null;
  let monthCache = {};

  let _activeSitDoc = null;
  let _isEditing    = false;
  let _nozzleCache  = null;   // enriched nozzle list for this station (active only)

  const { safeDate, fmt, fmtShort } = window._utils;
  const { apiFetch, state } = window._dash;

  // ── Nozzle cache ─────────────────────────────────────────────────────────────
  // Fetches nozzles + their parent pumps, enriches each nozzle with pumpNumber
  // and pumpLabel, then sorts by pump order → nozzle number.

  async function _getNozzles() {
    if (_nozzleCache) return _nozzleCache;
    const stationId = state.viewingStation?.$id || state.profile?.stationId;
    if (!stationId) return [];

    const [nozzlesRes, pumpsRes] = await Promise.all([
      apiFetch(`/nozzles?station=${stationId}`).then(r => r.json()),
      apiFetch(`/pumps?station=${stationId}`).then(r => r.json()),
    ]);

    const pumps = pumpsRes.pumps ?? pumpsRes.documents ?? [];
    const pumpMap = {};
    pumps.forEach(p => { pumpMap[p.$id] = p; });

    const raw = nozzlesRes.nozzles ?? nozzlesRes.documents ?? [];
    _nozzleCache = raw
      .filter(n => n.active !== false && pumpMap[n.pumpId]?.active !== false)
      .map(n => ({
        ...n,
        pumpNumber: pumpMap[n.pumpId]?.pumpNumber ?? 0,
        pumpLabel:  pumpMap[n.pumpId]?.label || `Pump ${pumpMap[n.pumpId]?.pumpNumber ?? "?"}`,
      }))
      .sort((a, b) => a.pumpNumber - b.pumpNumber || a.nozzleNumber - b.nozzleNumber);

    return _nozzleCache;
  }

  // ── Data fetching ─────────────────────────────────────────────────────────────

  async function _fetchMonthFull(year, month) {
    const mm   = String(month).padStart(2, "0");
    const res  = await apiFetch(`/situation?month=${mm}&year=${year}`);
    const data = await res.json();
    return data.situations || [];
  }

  function cacheFromDocs(docs) {
    docs.forEach(doc => {
      const ld  = safeDate(doc.logDate);
      const key = ld.substring(0, 7);
      if (!monthCache[key]) monthCache[key] = [];
      if (!monthCache[key].find(d => d.logDate === ld))
        monthCache[key].push({ logDate: ld, done: doc.done });
    });
  }

  async function fetchMonthDates(year, month) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (monthCache[key]) return monthCache[key];
    const mm   = String(month).padStart(2, "0");
    const res  = await apiFetch(`/situation?month=${mm}&year=${year}`);
    const data = await res.json();
    monthCache[key] = (data.situations || []).map(d => ({ logDate: safeDate(d.logDate), done: d.done }));
    return monthCache[key];
  }

  // ── Calendar / sidebar ───────────────────────────────────────────────────────

  async function buildCalendar(year, month) {
    let dates = [];
    try { dates = await fetchMonthDates(year, month); } catch {}
    window._utils.renderCalendar({
      gridId: "calGrid", labelId: "calMonthLabel",
      year, month,
      entries:      dates.map(d => ({ date: d.logDate, done: d.done })),
      selectedDate: activeDate,
      weekStart:    "mon",
      onDayClick:   selectDate,
    });
  }

  function buildRecentList(docs) {
    const list = document.getElementById("recentList");
    if (!list) return;
    list.innerHTML = "";
    docs.forEach(doc => {
      const ld      = safeDate(doc.logDate);
      const d       = new Date(ld + "T00:00:00");
      const display = d.toLocaleString("default", { day: "numeric", month: "short", year: "numeric" });
      const dayName = d.toLocaleString("default", { weekday: "short" });
      const item    = document.createElement("div");
      item.className    = "recent-item";
      item.dataset.date = ld;
      item.innerHTML = `
        <div class="recent-dot" style="background:${doc.done ? "var(--pms)" : "var(--navy-light)"}"></div>
        <div class="recent-info">
          <div class="recent-date">${display}</div>
          <div class="recent-meta">${dayName} · ${doc.done ? "Done ✓" : "Pending"}</div>
        </div>
        <div class="recent-total">${fmtShort(doc.totalPayments)}</div>
      `;
      item.onclick = () => selectDate(ld);
      list.appendChild(item);
    });
  }

  async function selectDate(date) {
    if (_isEditing) { _isEditing = false; _setEditUI(false); }
    _pos.close();
    activeDate = date;
    document.querySelectorAll(".recent-item").forEach(el =>
      el.classList.toggle("recent-active", el.dataset.date === date)
    );
    const [y, m] = date.split("-").map(Number);
    if (y === calMonth.year && m === calMonth.month) await buildCalendar(y, m);
    await loadSituationDate(date);
  }

  // ── Sheet renderer ───────────────────────────────────────────────────────────

  async function loadSituationDate(date) {
    if (_isEditing) return;
    _restoreNonNozzleSpans();
    const toast  = window._dash.toast;
    date         = safeDate(date);
    const mainEl = document.getElementById("sitMain");
    if (!mainEl) return;
    mainEl.classList.add("sit-loading");
    _setEditBtn(false);

    try {
      const stationId = state.viewingStation?.$id || state.profile?.stationId;
      const [y, m] = date.split("-");

      const [sitRes, stockRes, pmsRes, agoRes, nozzles, readingsRes] = await Promise.all([
        apiFetch(`/situation/me?logDate=${date}`).then(r => r.json()),
        apiFetch(`/stock/me?monthYear=${y}-${m}`).then(r => r.json()),
        apiFetch(`/stock-daily/me?logDate=${date}&fuelType=PMS`).then(r => r.json()),
        apiFetch(`/stock-daily/me?logDate=${date}&fuelType=AGO`).then(r => r.json()),
        _getNozzles(),
        stationId
          ? apiFetch(`/nozzle-readings?station=${stationId}&date=${date}`).then(r => r.json())
          : Promise.resolve({ readings: [] }),
      ]);

      if (_isEditing) return;

      const readings = readingsRes.readings ?? [];

      if (!sitRes.situation || sitRes.situation.documents.length === 0) {
        const el = document.getElementById("loadedDate");
        if (el) el.textContent = "No data for " + date;
        const pill = document.getElementById("donePill");
        if (pill) pill.textContent = "";
        _activeSitDoc = null;
        _renderNozzleRows(nozzles, readings);
        return;
      }

      const doc      = sitRes.situation.documents[0];
      const stockDoc = stockRes.stock?.documents[0]     || null;
      const pmsDoc   = pmsRes.stockDaily?.documents[0]  || null;
      const agoDoc   = agoRes.stockDaily?.documents[0]  || null;

      _activeSitDoc = doc;

      // Collapse all shift readings into one row per nozzle:
      // startReading = Morning shift's start, endReading = last submitted shift's end
      const SHIFT_ORDER = { Morning: 0, Afternoon: 1, Evening: 2, Night: 3 };
      const nozzleMap = {};
      readings
        .filter(r => r.startReading > 0 || r.endReading > 0) // skip unused 0,0,0 entries
        .forEach(r => {
          const id    = r.nozzleId;
          const order = SHIFT_ORDER[r.shift] ?? 99;
          if (!nozzleMap[id]) {
            nozzleMap[id] = { ...r, _firstOrder: order, _lastOrder: order };
            return;
          }
          if (order < nozzleMap[id]._firstOrder) {
            nozzleMap[id].startReading = r.startReading;
            nozzleMap[id]._firstOrder  = order;
          }
          if (order > nozzleMap[id]._lastOrder) {
            nozzleMap[id].endReading = r.endReading;
            nozzleMap[id]._lastOrder = order;
          }
        });
      const collapsedReadings = Object.values(nozzleMap).map(r => ({
        ...r,
        venteLitres: Number(r.endReading) - Number(r.startReading),
      }));

      // Header
      const d = new Date(date + "T00:00:00");
      const loadedDateEl = document.getElementById("loadedDate");
      if (loadedDateEl) loadedDateEl.textContent = isNaN(d) ? date
        : d.toLocaleString("default", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

      // 3-stage status pill
      const hasReadings = collapsedReadings.length > 0;
      const hasStock    = !!(pmsDoc || agoDoc);
      const stage = doc.done
        ? { text: "Complete ✓",  bg: "var(--pms-bg)", color: "var(--pms)" }
        : hasReadings && hasStock
        ? { text: "Not Complete", bg: "#fef3c7",       color: "#b45309"    }
        : hasReadings
        ? { text: "In Progress",  bg: "#fff7ed",       color: "#ea580c"    }
        : { text: "Pending",      bg: "#f1f5f9",       color: "#64748b"    };

      const pill = document.getElementById("donePill");
      if (pill) {
        pill.textContent      = stage.text;
        pill.style.background = stage.bg;
        pill.style.color      = stage.color;
      }
      const sheetDateEl = document.getElementById("sheetDate");
      if (sheetDateEl) sheetDateEl.textContent = date;

      // Render nozzle reading rows
      _renderNozzleRows(nozzles, collapsedReadings);

      // Sales totals + payment fields
      const ventePms = Number(doc.venteLitresPms) || 0;
      const venteAgo = Number(doc.venteLitresAgo) || 0;
      [
        ["litresAPms", ventePms], ["litresAAgo", venteAgo],
        ["litresCPms", ventePms], ["litresCAgo", venteAgo],
        ["totalPms",   doc.totalPms],    ["totalAgo",      doc.totalAgo],
        ["totalVente", doc.totalVente],  ["pmsPrices",     doc.pmsPrice],
        ["agoPrices",  doc.agoPrice],    ["totalPayments", doc.totalPayments],
        ["momo",       doc.momo],        ["momoLoss",      doc.momoLoss],
        ["spFuelCard", doc.spFuelCard],  ["bankCard",      doc.bankCard],
        ["totalFiche", doc.totalFiche],  ["bon",           doc.bon],
        ["totalCash",  doc.totalCash],
      ].forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (typeof val === "number" ? val : Number(val) || 0).toLocaleString();
      });

      // Stock fields
      [
        ["initialPms",          pmsDoc?.initialStock],  ["initialAgo",          agoDoc?.initialStock],
        ["receivedPms",         pmsDoc?.receivedLitres], ["receivedAgo",         agoDoc?.receivedLitres],
        ["venteLitresPmsStock", ventePms],               ["venteLitresAgoStock", venteAgo],
        ["theoryStockPms",      pmsDoc?.theoryStock],    ["theoryStockAgo",      agoDoc?.theoryStock],
        ["physicalStockPms",    pmsDoc?.physicalStock],  ["physicalStockAgo",    agoDoc?.physicalStock],
        ["gainFuelPms",         pmsDoc?.gainFuel],       ["gainFuelAgo",         agoDoc?.gainFuel],
      ].forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = typeof val === "number" ? val : Number(val) || 0;
      });

      const tgPmsEl = document.getElementById("totalGainFuelPms");
      if (tgPmsEl) tgPmsEl.textContent = stockDoc ? fmt(stockDoc.totalGainFuelPms) : "—";
      const tgAgoEl = document.getElementById("totalGainFuelAgo");
      if (tgAgoEl) tgAgoEl.textContent = stockDoc ? fmt(stockDoc.totalGainFuelAgo) : "—";

      const doneEl = document.getElementById("done");
      if (doneEl) doneEl.textContent = doc.done ? "Yes ✓" : "No";

      _setEditBtn(true);
      const posBtn = document.getElementById('sitPosAuditBtn');
      if (posBtn) posBtn.style.display = '';

    } catch (err) {
      toast("Error loading situation: " + (err?.message || err), "error");
    } finally {
      mainEl.classList.remove("sit-loading");
    }
  }

  // ── Nozzle row rendering ─────────────────────────────────────────────────────

  const _pumpColors = ["#64748b","#22c55e","#3b82f6","#f59e0b","#f97316","#8b5cf6","#ec4899"];

  function _pBadge(pumpNumber) {
    const color = _pumpColors[pumpNumber] || _pumpColors[0];
    return `<span style="font-weight:700;color:${color}">P${pumpNumber || "?"}</span>`;
  }

  function _fuelCols(fuelType, value) {
    const v = value != null ? fmt(value) : "—";
    return [
      fuelType === "PMS"      ? v : "—",
      fuelType === "AGO"      ? v : "—",
      fuelType === "Kerosene" ? v : "-",
    ];
  }

  function _renderNozzleRows(nozzles, readings, editing = false) {
    const tbody = document.getElementById("nozzleReadingsBody");
    if (!tbody) return;

    if (editing) {
      if (!nozzles.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted,#888);">No active nozzles configured. Add pumps and nozzles in Settings → Pumps &amp; Nozzles.</td></tr>`;
        return;
      }
      const readingMap = {};
      readings.forEach(r => { readingMap[r.nozzleId] = r; });

      tbody.innerHTML = nozzles.map(n => {
        const r     = readingMap[n.$id] || {};
        const start = r.startReading != null ? r.startReading : "";
        const end   = r.endReading   != null ? r.endReading   : "";
        const [essCell, gasCell, keroCell] = [
          n.fuelType === "PMS"      ? `<td class="nozzle-sold" data-nozzle="${n.$id}">—</td>` : `<td>—</td>`,
          n.fuelType === "AGO"      ? `<td class="nozzle-sold" data-nozzle="${n.$id}">—</td>` : `<td>—</td>`,
          n.fuelType === "Kerosene" ? `<td class="nozzle-sold" data-nozzle="${n.$id}">—</td>` : `<td>-</td>`,
        ];
        return `<tr data-nozzle-id="${n.$id}" data-fuel-type="${n.fuelType}" data-pump-id="${n.pumpId}" data-pump-number="${n.pumpNumber}" data-nozzle-number="${n.nozzleNumber}">
          <td>${_pBadge(n.pumpNumber)}</td>
          <td>${n.pumpLabel}</td>
          <td><input type="number" class="sit-edit-input nozzle-end"   data-nozzle="${n.$id}" value="${Number(end)   || 0}" oninput="window._sit.recalcNozzles()"></td>
          <td><input type="number" class="sit-edit-input nozzle-start" data-nozzle="${n.$id}" value="${Number(start) || 0}" oninput="window._sit.recalcNozzles()"></td>
          ${essCell}${gasCell}${keroCell}
        </tr>`;
      }).join("");
      recalcNozzles();
      return;
    }

    // View mode
    if (!readings.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted,#888);">No nozzle readings recorded for this date.</td></tr>`;
      return;
    }

    tbody.innerHTML = [...readings]
      .sort((a, b) => (a.pumpNumber - b.pumpNumber) || (a.nozzleNumber - b.nozzleNumber))
      .map(r => {
        const [ess, gas, kero] = _fuelCols(r.fuelType, r.venteLitres);
        return `<tr data-nozzle-id="${r.nozzleId}" data-fuel-type="${r.fuelType}">
          <td>${_pBadge(r.pumpNumber)}</td>
          <td>${r.pumpLabel || `Pump ${r.pumpNumber || "?"}`}</td>
          <td>${r.endReading   != null ? fmt(r.endReading)   : "—"}</td>
          <td>${r.startReading != null ? fmt(r.startReading) : "—"}</td>
          <td>${ess}</td>
          <td>${gas}</td>
          <td>${kero}</td>
        </tr>`;
      }).join("");
  }

  function recalcNozzles() {
    const tbody = document.getElementById("nozzleReadingsBody");
    if (!tbody) return;

    const totals = {};
    tbody.querySelectorAll("tr[data-nozzle-id]").forEach(row => {
      const fuelType   = row.dataset.fuelType;
      const endInput   = row.querySelector(".nozzle-end");
      const startInput = row.querySelector(".nozzle-start");
      const soldCell   = row.querySelector(".nozzle-sold");
      if (!endInput || !startInput) return;

      const end   = Number(endInput.value)   || 0;
      const start = Number(startInput.value) || 0;
      const sold  = end - start;

      if (soldCell) soldCell.textContent = sold >= 0 ? sold.toLocaleString() : "—";
      if (!totals[fuelType]) totals[fuelType] = 0;
      if (sold > 0) totals[fuelType] += sold;
    });

    const litPms = totals["PMS"] || 0;
    const litAgo = totals["AGO"] || 0;

    const readEl = id => {
      const el = document.getElementById(id);
      if (!el) return 0;
      return el.tagName === "INPUT"
        ? Number(el.value) || 0
        : Number(el.textContent.replace(/,/g, "")) || 0;
    };

    const pmsPrice = readEl("pmsPrices");
    const agoPrice = readEl("agoPrices");
    const tPms     = litPms * pmsPrice;
    const tAgo     = litAgo * agoPrice;
    const tVente   = tPms + tAgo;

    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el && el.tagName !== "INPUT") el.textContent = Math.round(n).toLocaleString();
    };
    set("litresAPms", litPms); set("litresAAgo", litAgo);
    set("litresCPms", litPms); set("litresCAgo", litAgo);
    set("totalPms",   tPms);  set("totalAgo",   tAgo);
    set("totalVente", tVente);
  }

  // ── Edit mode ────────────────────────────────────────────────────────────────

  // Restores price/payment inputs back to spans so loadSituationDate can fill them.
  function _restoreNonNozzleSpans() {
    [
      "pmsPrices", "agoPrices",
      "momo", "momoLoss", "spFuelCard", "bankCard",
      "totalFiche", "bon", "totalCash", "totalPayments",
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.tagName !== "INPUT") return;
      const span = document.createElement("span");
      span.id = id;
      el.replaceWith(span);
    });
    const doneEl = document.getElementById("done");
    if (doneEl && doneEl.tagName === "INPUT") {
      const span = document.createElement("span");
      span.id = "done";
      doneEl.replaceWith(span);
    }
  }

  function _setEditBtn(visible) {
    const btn = document.getElementById("sitEditBtn");
    if (btn) btn.style.display = visible && !_isEditing ? "" : "none";
  }

  function _setEditUI(editing) {
    document.getElementById("sitEditBtn").style.display     = editing ? "none" : (_activeSitDoc ? "" : "none");
    document.getElementById("sitCancelBtn").style.display   = editing ? "" : "none";
    document.getElementById("sitSaveBtn").style.display     = editing ? "" : "none";
    document.getElementById("sitDownloadBtn").style.display = editing ? "none" : "";
    const sheet = document.querySelector("#section-situation .sheet");
    if (sheet) sheet.classList.toggle("sit-edit-mode", editing);
  }

  async function enterEditMode() {
    if (!_activeSitDoc || _isEditing) return;
    _isEditing = true;

    const stationId = state.viewingStation?.$id || state.profile?.stationId;
    const [nozzles, readingsRes] = await Promise.all([
      _getNozzles(),
      stationId
        ? apiFetch(`/nozzle-readings?station=${stationId}&date=${activeDate}`).then(r => r.json())
        : Promise.resolve({ readings: [] }),
    ]);
    const readings = readingsRes.readings ?? [];

    _renderNozzleRows(nozzles, readings, true);

    // Replace price spans with inputs
    [
      { id: "pmsPrices", key: "pmsPrice" },
      { id: "agoPrices", key: "agoPrice" },
    ].forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el || el.tagName === "INPUT") return;
      const inp = document.createElement("input");
      inp.type      = "number";
      inp.className = "sit-edit-input";
      inp.id        = id;
      inp.value     = Number(_activeSitDoc[key]) || 0;
      inp.addEventListener("input", recalcNozzles);
      el.replaceWith(inp);
    });

    // Replace payment spans with inputs
    [
      { id: "momo",          key: "momo" },
      { id: "momoLoss",      key: "momoLoss" },
      { id: "spFuelCard",    key: "spFuelCard" },
      { id: "bankCard",      key: "bankCard" },
      { id: "totalFiche",    key: "totalFiche" },
      { id: "bon",           key: "bon" },
      { id: "totalCash",     key: "totalCash" },
      { id: "totalPayments", key: "totalPayments" },
    ].forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el || el.tagName === "INPUT") return;
      const inp = document.createElement("input");
      inp.type      = "number";
      inp.className = "sit-edit-input";
      inp.id        = id;
      inp.value     = Number(_activeSitDoc[key]) || 0;
      el.replaceWith(inp);
    });

    // Replace done span with checkbox
    const doneEl = document.getElementById("done");
    if (doneEl && doneEl.tagName !== "INPUT") {
      const chk = document.createElement("input");
      chk.type      = "checkbox";
      chk.className = "sit-edit-checkbox";
      chk.id        = "done";
      chk.checked   = !!_activeSitDoc.done;
      doneEl.replaceWith(chk);
    }

    recalcNozzles();
    _setEditUI(true);
  }

  async function exitEditMode() {
    if (!_isEditing) return;
    _isEditing = false;
    _setEditUI(false);
    await loadSituationDate(activeDate);
  }

  async function saveEdit(btn) {
    if (!_activeSitDoc || !_isEditing) return;
    const { toast } = window._dash;

    const stationId = state.viewingStation?.$id || state.profile?.stationId || "";
    const companyId = state.company?.$id       || "";
    const shift     = _activeSitDoc.shift      || "Morning";

    const readEl = id => {
      const el = document.getElementById(id);
      if (!el) return 0;
      return el.tagName === "INPUT"
        ? Number(el.value) || 0
        : Number(el.textContent.replace(/,/g, "")) || 0;
    };

    const pmsPrice = readEl("pmsPrices");
    const agoPrice = readEl("agoPrices");

    // Collect nozzle rows and POST one reading per nozzle
    const tbody    = document.getElementById("nozzleReadingsBody");
    const nozzleRows = tbody ? [...tbody.querySelectorAll("tr[data-nozzle-id]")] : [];
    const totals   = {};

    const createdReadingIds = [];

    async function rollbackReadings() {
      for (const id of [...createdReadingIds].reverse()) {
        try { await apiFetch(`/nozzle-readings/${id}`, { method: "DELETE" }); } catch {}
      }
    }

    const readingPromises = nozzleRows.map(async row => {
      const nozzleId     = row.dataset.nozzleId;
      const fuelType     = row.dataset.fuelType;
      const pumpId       = row.dataset.pumpId       || "";
      const pumpNumber   = Number(row.dataset.pumpNumber)   || 0;
      const nozzleNumber = Number(row.dataset.nozzleNumber) || 0;
      const endReading   = Number(row.querySelector(".nozzle-end")?.value)   || 0;
      const startReading = Number(row.querySelector(".nozzle-start")?.value) || 0;
      const venteLitres  = Math.max(0, endReading - startReading);

      if (!totals[fuelType]) totals[fuelType] = 0;
      totals[fuelType] += venteLitres;

      const r = await apiFetch("/nozzle-readings", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          nozzleId, pumpId, stationId, companyId,
          fuelType, pumpNumber, nozzleNumber,
          startReading, endReading, venteLitres,
          logDate: activeDate, shift,
          userId:       state.profile?.userId || "",
          email:        state.profile?.email  || "",
          employeeName: state.profile?.name   || "",
        }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Nozzle reading failed"); }
      const doc = await r.json();
      const id = doc.$id || doc.reading?.$id;
      if (id) createdReadingIds.push(id);
    });

    try {
      await Promise.all(readingPromises);

      const venteLitresPms = totals["PMS"] || 0;
      const venteLitresAgo = totals["AGO"] || 0;
      const totalPms       = Math.round(venteLitresPms * pmsPrice);
      const totalAgo       = Math.round(venteLitresAgo * agoPrice);
      const totalVente     = totalPms + totalAgo;
      const totalPayments  = readEl("totalPayments");
      const gainPayments   = totalVente - totalPayments;

      const doneEl = document.getElementById("done");
      const done   = doneEl?.tagName === "INPUT" ? doneEl.checked : !!_activeSitDoc.done;

      const res = await apiFetch(`/situation/${_activeSitDoc.$id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          pmsPrice, agoPrice,
          venteLitresPms, venteLitresAgo,
          totalPms, totalAgo, totalVente,
          gainPayments,
          momo:          readEl("momo"),
          momoLoss:      readEl("momoLoss"),
          spFuelCard:    readEl("spFuelCard"),
          bankCard:      readEl("bankCard"),
          totalFiche:    readEl("totalFiche"),
          bon:           readEl("bon"),
          totalCash:     readEl("totalCash"),
          totalPayments,
          done,
        }),
      });

      if (!res.ok) { const e = await res.json(); await rollbackReadings(); throw new Error(e.error || "Save failed"); }

      delete monthCache[activeDate.substring(0, 7)];
      _isEditing = false;
      _setEditUI(false);
      await loadSituationDate(activeDate);
      toast("Situation updated.", "success");
    } catch (err) {
      await rollbackReadings();
      toast("Save failed: " + err.message, "error");
      btn.disabled = false;
    }
  }

  // ── POS Reconciliation ────────────────────────────────────────────────────────

  const _pos = {
    _open: false,

    toggle() {
      _pos._open = !_pos._open;
      const panel = document.getElementById('posAuditPanel');
      if (!panel) return;
      if (_pos._open) {
        panel.style.display = '';
        panel.innerHTML = _pos._panelHTML();
      } else {
        panel.style.display = 'none';
      }
    },

    close() {
      _pos._open = false;
      const panel = document.getElementById('posAuditPanel');
      if (panel) panel.style.display = 'none';
    },

    _panelHTML() {
      return `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:1.25rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--navy)">POS Reconciliation</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">${activeDate || '—'} — compare AdvaTech POS export against RP data</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
              <label style="cursor:pointer;background:var(--navy,#1b263b);color:#fff;font-size:12px;font-weight:600;padding:6px 14px;border-radius:6px;white-space:nowrap;">
                Upload CSV
                <input type="file" accept=".csv" style="display:none;"
                       onchange="window._sit._posHandleFile(this.files[0])">
              </label>
              <button onclick="window._sit.togglePosPanel()"
                      style="background:none;border:1px solid #cbd5e1;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:13px;color:#64748b;">✕</button>
            </div>
          </div>
          <div id="posAuditResults" style="font-size:13px;color:#64748b;">
            Upload the AdvaTech POS export for <strong>${activeDate || 'this date'}</strong> to check for discrepancies.
            The CSV is filtered to this date client-side — you can upload the full monthly file.
          </div>
        </div>`;
    },

    // ── CSV parsing ───────────────────────────────────────────────────────────

    _parseLine(line) {
      const fields = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
        else { cur += c; }
      }
      fields.push(cur);
      return fields;
    },

    _parseCSV(text) {
      // Strip UTF-8 BOM (U+FEFF) — Excel-exported CSVs always include it; it
      // silently corrupts the first header name making row['date'] return undefined.
      const clean = (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).trim();
      const lines = clean.split(/\r?\n/);
      if (lines.length < 2) return [];
      const headers = _pos._parseLine(lines[0]).map(h => h.trim().toLowerCase());
      return lines.slice(1).filter(l => l.trim()).map(l => {
        const vals = _pos._parseLine(l);
        const row = {};
        headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
        return row;
      });
    },

    _mapRow(row) {
      // Date field from AdvaTech CSV: "2026/05/31,00:03:45" (quoted in file, comma inside)
      // After our parser strips quotes: "2026/05/31,00:03:45"
      const rawDate = row['date'] || '';
      const [datePart = '', timePart = '00:00'] = rawDate.split(',');
      // Normalise to YYYY-MM-DD regardless of whether month/day are zero-padded
      const [y = '', m = '', d = ''] = datePart.trim().split('/');
      const date = y && m && d
        ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
        : datePart.replace(/\//g, '-').trim();

      const product = (row['product'] || '').toUpperCase();
      const fuelType = product === 'ESSENCE' ? 'PMS'
                     : (product.includes('DIESEL') || product.includes('GASOIL') || product === 'AGO') ? 'AGO'
                     : 'OTHER';

      const method = (row['payment method'] || row['payment_method'] || '').trim().toUpperCase();

      return {
        date,
        time:       timePart.trim().substring(0, 5),
        fuelType,
        amount:     Number(row['amount'])  || 0,
        volume:     Number(row['volume'])  || 0,
        method,
        customerId: row['customer id'] || row['customer_id'] || '',
      };
    },

    // ── File handler ──────────────────────────────────────────────────────────

    async handleFile(file) {
      if (!file || !activeDate) return;
      const resultsEl = document.getElementById('posAuditResults');
      if (!resultsEl) return;
      resultsEl.innerHTML = '<div style="color:var(--navy,#1b263b);padding:6px 0;">Parsing CSV…</div>';

      try {
        const text    = await file.text();
        const allRows = _pos._parseCSV(text);
        const mapped  = allRows.map(_pos._mapRow);
        const dayRows = mapped.filter(r => r.date === activeDate && r.amount > 0);

        if (dayRows.length === 0) {
          // Diagnostic: show what dates the parser actually found
          const dateCounts = {};
          mapped.forEach(r => { const k = r.date || '(empty)'; dateCounts[k] = (dateCounts[k] || 0) + 1; });
          const dateList = Object.entries(dateCounts)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([d, n]) => `<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;">${d}</code> (${n} rows)`)
            .join(', ') || 'none';
          resultsEl.innerHTML = `
            <div style="color:#ef4444;padding:6px 0;margin-bottom:8px;">
              No transactions found for <strong>${activeDate}</strong> — ${allRows.length} total rows parsed.
            </div>
            <div style="font-size:12px;color:#64748b;">
              <strong>Dates the parser found:</strong> ${dateList}
            </div>`;
          return;
        }

        resultsEl.innerHTML = `<div style="color:#64748b;padding:6px 0;">Found ${dayRows.length} transactions for ${activeDate}. Running checks…</div>`;

        const stationId = state.viewingStation?.$id || state.profile?.stationId;
        const res = await apiFetch('/reconcile-pos', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ date: activeDate, stationId, csvRows: dayRows }),
        });

        if (!res.ok) {
          const err = await res.json();
          resultsEl.innerHTML = `<div style="color:#ef4444;">Server error: ${err.error || 'Reconcile failed'}</div>`;
          return;
        }

        const result = await res.json();
        resultsEl.innerHTML = _pos._renderResults(result);

      } catch (err) {
        const el = document.getElementById('posAuditResults');
        if (el) el.innerHTML = `<div style="color:#ef4444;">Error: ${err.message}</div>`;
      }
    },

    // ── Results renderer ──────────────────────────────────────────────────────

    _fmt(n)  { return Math.round(Number(n) || 0).toLocaleString(); },
    _fmtL(n) { return (Number(n) || 0).toFixed(2); },

    _statusBadge(clean, skipped) {
      if (skipped) return '<span style="background:#f1f5f9;color:#64748b;font-size:11px;padding:2px 7px;border-radius:999px;">N/A</span>';
      return clean
        ? '<span style="background:#dcfce7;color:#16a34a;font-size:11px;padding:2px 7px;border-radius:999px;">✓ Clean</span>'
        : '<span style="background:#fee2e2;color:#ef4444;font-size:11px;padding:2px 7px;border-radius:999px;">⚠ Issues</span>';
    },

    _section(title, clean, skipped, body) {
      const badge = _pos._statusBadge(clean, skipped);
      return `
        <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;
                      padding:9px 12px;background:${(!skipped && !clean) ? '#fff7f7' : '#f8fafc'};
                      border-bottom:1px solid #e2e8f0;">
            <span style="font-weight:600;font-size:13px;color:var(--navy,#1b263b);">${title}</span>
            ${badge}
          </div>
          <div style="padding:10px 12px;font-size:12px;">${body}</div>
        </div>`;
    },

    _table(rows) {
      const thead = `<tr style="background:#f1f5f9;">
        <th style="padding:5px 8px;text-align:left;font-weight:600;">Category</th>
        <th style="padding:5px 8px;text-align:right;font-weight:600;">POS (CSV)</th>
        <th style="padding:5px 8px;text-align:right;font-weight:600;">RP</th>
        <th style="padding:5px 8px;text-align:right;font-weight:600;">Gap</th>
      </tr>`;
      return `<table style="width:100%;border-collapse:collapse;">${thead}<tbody>${rows}</tbody></table>`;
    },

    _tableRow(label, csvVal, rpVal, gap, fmtFn, unit) {
      const flagged = Math.abs(gap) > 0;
      const gapTxt  = (gap > 0 ? '+' : '') + fmtFn(gap) + ' ' + unit;
      const color   = flagged ? '#ef4444' : '#16a34a';
      return `<tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:5px 8px;">${label}</td>
        <td style="padding:5px 8px;text-align:right;">${fmtFn(csvVal)} ${unit}</td>
        <td style="padding:5px 8px;text-align:right;">${fmtFn(rpVal)} ${unit}</td>
        <td style="padding:5px 8px;text-align:right;color:${color};font-weight:${flagged ? 700 : 400};">${gapTxt}</td>
      </tr>`;
    },

    _renderResults(r) {
      const { checks, csvRowCount, hasRpData } = r;

      if (!hasRpData) {
        return `<div style="color:#b45309;background:#fef3c7;padding:10px 14px;border-radius:6px;font-size:13px;">
          No Situation record found in RP for <strong>${r.date}</strong>.<br>
          Submit the situation sheet first, then run the POS audit.
        </div>`;
      }

      const { payments, volume, ficheGhosts, ficheSuppressed, grandTotal: gt } = checks;

      // Check 1 — Payments
      const payBody = _pos._table(
        payments.rows.map(c => _pos._tableRow(c.label, c.csv, c.rp, c.gap, _pos._fmt, 'RWF')).join('')
      );

      // Check 2 — Volume
      const volBody = _pos._table(
        volume.rows.map(c => _pos._tableRow(c.label, c.csv, c.rp, c.gap, _pos._fmtL, 'L')).join('')
      );

      // Check 3 — Fiche ghosts
      const ghostBody = ficheGhosts.skipped
        ? '<span style="color:#64748b;">Skipped — fiche logDate not indexed in Appwrite.</span>'
        : ficheGhosts.clean
          ? '<span style="color:#16a34a;">No ghost fiche entries found.</span>'
          : ficheGhosts.items.map(f =>
              `<div style="padding:4px 0;border-bottom:1px solid #f1f5f9;color:#ef4444;">
                ⚠ ${_pos._fmt(f.amount)} RWF — Customer: ${f.customerId} — <em style="color:#64748b;">${f.note}</em>
              </div>`).join('');

      // Check 4 — Fiche suppressed
      const suppBody = ficheSuppressed.skipped
        ? '<span style="color:#64748b;">Skipped — fiche logDate not indexed in Appwrite.</span>'
        : ficheSuppressed.clean
          ? '<span style="color:#16a34a;">No suppressed fiche entries found.</span>'
          : ficheSuppressed.items.map(f =>
              `<div style="padding:4px 0;border-bottom:1px solid #f1f5f9;color:#ef4444;">
                ⚠ ${_pos._fmt(f.amount)} RWF — Customer: ${f.customerId} — <em style="color:#64748b;">${f.note}</em>
              </div>`).join('');

      // Check 5 — Grand total
      const gtColor  = gt.clean ? '#16a34a' : '#ef4444';
      const gtBody   = `
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
          <div>POS total: <strong>${_pos._fmt(gt.csv)} RWF</strong></div>
          <div>RP total: <strong>${_pos._fmt(gt.rp)} RWF</strong></div>
          <div style="color:${gtColor};font-weight:700;">Gap: ${gt.gap >= 0 ? '+' : ''}${_pos._fmt(gt.gap)} RWF</div>
        </div>`;

      const allClean = payments.clean && volume.clean && ficheGhosts.clean && ficheSuppressed.clean && gt.clean;
      const summary  = allClean
        ? `<div style="background:#dcfce7;color:#166534;padding:10px 14px;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:12px;">
            ✓ All checks passed — ${csvRowCount} POS transactions match RP data for ${r.date}.
           </div>`
        : `<div style="background:#fef3c7;color:#92400e;padding:10px 14px;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:12px;">
            ⚠ Discrepancies found — review flagged checks below. ${csvRowCount} POS transactions analysed.
           </div>`;

      return summary
        + _pos._section('Check 1 — Payment Methods',          payments.clean,          false,                    payBody)
        + _pos._section('Check 2 — Volume (litres)',          volume.clean,            false,                    volBody)
        + _pos._section('Check 3 — Fiche Ghost Entries',      ficheGhosts.clean,       ficheGhosts.skipped,      ghostBody)
        + _pos._section('Check 4 — Fiche Suppression',        ficheSuppressed.clean,   ficheSuppressed.skipped,  suppBody)
        + _pos._section('Check 5 — Grand Total',              gt.clean,                false,                    gtBody);
    },
  };

  // ── Init ─────────────────────────────────────────────────────────────────────

  async function initSituation() {
    // Pre-warm nozzle cache in the background
    _getNozzles().catch(() => {});
    try {
      const now = new Date();
      const y   = now.getFullYear();
      const m   = now.getMonth() + 1;
      calMonth  = { year: y, month: m };
      const docs = await _fetchMonthFull(y, m);
      if (docs.length > 0) {
        cacheFromDocs(docs);
        await buildCalendar(y, m);
        buildRecentList(docs);
        await selectDate(safeDate(docs[0].logDate));
        return;
      }
      const fallbackRes  = await apiFetch("/situation?limit=1");
      const fallbackData = await fallbackRes.json();
      if (!fallbackData.situations || fallbackData.situations.length === 0) {
        const el = document.getElementById("loadedDate");
        if (el) el.textContent = "No records found.";
        const rl = document.getElementById("recentList");
        if (rl) rl.innerHTML = '<div class="list-empty">No records yet.</div>';
        await buildCalendar(y, m);
        return;
      }
      const latest       = safeDate(fallbackData.situations[0].logDate);
      const [fy, fm]     = latest.split("-").map(Number);
      calMonth           = { year: fy, month: fm };
      const fallbackDocs = await _fetchMonthFull(fy, fm);
      cacheFromDocs(fallbackDocs);
      await buildCalendar(fy, fm);
      buildRecentList(fallbackDocs);
      await selectDate(latest);
    } catch {
      const el = document.getElementById("loadedDate");
      if (el) el.textContent = "Failed to load.";
      const rl = document.getElementById("recentList");
      if (rl) rl.innerHTML = '<div class="list-empty">Error loading.</div>';
    }
  }

  async function download() {
    if (!activeDate) { window._dash.toast("No situation loaded.", "warning"); return; }
    try {
      await html2pdf().set({
        margin: [10, 10, 10, 10], filename: `Situation_${activeDate}.pdf`,
        image:       { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
      }).from(document.querySelector(".sheet")).save();
    } catch (err) {
      window._dash.toast("Download failed: " + (err?.message || err), "error");
    }
  }

  async function changeCalMonth(dir) {
    calMonth.month += dir;
    if (calMonth.month > 12) { calMonth.month = 1;  calMonth.year++; }
    if (calMonth.month < 1)  { calMonth.month = 12; calMonth.year--; }
    await buildCalendar(calMonth.year, calMonth.month);
  }

  window._sections.situation = initSituation;
  window._sit = {
    selectDate, changeCalMonth, download,
    enterEditMode, exitEditMode, saveEdit, recalcNozzles,
    togglePosPanel: () => _pos.toggle(),
    _posHandleFile: (f) => _pos.handleFile(f),
  };

})();
