(function () {

  const PAGE_SIZE = 15;
  let _mgPage     = 1;
  let _allMgrs    = [];

  function _render() {
    const { openEditUser, openDeleteUser, openResetPwd, state } = window._dash;
    const listEl = document.getElementById("managersList");
    if (!listEl) return;

    const total      = _allMgrs.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _mgPage          = Math.min(_mgPage, totalPages);
    const start      = (_mgPage - 1) * PAGE_SIZE;
    const slice      = _allMgrs.slice(start, start + PAGE_SIZE);
    const stationMap = Object.fromEntries((state.stations || []).map(s => [s.$id, s.name]));

    const pagination = totalPages > 1 ? `
      <div class="list-pagination">
        <button class="btn-ghost btn-sm" id="mgPrev" ${_mgPage <= 1 ? "disabled" : ""}>Previous</button>
        <span>${_mgPage} / ${totalPages}</span>
        <button class="btn-ghost btn-sm" id="mgNext" ${_mgPage >= totalPages ? "disabled" : ""}>Next</button>
      </div>` : "";

    listEl.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Station</th><th></th></tr></thead>
        <tbody>${slice.map(m => `<tr>
          <td>${m.name || "—"}</td>
          <td>${m.email}</td>
          <td>${stationMap[m.stationId] || m.stationId || "—"}</td>
          <td class="row-actions">
            <button class="btn-ghost btn-sm"  data-action="edit"      data-uid="${m.userId}" data-name="${(m.name||m.email).replace(/"/g,'&quot;')}">Edit</button>
            <button class="btn-ghost btn-sm"  data-action="reset-pwd" data-uid="${m.userId}" data-name="${(m.name||m.email).replace(/"/g,'&quot;')}">Reset pwd</button>
            <button class="btn-danger btn-sm" data-action="delete"    data-uid="${m.userId}" data-name="${(m.name||m.email).replace(/"/g,'&quot;')}">Delete</button>
          </td>
        </tr>`).join("")}</tbody>
      </table>
      ${pagination}`;

    listEl.querySelectorAll("[data-action='edit']").forEach(btn =>
      btn.addEventListener("click", () => openEditUser(btn.dataset.uid))
    );
    listEl.querySelectorAll("[data-action='reset-pwd']").forEach(btn =>
      btn.addEventListener("click", () => openResetPwd(btn.dataset.uid, btn.dataset.name))
    );
    listEl.querySelectorAll("[data-action='delete']").forEach(btn =>
      btn.addEventListener("click", () => openDeleteUser(btn.dataset.uid, btn.dataset.name))
    );

    if (totalPages > 1) {
      document.getElementById("mgPrev")?.addEventListener("click", () => { _mgPage--; _render(); });
      document.getElementById("mgNext")?.addEventListener("click", () => { _mgPage++; _render(); });
    }
  }

  window._sections.managers = async function loadManagers() {
    const { toast, state, apiFetch } = window._dash;
    const listEl = document.getElementById("managersList");
    if (listEl) listEl.innerHTML = "<div class='loading-state'>Loading…</div>";
    _mgPage = 1;

    try {
      const res      = await apiFetch(`/users`).then(r => r.json());
      const managers = (res.users ?? []).filter(u => u.role === "manager");

      state.managers = managers.map(m => ({
        userId: m.userId,
        name:   m.name || m.email,
        email:  m.email,
      }));

      _allMgrs = managers;

      if (managers.length === 0) {
        if (listEl) listEl.innerHTML = "<div class='empty-state'>No managers found.</div>";
        return;
      }

      _render();
    } catch (err) {
      toast("Could not load managers: " + err.message, "error");
    }
  };

  document.getElementById("addManagerBtn")?.addEventListener("click", () => {
    window._dash.openAddUserModal("manager");
  });

})();
