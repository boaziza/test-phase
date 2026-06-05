let _profile = null;

const SHIFT_ORDER = { Morning: 0, Afternoon: 1, Evening: 2, Night: 3 };
const _fmt = n => (n == null ? '—' : Number(n).toLocaleString());

(async function init() {
  _profile = await requireAuth({ roles: ['pompiste'] });
  if (!_profile) return;

  const el = document.getElementById('welcomeMessage');
  if (el) el.textContent = _profile.name || '';

  const now = new Date();
  document.getElementById('monthPicker').value =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await loadHistory();
})();

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadHistory() {
  const monthVal = document.getElementById('monthPicker').value;
  if (!monthVal) return;

  const [year, month] = monthVal.split('-');
  const stationId = _profile.stationId;
  const email     = _profile.email;

  const main = document.getElementById('histMain');
  main.innerHTML = `<div class="fuel-loading">Loading…</div>`;
  document.getElementById('summaryChips').style.display = 'none';
  document.getElementById('histFooter').style.display   = 'none';

  try {
    const [reportsRes, paymentsRes] = await Promise.all([
      apiFetch(`/daily-reports/me?logDate=${year}-${month}-01&email=${encodeURIComponent(email)}`).then(r => r.json()),
      apiFetch(`/payments/me?logDate=${year}-${month}-01&email=${encodeURIComponent(email)}`).then(r => r.json()),
    ]);

    const reports = (reportsRes.dailyReport?.documents ?? reportsRes.documents ?? [])
      .filter(d => String(d.logDate || '').startsWith(`${year}-${month}`));
    const payments = reportsRes.payment?.documents ?? paymentsRes.documents ?? [];

    if (!reports.length) {
      main.innerHTML = `
        <div class="hist-empty">
          <div class="hist-empty-icon">📋</div>
          <div class="hist-empty-title">No shifts found</div>
          <div class="hist-empty-sub">No shifts submitted for ${monthVal}</div>
        </div>`;
      return;
    }

    const payMap = {};
    payments.forEach(p => { payMap[p.shiftKey] = p; });

    // Sort newest first, then fetch nozzle readings per shift
    const sorted = [...reports].sort((a, b) => {
      const dc = String(b.logDate).localeCompare(String(a.logDate));
      return dc !== 0 ? dc : (SHIFT_ORDER[b.shift] ?? 0) - (SHIFT_ORDER[a.shift] ?? 0);
    });

    const shifts = await Promise.all(sorted.map(async doc => {
      const pay = payMap[doc.shiftKey] || null;
      if (!stationId || !doc.shift) return { ...doc, pay, readings: [] };
      try {
        const res = await apiFetch(
          `/nozzle-readings?station=${stationId}&date=${String(doc.logDate).substring(0,10)}&shift=${encodeURIComponent(doc.shift)}`
        ).then(r => r.json());
        return { ...doc, pay, readings: (res.readings ?? []).filter(r => r.email === email) };
      } catch {
        return { ...doc, pay, readings: [] };
      }
    }));

    // Summary chips
    const totalVente = shifts.reduce((s, d) => s + (Number(d.totalVente) || 0), 0);
    const totalGain  = shifts.reduce((s, d) => s + (Number(d.pay?.gainPayments) || 0), 0);

    const chips = document.getElementById('summaryChips');
    chips.style.display = '';
    document.getElementById('chipShifts').textContent = `${shifts.length} shift${shifts.length !== 1 ? 's' : ''}`;
    document.getElementById('chipVente').textContent  = `Vente: ${_fmt(totalVente)} RWF`;
    const gainChip = document.getElementById('chipGain');
    gainChip.textContent = totalGain >= 0 ? `Gain +${_fmt(totalGain)} RWF` : `Loss ${_fmt(totalGain)} RWF`;
    gainChip.className   = `hist-chip ${totalGain >= 0 ? 'hist-chip-gain' : 'hist-chip-loss'}`;

    main.innerHTML = shifts.map((doc, i) => _renderCard(doc, i)).join('');
    document.getElementById('histFooter').style.display = '';

  } catch (err) {
    main.innerHTML = `<div class="hist-empty"><div class="hist-empty-title">Error</div><div class="hist-empty-sub">${err.message}</div></div>`;
  }
}

// ── Card ──────────────────────────────────────────────────────────────────────
function _renderCard(doc, i) {
  const date    = String(doc.logDate || '').substring(0, 10);
  const d       = new Date(date + 'T00:00:00');
  const dateStr = isNaN(d) ? date : d.toLocaleString('default', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const pay     = doc.pay;
  const gain    = pay ? Number(pay.gainPayments) : null;
  const gainCls = gain === null ? '' : gain >= 0 ? 'gain' : 'loss';
  const gainTxt = gain === null ? '—' : gain >= 0 ? `+${_fmt(gain)} RWF` : `${_fmt(gain)} RWF`;

  const shiftColors = { Morning: '#16a34a', Afternoon: '#2563eb', Evening: '#7c3aed', Night: '#0f172a' };
  const color = shiftColors[doc.shift] || '#64748b';

  const fuelCls = { PMS: 'pms', AGO: 'ago', Kerosene: 'kero' };

  const nozzleRows = doc.readings.length
    ? [...doc.readings]
        .sort((a, b) => (a.pumpNumber - b.pumpNumber) || (a.nozzleNumber - b.nozzleNumber))
        .map(r => `
          <tr>
            <td>P${r.pumpNumber || '?'}</td>
            <td>N${r.nozzleNumber || '?'}</td>
            <td><span class="fuel-pill ${fuelCls[r.fuelType] || ''}">${r.fuelType || '—'}</span></td>
            <td>${_fmt(r.startReading)}</td>
            <td>${_fmt(r.endReading)}</td>
            <td>${_fmt(r.venteLitres)}</td>
          </tr>`).join('')
    : `<tr><td colspan="6" style="text-align:center;padding:10px;color:#64748b;">No nozzle readings</td></tr>`;

  return `
    <div class="hist-card">
      <div class="hist-card-header" onclick="toggleCard(${i})">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;"></span>
          <div>
            <div style="font-weight:700;font-size:13px;">${dateStr}</div>
            <div style="font-size:11px;font-weight:600;color:${color};margin-top:2px;">${doc.shift || ''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="done-pill ${gainCls ? `pill-${gainCls}` : ''}">${gainTxt}</span>
          <span class="hist-chevron" id="chev-${i}">▼</span>
        </div>
      </div>

      <div class="hist-card-body" id="hbody-${i}" style="display:none;">

        <div class="hist-section-label">Nozzle Readings</div>
        <div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border,#e2e8f0);">
          <table class="indices-table" style="margin:0;">
            <thead><tr>
              <th>P</th><th>N</th><th>Fuel</th><th>Start</th><th>End</th><th>Sold (L)</th>
            </tr></thead>
            <tbody>${nozzleRows}</tbody>
          </table>
        </div>

        <div class="hist-section-label">Sales</div>
        <div class="hist-fin-grid">
          <div class="hist-fin-item"><span class="hist-fin-label">Essence (L)</span><span class="hist-fin-val">${_fmt(doc.venteLitresPms)}</span></div>
          <div class="hist-fin-item"><span class="hist-fin-label">Gasoil (L)</span><span class="hist-fin-val">${_fmt(doc.venteLitresAgo)}</span></div>
          <div class="hist-fin-item"><span class="hist-fin-label">Total Vente</span><span class="hist-fin-val">${_fmt(doc.totalVente)} RWF</span></div>
        </div>

        ${pay ? `
        <div class="hist-section-label">Payments</div>
        <div class="hist-fin-grid">
          <div class="hist-fin-item"><span class="hist-fin-label">Cash</span><span class="hist-fin-val">${_fmt(pay.totalCash)}</span></div>
          <div class="hist-fin-item"><span class="hist-fin-label">MoMo</span><span class="hist-fin-val">${_fmt(pay.momo)}</span></div>
          <div class="hist-fin-item"><span class="hist-fin-label">Bank Card</span><span class="hist-fin-val">${_fmt(pay.bankCard)}</span></div>
          <div class="hist-fin-item"><span class="hist-fin-label">Fuel Card</span><span class="hist-fin-val">${_fmt(pay.spFuelCard)}</span></div>
          <div class="hist-fin-item"><span class="hist-fin-label">Fiche</span><span class="hist-fin-val">${_fmt(pay.totalFiche)}</span></div>
          <div class="hist-fin-item"><span class="hist-fin-label">Loans</span><span class="hist-fin-val">${_fmt(pay.totalLoans)}</span></div>
        </div>
        <div class="result-summary" style="margin-top:4px;">
          <span>Gain / Loss</span>
          <span class="${gainCls}">${gainTxt}</span>
        </div>` : `<div style="color:#64748b;font-size:12px;padding:8px 0;">No payment data for this shift.</div>`}

      </div>
    </div>`;
}

function toggleCard(i) {
  const body = document.getElementById(`hbody-${i}`);
  const chev = document.getElementById(`chev-${i}`);
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display    = open ? '' : 'none';
  chev.style.transform  = open ? 'rotate(180deg)' : '';
}

// ── PDF ───────────────────────────────────────────────────────────────────────
async function downloadPDF() {
  const monthVal = document.getElementById('monthPicker').value || 'history';
  const name     = (_profile?.name || 'pompiste').replace(/[^a-zA-Z0-9]/g, '_');
  document.querySelectorAll('.hist-card-body').forEach(el => { el.style.display = ''; });
  try {
    await html2pdf().set({
      margin:      [10, 10, 10, 10],
      filename:    `History_${name}_${monthVal}.pdf`,
      image:       { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:   { mode: ['css', 'legacy'] },
    }).from(document.getElementById('histMain')).save();
  } catch (err) {
    alert('Download failed: ' + err.message);
  }
}
