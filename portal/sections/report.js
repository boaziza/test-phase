(function () {

  let _repRows = [], _repFiltered = null, _repPage = 1, _repAttrs = [];
  const PAGE_SIZE = 20;
  const getEl = (id) => document.getElementById(id);

  // ── Collections ──────────────────────────────────────────────────────────────
  const COLLECTIONS = [
    { name: "payments",     label: "Payments",      route: "/payments",      docsKey: "payments"      },
    { name: "stockDaily",   label: "Stock Daily",   route: "/stock-daily",   docsKey: "stockDaily"    },
    { name: "stock",        label: "Stock Monthly", route: "/stock",         docsKey: "stock"         },
    { name: "gainPompiste", label: "Gain Pompiste", route: "/gain-pompiste", docsKey: "gains"         },
    { name: "fiche",        label: "Fiche",         route: "/fiche",         docsKey: "fiche"         },
    { name: "loans",        label: "Loans",         route: "/loans",         docsKey: "loans"         },
    // { name: "situation",    label: "Situation",     route: "/situation",     docsKey: "situations"    },
    // { name: "dailyReports", label: "Daily Reports", route: "/daily-reports", docsKey: "dailyReports"  },
  ];

  // ── Column config ─────────────────────────────────────────────────────────────
  const hiddenKeys = [
    "cash5000","cash2000","cash1000","cash500","listSFC","listBC",
    "shiftKey","companyId","stationId","situationKey","stockKey",
    "archived","userId","gainKey","customerId","createdBy",
    "pms1","pms2","pms3","pms4","ago1","ago2","ago3","ago4","email"
  ];

  const preferredOrder = [
    "employeeName","email","logDate","monthYear","fuelType","shift",
    "totalVente","totalPayments","totalCash","gainPayments",
    "momo","momoLoss","spFuelCard","bankCard","totalFiche","bon","totalLoans",
    "initialStock","receivedLitres","venteLitres","theoryStock","physicalStock","gainFuel",
    "totalReceivedPms","totalReceivedAgo","totalGainFuelPms","totalGainFuelAgo",
    "totalVenteLitresPms","totalVenteLitresAgo",
    "customerName","plate","amount",
  ];

  const renameMap = {
    employeeName:"Employee",     email:"Email",             logDate:"Date",
    monthYear:"Month",           fuelType:"Fuel Type",      shift:"Shift",
    totalVente:"Total Vente",    totalPayments:"Total Payments", totalCash:"Total Cash",
    gainPayments:"Gain",         momo:"MoMo",               momoLoss:"MoMo Loss",
    spFuelCard:"SP Fuel Card",   bankCard:"Bank Card",       totalFiche:"Fiche",
    bon:"Bon",                   totalLoans:"Total Loans",
    initialStock:"Initial (L)",  receivedLitres:"Received (L)", venteLitres:"Sold (L)",
    theoryStock:"Theory (L)",    physicalStock:"Physical (L)",  gainFuel:"Gain Fuel (L)",
    totalReceivedPms:"Recv PMS (L)",   totalReceivedAgo:"Recv AGO (L)",
    totalGainFuelPms:"Gain PMS (L)",   totalGainFuelAgo:"Gain AGO (L)",
    totalVenteLitresPms:"Sold PMS (L)", totalVenteLitresAgo:"Sold AGO (L)",
    customerName:"Customer",     plate:"Plate",             amount:"Amount",
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function rearrangeAndRename(attrs) {
    return [
      ...preferredOrder.map(k => attrs.find(a => a.key === k)).filter(Boolean),
      ...attrs.filter(a => !preferredOrder.includes(a.key)),
    ].filter(a => !hiddenKeys.includes(a.key))
     .map(a => ({ ...a, displayName: renameMap[a.key] || a.key }));
  }

  function mapTypeToInput(type) {
    return { integer:"number", float:"number", boolean:"checkbox", email:"email", url:"url", datetime:"date" }[type] || "text";
  }

  function formatValue(key, value) {
    if (value === null || value === undefined) return "—";
    if (key === "logDate" && value) {
      const d = new Date(value);
      return isNaN(d) ? String(value).substring(0, 10) : d.toISOString().split("T")[0];
    }
    const n = Number(value);
    return isNaN(n) ? String(value) : n.toLocaleString();
  }

  function preprocessRows(rows) {
    return rows.map(row => {
      const r = { ...row };
      if (typeof r.loans === "string") { try { r._loans = JSON.parse(r.loans); } catch { r._loans = []; } }
      else { r._loans = Array.isArray(r.loans) ? r.loans : []; }
      if (r.logDate) r.logDate = String(r.logDate).substring(0, 10);
      return r;
    });
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  // ── Table list ────────────────────────────────────────────────────────────────
  function loadTableList() {
    const listEl = getEl("rep-reportsList");
    if (!listEl) return;
    listEl.innerHTML = "";
    COLLECTIONS.forEach(col => {
      const div = document.createElement("div");
      div.textContent   = col.label;
      div.className     = "report-item";
      div.dataset.table = col.name;
      div.onclick       = () => display(col.name);
      listEl.appendChild(div);
    });
    display(COLLECTIONS[0].name);
  }

  // ── Display ───────────────────────────────────────────────────────────────────
  async function display(tableName) {
    const col = COLLECTIONS.find(c => c.name === tableName);
    if (!col) return;
    try {
      const titleEl = getEl("rep-tableTitle");
      if (titleEl) titleEl.textContent = col.label;
      document.querySelectorAll("#section-report .report-item").forEach(el =>
        el.classList.toggle("active", el.dataset.table === tableName)
      );

      const { apiFetch } = window._dash;
      const data = await apiFetch(`${col.route}?limit=200`).then(r => r.json());
      const raw  = data[col.docsKey]?.documents ?? data[col.docsKey] ?? [];

      // Derive columns from first doc, strip system keys
      const sysKeys = ["$id","$collectionId","$databaseId","$createdAt","$updatedAt","$permissions","$sequence"];
      const keys  = raw.length > 0 ? Object.keys(raw[0]).filter(k => !sysKeys.includes(k)) : [];
      const attrs = keys.map(k => ({ key: k, type: typeof raw[0][k] === "number" ? "integer" : "string" }));

      _repAttrs    = rearrangeAndRename(attrs);
      _repRows     = preprocessRows(raw);
      _repFiltered = null; _repPage = 1;

      const searchEl = getEl("rep-search");
      if (searchEl) searchEl.value = "";
      const hasLogDate = _repAttrs.some(a => a.key === "logDate");
      const dfRow = getEl("rep-dateFilterRow");
      if (dfRow) dfRow.style.display = hasLogDate ? "flex" : "none";
      const expBtn = getEl("rep-exportBtn");
      if (expBtn) expBtn.style.display = "inline-block";
      if (getEl("rep-dateFrom")) getEl("rep-dateFrom").value = "";
      if (getEl("rep-dateTo"))   getEl("rep-dateTo").value   = "";

      buildHeaders(_repAttrs);
      buildSearchControls(_repAttrs);
      renderCurrentPage();
    } catch (err) {
      window._dash.toast("Could not load table data: " + err.message, "error");
    }
  }

  // ── Headers ───────────────────────────────────────────────────────────────────
  function buildHeaders(attributes) {
    const headers = getEl("rep-headers");
    if (!headers) return;
    headers.innerHTML = "";
    attributes.forEach(attr => {
      const th = document.createElement("th"); th.textContent = attr.displayName; headers.appendChild(th);
    });
  }

  // ── Search controls ───────────────────────────────────────────────────────────
  function buildSearchControls(attributes) {
    const searchWith  = getEl("rep-searchWith");
    const searchInput = getEl("rep-search");
    if (!searchWith || !searchInput) return;
    searchWith.innerHTML = "";
    attributes.forEach(attr => {
      const opt = document.createElement("option"); opt.value = attr.key; opt.textContent = attr.displayName;
      searchWith.appendChild(opt);
    });
    searchWith.onchange = () => {
      const sel = attributes.find(a => a.key === searchWith.value);
      if (sel) searchInput.type = mapTypeToInput(sel.type);
      searchInput.value = ""; updateSuggestions(); applyFilters();
    };
    searchInput.value = ""; searchInput.type = "text";
    searchInput.oninput   = debounce(() => applyFilters(), 300);
    searchInput.onkeydown = e => { if (e.key === "Enter") applyFilters(); };
    updateSuggestions();
  }

  function updateSuggestions() {
    const key = getEl("rep-searchWith")?.value;
    const dl  = getEl("rep-searchSuggestions");
    if (dl) dl.innerHTML = "";
    if (!key) return;
    const seen = new Set();
    _repRows.forEach(row => {
      const v = row[key];
      if (v !== null && v !== undefined && v !== "") {
        const disp = key === "logDate" ? String(v).substring(0, 10) : String(v);
        if (!seen.has(disp)) {
          seen.add(disp);
          const opt = document.createElement("option"); opt.value = disp; dl.appendChild(opt);
        }
      }
    });
  }

  // ── Filters ───────────────────────────────────────────────────────────────────
  function applyFilters() {
    const df = getEl("rep-dateFrom")?.value;
    const dt = getEl("rep-dateTo")?.value;
    const sk = getEl("rep-searchWith")?.value;
    const sv = getEl("rep-search")?.value.trim();
    let rows = _repRows;
    if (df || dt) rows = rows.filter(row => {
      const d = row.logDate; if (!d) return true;
      if (df && d < df) return false; if (dt && d > dt) return false; return true;
    });
    if (sv) rows = rows.filter(row => String(row[sk] ?? "").toLowerCase().includes(sv.toLowerCase()));
    _repFiltered = (!df && !dt && !sv) ? null : rows;
    _repPage = 1; renderCurrentPage();
  }

  function clearDateFilter() {
    if (getEl("rep-dateFrom")) getEl("rep-dateFrom").value = "";
    if (getEl("rep-dateTo"))   getEl("rep-dateTo").value   = "";
    applyFilters();
  }

  // ── CSV export ────────────────────────────────────────────────────────────────
  function exportCSV() {
    const source = _repFiltered ?? _repRows;
    if (source.length === 0) { window._dash.toast("No data to export.", "warning"); return; }
    const headers = _repAttrs.map(a => `"${a.displayName}"`);
    const rows = source.map(row => _repAttrs.map(attr => {
      const v = row[attr.key];
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }));
    const csv  = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), {
      href: url,
      download: `${getEl("rep-tableTitle")?.textContent.replace(/[^a-zA-Z0-9]/g,"_")}_${new Date().toISOString().split("T")[0]}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    window._dash.toast(`Exported ${source.length} row${source.length !== 1 ? "s" : ""}.`, "success");
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function renderCurrentPage() {
    const body        = getEl("rep-body");
    const source      = _repFiltered ?? _repRows;
    const totalPages  = Math.max(1, Math.ceil(source.length / PAGE_SIZE));
    if (_repPage > totalPages) _repPage = totalPages;
    const pageRows = source.slice((_repPage - 1) * PAGE_SIZE, _repPage * PAGE_SIZE);
    if (!body) return;
    body.innerHTML = "";

    if (pageRows.length === 0) {
      const tr = document.createElement("tr"); const td = document.createElement("td");
      td.colSpan = _repAttrs.length || 1; td.className = "empty-row";
      td.textContent = _repFiltered !== null ? "No records match your search." : "No records found.";
      tr.appendChild(td); body.appendChild(tr);
    } else {
      const totals = Array(_repAttrs.length).fill(0); let hasTotals = false;
      pageRows.forEach(row => {
        const tr = document.createElement("tr");
        _repAttrs.forEach((attr, j) => {
          const td = document.createElement("td");
          td.textContent = formatValue(attr.key, row[attr.key]);
          const n = Number(row[attr.key]);
          if (!isNaN(n) && row[attr.key] !== null) { totals[j] += n; hasTotals = true; }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      if (hasTotals) {
        const tr = document.createElement("tr"); tr.className = "totals-row";
        _repAttrs.forEach((attr, j) => {
          const td = document.createElement("td");
          td.textContent = j === 0 ? "TOTALS" : (totals[j] ? totals[j].toLocaleString() : "");
          tr.appendChild(td);
        });
        body.appendChild(tr);
      }
    }

    const countEl = getEl("rep-resultCount");
    if (countEl) {
      const total = source.length;
      countEl.textContent = _repFiltered !== null
        ? `${total} result${total !== 1 ? "s" : ""} found`
        : `${total} record${total !== 1 ? "s" : ""}`;
      countEl.className = _repFiltered !== null && total === 0 ? "result-count no-results" : "result-count";
    }
    const pag = getEl("rep-pagination");
    if (pag) pag.style.display = source.length > 0 ? "flex" : "none";
    if (getEl("rep-prevPage"))   getEl("rep-prevPage").disabled   = _repPage === 1;
    if (getEl("rep-nextPage"))   getEl("rep-nextPage").disabled   = _repPage === totalPages;
    if (getEl("rep-pageNumber")) getEl("rep-pageNumber").textContent = `Page ${_repPage} of ${totalPages}`;
  }

  // ── Register ──────────────────────────────────────────────────────────────────
  window._sections.report = function loadReport() {
    if (window._sections.report._initialized) return;
    window._sections.report._initialized = true;
    if (getEl("rep-prevPage")) getEl("rep-prevPage").onclick = () => { if (_repPage > 1) { _repPage--; renderCurrentPage(); } };
    if (getEl("rep-nextPage")) getEl("rep-nextPage").onclick = () => {
      const total = Math.ceil((_repFiltered ?? _repRows).length / PAGE_SIZE);
      if (_repPage < total) { _repPage++; renderCurrentPage(); }
    };
    loadTableList();
  };

  window._rep = { exportCSV, applyFilters, clearDateFilter };

})();
