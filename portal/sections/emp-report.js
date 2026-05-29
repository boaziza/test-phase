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
    document.querySelectorAll("#er-reportSheet span").forEach(el => { el.textContent = ''; });
  }

  function setMainBar(label, gainLoss) {
    const labelEl = document.getElementById("er-loadedDate");
    if (labelEl) labelEl.textContent = label;
    const pill = document.getElementById("er-donePill");
    if (!pill) return;
    if (gainLoss === null || gainLoss === undefined) {
      pill.textContent = "";
      pill.className = "done-pill";
      return;
    }
    const gl = Number(gainLoss);
    pill.textContent = gl >= 0 ? `Gain +${fmt(gl)} RWF` : `Loss ${fmt(gl)} RWF`;
    pill.className = `done-pill ${gl >= 0 ? "pill-gain" : "pill-loss"}`;
  }

  function setSidebarList(docs, loading) {
    const listEl = document.getElementById("er-entryList");
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
            <div class="pom-entry-label">Entry ${n}</div>
            <div class="pom-entry-meta">${dateStr}</div>
          </div>
          <div class="pom-entry-amount ${amtClass}">${glText}</div>
        </div>`;
        }).join("");
  }

  // ── display ───────────────────────────────────────────────────────────────────

  function displayPage(n) {
    if (n < 1 || n > _docs.length) return;
    clearSheet();

    const doc      = _docs[n - 1];
    const dateStr  = String(doc.logDate || _logDate).substring(0, 10);
    const label    = `Entry ${n} of ${_docs.length} — ${dateStr} · ${_email}`;

    setField("er-pms1", doc.pms1); setField("er-pms2", doc.pms2);
    setField("er-pms3", doc.pms3); setField("er-pms4", doc.pms4);
    setField("er-ago1", doc.ago1); setField("er-ago2", doc.ago2);
    setField("er-ago3", doc.ago3); setField("er-ago4", doc.ago4);

    const p1El = document.getElementById("er-p1_essence");
    if (p1El) p1El.textContent = fmt((doc.pms2 || 0) - (doc.pms1 || 0));
    const p2El = document.getElementById("er-p2_essence");
    if (p2El) p2El.textContent = fmt((doc.pms4 || 0) - (doc.pms3 || 0));
    const p3El = document.getElementById("er-p3_gasoil");
    if (p3El) p3El.textContent = fmt((doc.ago2 || 0) - (doc.ago1 || 0));
    const p4El = document.getElementById("er-p4_gasoil");
    if (p4El) p4El.textContent = fmt((doc.ago4 || 0) - (doc.ago3 || 0));

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
        if (bcEl) bcEl.textContent = Array.isArray(p.listBC) ? p.listBC.join(", ")  : (p.listBC  || "—");
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
    const toast = window._dash.toast;
    const logDateEl = document.getElementById("er-logDate");
    const emailEl = document.getElementById("er-email");
    _logDate = logDateEl?.value;
    _email = emailEl?.value;

    if (!_logDate || !_email) {
      toast("Please choose both a date and an employee email.", "warning"); return;
    }

    clearSheet(); _docs = []; _page = 0;
    setMainBar("Fetching report…", null);
    setSidebarList([], true);

    try {
      
      const { apiFetch } = window._dash;
      const params = `logDate=${_logDate}&email=${encodeURIComponent(_email)}`;

      const [idxData, payData] = await Promise.all([
        apiFetch(`/daily-reports/me?${params}`).then(r => r.json()),
        apiFetch(`/payments/me?${params}`).then(r => r.json()),
      ]);


      const idxDocs = idxData.dailyReport?.documents ?? idxData.documents ?? [];
      const payDocs = payData.payment?.documents     ?? payData.documents ?? [];

      if (idxDocs.length === 0) {
        toast("No records found for this date and employee.", "warning");
        setMainBar("No report loaded", null);
        setSidebarList([], false);
        return;
      }

      const paymentDoc = payDocs[0] || null;
      _docs = idxDocs.map(doc => ({ ...doc, paymentData: paymentDoc }));
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
    document.querySelectorAll(".pom-entry-item").forEach(el => el.classList.toggle("pom-active", el.dataset.entry == n));
    displayPage(n);
  }

  async function download() {
    const toast = window._dash.toast;
    if (!_docs.length) { toast("Fetch a report before downloading.", "warning"); return; }
    try {
      const safeEmail = (_email || "employee").replace(/[^a-zA-Z0-9]/g, "_");
      const reportEl = document.getElementById("er-reportSheet");
      await html2pdf().set({
        margin: [10,10,10,10],
        filename:    `Pompiste_${safeEmail}_${_logDate}.pdf`,
        image:       { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak:   { mode: ["css", "legacy"] },
      }).from(reportEl).save();
    } catch (err) {
      toast("Download failed: " + (err?.message || err), "error");
    }
  }

  // Section is form-driven — no data to load on nav
  window._sections["emp-report"] = function () {};

  window._er = { displayDetails, selectEntry, download };

})();
