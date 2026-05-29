// ── TOAST NOTIFICATIONS ───────────────────────────────────────
(function () {
  const style = document.createElement("style");
  style.textContent =
    "#toast-container{position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:9999;pointer-events:none}" +
    ".toast{min-width:220px;max-width:360px;padding:12px 16px;border-radius:8px;font-size:13px;font-weight:500;color:#fff;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.18);opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;pointer-events:auto}" +
    ".toast.show{opacity:1;transform:translateY(0)}" +
    ".toast-success{background:#16a34a}.toast-error{background:#dc2626}" +
    ".toast-warning{background:#d97706}.toast-info{background:#2563eb}" +
    ":focus-visible{outline:2px solid #2563eb;outline-offset:2px;border-radius:2px}" +
    ".skip-nav{position:absolute;left:-9999px;top:4px;padding:8px 16px;background:#1e293b;color:#fff;border-radius:4px;font-size:13px;font-weight:600;z-index:10000;text-decoration:none}" +
    ".skip-nav:focus{left:4px}" +
    ".dropdown.open .dropdown-menu{display:block}" +
    ".stock-alert-badge{display:inline-flex;align-items:center;gap:4px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;" +
    "border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap;cursor:default}";
  document.head.appendChild(style);
})();

window.toast = function toast(message, type = "info") {
  let c = document.getElementById("toast-container");
  if (!c) { c = document.createElement("div"); c.id = "toast-container"; document.body.appendChild(c); }
  const el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.setAttribute("role", "alert");
  el.textContent = message;
  c.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3500);
};

// ── DIALOG FOCUS MANAGEMENT ───────────────────────────────────
const _dialogFocusStack = [];

window.openDialog = function openDialog(id) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  _dialogFocusStack.push(document.activeElement);
  dlg.style.display = "flex";
  dlg.setAttribute("aria-hidden", "false");
  const getFocusable = () => [...dlg.querySelectorAll(
    "button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex=\"-1\"])"
  )];
  const els = getFocusable();
  if (els.length) els[0].focus();
  dlg._keyHandler = (e) => {
    if (e.key === "Escape") { closeDialog(id); return; }
    if (e.key !== "Tab") return;
    const list = getFocusable();
    if (list.length < 2) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", dlg._keyHandler);
};

window.closeDialog = function closeDialog(id) {
  const dlg = document.getElementById(id);
  if (!dlg) return;
  dlg.style.display = "none";
  dlg.setAttribute("aria-hidden", "true");
  if (dlg._keyHandler) { document.removeEventListener("keydown", dlg._keyHandler); delete dlg._keyHandler; }
  const prev = _dialogFocusStack.pop();
  if (prev && prev.focus) prev.focus();
};

// ── WELCOME MESSAGE ───────────────────────────────────────────
function welcomeMessage() {
  const el = document.getElementById("welcomeMessage");
  if (!el) return;
  const name = window._SESSION && window._SESSION.profile && window._SESSION.profile.name;
  if (name) { el.textContent = "Welcome back, " + name; return; }
  _AW.account.get()
    .then(function(u) { el.textContent = "Welcome back, " + (u.name || u.email); })
    .catch(function() { location.replace(_AW.SIGNIN_URL); });
}

// ── STATION PRICES IN HEADER ──────────────────────────────────
window.loadStationPrices = async function loadStationPrices() {
  const pmEl      = document.getElementById("pmsPrice");
  const agoEl     = document.getElementById("agoPrice");
  const stationEl = document.getElementById("headerStationName");
  if (!pmEl || !agoEl) return;
  try {
    const res = await apiFetch("/stations");
    if (!res.ok) return;
    const data = await res.json();
    const documents = data.documents || data;
    const stationId = window._SESSION && window._SESSION.profile && window._SESSION.profile.stationId;
    const station   = stationId
      ? documents.find(function(s) { return s.$id === stationId; })
      : documents[0];
    if (!station) return;
    pmEl.textContent  = station.pmsPrice != null ? Number(station.pmsPrice).toLocaleString() + " RWF" : "—";
    agoEl.textContent = station.agoPrice != null ? Number(station.agoPrice).toLocaleString() + " RWF" : "—";
    if (stationEl) {
      stationEl.textContent   = station.name || "";
      stationEl.style.display = station.name ? "" : "none";
    }
  } catch (e) {
    pmEl.textContent  = "—";
    agoEl.textContent = "—";
  }
};

// ── LOGOUT ────────────────────────────────────────────────────
window.logout = async function logout() {
  try { await _AW.account.deleteSession("current"); } catch (e) {}
  sessionStorage.clear();
  location.replace(_AW.SIGNIN_URL);
};

// ── LOW STOCK WARNING ─────────────────────────────────────────
const _LOW_STOCK_LIMIT = 1000;

window.checkLowStock = async function checkLowStock() {
  try {
    const today      = new Date().toISOString().split("T")[0];
    const monthStart = today.substring(0, 7) + "-01";
    const res = await apiFetch("/documents/situation?from=" + monthStart + "&to=" + today);
    if (!res.ok) return;
    const data = await res.json();
    const documents = data.documents || data;
    const sorted = documents
      .filter(function(d) { return d.physicalStockPms != null || d.physicalStockAgo != null; })
      .sort(function(a, b) { return b.logDate > a.logDate ? 1 : -1; });
    if (sorted.length === 0) return;
    const doc = sorted[0];
    const warnings = [];
    if (doc.physicalStockPms != null && doc.physicalStockPms < _LOW_STOCK_LIMIT)
      warnings.push("PMS: " + Number(doc.physicalStockPms).toLocaleString() + " L");
    if (doc.physicalStockAgo != null && doc.physicalStockAgo < _LOW_STOCK_LIMIT)
      warnings.push("AGO: " + Number(doc.physicalStockAgo).toLocaleString() + " L");
    if (warnings.length === 0) return;
    const fuelDiv = document.querySelector(".fuel-prices");
    if (fuelDiv && !document.getElementById("stockAlertBadge")) {
      const badge = document.createElement("span");
      badge.id        = "stockAlertBadge";
      badge.className = "stock-alert-badge";
      badge.textContent = "⚠ Low Stock";
      badge.title     = "Last recorded: " + warnings.join(" | ");
      fuelDiv.appendChild(badge);
    }
    if (!sessionStorage.getItem("stockAlertShown")) {
      sessionStorage.setItem("stockAlertShown", "1");
      toast("⚠ Low fuel stock — " + warnings.join(", "), "warning");
    }
  } catch (e) {}
};

// ── NAV DROPDOWNS ─────────────────────────────────────────────
function initNavDropdowns() {
  document.querySelectorAll(".dropdown > a").forEach(function(trigger) {
    trigger.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const li = trigger.closest(".dropdown");
        const isOpen = li.classList.contains("open");
        document.querySelectorAll(".dropdown.open").forEach(function(d) {
          d.classList.remove("open");
          d.querySelector("a").setAttribute("aria-expanded", "false");
        });
        if (!isOpen) {
          li.classList.add("open");
          trigger.setAttribute("aria-expanded", "true");
        }
      } else if (e.key === "Escape") {
        const li = trigger.closest(".dropdown");
        li.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  });
  document.addEventListener("click", function(e) {
    if (!e.target.closest(".dropdown")) {
      document.querySelectorAll(".dropdown.open").forEach(function(d) {
        d.classList.remove("open");
        d.querySelector("a").setAttribute("aria-expanded", "false");
      });
    }
  });
}

window._utils = {

  // Number and formatting helpers
  toNumber: (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },
  isNumber: value => typeof value === "number" && Number.isFinite(value),
  fmt: v => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString() : "0";
  },
  fmtShort: v => {
    const n = Number(v) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return Math.round(n / 1_000) + "k";
    return n.toLocaleString();
  },
  fmtCurrency: (value, currency = "RWF", { defaultText = "—" } = {}) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() + " " + currency : defaultText;
  },
  fmtSigned: (value, { positivePrefix = "+", negativePrefix = "", defaultText = "—" } = {}) => {
    if (value === null || value === undefined || value === "") return defaultText;
    const n = Number(value);
    if (!Number.isFinite(n)) return defaultText;
    return (n >= 0 ? positivePrefix : negativePrefix) + n.toLocaleString();
  },
  safeDate: s => s ? String(s).substring(0, 10) : "",
  toIsoDate: value => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().substring(0, 10);
  },
  formatDate: (value, options = {}) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("default", options);
  },
  monthLabel: (y, m) => new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" }),

  // Data helpers
  parseJson: (input, fallback = []) => {
    if (input === null || input === undefined || input === "") return fallback;
    try { return JSON.parse(input); } catch (e) { return fallback; }
  },
  toArray: (value, fallback = []) => Array.isArray(value) ? value : fallback,
  renderList: ({ containerId, items = [], renderItem, emptyHtml = "<div class=\"empty\">No items</div>", loading = false, loadingHtml = "<div class=\"loading\">Loading…</div>" }) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (loading) {
      container.innerHTML = loadingHtml;
      return;
    }
    if (!items.length) {
      container.innerHTML = emptyHtml;
      return;
    }
    container.innerHTML = items.map(renderItem).join("");
  },

  // Shared calendar renderer used by situation.js and stock.js.
  // entries: [{ date: "YYYY-MM-DD", done?: boolean }]
  // done===true → "done" class + "Done ✓" title
  // done===false → "pending" class + "Pending" title
  // done===undefined → dataClass only, no title
  renderCalendar({ gridId, labelId, year, month, entries = [], selectedDate,
                   weekStart = "mon", dayClass = "cal-day",
                   headerClass = "cal-day-label", dataClass = "has-data",
                   onDayClick }) {
    const labelEl = document.getElementById(labelId);
    if (labelEl) labelEl.textContent = window._utils.monthLabel(year, month);

    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = "";

    const today  = new Date().toISOString().substring(0, 10);
    const isMon  = weekStart !== "sun";
    const hdrs   = isMon ? ["M","T","W","T","F","S","S"] : ["Su","Mo","Tu","We","Th","Fr","Sa"];

    hdrs.forEach(h => {
      const el = document.createElement("div");
      el.className = headerClass; el.textContent = h; grid.appendChild(el);
    });

    const firstDow    = new Date(year, month - 1, 1).getDay();
    const offset      = isMon ? (firstDow === 0 ? 6 : firstDow - 1) : firstDow;
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 0; i < offset; i++) {
      const el = document.createElement("div"); el.className = dayClass; grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const ds    = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const entry = entries.find(e => e.date === ds) ?? null;
      const el    = document.createElement("div");
      el.className = dayClass; el.textContent = d;

      if (ds === today)        el.classList.add("cal-today");
      if (ds === selectedDate) el.classList.add("cal-selected");
      if (entry) {
        el.classList.add(dataClass);
        if (entry.done === true)  { el.classList.add("done");    el.title = "Done ✓";  }
        if (entry.done === false) { el.classList.add("pending"); el.title = "Pending"; }
        if (onDayClick) el.addEventListener("click", () => onDayClick(ds));
      }
      grid.appendChild(el);
    }
  },
};


// ── AUTO-INIT ─────────────────────────────────────────────────
initNavDropdowns();
welcomeMessage();
