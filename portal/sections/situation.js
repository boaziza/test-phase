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
    const stationId = state.profile?.stationId;
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
      const stationId = state.profile?.stationId;
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
      // startReading = lowest start seen that day, endReading = highest end seen that day
      const nozzleMap = {};
      readings.forEach(r => {
        const id = r.nozzleId;
        if (!nozzleMap[id]) { nozzleMap[id] = { ...r }; return; }
        if (Number(r.startReading) < Number(nozzleMap[id].startReading))
          nozzleMap[id].startReading = r.startReading;
        if (Number(r.endReading) > Number(nozzleMap[id].endReading))
          nozzleMap[id].endReading = r.endReading;
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

      const pill = document.getElementById("donePill");
      if (pill) {
        pill.textContent      = doc.done ? "Done ✓" : "Pending";
        pill.style.background = doc.done ? "var(--pms-bg)" : "#fff7ed";
        pill.style.color      = doc.done ? "var(--pms)"    : "var(--ago)";
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

    } catch (err) {
      toast("Error loading situation: " + (err?.message || err), "error");
    } finally {
      mainEl.classList.remove("sit-loading");
    }
  }

  // ── Nozzle row rendering ─────────────────────────────────────────────────────

  function _renderNozzleRows(nozzles, readings, editing = false) {
    const tbody = document.getElementById("nozzleReadingsBody");
    if (!tbody) return;

    if (editing) {
      // Edit mode: driven by active nozzles — deactivated pumps excluded
      if (!nozzles.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted,#888);">No active nozzles configured. Add pumps and nozzles in Settings → Pumps &amp; Nozzles.</td></tr>`;
        return;
      }
      const readingMap = {};
      readings.forEach(r => { readingMap[r.nozzleId] = r; });

      tbody.innerHTML = nozzles.map(n => {
        const r       = readingMap[n.$id] || {};
        const nLabel  = n.label || `Nozzle ${n.nozzleNumber}`;
        const fuelCls = n.fuelType === "PMS" ? "pms" : n.fuelType === "AGO" ? "ago" : "kero";
        const start   = r.startReading != null ? r.startReading : "";
        const end     = r.endReading   != null ? r.endReading   : "";
        return `<tr data-nozzle-id="${n.$id}" data-fuel-type="${n.fuelType}" data-pump-id="${n.pumpId}" data-pump-number="${n.pumpNumber}" data-nozzle-number="${n.nozzleNumber}">
          <td>${n.pumpNumber}</td>
          <td>${n.pumpLabel}</td>
          <td>${nLabel}</td>
          <td><span class="fuel-pill ${fuelCls}">${n.fuelType}</span></td>
          <td><input type="number" class="sit-edit-input nozzle-end"   data-nozzle="${n.$id}" value="${Number(end)   || 0}" oninput="window._sit.recalcNozzles()"></td>
          <td><input type="number" class="sit-edit-input nozzle-start" data-nozzle="${n.$id}" value="${Number(start) || 0}" oninput="window._sit.recalcNozzles()"></td>
          <td class="nozzle-sold" data-nozzle="${n.$id}">—</td>
        </tr>`;
      }).join("");
      recalcNozzles();
      return;
    }

    // View mode: driven by saved readings — shows all recorded data including
    // readings for pumps that have since been deactivated
    if (!readings.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted,#888);">No nozzle readings recorded for this date.</td></tr>`;
      return;
    }

    tbody.innerHTML = [...readings]
      .sort((a, b) => (a.pumpNumber - b.pumpNumber) || (a.nozzleNumber - b.nozzleNumber))
      .map(r => {
        const fuelCls = r.fuelType === "PMS" ? "pms" : r.fuelType === "AGO" ? "ago" : "kero";
        return `<tr data-nozzle-id="${r.nozzleId}" data-fuel-type="${r.fuelType}">
          <td>${r.pumpNumber  || "—"}</td>
          <td>Pump ${r.pumpNumber  || "?"}</td>
          <td>Nozzle ${r.nozzleNumber || "?"}</td>
          <td><span class="fuel-pill ${fuelCls}">${r.fuelType}</span></td>
          <td>${r.endReading   != null ? fmt(r.endReading)   : "—"}</td>
          <td>${r.startReading != null ? fmt(r.startReading) : "—"}</td>
          <td>${r.venteLitres  != null ? fmt(r.venteLitres)  : "—"}</td>
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

    const stationId = state.profile?.stationId;
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

    const stationId = state.profile?.stationId || "";
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

    const readingPromises = nozzleRows.map(row => {
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

      return apiFetch("/nozzle-readings", {
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

      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Save failed"); }

      delete monthCache[activeDate.substring(0, 7)];
      _isEditing = false;
      _setEditUI(false);
      await loadSituationDate(activeDate);
      toast("Situation updated.", "success");
    } catch (err) {
      toast("Save failed: " + err.message, "error");
      btn.disabled = false;
    }
  }

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
  window._sit = { selectDate, changeCalMonth, download, enterEditMode, exitEditMode, saveEdit, recalcNozzles };

})();
