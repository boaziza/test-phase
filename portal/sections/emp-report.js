(function () {

  const { fmt, parseJson } = window._utils;

  let _logDate = null;
  let _email   = null;
  let _docs    = [];
  let _page    = 0;

  // ── helpers ──────────────────────────────────────────────────────────────────

  function setField(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function clearSheet() {
    document.querySelectorAll("#er-reportSheet span").forEach(el => { el.textContent = ""; });
    const tbody = document.getElementById("er-nozzleReadingsBody");
    if (tbody) tbody.innerHTML = "";
  }

  function setMainBar(label, gainLoss) {
    const labelEl = document.getElementById("er-loadedDate");
    if (labelEl) labelEl.textContent = label;
    const pill = document.getElementById("er-donePill");
    if (!pill) return;
    if (gainLoss === null || gainLoss === undefined) {
      pill.textContent = ""; pill.className = "done-pill"; return;
    }
    const gl = Number(gainLoss);
    pill.textContent = gl >= 0 ? `Gain +${fmt(gl)} RWF` : `Loss ${fmt(gl)} RWF`;
    pill.className   = `done-pill ${gl >= 0 ? "pill-gain" : "pill-loss"}`;
  }

  function setSidebarList(docs, loading) {
    const listEl  = document.getElementById("er-entryList");
    const titleEl = document.getElementById("er-entryListTitle");
    if (!listEl || !titleEl) return;
    if (loading) {
      titleEl.textContent = "";
      listEl.innerHTML = `<div class="pom-list-empty">Loading…</div>`;
      return;
    }
    if (!docs.length) {
      titleEl.textContent = "";
      listEl.innerHTML = `<div class="pom-list-empty">No report loaded yet.</div>`;
      return;
    }
    titleEl.textContent = `${docs.length} entr${docs.length === 1 ? "y" : "ies"} found`;
    listEl.innerHTML = docs.map((doc, i) => {
      const n        = i + 1;
      const gl       = doc.paymentData ? Number(doc.paymentData.gainPayments) : null;
      const glText   = gl !== null ? (gl >= 0 ? `+${fmt(gl)}` : fmt(gl)) : "—";
      const dotClass = gl === null ? "neutral-dot" : gl >= 0 ? "gain-dot" : "loss-dot";
      const amtClass = gl === null ? "" : gl >= 0 ? "gain" : "loss";
      const initial  = (_email || "E").charAt(0).toUpperCase();
      const dateStr  = String(doc.logDate || _logDate).substring(0, 10);
      return `
        <div class="pom-entry-item${n === _page ? " pom-active" : ""}"
             onclick="window._er.selectEntry(${n})" data-entry="${n}">
          <div class="pom-entry-dot ${dotClass}">${initial}${n}</div>
          <div class="pom-entry-info">
            <div class="pom-entry-label">Entry ${n} — ${doc.shift || ""}</div>
            <div class="pom-entry-meta">${dateStr}</div>
          </div>
          <div class="pom-entry-amount ${amtClass}">${glText}</div>
        </div>`;
    }).join("");
  }

  // ── nozzle row renderer ───────────────────────────────────────────────────────

  function _renderNozzleRows(readings) {
    const tbody = document.getElementById("er-nozzleReadingsBody");
    if (!tbody) return;

    if (!readings || !readings.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:.75rem;color:var(--text-muted,#888);">No nozzle readings for this shift.</td></tr>`;
      return;
    }

    const fuelCls = { PMS: "pms", AGO: "ago", Kerosene: "kero" };
    tbody.innerHTML = [...readings]
      .sort((a, b) => (a.pumpNumber - b.pumpNumber) || (a.nozzleNumber - b.nozzleNumber))
      .map(r => `
        <tr>
          <td>${r.pumpNumber  || "—"}</td>
          <td>Pump ${r.pumpNumber  || "?"}</td>
          <td>Nozzle ${r.nozzleNumber || "?"}</td>
          <td><span class="fuel-pill ${fuelCls[r.fuelType] || ""}">${r.fuelType}</span></td>
          <td>${fmt(r.endReading)}</td>
          <td>${fmt(r.startReading)}</td>
          <td>${fmt(r.venteLitres)}</td>
        </tr>`)
      .join("");
  }

  // ── display ───────────────────────────────────────────────────────────────────

  function displayPage(n) {
    if (n < 1 || n > _docs.length) return;
    clearSheet();

    const doc     = _docs[n - 1];
    const dateStr = String(doc.logDate || _logDate).substring(0, 10);
    const label   = `Entry ${n} of ${_docs.length} — ${dateStr} · ${doc.shift || ""} · ${_email}`;

    // Render nozzle rows for this shift
    _renderNozzleRows(doc.nozzleReadings || []);

    // Summary totals (still on the daily-report doc)
    setField("er-venteLitresPms", doc.venteLitresPms);
    setField("er-venteLitresAgo", doc.venteLitresAgo);
    setField("er-pmsPrices",      doc.pmsPrice);
    setField("er-agoPrices",      doc.agoPrice);
    setField("er-totalPms",       doc.totalPms);
    setField("er-totalAgo",       doc.totalAgo);
    setField("er-totalVente",     doc.totalVente);

    let gainLoss = null;
    if (doc.paymentData) {
      const p = doc.paymentData;
      try {
        const loans = parseJson(p.loans, []);
        const fiche = parseJson(p.fiche, []);

        ["momo","momoLoss","totalFiche","bon","spFuelCard","bankCard",
         "totalCash","totalPayments","totalLoans"].forEach(f => setField(`er-${f}`, p[f]));

        const gainEl = document.getElementById("er-gainPayments");
        if (gainEl) {
          gainEl.textContent = fmt(p.gainPayments);
          gainEl.className   = Number(p.gainPayments) >= 0 ? "gain" : "loss";
        }
        gainLoss = p.gainPayments;

        const sfcEl = document.getElementById("er-listSFC");
        if (sfcEl) sfcEl.textContent = Array.isArray(p.listSFC) ? p.listSFC.join(", ") : (p.listSFC || "—");
        const bcEl = document.getElementById("er-listBC");
        if (bcEl) bcEl.textContent = Array.isArray(p.listBC) ? p.listBC.join(", ") : (p.listBC || "—");
        const loansEl = document.getElementById("er-loans");
        if (loansEl) loansEl.textContent = loans.length ? loans.map(l => `${l.company}: ${fmt(l.amount)}`).join(" · ") : "—";
        const ficheEl = document.getElementById("er-fiche");
        if (ficheEl) ficheEl.textContent = fiche.length ? fiche.map(f => `${f.company}: ${fmt(f.amount)}`).join(" · ") : "—";
      } catch {}
    }

    setMainBar(label, gainLoss);
  }

  // ── public API ────────────────────────────────────────────────────────────────

  async function displayDetails() {
    const { toast, apiFetch, state } = window._dash;
    const logDateEl = document.getElementById("er-logDate");
    const emailEl   = document.getElementById("er-email");
    _logDate = logDateEl?.value;
    _email   = emailEl?.value;

    if (!_logDate || !_email) {
      toast("Please choose both a date and an employee email.", "warning"); return;
    }

    clearSheet(); _docs = []; _page = 0;
    setMainBar("Fetching report…", null);
    setSidebarList([], true);

    try {
      const params = `logDate=${_logDate}&email=${encodeURIComponent(_email)}`;

      const [idxData, payData] = await Promise.all([
        apiFetch(`/daily-reports/me?${params}`).then(r => r.json()),
        apiFetch(`/payments/me?${params}`).then(r => r.json()),
      ]);

      const idxDocs = idxData.dailyReport?.documents ?? idxData.documents ?? [];
      const payDocs = payData.payment?.documents     ?? payData.documents ?? [];

      if (!idxDocs.length) {
        toast("No records found for this date and employee.", "warning");
        setMainBar("No report loaded", null);
        setSidebarList([], false);
        return;
      }

      // For each shift entry, fetch its nozzle readings
      const stationId = state.profile?.stationId;
      const docsWithReadings = await Promise.all(idxDocs.map(async doc => {
        if (!stationId || !doc.shift) return { ...doc, nozzleReadings: [] };
        try {
          const res = await apiFetch(
            `/nozzle-readings?station=${stationId}&date=${_logDate}&shift=${encodeURIComponent(doc.shift)}`
          ).then(r => r.json());
          // Filter to only this employee's readings
          const readings = (res.readings ?? []).filter(r => r.email === _email);
          return { ...doc, nozzleReadings: readings };
        } catch {
          return { ...doc, nozzleReadings: [] };
        }
      }));

      const paymentDoc = payDocs[0] || null;
      _docs = docsWithReadings.map(doc => ({ ...doc, paymentData: paymentDoc }));
      _page = 1;
      setSidebarList(_docs, false);
      displayPage(_page);

    } catch (err) {
      toast("Error fetching report: " + (err?.message || err), "error");
      setMainBar("Error loading report", null);
      setSidebarList([], false);
    }
  }

  function selectEntry(n) {
    _page = n;
    document.querySelectorAll(".pom-entry-item").forEach(el =>
      el.classList.toggle("pom-active", el.dataset.entry == n)
    );
    displayPage(n);
  }

  async function download() {
    const toast = window._dash.toast;
    if (!_docs.length) { toast("Fetch a report before downloading.", "warning"); return; }
    try {
      const safeEmail = (_email || "employee").replace(/[^a-zA-Z0-9]/g, "_");
      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename:    `Pompiste_${safeEmail}_${_logDate}.pdf`,
        image:       { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak:   { mode: ["css", "legacy"] },
      }).from(document.getElementById("er-reportSheet")).save();
    } catch (err) {
      window._dash.toast("Download failed: " + (err?.message || err), "error");
    }
  }

  window._sections["emp-report"] = function () {};
  window._er = { displayDetails, selectEntry, download };

})();
