// ── MODULE STATE ───────────────────────────────────────────────
let _profile    = null;
let _nozzles    = [];     // enriched nozzle list (active only, sorted by pump→nozzle)
let _nozzleEntries = []; // [{nozzleId,fuelType,pumpId,pumpNumber,nozzleNumber,startReading,endReading,venteLitres}]
let _calcDone   = false;  // true only after calculateIndex passes

// Shift timing — startTime captured on first Calculate Index for this date+shift,
// endTime captured at submission time
let shiftStartTime = null;
let _shiftTimerKey  = null;

// Computed totals — set by calculateIndex, consumed by payments + situation
let totalVente, venteLitresPms, totalPms, venteLitresAgo, totalAgo;
let pmsPrice, agoPrice, logDate, shift;
let momoFeePercent = 0;

// Payment totals — set by payments(), consumed by situation()
let momo, momoLoss, totalFiche, bon, spFuelCard, bankCard;
let cash5000, cash2000, cash1000, cash500;
let totalCash, totalPayments, gainPayments, listBC, listSFC, totalLoans;

// ── INIT ────────────────────────────────────────────────────────
(async function init() {
  _profile = await requireAuth({ roles: ["pompiste"] });
  if (!_profile) return;

  // Device lock check — pompiste must be on a registered work device
  const deviceToken = localStorage.getItem("rp_device_token");
  if (!deviceToken) {
    _showDeviceBlocked();
    return;
  }

  const el = document.getElementById("welcomeMessage");
  if (el) el.textContent = `Welcome, ${_profile.name || ""}`;

  await initSettings();
})();

function _showDeviceBlocked() {
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:100vh;padding:32px;text-align:center;font-family:inherit;
                background:#f8fafc;">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"
           style="margin-bottom:20px;">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 8px;">Device Not Registered</h2>
      <p style="font-size:14px;color:#64748b;max-width:320px;margin:0 0 24px;">
        This device is not authorised to submit reports.<br>
        Ask your manager to register this device in Settings → Work Devices.
      </p>
      <button onclick="location.reload()"
        style="padding:10px 24px;background:#2563eb;color:white;border:none;border-radius:8px;
               font-size:14px;font-weight:600;cursor:pointer;">
        Try Again
      </button>
    </div>`;
}

// ── SETTINGS + NOZZLE LOAD ─────────────────────────────────────
async function initSettings() {
  try {
    const [pricesRes, nozzlesRes, pumpsRes, stationsRes] = await Promise.all([
      apiFetch("/fuel-prices/me").then(r => r.json()),
      apiFetch(`/nozzles?station=${_profile.stationId}`).then(r => r.json()),
      apiFetch(`/pumps?station=${_profile.stationId}`).then(r => r.json()),
      apiFetch("/stations").then(r => r.json()),
    ]);

    const station  = (stationsRes.stations ?? [])[0];
    const priceDocs = pricesRes.fuelPriceHistory?.documents ?? pricesRes.fuelPriceHistory ?? [];
    const pms = priceDocs.find(d => d.fuelType === "PMS");
    const ago = priceDocs.find(d => d.fuelType === "AGO");

    pmsPrice       = pms?.price       ?? 2303;
    agoPrice       = ago?.price       ?? 2205;
    momoFeePercent = station?.momoFee ?? 0.5;

    document.getElementById("pmsPrice").textContent = `${pmsPrice.toLocaleString()} RWF`;
    document.getElementById("agoPrice").textContent = `${agoPrice.toLocaleString()} RWF`;

    const nameEl = document.getElementById("headerStationName");
    if (nameEl && station?.name) { nameEl.textContent = station.name; nameEl.style.display = ""; }

    // Enrich nozzles with pump data
    const pumps   = pumpsRes.pumps ?? pumpsRes.documents ?? [];
    const pumpMap = {};
    pumps.forEach(p => { pumpMap[p.$id] = p; });

    const raw = nozzlesRes.nozzles ?? nozzlesRes.documents ?? [];
    _nozzles = raw
      .filter(n => n.active !== false && pumpMap[n.pumpId]?.active !== false)
      .map(n => ({
        ...n,
        pumpNumber: pumpMap[n.pumpId]?.pumpNumber ?? 0,
        pumpLabel:  pumpMap[n.pumpId]?.label || `Pump ${pumpMap[n.pumpId]?.pumpNumber ?? "?"}`,
      }))
      .sort((a, b) => a.pumpNumber - b.pumpNumber || a.nozzleNumber - b.nozzleNumber);

    renderNozzleInputs(_nozzles);

  } catch (err) {
    pmsPrice = 2303; agoPrice = 2205; momoFeePercent = 0.5;
    const c = document.getElementById("nozzleInputsContainer");
    if (c) c.innerHTML = `<div class="fuel-loading" style="color:#c0392b;padding:16px;">Could not load nozzles: ${err.message}</div>`;
  }
}

// ── RENDER NOZZLE INPUTS ───────────────────────────────────────
function renderNozzleInputs(nozzles) {
  const container = document.getElementById("nozzleInputsContainer");
  if (!container) return;

  if (!nozzles.length) {
    container.innerHTML = `<div class="fuel-loading" style="padding:16px;color:#888;">No nozzles configured. Ask your manager to set up pumps in Settings.</div>`;
    renderResultCards({});
    return;
  }

  // Group by fuel type, preserving insertion order (sorted by pump already)
  const groups  = {};
  const order   = [];
  nozzles.forEach(n => {
    if (!groups[n.fuelType]) { groups[n.fuelType] = []; order.push(n.fuelType); }
    groups[n.fuelType].push(n);
  });

  const fuelLabel = { PMS: "Essence (PMS)", AGO: "Mazout (AGO)", Kerosene: "Kérosène" };
  const fuelCls   = { PMS: "pms-group",     AGO: "ago-group",    Kerosene: "kero-group" };

  container.innerHTML = order.map(ft => `
    <div class="fuel-group ${fuelCls[ft] || ""}">
      <div class="fuel-group-label">${fuelLabel[ft] || ft}</div>
      ${groups[ft].map(n => `
        <div class="pump-row"
          data-nozzle-id="${n.$id}"
          data-fuel-type="${n.fuelType}"
          data-pump-id="${n.pumpId}"
          data-pump-number="${n.pumpNumber}"
          data-nozzle-number="${n.nozzleNumber}">
          <span class="pump-id">P${n.pumpNumber}-N${n.nozzleNumber}</span>
          <label>Start</label>
          <input type="number" class="nozzle-start" placeholder="0" min="0">
          <label>End</label>
          <input type="number" class="nozzle-end" placeholder="0" min="0">
        </div>
      `).join("")}
    </div>
  `).join("");

  renderResultCards({});
}

// ── RENDER RESULT CARDS ────────────────────────────────────────
function renderResultCards(fuelTotals) {
  const container = document.getElementById("indexResultCards");
  if (!container) return;

  const cardCls  = { PMS: "pms-card", AGO: "ago-card", Kerosene: "kero-card" };
  const cardLabel = { PMS: "PMS Sales", AGO: "AGO Sales", Kerosene: "Kerosene Sales" };
  const entries  = Object.entries(fuelTotals);
  const grand    = entries.reduce((s, [, v]) => s + v.sales, 0);

  container.innerHTML =
    entries.map(([ft, { sales }]) => `
      <div class="result-card ${cardCls[ft] || ""}">
        <div class="result-label">${cardLabel[ft] || ft + " Sales"}</div>
        <div class="result-value output">${sales > 0 ? sales.toLocaleString() + " RWF" : "—"}</div>
      </div>
    `).join("") + `
    <div class="result-card total-card">
      <div class="result-label">Total Vente</div>
      <div class="result-value output" id="result">${entries.length ? grand.toLocaleString() + " RWF" : "—"}</div>
    </div>`;
}

// ── CALCULATE INDEX ────────────────────────────────────────────
async function calculateIndex() {
  _calcDone  = false;
  totalVente = undefined;
  _nozzleEntries = [];

  logDate = document.getElementById("logDate").value;
  shift   = document.getElementById("shift").value;

  if (!logDate) { toast("Select a date.", "warning"); return; }
  if (!shift)   { toast("Select a shift.", "warning"); return; }

  const timerKey = `${logDate}_${shift}`;
  if (_shiftTimerKey !== timerKey) {
    shiftStartTime = new Date().toISOString();
    _shiftTimerKey  = timerKey;
  }

  const rows = [...document.querySelectorAll("#nozzleInputsContainer .pump-row[data-nozzle-id]")];
  if (!rows.length) { toast("No nozzles loaded. Refresh and try again.", "warning"); return; }

  // Read + validate each nozzle row
  const entries = [];
  for (const row of rows) {
    const start      = Number(row.querySelector(".nozzle-start")?.value) || 0;
    const end        = Number(row.querySelector(".nozzle-end")?.value)   || 0;
    const pumpNumber = row.dataset.pumpNumber;

    if (end && start && end < start) {
      toast(`Pump ${pumpNumber}: End reading must be ≥ Start reading`, "warning");
      return;
    }

    entries.push({
      nozzleId:     row.dataset.nozzleId,
      fuelType:     row.dataset.fuelType,
      pumpId:       row.dataset.pumpId,
      pumpNumber:   Number(row.dataset.pumpNumber)   || 0,
      nozzleNumber: Number(row.dataset.nozzleNumber) || 0,
      startReading: start,
      endReading:   end,
      venteLitres:  Math.max(0, end - start),
    });
  }

  // Aggregate by fuel type
  const byFuel = {};
  const priceMap = { PMS: pmsPrice, AGO: agoPrice };
  entries.forEach(({ fuelType, venteLitres }) => {
    if (!byFuel[fuelType]) byFuel[fuelType] = { litres: 0, sales: 0 };
    byFuel[fuelType].litres += venteLitres;
  });
  Object.entries(byFuel).forEach(([ft, v]) => {
    v.sales = Math.round(v.litres * (priceMap[ft] ?? 0));
  });

  venteLitresPms = byFuel["PMS"]?.litres ?? 0;
  totalPms       = byFuel["PMS"]?.sales  ?? 0;
  venteLitresAgo = byFuel["AGO"]?.litres ?? 0;
  totalAgo       = byFuel["AGO"]?.sales  ?? 0;
  totalVente     = Object.values(byFuel).reduce((s, v) => s + v.sales, 0);

  renderResultCards(byFuel);

  // Continuity check: each nozzle's start must match the previous shift's end
  try {
    const matched = await _checkIndexMatch(entries, logDate, shift);
    if (matched) {
      toast("All indices match ✓", "success");
      _nozzleEntries = entries;
      _calcDone = true;
    } else {
      toast("Index mismatch — correct your values before continuing.", "error");
      totalVente = undefined;
      _calcDone  = false;
      renderResultCards({});
    }
  } catch (err) {
    toast("Error checking index: " + err.message, "error");
  }
}

// Check each nozzle's start reading against the last known end reading
// stored in nozzle-readings (today's earlier shifts, or yesterday's Night shift).
async function _checkIndexMatch(entries, date, shift) {
  const stationId  = _profile?.stationId;
  const dateBefore = _getPrevDate(date);

  const [todayRes, yesterdayRes] = await Promise.all([
    apiFetch(`/nozzle-readings?station=${stationId}&date=${date}`).then(r => r.json()),
    apiFetch(`/nozzle-readings?station=${stationId}&date=${dateBefore}`).then(r => r.json()),
  ]);

  const todayReadings     = todayRes.readings     ?? [];
  const yesterdayReadings = yesterdayRes.readings ?? [];

  // All known readings for this nozzle, oldest first
  // Yesterday Night is baseline, today's shifts come after
  const allReadings = [...yesterdayReadings, ...todayReadings];

  for (const { nozzleId, startReading } of entries) {
    if (!startReading) continue; // nozzle not used this shift, skip

    // Walk back through history to find the last non-zero end reading
    const lastNonZero = allReadings
      .filter(r => r.nozzleId === nozzleId && r.endReading > 0)
      .at(-1); // last one in chronological order

    if (!lastNonZero) continue; // all zeros or no history = fresh start, pass

    if (startReading !== lastNonZero.endReading) return false; // mismatch
  }

  return true;
}

function _getPrevDate(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── PAYMENTS ───────────────────────────────────────────────────
async function payments() {
  if (totalVente === undefined) {
    toast("Run Calculate Index first.", "warning");
    return;
  }

  try {
    momo      = Number(document.getElementById("momo").value);
    momoLoss  = Number(document.getElementById("momoLoss").value);
    bon       = Number(document.getElementById("bon").value);
    cash5000  = Number(document.getElementById("5000").value);
    cash2000  = Number(document.getElementById("2000").value);
    cash1000  = Number(document.getElementById("1000").value);
    cash500   = Number(document.getElementById("500").value);
    logDate   = document.getElementById("logDate").value;
    shift     = document.getElementById("shift").value;

    listSFC = [...spFuelCardList];
    listBC  = [...bankCardList];

    spFuelCard = listSFC.reduce((sum, n) => sum + n, 0);
    bankCard   = listBC.reduce((sum, n) => sum + n, 0);

    totalLoans    = loans.reduce((sum, loan) => sum + loan.amount, 0);
    totalFiche    = fiche.reduce((sum, item) => sum + item.amount, 0);
    totalCash     = (cash5000 * 5000) + (cash2000 * 2000) + (cash1000 * 1000) + (cash500 * 500);
    totalPayments = momo + momoLoss + totalFiche + bon + spFuelCard + bankCard + totalCash + totalLoans;
    gainPayments  = totalPayments - totalVente;

    document.getElementById("totalLoans").textContent    = `${totalLoans.toLocaleString()} RWF`;
    document.getElementById("totalFiche").textContent    = `${totalFiche.toLocaleString()} RWF`;
    document.getElementById("totalPayments").textContent = `${totalPayments.toLocaleString()} RWF`;
    const gainEl = document.getElementById("gainPayments");
    gainEl.textContent = `${gainPayments.toLocaleString()} RWF`;
    gainEl.className   = `output result-value ${gainPayments >= 0 ? "gain" : "loss"}`;
    document.getElementById("totalCash").textContent     = `${totalCash.toLocaleString()} RWF`;
  } catch (err) {
    toast("Error calculating payments: " + err.message, "error");
  }
}

// ── VALIDATE BEFORE STORE ──────────────────────────────────────
function validateBeforeStore() {
  logDate = document.getElementById("logDate").value;
  shift   = document.getElementById("shift").value;

  if (!logDate) { toast("Select a date before storing.", "warning"); return false; }
  if (!shift)   { toast("Select a shift before storing.", "warning"); return false; }

  if (!_calcDone || totalVente === undefined || isNaN(totalVente)) {
    toast("Run Calculate Index first.", "warning"); return false;
  }
  if (totalPayments === undefined || isNaN(totalPayments)) {
    toast("Run Calculate Payments first.", "warning"); return false;
  }

  const fields = [
    [pmsPrice,       "PMS price (check Settings)"],
    [agoPrice,       "AGO price (check Settings)"],
    [venteLitresPms, "PMS litres"],
    [venteLitresAgo, "AGO litres"],
    [totalPms,       "Total PMS"],
    [totalAgo,       "Total AGO"],
    [momo,           "MoMo"],
    [momoLoss,       "MoMo Loss"],
    [totalCash,      "Total Cash"],
    [gainPayments,   "Gain Payments"],
  ];
  for (const [val, label] of fields) {
    if (val === undefined || val === null || isNaN(val)) {
      toast(`Invalid value for ${label} — re-run the calculations.`, "warning");
      return false;
    }
  }
  return true;
}

// ── STORE REPORT ───────────────────────────────────────────────
async function situation() {
  if (!validateBeforeStore()) return;

  try {
    const email      = _profile.email;
    const employee   = _profile.name;
    const companyId  = _profile.companyId || "";
    const stationId  = _profile.stationId || "";
    const userId     = _profile.userId    || _profile.$id || "";

    const selectedDate = new Date(logDate);
    const mm        = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const yyyy      = selectedDate.getFullYear();
    const monthYear = `${yyyy}-${mm}`;

    const activeEntries = _nozzleEntries.filter(e => e.startReading > 0 || e.endReading > 0);

    const startTime = shiftStartTime || new Date().toISOString();
    const endTime   = new Date().toISOString();

    const res = await apiFetch("/shift-submit", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        shift, logDate, monthYear,
        startTime, endTime,
        email, employeeName: employee, companyId, stationId, userId,
        gainPayments,
        nozzleReadings: activeEntries,
        payments: {
          momo, momoLoss, totalFiche, bon,
          listBC, listSFC, bankCard, spFuelCard,
          cash5000, cash2000, cash1000, cash500,
          totalCash, totalPayments, totalLoans,
        },
        totals: {
          venteLitresPms, totalPms,
          venteLitresAgo, totalAgo,
          totalVente, pmsPrice, agoPrice,
        },
        fiche: fiche.map(i => ({
          plate: i.plate, amount: i.amount,
          customerId: i.customerId || "", customerName: i.company || "",
        })),
        loans: loans.map(i => ({
          plate: i.plate, amount: i.amount,
          customerId: i.customerId || "", customerName: i.company || "",
        })),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      toast(data.error || "Failed to save shift.", "error");
      return;
    }

    toast("Report saved successfully ✓", "success");

    // Reset UI
    _calcDone      = false;
    _nozzleEntries = [];
    totalVente     = undefined;
    shiftStartTime = null;
    _shiftTimerKey = null;
    renderResultCards({});

    document.querySelectorAll(".output").forEach(el => { el.textContent = "—"; });
    document.getElementById("momo").value = "";
    clearFiche();
    clearLoan();
    fiche = []; loans = []; spFuelCardList = []; bankCardList = [];
    document.getElementById("ficheChips").innerHTML      = "";
    document.getElementById("loanChips").innerHTML       = "";
    document.getElementById("spFuelCardChips").innerHTML = "";
    document.getElementById("bankCardChips").innerHTML   = "";
    document.getElementById("rapportForm").reset();
    document.getElementById("paymentsForm").reset();

  } catch (err) {
    if (err.message.includes("Unauthorized")) {
      toast("You must be logged in.", "error");
    } else {
      toast("Error: " + err.message, "error");
    }
  }
}

// ── MOMO LOSS ──────────────────────────────────────────────────
function MomoLoss() {
  const m = Number(document.getElementById("momo").value);
  document.getElementById("momoLoss").value = parseInt((m / 100) * momoFeePercent) || 0;
}

// ── CHIP HELPERS ───────────────────────────────────────────────
let spFuelCardList = [];
let bankCardList   = [];

function renderChips(containerId, list, removeFn) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  list.forEach((amt, i) => {
    const chip = document.createElement("span");
    chip.className   = "chip";
    chip.textContent = amt.toLocaleString() + " RWF";
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "chip-remove";
    btn.textContent = "×";
    btn.onclick = () => removeFn(i);
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

function addSpCard() {
  const input = document.getElementById("spFuelCardInput");
  const val   = parseInt(input.value);
  if (!val || val <= 0) return;
  spFuelCardList.push(val);
  renderChips("spFuelCardChips", spFuelCardList, removeSpCard);
  input.value = "";
  input.focus();
}
function removeSpCard(i) {
  spFuelCardList.splice(i, 1);
  renderChips("spFuelCardChips", spFuelCardList, removeSpCard);
}

function addBankCard() {
  const input = document.getElementById("bankCardInput");
  const val   = parseInt(input.value);
  if (!val || val <= 0) return;
  bankCardList.push(val);
  renderChips("bankCardChips", bankCardList, removeBankCard);
  input.value = "";
  input.focus();
}
function removeBankCard(i) {
  bankCardList.splice(i, 1);
  renderChips("bankCardChips", bankCardList, removeBankCard);
}

// ── FICHE ──────────────────────────────────────────────────────
let fiche = [];

const _plateRegex = /^R[A-Z]{2}\s?\d{3}\s?[A-Z]$/;
function _normalizePlate(p) {
  const m = p.match(/^(R[A-Z]{2})\s?(\d{3})\s?([A-Z])$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : p;
}

function renderFicheChips() {
  const container = document.getElementById("ficheChips");
  container.innerHTML = "";
  fiche.forEach((item, i) => {
    const chip = document.createElement("span");
    chip.className   = "chip";
    const label = [item.plate, item.company].filter(Boolean).join(" · ") + ` · ${item.amount.toLocaleString()} RWF`;
    chip.textContent = label;
    chip.style.cursor = "pointer";
    chip.title        = "Click to edit";
    chip.onclick      = () => editFiche(i);
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "chip-remove";
    btn.textContent = "×";
    btn.onclick = (e) => { e.stopPropagation(); removeFiche(i); };
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

function addFiche() {
  const plate   = document.getElementById("fiche-plate").value.trim();
  const company = document.getElementById("fiche-company").value.trim();
  const amount  = parseInt(document.getElementById("fiche-amount").value);
  if (!plate && !company) { toast("Enter a plate or company", "warning"); return; }
  if (plate && !_plateRegex.test(plate)) { toast("Plate format must be: RAB 123A", "warning"); return; }
  if (!amount || amount <= 0) { toast("Enter a valid amount", "warning"); return; }
  fiche.push({ plate: plate ? _normalizePlate(plate) : "", company, amount });
  renderFicheChips();
  clearFiche();
  document.getElementById("fiche-amount").focus();
}

function editFiche(i) {
  const item = fiche[i];
  document.getElementById("fiche-plate").value   = item.plate;
  document.getElementById("fiche-company").value = item.company;
  document.getElementById("fiche-amount").value  = item.amount;
  fiche.splice(i, 1);
  renderFicheChips();
  document.getElementById("fiche-amount").focus();
}

function removeFiche(i) { fiche.splice(i, 1); renderFicheChips(); }

function clearFiche() {
  document.getElementById("fiche-plate").value   = "";
  document.getElementById("fiche-company").value = "";
  document.getElementById("fiche-amount").value  = "";
}

// ── LOANS ──────────────────────────────────────────────────────
let loans = [];

function renderLoanChips() {
  const container = document.getElementById("loanChips");
  container.innerHTML = "";
  loans.forEach((item, i) => {
    const chip = document.createElement("span");
    chip.className   = "chip";
    const label = [item.plate, item.company].filter(Boolean).join(" · ") + ` · ${item.amount.toLocaleString()} RWF`;
    chip.textContent = label;
    chip.style.cursor = "pointer";
    chip.title        = "Click to edit";
    chip.onclick      = () => editLoan(i);
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "chip-remove";
    btn.textContent = "×";
    btn.onclick = (e) => { e.stopPropagation(); removeLoan(i); };
    chip.appendChild(btn);
    container.appendChild(chip);
  });
}

function addLoan() {
  const plate   = document.getElementById("loan-plate").value.trim();
  const company = document.getElementById("loan-company").value.trim();
  const amount  = parseInt(document.getElementById("loan-amount").value);
  if (!plate && !company) { toast("Enter a plate or company", "warning"); return; }
  if (plate && !_plateRegex.test(plate)) { toast("Plate format must be: RAB 123A", "warning"); return; }
  if (!amount || amount === 0) { toast("Enter a valid amount", "warning"); return; }
  loans.push({ plate: plate ? _normalizePlate(plate) : "", company, amount });
  renderLoanChips();
  clearLoan();
  document.getElementById("loan-amount").focus();
}

function editLoan(i) {
  const item = loans[i];
  document.getElementById("loan-plate").value   = item.plate;
  document.getElementById("loan-company").value = item.company;
  document.getElementById("loan-amount").value  = item.amount;
  loans.splice(i, 1);
  renderLoanChips();
  document.getElementById("loan-amount").focus();
}

function removeLoan(i) { loans.splice(i, 1); renderLoanChips(); }

function clearLoan() {
  document.getElementById("loan-plate").value   = "";
  document.getElementById("loan-company").value = "";
  document.getElementById("loan-amount").value  = "";
}
