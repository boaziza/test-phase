(function () {

  let _selectedFile = null;

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    _selectedFile = null;
    _resetUI();
  }

  function _resetUI() {
    const fileInput = document.getElementById('bonusFileInput');
    if (fileInput) fileInput.value = '';
    _setDropLabel('Drop your Excel file here or click to browse');
    _setDropStyle(false, false);
    document.getElementById('bonusResults').style.display = 'none';
    _showStatus('', '');
  }

  // ── Drag & drop ───────────────────────────────────────────────
  function _setDropStyle(hover, ready) {
    const zone = document.getElementById('bonusDropZone');
    if (!zone) return;
    zone.style.borderColor  = hover ? '#2563eb' : ready ? '#22c55e' : '#c8d3e6';
    zone.style.background   = hover ? '#eff6ff' : ready ? '#f0fdf4' : '#f8fafc';
  }

  function _setDropLabel(text) {
    const el = document.getElementById('bonusDropLabel');
    if (el) el.textContent = text;
  }

  function onDragOver(e) {
    e.preventDefault();
    _setDropStyle(true, false);
  }

  function onDragLeave() {
    _setDropStyle(false, !!_selectedFile);
  }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file) _setFile(file);
    else _setDropStyle(false, false);
  }

  function onFileChange(input) {
    const file = input.files[0];
    if (file) _setFile(file);
  }

  function _setFile(file) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      _showStatus('Only .xlsx files are accepted.', 'error');
      return;
    }
    _selectedFile = file;
    _setDropLabel(`✓ ${file.name}`);
    _setDropStyle(false, true);
    _showStatus('', '');
    document.getElementById('bonusResults').style.display = 'none';
  }

  // ── Generate (preview as JSON) ────────────────────────────────
  async function generate(btn) {
    if (!_selectedFile) { _showStatus('Select an Excel file first.', 'error'); return; }

    btn.disabled = true;
    _showStatus('Processing…', '');

    try {
      const form = new FormData();
      form.append('file', _selectedFile);

      const { jwt } = await window._AW.account.createJWT();
      const res = await fetch(`${window._AW.SERVER_URL}/bonuses/filter`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
        body:    form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      if (!data.summary || data.summary.length === 0) {
        _showStatus(data.message || 'No customers met the 400,000 RWF threshold.', 'warning');
        document.getElementById('bonusResults').style.display = 'none';
        return;
      }

      _renderResults(data);
      _showStatus('', '');

    } catch (err) {
      _showStatus('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function _renderResults({ summary, count, totalAmount }) {
    // Summary cards
    document.getElementById('bonusCardCount').textContent = count;
    document.getElementById('bonusCardTotal').textContent = totalAmount.toLocaleString() + ' RWF';

    // Table body
    const tbody = document.getElementById('bonusTableBody');
    tbody.innerHTML = summary.map((r, i) => `
      <tr>
        <td style="text-align:center;color:#8899aa;font-size:12px;">${i + 1}</td>
        <td style="font-weight:600;letter-spacing:.5px;">${r.customer}</td>
        <td style="text-align:right;">${r.total.toLocaleString()} RWF</td>
      </tr>`).join('');

    // Footer total row
    const tfoot = document.getElementById('bonusTableFoot');
    tfoot.innerHTML = `
      <tr style="background:var(--bg-subtle,#f8fafc);">
        <td colspan="2" style="font-weight:700;padding:10px 12px;font-size:13px;">TOTAL</td>
        <td style="text-align:right;font-weight:700;padding:10px 12px;font-size:13px;">${totalAmount.toLocaleString()} RWF</td>
      </tr>`;

    document.getElementById('bonusResults').style.display = '';

    // Scroll into view
    document.getElementById('bonusResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Download Excel ────────────────────────────────────────────
  async function download(btn) {
    if (!_selectedFile) return;
    btn.disabled = true;

    try {
      const form = new FormData();
      form.append('file', _selectedFile);

      const { jwt } = await window._AW.account.createJWT();
      const res = await fetch(`${window._AW.SERVER_URL}/bonuses/filter`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body:    form,
      });

      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Download failed'); }

      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'Bonus.xlsx';
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      _showStatus('Download failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ── Reset ─────────────────────────────────────────────────────
  function reset() { _resetUI(); }

  function _showStatus(msg, type) {
    const el = document.getElementById('bonusStatus');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'status-msg' + (type ? ' ' + type : '');
  }

  window._sections.bonuses = init;
  window._bon = { onFileChange, onDragOver, onDragLeave, onDrop, generate, download, reset };

})();
