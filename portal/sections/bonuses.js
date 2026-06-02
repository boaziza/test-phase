(function () {

  const { apiFetch } = window._dash;

  let _selectedFile = null;

  function init() {
    _selectedFile = null;
    const input  = document.getElementById('bonusFileInput');
    const label  = document.getElementById('bonusFileName');
    const btn    = document.getElementById('bonusGenerateBtn');
    const status = document.getElementById('bonusStatus');

    if (input) input.value = '';
    if (label) label.textContent = 'No file chosen';
    if (btn)   btn.disabled = true;
    if (status) { status.textContent = ''; status.className = 'status-msg'; }
  }

  function onFileChange(input) {
    const file   = input.files[0];
    const label  = document.getElementById('bonusFileName');
    const btn    = document.getElementById('bonusGenerateBtn');
    if (!file) { _selectedFile = null; if (label) label.textContent = 'No file chosen'; if (btn) btn.disabled = true; return; }
    _selectedFile = file;
    if (label) label.textContent = file.name;
    if (btn)   btn.disabled = false;
  }

  async function generate(btn) {
    const status = document.getElementById('bonusStatus');
    if (!_selectedFile) { _showStatus(status, 'Please select an Excel file first.', 'error'); return; }

    btn.disabled = true;
    _showStatus(status, 'Processing…', '');

    try {
      const form = new FormData();
      form.append('file', _selectedFile);

      const { jwt } = await window._AW.account.createJWT();
      const res = await fetch(`${window._AW.SERVER_URL}/bonuses/filter`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.includes('json')) {
        const data = await res.json();
        _showStatus(status, data.message || 'No results.', 'success');
        return;
      }

      // Trigger download
      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      const filename = (res.headers.get('Content-Disposition') || '')
        .match(/filename="?([^"]+)"?/)?.[1] || 'Bonus.xlsx';
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      _showStatus(status, `✓ "${filename}" downloaded.`, 'success');
    } catch (err) {
      _showStatus(status, 'Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function _showStatus(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.className   = 'status-msg' + (type ? ' ' + type : '');
  }

  window._sections.bonuses = init;
  window._bon = { onFileChange, generate };

})();
