(function () {

  const SHIFT_ORDER = ["Morning", "Afternoon", "Evening", "Night"];

  let _grid        = null;  // raw parsed CSV grid
  let _summary     = null;  // { slot: { totalVente, totalCash, ... , pompiste } }
  let _dayTotal    = null;
  let _nozzlesBySlot  = null;
  let _loansBySlot    = null;
  let _ficheBySlot    = null;
  let _meta        = null;  // { date, pmsPrice, agoPrice }
  let _slots       = [];
  let _pumpMap     = null;  // pumpNumber -> { pumpId, nozzles: [{nozzleId, nozzleNumber}] }
  let _pompistes   = [];    // station's pompiste users
  let _lastShifts  = null;  // built shifts payload from last "Generate Preview"

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    _grid = null; _summary = null; _dayTotal = null; _nozzlesBySlot = null;
    _loansBySlot = null; _ficheBySlot = null; _meta = null; _slots = [];
    _pumpMap = null; _pompistes = []; _lastShifts = null;

    const fileInput = document.getElementById('shiftImportFile');
    if (fileInput) fileInput.value = '';
    document.getElementById('shiftImportAssign').style.display  = 'none';
    document.getElementById('shiftImportPreview').style.display = 'none';
    document.getElementById('shiftImportResults').style.display = 'none';
    _showStatus('', '');

    const stationRow = document.getElementById('shiftImportStationRow');
    if (window._dash.state.role === 'owner') {
      stationRow.style.display = '';
      const sel = document.getElementById('shiftImportStation');
      sel.innerHTML = window._dash.state.stations.map(s => `<option value="${s.$id}">${s.name}</option>`).join('');
    } else {
      stationRow.style.display = 'none';
    }
  }

  function _showStatus(msg, type) {
    const el = document.getElementById('shiftImportStatus');
    el.textContent = msg;
    el.className = 'status-msg' + (type ? ` ${type}` : '');
  }

  function getStationId() {
    return window._dash.state.role === 'owner'
      ? document.getElementById('shiftImportStation').value
      : window._dash.state.profile.stationId;
  }

  // ── CSV parsing (mirrors scripts/shift_review.html) ────────────────────────

  function parseCSVText(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = ""; rows.push(row); row = [];
        } else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ""));
  }

  function cleanNum(s) {
    if (s == null) return null;
    const t = String(s).replace(/[",]/g, "").trim();
    if (t === "" || t === "-") return null;
    const neg = /^\(.*\)$/.test(t);
    const num = parseFloat(t.replace(/[()]/g, ""));
    if (isNaN(num)) return null;
    return neg ? -num : num;
  }

  function norm(s) {
    return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
  }

  function findSummaryHeader(grid) {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      let pompisteCol = -1;
      const cols = {};
      for (let c = 0; c < row.length; c++) {
        const v = norm(row[c]);
        if (v) cols[v] = c;
        if (v === "POMPISTE") pompisteCol = c;
      }
      if (pompisteCol >= 0 && cols["VENTE TOTAL"] != null) {
        return { rowIndex: r, pompisteCol, cols };
      }
    }
    return null;
  }

  function parseSummaryTable(grid, header) {
    const { rowIndex, pompisteCol, cols } = header;
    const slotCol = pompisteCol - 1;
    const get = (row, name) => (cols[name] != null ? cleanNum(row[cols[name]]) : null);

    const buildRow = (row) => ({
      totalVente:   get(row, "VENTE TOTAL")  || 0,
      totalCash:    get(row, "VENTE CASH")   || 0,
      bon:          get(row, "VENTE BON")    || 0,
      momo: (get(row, "MOMO (24)") || 0) + (get(row, "MOMO (70)") || 0) + (get(row, "MOMO (71)") || 0),
      momoLoss:     get(row, "MOMO LOSS")    || 0,
      spFuelCard:   get(row, "TERMINAL")     || 0,
      bankCard:     get(row, "VISA")         || 0,
      gainPayments: get(row, "MQN/GAIN")     || 0,
    });

    const summary = {};
    let dayTotal = null;
    for (let r = rowIndex + 1; r < grid.length; r++) {
      const row = grid[r];
      const slotCell = (row[slotCol] || "").trim();
      if (/^TOTAL$/i.test(slotCell) || /^TOTAL$/i.test((row[pompisteCol] || "").trim())) { dayTotal = buildRow(row); break; }
      const slotNum = cleanNum(slotCell);
      if (slotNum == null || !Number.isInteger(slotNum) || slotNum < 1 || slotNum > 11) continue;
      summary[slotNum] = buildRow(row);
      summary[slotNum].pompiste = (row[pompisteCol] || "").trim().toUpperCase();
    }
    return { summary, dayTotal };
  }

  function parseBlocks(grid) {
    const blocks = {};
    let currentSlot = null;
    let section = null; // null | "client" | "details"
    for (const row of grid) {
      const nonEmpty = row.map(c => c.trim()).filter(c => c !== "");
      if (nonEmpty.length === 1) {
        const n = cleanNum(nonEmpty[0]);
        if (n != null && Number.isInteger(n) && n >= 1 && n <= 11) {
          currentSlot = n;
          section = null;
          blocks[currentSlot] = { pompiste: null, nozzles: [], loans: [], fiche: [] };
          continue;
        }
      }
      if (currentSlot == null) continue;
      const label = norm(row[1]);
      if (label === "POMPISTE") {
        const name = (row[2] || "").trim().toUpperCase();
        if (name) blocks[currentSlot].pompiste = name;
        section = null;
        continue;
      }
      const m = label.match(/^(PMS|AGO)\s*P\s*(\d)/);
      if (m) {
        const pumpNumber = Number(m[2]);
        const start = cleanNum(row[2]);
        const end = cleanNum(row[5]);
        if (start != null || end != null) {
          blocks[currentSlot].nozzles.push({
            pumpNumber, fuelType: m[1], label: "P" + pumpNumber,
            startReading: start ?? end, endReading: end ?? start,
          });
        }
        continue;
      }

      if (label === "CLIENT") { section = "client"; continue; }
      if (label === "DETAILS") { section = "details"; continue; }

      if (section === "client" || section === "details") {
        if (label === "TOTAL") { section = null; continue; }
        if (!label) continue;
        const amount = cleanNum(row[2]);
        if (amount == null || amount === 0) continue;
        const entry = { customerName: row[1].trim(), amount };
        if (label.includes("FICHE")) blocks[currentSlot].fiche.push(entry);
        else blocks[currentSlot].loans.push(entry);
        continue;
      }
    }
    return blocks;
  }

  function findDate(grid) {
    for (const row of grid) {
      for (let c = 0; c < row.length; c++) {
        if (/^DATE\s*:?$/i.test(row[c].trim())) {
          for (let c2 = c + 1; c2 < row.length; c2++) {
            const m = row[c2].trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
            if (m) return `${m[3]}-${m[2]}-${m[1]}`;
          }
        }
      }
    }
    return null;
  }

  function findPrice(grid, label) {
    for (const row of grid) {
      for (let c = 0; c < row.length; c++) {
        if (norm(row[c]) === label) {
          for (let c2 = c + 1; c2 < row.length; c2++) {
            const v = cleanNum(row[c2]);
            if (v != null) return v;
          }
        }
      }
    }
    return null;
  }

  function fmt(n) {
    if (typeof n !== "number") return n;
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  // ── File handling ────────────────────────────────────────────────────────

  function onFileChange(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { processCsv(reader.result); }
      catch (e) { _showStatus(`Failed to parse CSV: ${e.message}`, 'error'); }
    };
    reader.readAsText(file);
  }

  async function processCsv(text) {
    _showStatus('Parsing CSV…', '');
    _grid = parseCSVText(text);

    const header = findSummaryHeader(_grid);
    if (!header) {
      _showStatus('Could not find the summary table (row with "POMPISTE" and "VENTE TOTAL" headers).', 'error');
      return;
    }
    const { summary, dayTotal } = parseSummaryTable(_grid, header);
    const blocks = parseBlocks(_grid);
    const date     = findDate(_grid);
    const pmsPrice = findPrice(_grid, "PRICE PMS");
    const agoPrice = findPrice(_grid, "PRICE AGO");

    _slots = [...new Set([...Object.keys(summary), ...Object.keys(blocks)].map(Number))].sort((a, b) => a - b);

    _nozzlesBySlot = {};
    _loansBySlot   = {};
    _ficheBySlot   = {};
    const pompisteRow = {};
    for (const s of _slots) {
      _nozzlesBySlot[s] = (blocks[s] && blocks[s].nozzles) || [];
      pompisteRow[s]    = (summary[s] && summary[s].pompiste) || (blocks[s] && blocks[s].pompiste) || null;
      _loansBySlot[s]   = (blocks[s] && blocks[s].loans) || [];
      _ficheBySlot[s]   = (blocks[s] && blocks[s].fiche) || [];
    }

    _summary  = summary;
    _dayTotal = dayTotal;
    _meta     = { date, pmsPrice, agoPrice, pompisteRow };

    if (date) document.getElementById('shiftImportDate').value = date;

    // Fetch the station's pompistes + pump/nozzle map for the assignment step
    const stationId = getStationId();
    if (!stationId) { _showStatus('Select a station first.', 'error'); return; }

    _showStatus('Loading station pompistes & pumps…', '');
    const [usersRes, pumpsRes, nozzlesRes] = await Promise.all([
      window._dash.apiFetch(`/users?station=${stationId}`).then(r => r.json()),
      window._dash.apiFetch(`/pumps?station=${stationId}`).then(r => r.json()),
      window._dash.apiFetch(`/nozzles?station=${stationId}`).then(r => r.json()),
    ]);
    _pompistes = (usersRes.users || []).filter(u => u.role === 'pompiste');

    _pumpMap = {};
    for (const pump of (pumpsRes.pumps || [])) {
      _pumpMap[pump.pumpNumber] = { pumpId: pump.$id, nozzles: [] };
    }
    for (const nz of (nozzlesRes.nozzles || [])) {
      const pump = (pumpsRes.pumps || []).find(p => p.$id === nz.pumpId);
      if (!pump || !_pumpMap[pump.pumpNumber]) continue;
      _pumpMap[pump.pumpNumber].nozzles.push({ nozzleId: nz.$id, nozzleNumber: nz.nozzleNumber });
    }

    _showStatus(`Detected ${_slots.length} slot(s). Review the assignments below, then generate a preview.`, 'success');
    renderAssignTable();
  }

  // Best-effort match of a CSV name to a real pompiste account
  function bestPompisteMatch(name) {
    if (!name) return '';
    const n = norm(name);
    const exact = _pompistes.find(p => norm(p.name) === n || norm(p.name).includes(n) || n.includes(norm(p.name)));
    return exact ? exact.userId : '';
  }

  function renderAssignTable() {
    const el = document.getElementById('shiftImportAssign');
    el.style.display = '';

    let html = `
      <div class="settings-card">
        <div class="settings-card-title">Step 2 — Assign Pompiste &amp; Shift</div>
        <p class="settings-hint">Map each detected slot to a real pompiste account and a shift name.</p>
        <table class="nozzle-table" style="width:100%;">
          <thead><tr><th>Slot</th><th>CSV Name</th><th>Pompiste Account</th><th>Shift</th><th>Vente Total</th></tr></thead>
          <tbody>`;

    for (const s of _slots) {
      const csvName = _meta.pompisteRow[s] || '—';
      const match = bestPompisteMatch(csvName);
      html += `
        <tr>
          <td>${s}</td>
          <td>${csvName}</td>
          <td>
            <select id="shiftImportUser_${s}">
              <option value="">— skip —</option>
              ${_pompistes.map(p => `<option value="${p.userId}" ${p.userId === match ? 'selected' : ''}>${p.name} (${p.email})</option>`).join('')}
            </select>
          </td>
          <td>
            <select id="shiftImportShift_${s}">
              <option value="">— skip —</option>
              ${SHIFT_ORDER.map(sh => `<option value="${sh}">${sh}</option>`).join('')}
            </select>
          </td>
          <td class="num">${fmt((_summary[s] && _summary[s].totalVente) || 0)}</td>
        </tr>`;
    }

    html += `
          </tbody>
        </table>
        <div style="display:flex;gap:14px;align-items:center;margin-top:14px;flex-wrap:wrap;">
          <label>PMS Price: <input type="number" id="shiftImportPmsPrice" value="${_meta.pmsPrice ?? ''}" style="width:100px;"></label>
          <label>AGO Price: <input type="number" id="shiftImportAgoPrice" value="${_meta.agoPrice ?? ''}" style="width:100px;"></label>
          <button class="btn-primary" onclick="window._shiftImport.generatePreview()">Generate Preview</button>
        </div>
      </div>`;

    html += renderDebugTable();

    el.innerHTML = html;
  }

  // Shows exactly what was parsed from the CSV per slot — nozzle readings
  // (incl. AGO), gain, loans and fiche — so mismatches can be spotted before
  // generating the preview.
  function renderDebugTable() {
    let html = `
      <div class="settings-card" style="margin-top:16px;">
        <div class="settings-card-title">Detected Detail (raw CSV parse)</div>
        <table class="nozzle-table" style="width:100%;">
          <thead><tr><th>Slot</th><th>PMS Readings</th><th>AGO Readings</th><th>Gain</th><th>Loans</th><th>Fiche</th></tr></thead>
          <tbody>`;

    for (const s of _slots) {
      const nozzles = _nozzlesBySlot[s] || [];
      const pms = nozzles.filter(n => n.fuelType === 'PMS');
      const ago = nozzles.filter(n => n.fuelType === 'AGO');
      const loans = _loansBySlot[s] || [];
      const fiche = _ficheBySlot[s] || [];

      const fmtReadings = (list) => list.length
        ? list.map(n => {
            const mapped = _pumpMap[n.pumpNumber] && _pumpMap[n.pumpNumber].nozzles[0];
            const flag = mapped ? '' : ' <span class="diff-bad">(no pump/nozzle found — will be skipped)</span>';
            return `${n.label}: ${fmt(n.startReading)} → ${fmt(n.endReading)} (Δ${fmt(parseFloat((n.endReading - n.startReading).toFixed(3)))})${flag}`;
          }).join('<br>')
        : '—';
      const fmtEntries = (list) => list.length
        ? list.map(e => `${e.customerName}: ${fmt(e.amount)}`).join('<br>')
        : '—';

      html += `
        <tr>
          <td>${s}</td>
          <td>${fmtReadings(pms)}</td>
          <td>${fmtReadings(ago)}</td>
          <td class="num">${fmt((_summary[s] && _summary[s].gainPayments) || 0)}</td>
          <td>${fmtEntries(loans)}</td>
          <td>${fmtEntries(fiche)}</td>
        </tr>`;
    }

    html += `
          </tbody>
        </table>
      </div>`;
    return html;
  }

  // ── Preview generation (mirrors scripts/shift_review.html) ─────────────────

  function generatePreview() {
    const date     = document.getElementById('shiftImportDate').value;
    const pmsPrice = Number(document.getElementById('shiftImportPmsPrice').value) || 0;
    const agoPrice = Number(document.getElementById('shiftImportAgoPrice').value) || 0;

    if (!date) { _showStatus('Set the report date.', 'error'); return; }

    const selectedDate = new Date(date);
    const monthYear = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;

    const shifts = [];
    const sit = {
      momo: 0, momoLoss: 0, totalFiche: 0, bon: 0, spFuelCard: 0, bankCard: 0,
      totalCash: 0, totalLoans: 0, totalPayments: 0, gainPayments: 0,
      venteLitresPms: 0, totalPms: 0, venteLitresAgo: 0, totalAgo: 0, totalVente: 0,
    };

    for (const s of _slots) {
      const userId = document.getElementById(`shiftImportUser_${s}`).value;
      const shift  = document.getElementById(`shiftImportShift_${s}`).value;
      if (!userId || !shift) continue;

      const pompiste = _pompistes.find(p => p.userId === userId);
      const sum = _summary[s] || {};
      const loans = _loansBySlot[s] || [];
      const fiche = _ficheBySlot[s] || [];
      const totalLoans = loans.reduce((acc, e) => acc + e.amount, 0);
      const totalFiche = fiche.reduce((acc, e) => acc + e.amount, 0);

      const payments = {
        totalCash: sum.totalCash || 0,
        momo: sum.momo || 0,
        momoLoss: sum.momoLoss || 0,
        bankCard: sum.bankCard || 0,
        spFuelCard: sum.spFuelCard || 0,
        bon: sum.bon || 0,
        gainPayments: sum.gainPayments || 0,
        totalFiche, totalLoans, listBC: [], listSFC: [],
        cash5000: 0, cash2000: 0, cash1000: 0, cash500: 0,
      };
      payments.totalPayments = payments.totalCash + payments.momo + payments.momoLoss + payments.bankCard
        + payments.spFuelCard + payments.bon + payments.totalFiche + payments.totalLoans;

      const rawNozzles = _nozzlesBySlot[s] || [];
      const nozzleReadings = [];
      for (const r of rawNozzles) {
        const pumpEntry = _pumpMap[r.pumpNumber];
        const nozzle = pumpEntry && pumpEntry.nozzles[0];
        if (!pumpEntry || !nozzle) continue; // unmapped pump — skip this reading
        nozzleReadings.push({
          nozzleId: nozzle.nozzleId, pumpId: pumpEntry.pumpId,
          fuelType: r.fuelType, pumpNumber: r.pumpNumber, nozzleNumber: nozzle.nozzleNumber,
          startReading: r.startReading, endReading: r.endReading,
          venteLitres: parseFloat((r.endReading - r.startReading).toFixed(3)),
        });
      }

      const pms = nozzleReadings.filter(r => r.fuelType === 'PMS');
      const ago = nozzleReadings.filter(r => r.fuelType === 'AGO');
      const venteLitresPms = parseFloat(pms.reduce((acc, r) => acc + (r.endReading - r.startReading), 0).toFixed(3));
      const venteLitresAgo = parseFloat(ago.reduce((acc, r) => acc + (r.endReading - r.startReading), 0).toFixed(3));
      const totalPms = Math.round(venteLitresPms * pmsPrice);
      const totalAgo = Math.round(venteLitresAgo * agoPrice);
      const totalVente = sum.totalVente || 0;

      const totals = { pmsPrice, agoPrice, venteLitresPms, venteLitresAgo, totalPms, totalAgo, totalVente };

      sit.momo += payments.momo;
      sit.momoLoss += payments.momoLoss;
      sit.totalFiche += payments.totalFiche;
      sit.bon += payments.bon;
      sit.spFuelCard += payments.spFuelCard;
      sit.bankCard += payments.bankCard;
      sit.totalCash += payments.totalCash;
      sit.totalLoans += payments.totalLoans;
      sit.totalPayments += payments.totalPayments;
      sit.gainPayments += payments.gainPayments;
      sit.venteLitresPms += venteLitresPms;
      sit.totalPms += totalPms;
      sit.venteLitresAgo += venteLitresAgo;
      sit.totalAgo += totalAgo;
      sit.totalVente += totalVente;

      shifts.push({
        slot: s,
        shift, logDate: date, monthYear,
        email: pompiste.email, employeeName: pompiste.name, userId: pompiste.userId,
        nozzleReadings, gainPayments: payments.gainPayments, payments, totals,
        fiche: fiche.map(e => ({ customerName: e.customerName, amount: e.amount })),
        loans: loans.map(e => ({ customerName: e.customerName, amount: e.amount })),
      });
    }

    if (!shifts.length) { _showStatus('Assign at least one slot to a pompiste + shift.', 'error'); return; }

    _lastShifts = shifts;
    renderPreview(shifts, sit, date);
  }

  function diffRow(label, key, computed, expected) {
    if (expected == null) {
      return `<tr><td>${label}</td><td class="num">${fmt(computed)}</td><td>—</td><td>—</td></tr>`;
    }
    const ok = Math.abs(expected - computed) < 0.5;
    return `<tr><td>${label}</td><td class="num">${fmt(computed)}</td><td class="num">${fmt(expected)}</td><td class="${ok ? 'diff-ok' : 'diff-bad'}">${ok ? '✓ match' : '✗ MISMATCH'}</td></tr>`;
  }

  function renderPreview(shifts, sit, date) {
    const expected = _dayTotal || {};
    const sorted = [...shifts].sort((a, b) => SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift));

    let html = `<div class="settings-card"><div class="settings-card-title">Step 3 — Preview (${date}, ${sorted.length} shift(s))</div>`;

    for (const sh of sorted) {
      html += `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin-bottom:10px;">
          <strong>#${sh.slot} — ${sh.employeeName}</strong> <span class="badge badge-manager">${sh.shift}</span>
          <div style="font-size:12px;color:#666;">${sh.email} · ${sh.logDate}</div>
          <table class="nozzle-table" style="width:100%;margin-top:6px;">
            <tr><th>Cash</th><th>MoMo</th><th>MoMo Loss</th><th>Bank Card</th><th>SP Fuel</th><th>Bon</th><th>Fiche</th><th>Loans</th><th>Total Payments</th><th>Gain</th></tr>
            <tr>
              <td class="num">${fmt(sh.payments.totalCash)}</td>
              <td class="num">${fmt(sh.payments.momo)}</td>
              <td class="num">${fmt(sh.payments.momoLoss)}</td>
              <td class="num">${fmt(sh.payments.bankCard)}</td>
              <td class="num">${fmt(sh.payments.spFuelCard)}</td>
              <td class="num">${fmt(sh.payments.bon)}</td>
              <td class="num">${fmt(sh.payments.totalFiche)}</td>
              <td class="num">${fmt(sh.payments.totalLoans)}</td>
              <td class="num">${fmt(sh.payments.totalPayments)}</td>
              <td class="num">${fmt(sh.payments.gainPayments)}</td>
            </tr>
          </table>
          <table class="nozzle-table" style="width:100%;margin-top:6px;">
            <tr><th>PMS Litres</th><th>PMS Total</th><th>AGO Litres</th><th>AGO Total</th><th>Vente Total</th></tr>
            <tr>
              <td class="num">${fmt(sh.totals.venteLitresPms)}</td>
              <td class="num">${fmt(sh.totals.totalPms)}</td>
              <td class="num">${fmt(sh.totals.venteLitresAgo)}</td>
              <td class="num">${fmt(sh.totals.totalAgo)}</td>
              <td class="num">${fmt(sh.totals.totalVente)}</td>
            </tr>
          </table>
        </div>`;
    }

    html += `
      <div class="settings-card-title" style="margin-top:14px;">Accumulated Situation Check</div>
      <table class="nozzle-table" style="width:100%;">
        <tr><th>Field</th><th>Computed</th><th>Expected (CSV)</th><th>Check</th></tr>
        ${diffRow('Total Cash', 'totalCash', sit.totalCash, expected.totalCash)}
        ${diffRow('MoMo', 'momo', sit.momo, expected.momo)}
        ${diffRow('MoMo Loss', 'momoLoss', sit.momoLoss, expected.momoLoss)}
        ${diffRow('Bank Card', 'bankCard', sit.bankCard, expected.bankCard)}
        ${diffRow('SP Fuel Card', 'spFuelCard', sit.spFuelCard, expected.spFuelCard)}
        ${diffRow('Bon', 'bon', sit.bon, expected.bon)}
        ${diffRow('Total Fiche', 'totalFiche', sit.totalFiche, null)}
        ${diffRow('Total Loans', 'totalLoans', sit.totalLoans, null)}
        ${diffRow('Total Payments', 'totalPayments', sit.totalPayments, null)}
        ${diffRow('Gain Payments', 'gainPayments', sit.gainPayments, expected.gainPayments)}
        ${diffRow('Vente Litres PMS', 'venteLitresPms', sit.venteLitresPms, null)}
        ${diffRow('Total PMS (RWF)', 'totalPms', sit.totalPms, null)}
        ${diffRow('Vente Litres AGO', 'venteLitresAgo', sit.venteLitresAgo, null)}
        ${diffRow('Total AGO (RWF)', 'totalAgo', sit.totalAgo, null)}
        ${diffRow('Total Vente (RWF)', 'totalVente', sit.totalVente, expected.totalVente)}
      </table>
      <div style="margin-top:14px;">
        <button class="btn-primary" onclick="window._shiftImport.submitBatch(this)">Submit ${sorted.length} Shift(s)</button>
      </div>
    </div>`;

    const el = document.getElementById('shiftImportPreview');
    el.style.display = '';
    el.innerHTML = html;
    document.getElementById('shiftImportResults').style.display = 'none';
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function submitBatch(btn) {
    if (!_lastShifts || !_lastShifts.length) return;
    btn.disabled = true;
    _showStatus('Submitting…', '');
    try {
      const res = await window._dash.apiFetch('/shift-import-batch', {
        method: 'POST',
        body: JSON.stringify({ stationId: getStationId(), shifts: _lastShifts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      renderResults(data.results || []);
      window._dash.toast('Shift import finished.', 'success');
    } catch (err) {
      _showStatus(err.message || 'Import failed.', 'error');
      window._dash.toast(err.message || 'Import failed.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function renderResults(results) {
    let html = `<div class="settings-card"><div class="settings-card-title">Import Results</div>
      <table class="nozzle-table" style="width:100%;">
        <tr><th>Shift</th><th>Status</th><th>Detail</th></tr>`;
    for (const r of results) {
      const color = r.status === 'ok' ? 'diff-ok' : r.status === 'skipped-duplicate' ? '' : 'diff-bad';
      html += `<tr><td>${r.label}</td><td class="${color}">${r.status}</td><td>${r.error || ''}</td></tr>`;
    }
    html += `</table></div>`;
    const el = document.getElementById('shiftImportResults');
    el.style.display = '';
    el.innerHTML = html;
  }

  window._shiftImport = { onFileChange, generatePreview, submitBatch };
  window._sections['shift-import'] = init;

})();
