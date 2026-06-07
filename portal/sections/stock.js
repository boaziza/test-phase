(function () {

  let initialPms, initialAgo, receivedPms, receivedAgo;
  let physicalStockPms, physicalStockAgo, theoryStockPms, theoryStockAgo;
  let gainFuelPms, gainFuelAgo;
  let totalGainFuelPms, totalGainFuelAgo, totalReceivedPms, totalReceivedAgo;
  let logDate, venteLitresAgo, venteLitresPms, totalVenteLitresAgo, totalVenteLitresPms;

  // ── History edit state ────────────────────────────────────────────────────────
  let _histIsEditing = false;
  let _histActivDoc  = null; // the merged doc currently shown in the detail panel

  // ── Submit tab ────────────────────────────────────────────────────────────────

  async function stock() {
    const { toast, apiFetch } = window._dash;
    logDate = document.querySelector("#section-stock #logDate")?.value;
    if (!logDate) { toast("Enter a date to continue", "warning"); return; }
    try {
      const resSituation = await apiFetch(`/situation/me?logDate=${logDate}`).then(r => r.json());
      const docSituation = resSituation.situation?.documents?.[0];
      if (docSituation) {
        venteLitresPms = parseInt(docSituation.venteLitresPms, 10);
        venteLitresAgo = parseInt(docSituation.venteLitresAgo, 10);
      }
    } catch (err) {
      toast("Error fetching sales data: " + err.message, "error");
      return;
    }
    if (isNaN(venteLitresPms) || isNaN(venteLitresAgo)) {
      toast("No sales data for this date. Submit the day's situation first.", "warning");
      return;
    }
    const stk = (id) => document.querySelector(`#section-stock #${id}`);
    initialPms       = parseInt(stk("initialPms")?.value,       10);
    initialAgo       = parseInt(stk("initialAgo")?.value,       10);
    receivedPms      = parseInt(stk("receivedPms")?.value,      10) || 0;
    receivedAgo      = parseInt(stk("receivedAgo")?.value,      10) || 0;
    physicalStockPms = parseInt(stk("physicalStockPms")?.value, 10);
    physicalStockAgo = parseInt(stk("physicalStockAgo")?.value, 10);
    theoryStockPms = initialPms + receivedPms - venteLitresPms;
    theoryStockAgo = initialAgo + receivedAgo - venteLitresAgo;
    gainFuelPms    = physicalStockPms - theoryStockPms;
    gainFuelAgo    = physicalStockAgo - theoryStockAgo;
    stk("theoryStockPms").textContent = theoryStockPms.toLocaleString();
    stk("theoryStockAgo").textContent = theoryStockAgo.toLocaleString();
    stk("gainFuelPms").textContent    = gainFuelPms.toLocaleString();
    stk("gainFuelAgo").textContent    = gainFuelAgo.toLocaleString();
    stk("venteLitresPms").textContent = venteLitresPms.toLocaleString();
    stk("venteLitresAgo").textContent = venteLitresAgo.toLocaleString();
  }

  async function storeStock() {
    const { toast, apiFetch, state } = window._dash;
    const { companyId, name, email } = state.profile;
    const stationId = state.viewingStation?.$id || state.profile.stationId;
    const situationKey    = `${stationId}_${logDate}`;
    const stockKeyPms     = `${stationId}_PMS_${logDate}`;
    const stockKeyAgo     = `${stationId}_AGO_${logDate}`;

    if (!logDate) { toast("Select a date and calculate stock first.", "warning"); return; }
    if (isNaN(theoryStockPms) || isNaN(theoryStockAgo)) { toast("Calculate stock before storing.", "warning"); return; }

    const d         = new Date(logDate);
    const monthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const stockKeyMonthly = `${stationId}_${monthYear}`;

    const created = [];
    const patched = [];

    async function rollbackStock() {
      for (const { url, id, snapshot } of [...patched].reverse()) {
        try { await apiFetch(`${url}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) }); } catch {}
      }
      for (const { url, id } of [...created].reverse()) {
        try { await apiFetch(`${url}/${id}`, { method: "DELETE" }); } catch {}
      }
    }

    try {
      const dataAgo = { initialStock: initialAgo, receivedLitres: receivedAgo, venteLitres: venteLitresAgo,
        physicalStock: physicalStockAgo, theoryStock: theoryStockAgo, gainFuel: gainFuelAgo,
        stockKey: stockKeyAgo, fuelType: "AGO",
        logDate, monthYear, companyId, stationId, email, situationKey };
      const dataPms = { initialStock: initialPms, receivedLitres: receivedPms, venteLitres: venteLitresPms,
        physicalStock: physicalStockPms, theoryStock: theoryStockPms, gainFuel: gainFuelPms,
        stockKey: stockKeyPms, fuelType: "PMS",
        logDate, monthYear, companyId, stationId, email, situationKey };

      const response = await apiFetch(`/stock/me?monthYear=${monthYear}`).then(r => r.json());

      totalGainFuelPms = gainFuelPms; totalGainFuelAgo = gainFuelAgo;
      totalReceivedPms = receivedPms; totalReceivedAgo = receivedAgo;
      totalVenteLitresPms = venteLitresPms; totalVenteLitresAgo = venteLitresAgo;

      if (response.stock?.documents.length > 0) {
        const sd = response.stock.documents[0];
        patched.push({ url: "/stock", id: sd.$id, snapshot: {
          totalGainFuelPms:    sd.totalGainFuelPms,
          totalGainFuelAgo:    sd.totalGainFuelAgo,
          totalReceivedPms:    sd.totalReceivedPms,
          totalReceivedAgo:    sd.totalReceivedAgo,
          totalVenteLitresPms: sd.totalVenteLitresPms,
          totalVenteLitresAgo: sd.totalVenteLitresAgo,
        }});
        totalGainFuelPms    += sd.totalGainFuelPms;    totalGainFuelAgo    += sd.totalGainFuelAgo;
        totalReceivedPms    += sd.totalReceivedPms;    totalReceivedAgo    += sd.totalReceivedAgo;
        totalVenteLitresPms += sd.totalVenteLitresPms; totalVenteLitresAgo += sd.totalVenteLitresAgo;
        const rMonthly = await apiFetch(`/stock/${sd.$id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totalGainFuelPms, totalGainFuelAgo, totalReceivedPms,
            totalReceivedAgo, totalVenteLitresPms, totalVenteLitresAgo }),
        });
        if (!rMonthly.ok) { const e = await rMonthly.json(); throw new Error("Monthly stock: " + e.error); }
      } else {
        const rMonthly = await apiFetch(`/stock`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stockKey: stockKeyMonthly, companyId, stationId,
            totalGainFuelPms, totalGainFuelAgo, totalReceivedPms,
            totalReceivedAgo, totalVenteLitresPms, totalVenteLitresAgo, monthYear }),
        });
        if (!rMonthly.ok) { const e = await rMonthly.json(); throw new Error("Monthly stock: " + e.error); }
        const mDoc = await rMonthly.json();
        created.push({ url: "/stock", id: mDoc.stock?.$id || mDoc.$id });
      }

      const resAgo = await apiFetch(`/stock-daily`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataAgo) });
      if (!resAgo.ok) { const e = await resAgo.json(); await rollbackStock(); throw new Error("AGO: " + e.error); }
      const agoDoc = await resAgo.json();
      created.push({ url: "/stock-daily", id: agoDoc.stock?.$id || agoDoc.$id });

      const resPms2 = await apiFetch(`/stock-daily`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataPms) });
      if (!resPms2.ok) { const e = await resPms2.json(); await rollbackStock(); throw new Error("PMS: " + e.error); }

      toast("Stock saved successfully", "success");
      document.querySelectorAll(".output").forEach(el => { el.textContent = "0"; });
      document.getElementById("stockForm")?.reset();
    } catch (err) {
      await rollbackStock();
      toast("Error saving stock: " + err.message, "error");
    }
  }

  async function download() {
    const { toast } = window._dash;
    const date = document.getElementById("logDate")?.value;
    if (!date) { toast("Select a date before downloading.", "warning"); return; }
    try {
      const formEl = document.getElementById("stockForm");
      if (!formEl) throw new Error("Stock form not found.");
      await html2pdf().set({
        margin: [10,10,10,10], filename: `Stock_${date}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      }).from(formEl).save();
    } catch (err) {
      window._dash.toast("Download failed: " + err.message, "error");
    }
  }

  async function switchStockTab(tab, btn) {
    const submitEl  = document.getElementById("stock-tab-submit");
    const historyEl = document.getElementById("stock-tab-history");
    if (submitEl)  submitEl.style.display  = tab === "submit"  ? "block" : "none";
    if (historyEl) historyEl.style.display = tab === "history" ? "block" : "none";
    document.querySelectorAll("#section-stock .stock-tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (tab === "history") await loadStockHistory();
  }

  // ── History tab ───────────────────────────────────────────────────────────────

  let _historyLoaded = false;
  let _stockDocs     = [];
  let _stockDates    = new Set();
  let _calYear, _calMonth, _selectedDate = null;

  async function loadStockHistory() {
    if (_historyLoaded) return;
    const { apiFetch, state } = window._dash;
    const stationId = state.viewingStation?.$id || state.profile?.stationId || "";
    const listEl = document.getElementById("histEntryList");
    try {
      const data = await apiFetch(`/stock-daily?limit=100${stationId ? `&station=${stationId}` : ""}`).then(r => r.json());
      const docs  = data.stockDaily?.documents ?? data.stockDaily ?? [];

      const byDate = {};
      docs.forEach(d => {
        const ds = String(d.logDate || "").substring(0, 10);
        if (!ds) return;
        if (!byDate[ds]) byDate[ds] = { logDate: ds };
        if (d.fuelType === "PMS") {
          byDate[ds].pmsDocId        = d.$id;       // ← store for PATCH
          byDate[ds].physicalStockPms = d.physicalStock;
          byDate[ds].gainFuelPms      = d.gainFuel;
          byDate[ds].initialPms       = d.initialStock;
          byDate[ds].receivedPms      = d.receivedLitres;
          byDate[ds].venteLitresPms   = d.venteLitres;
          byDate[ds].theoryStockPms   = d.theoryStock;
        } else {
          byDate[ds].agoDocId        = d.$id;       // ← store for PATCH
          byDate[ds].physicalStockAgo = d.physicalStock;
          byDate[ds].gainFuelAgo      = d.gainFuel;
          byDate[ds].initialAgo       = d.initialStock;
          byDate[ds].receivedAgo      = d.receivedLitres;
          byDate[ds].venteLitresAgo   = d.venteLitres;
          byDate[ds].theoryStockAgo   = d.theoryStock;
        }
      });

      _stockDocs = Object.values(byDate)
        .filter(d => d.physicalStockPms != null || d.physicalStockAgo != null)
        .sort((a, b) => b.logDate.localeCompare(a.logDate));

      if (_stockDocs.length === 0) {
        if (listEl) listEl.innerHTML = '<div class="hist-list-empty">No stock entries found yet.</div>';
        _historyLoaded = true; _initCalendar(); return;
      }
      _stockDocs.forEach(d => _stockDates.add(d.logDate));
      _renderEntryList(); _historyLoaded = true; _initCalendar();
    } catch {
      if (listEl) listEl.innerHTML = '<div class="hist-list-empty">Error loading history.</div>';
    }
  }

  function _renderEntryList() {
    const listEl = document.getElementById("histEntryList");
    if (!listEl) return;
    listEl.innerHTML = _stockDocs.map(doc => {
      const ds    = String(doc.logDate || "").substring(0, 10);
      const d     = new Date(ds + "T00:00:00");
      const label = isNaN(d.getTime()) ? ds : d.toLocaleString("default", { day: "numeric", month: "short", year: "numeric" });
      const gPms  = Number(doc.gainFuelPms) || 0;
      const gAgo  = Number(doc.gainFuelAgo) || 0;
      const net   = gPms + gAgo;
      const cls   = net > 0 ? "hist-pill-gain" : net < 0 ? "hist-pill-loss" : "hist-pill-neutral";
      return `<div class="hist-entry-item" data-date="${ds}" onclick="window._stock._selectDate('${ds}', this)">
        <span class="hist-dot"></span>
        <div class="hist-entry-info"><div class="hist-entry-date">${label}</div>
          <div class="hist-entry-sub">PMS ${(Number(doc.physicalStockPms)||0).toLocaleString()} L · AGO ${(Number(doc.physicalStockAgo)||0).toLocaleString()} L</div>
        </div>
        <span class="hist-pill ${cls}">${net >= 0 ? "+" : ""}${net.toLocaleString()} L</span>
      </div>`;
    }).join("");
  }

  function _initCalendar() {
    const now = new Date(); _calYear = now.getFullYear(); _calMonth = now.getMonth();
    _renderCalendar();
  }

  function _renderCalendar() {
    window._utils.renderCalendar({
      gridId: "histCalGrid", labelId: "histCalMonthLabel",
      year: _calYear, month: _calMonth + 1,
      entries:      [..._stockDates].map(date => ({ date })),
      selectedDate: _selectedDate,
      weekStart:    "mon",
      dayClass:     "hist-cal-day",
      headerClass:  "hist-cal-day cal-header",
      dataClass:    "has-stock",
      onDayClick:   _selectHistDate,
    });
  }

  function _calPrev() { _calMonth--; if (_calMonth < 0)  { _calMonth = 11; _calYear--; } _renderCalendar(); }
  function _calNext() { _calMonth++; if (_calMonth > 11) { _calMonth = 0;  _calYear++; } _renderCalendar(); }

  function _selectHistDate(dateStr, listItemEl) {
    // Lesson from situation: block switching dates while editing
    if (_histIsEditing) {
      window._dash.toast("Save or cancel your edits before switching.", "warning");
      return;
    }
    _selectedDate = dateStr;
    document.querySelectorAll(".hist-entry-item").forEach(el => el.classList.remove("active"));
    if (listItemEl) listItemEl.classList.add("active");
    else {
      const match = document.querySelector(`.hist-entry-item[data-date="${dateStr}"]`);
      if (match) { match.classList.add("active"); match.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    }
    _renderCalendar();
    const doc = _stockDocs.find(d => String(d.logDate || "").substring(0, 10) === dateStr);
    if (doc) _renderHistDetail(doc, dateStr);
  }

  function _renderHistDetail(doc, dateStr) {
    // Lesson from situation: guard against re-rendering while in edit mode
    if (_histIsEditing) return;

    _histActivDoc = doc;

    const d     = new Date(dateStr + "T00:00:00");
    const label = isNaN(d.getTime()) ? dateStr
      : d.toLocaleString("default", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const gPms = Number(doc.gainFuelPms) || 0;
    const gAgo = Number(doc.gainFuelAgo) || 0;
    const net  = gPms + gAgo;

    // bdRow with optional stable id on the value span
    const bdRow = (lbl, val, id = null) =>
      `<div class="hist-bd-row"><span class="hist-bd-label">${lbl}</span>` +
      `<span class="hist-bd-value"${id ? ` id="${id}"` : ""}>${val != null ? Number(val).toLocaleString() + " L" : "—"}</span></div>`;

    const chipVal = (id, n) =>
      `<span class="hist-chip-value" id="${id}">${(Number(n)||0).toLocaleString()} L</span>`;
    const chipGain = (id, n) =>
      `<span class="hist-chip-value ${n >= 0 ? "gain" : "loss"}" id="${id}">${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()} L</span>`;

    const histDetailEl = document.getElementById("histDetail");
    if (!histDetailEl) return;
    histDetailEl.innerHTML = `
      <div class="hist-detail-header">
        <div class="hist-detail-title-row">
          <div class="hist-detail-title">${label}</div>
          <div class="hist-detail-actions">
            <button class="btn-hist-edit"   id="histEditBtn"   onclick="window._stock._enterHistEditMode()">✏ Edit</button>
            <button class="btn-hist-cancel" id="histCancelBtn" style="display:none;" onclick="window._stock._exitHistEditMode()">Cancel</button>
            <button class="btn-hist-save"   id="histSaveBtn"   style="display:none;" onclick="this.disabled=true; window._stock._saveHistEdit(this).finally(()=>this.disabled=false)">Save</button>
          </div>
        </div>
        <div class="hist-summary-strip">
          <div class="hist-chip"><span class="hist-chip-label">PMS Physical</span>${chipVal("hchip-pms-physical", doc.physicalStockPms)}</div>
          <div class="hist-chip"><span class="hist-chip-label">AGO Physical</span>${chipVal("hchip-ago-physical", doc.physicalStockAgo)}</div>
          <div class="hist-chip"><span class="hist-chip-label">PMS Gain/Loss</span>${chipGain("hchip-pms-gain", gPms)}</div>
          <div class="hist-chip"><span class="hist-chip-label">AGO Gain/Loss</span>${chipGain("hchip-ago-gain", gAgo)}</div>
          <div class="hist-chip"><span class="hist-chip-label">Net</span>${chipGain("hchip-net", net)}</div>
        </div>
      </div>
      <div class="hist-breakdown-grid">
        <div class="hist-breakdown-card hist-bd-pms">
          <div class="hist-bd-title">Essence (PMS)</div>
          ${bdRow("Initial",  doc.initialPms,       "hpms-initial")}
          ${bdRow("Received", doc.receivedPms,       "hpms-received")}
          ${bdRow("Sold",     doc.venteLitresPms)}
          ${bdRow("Theory",   doc.theoryStockPms,    "hpms-theory")}
          ${bdRow("Physical", doc.physicalStockPms,  "hpms-physical")}
          <div class="hist-bd-row gain-row">
            <span class="hist-bd-label">Gain/Loss</span>
            <span class="hist-bd-value ${gPms >= 0 ? "gain" : "loss"}" id="hpms-gain">${gPms >= 0 ? "+" : ""}${gPms.toLocaleString()} L</span>
          </div>
        </div>
        <div class="hist-breakdown-card hist-bd-ago">
          <div class="hist-bd-title">Mazout (AGO)</div>
          ${bdRow("Initial",  doc.initialAgo,       "hago-initial")}
          ${bdRow("Received", doc.receivedAgo,       "hago-received")}
          ${bdRow("Sold",     doc.venteLitresAgo)}
          ${bdRow("Theory",   doc.theoryStockAgo,    "hago-theory")}
          ${bdRow("Physical", doc.physicalStockAgo,  "hago-physical")}
          <div class="hist-bd-row gain-row">
            <span class="hist-bd-label">Gain/Loss</span>
            <span class="hist-bd-value ${gAgo >= 0 ? "gain" : "loss"}" id="hago-gain">${gAgo >= 0 ? "+" : ""}${gAgo.toLocaleString()} L</span>
          </div>
        </div>
      </div>`;
  }

  // ── History edit mode ─────────────────────────────────────────────────────────

  function _setHistEditUI(editing) {
    // Lesson from situation: always null-safe
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v; };
    s("histEditBtn",   editing ? "none" : "");
    s("histCancelBtn", editing ? "" : "none");
    s("histSaveBtn",   editing ? "" : "none");
  }

  function _enterHistEditMode() {
    if (!_histActivDoc || _histIsEditing) return;
    _histIsEditing = true;

    // Editable: initial, received, physical — per fuel type
    const editFields = [
      { id: "hpms-initial",  val: _histActivDoc.initialPms      },
      { id: "hpms-received", val: _histActivDoc.receivedPms     },
      { id: "hpms-physical", val: _histActivDoc.physicalStockPms },
      { id: "hago-initial",  val: _histActivDoc.initialAgo      },
      { id: "hago-received", val: _histActivDoc.receivedAgo     },
      { id: "hago-physical", val: _histActivDoc.physicalStockAgo },
    ];

    editFields.forEach(({ id, val }) => {
      const el = document.getElementById(id);
      if (!el || el.tagName === "INPUT") return;
      const inp = document.createElement("input");
      inp.type      = "number";
      inp.className = "hist-edit-input";
      inp.id        = id;
      inp.value     = Number(val) || 0;
      inp.addEventListener("input", _recalcHistEdit);
      el.replaceWith(inp);
    });

    _recalcHistEdit();
    _setHistEditUI(true);
  }

  function _recalcHistEdit() {
    const v = id => Number(document.getElementById(id)?.value || 0);

    // set only non-input elements (calculated spans)
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el && el.tagName !== "INPUT") el.textContent = Math.round(n).toLocaleString() + " L";
    };
    const setChip = (id, n) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = (n >= 0 ? "+" : "") + Math.round(n).toLocaleString() + " L";
      el.className   = `hist-chip-value ${n >= 0 ? "gain" : "loss"}`;
    };
    const setChipVal = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = Math.round(n).toLocaleString() + " L";
    };

    const ventePms  = Number(_histActivDoc.venteLitresPms) || 0;
    const venteAgo  = Number(_histActivDoc.venteLitresAgo) || 0;
    const theoryPms = v("hpms-initial") + v("hpms-received") - ventePms;
    const gainPms   = v("hpms-physical") - theoryPms;
    const theoryAgo = v("hago-initial") + v("hago-received") - venteAgo;
    const gainAgo   = v("hago-physical") - theoryAgo;
    const net       = gainPms + gainAgo;

    set("hpms-theory", theoryPms);   set("hpms-gain", gainPms);
    set("hago-theory", theoryAgo);   set("hago-gain", gainAgo);
    setChipVal("hchip-pms-physical", v("hpms-physical"));
    setChipVal("hchip-ago-physical", v("hago-physical"));
    setChip("hchip-pms-gain", gainPms);
    setChip("hchip-ago-gain", gainAgo);
    setChip("hchip-net",      net);
  }

  function _exitHistEditMode() {
    if (!_histIsEditing) return;
    _histIsEditing = false;
    _setHistEditUI(false);
    // Full innerHTML rebuild = no restoreSpans needed
    _renderHistDetail(_histActivDoc, _selectedDate);
  }

  async function _saveHistEdit(btn) {
    if (!_histActivDoc || !_histIsEditing) return;
    const { toast, apiFetch } = window._dash;

    const v = id => Number(document.getElementById(id)?.value || 0);

    const ventePms  = Number(_histActivDoc.venteLitresPms) || 0;
    const venteAgo  = Number(_histActivDoc.venteLitresAgo) || 0;
    const initPms   = v("hpms-initial"), recvPms = v("hpms-received"), physPms = v("hpms-physical");
    const initAgo   = v("hago-initial"), recvAgo = v("hago-received"), physAgo = v("hago-physical");
    const theoryPms = Math.round(initPms + recvPms - ventePms);
    const gainPms   = Math.round(physPms - theoryPms);
    const theoryAgo = Math.round(initAgo + recvAgo - venteAgo);
    const gainAgo   = Math.round(physAgo - theoryAgo);

    // Snapshot both docs before writing so either can be restored on partial failure
    const snapPms = {
      initialStock: Number(_histActivDoc.initialPms), receivedLitres: Number(_histActivDoc.receivedPms),
      physicalStock: Number(_histActivDoc.physicalStockPms), theoryStock: Number(_histActivDoc.theoryStockPms),
      gainFuel: Number(_histActivDoc.gainFuelPms),
    };
    const snapAgo = {
      initialStock: Number(_histActivDoc.initialAgo), receivedLitres: Number(_histActivDoc.receivedAgo),
      physicalStock: Number(_histActivDoc.physicalStockAgo), theoryStock: Number(_histActivDoc.theoryStockAgo),
      gainFuel: Number(_histActivDoc.gainFuelAgo),
    };

    async function rollbackHistEdit(pmsOk, agoOk) {
      if (pmsOk) {
        try { await apiFetch(`/stock-daily/${_histActivDoc.pmsDocId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapPms) }); } catch {}
      }
      if (agoOk) {
        try { await apiFetch(`/stock-daily/${_histActivDoc.agoDocId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapAgo) }); } catch {}
      }
    }

    try {
      const [resPms, resAgo] = await Promise.all([
        apiFetch(`/stock-daily/${_histActivDoc.pmsDocId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initialStock: initPms, receivedLitres: recvPms, physicalStock: physPms,
            theoryStock: theoryPms, gainFuel: gainPms }),
        }),
        apiFetch(`/stock-daily/${_histActivDoc.agoDocId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initialStock: initAgo, receivedLitres: recvAgo, physicalStock: physAgo,
            theoryStock: theoryAgo, gainFuel: gainAgo }),
        }),
      ]);

      const pmsOk = resPms.ok, agoOk = resAgo.ok;
      if (!pmsOk || !agoOk) {
        await rollbackHistEdit(pmsOk, agoOk);
        const e = !pmsOk ? await resPms.json() : await resAgo.json();
        throw new Error((!pmsOk ? "PMS" : "AGO") + ": " + (e.error || "failed"));
      }

      // Update _stockDocs cache so list + calendar reflect new values
      const idx = _stockDocs.findIndex(d => String(d.logDate || "").substring(0, 10) === _selectedDate);
      if (idx !== -1) {
        Object.assign(_stockDocs[idx], {
          initialPms: initPms, receivedPms: recvPms, physicalStockPms: physPms,
          theoryStockPms: theoryPms, gainFuelPms: gainPms,
          initialAgo: initAgo, receivedAgo: recvAgo, physicalStockAgo: physAgo,
          theoryStockAgo: theoryAgo, gainFuelAgo: gainAgo,
        });
        _histActivDoc = _stockDocs[idx];
      }

      _histIsEditing = false;
      _setHistEditUI(false);
      _renderEntryList();
      _renderHistDetail(_histActivDoc, _selectedDate);
      toast("Stock updated.", "success");
    } catch (err) {
      toast("Save failed: " + err.message, "error");
      btn.disabled = false;
    }
  }

  // ── Register ──────────────────────────────────────────────────────────────────

  window._sections.stock = function () {};

  window._stock = {
    stock, storeStock, download, switchStockTab,
    _calPrev, _calNext,
    _selectDate: _selectHistDate,
    _enterHistEditMode, _exitHistEditMode, _saveHistEdit,
  };

})();
