(function () {

  const PAGE_SIZE   = 15;
  let _pomPage      = 1;
  let _allPompistes = [];
  let _gainMap      = {};

  function _render() {
    const { openEditUser, openDeleteUser, openResetPwd } = window._dash;
    const listEl = document.getElementById("pompistesList");
    if (!listEl) return;

    const now        = new Date();
    const total      = _allPompistes.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _pomPage         = Math.min(_pomPage, totalPages);
    const start      = (_pomPage - 1) * PAGE_SIZE;
    const slice      = _allPompistes.slice(start, start + PAGE_SIZE);

    const pagination = totalPages > 1 ? `
      <div class="list-pagination">
        <button class="btn-ghost btn-sm" id="pomPrev" ${_pomPage <= 1 ? "disabled" : ""}>Previous</button>
        <span>${_pomPage} / ${totalPages}</span>
        <button class="btn-ghost btn-sm" id="pomNext" ${_pomPage >= totalPages ? "disabled" : ""}>Next</button>
      </div>` : "";

    listEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Gain (${now.toLocaleString("default", { month: "long" })})</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${slice.map(u => {
          const uid     = u.userId || u.$id;
          const uname   = (u.name || u.email).replace(/"/g, '&quot;');
          const hasGain = u.email in _gainMap;
          const gain    = _gainMap[u.email] ?? 0;
          const gainCell = hasGain
            ? `<span class="${gain >= 0 ? "badge badge-ok" : "badge badge-warn"}">${gain >= 0 ? "+" : ""}${gain.toLocaleString()} RWF</span>`
            : `<span class="badge">No shifts</span>`;
          return `<tr>
            <td>${u.name || "—"}</td>
            <td>${u.email}</td>
            <td>${gainCell}</td>
            <td class="row-actions">
              <button class="btn-ghost btn-sm"  data-action="edit"      data-uid="${uid}" data-name="${uname}">Edit</button>
              <button class="btn-ghost btn-sm"  data-action="reset-pwd" data-uid="${uid}" data-name="${uname}">Reset pwd</button>
              <button class="btn-danger btn-sm" data-action="delete"    data-uid="${uid}" data-name="${uname}">Delete</button>
            </td>
          </tr>`;
        }).join("")}</tbody>
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
      document.getElementById("pomPrev")?.addEventListener("click", () => { _pomPage--; _render(); });
      document.getElementById("pomNext")?.addEventListener("click", () => { _pomPage++; _render(); });
    }
  }

  window._sections.pompistes = async function loadPompistes() {
    const { toast, state, apiFetch } = window._dash;
    const listEl = document.getElementById("pompistesList");
    if (listEl) listEl.innerHTML = "<div class='loading-state'>Loading…</div>";
    _pomPage = 1;

    try {
      const now          = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const [usersData, gainData] = await Promise.all([
        apiFetch('/users').then(r => r.json()),
        apiFetch('/gain-pompiste').then(r => r.json()),
      ]);

      if (usersData.error) throw new Error(usersData.error);

      _gainMap = {};
      (gainData.gains?.documents ?? gainData.gains ?? [])
        .filter(d => d.monthYear === currentMonth)
        .forEach(d => { _gainMap[d.email] = d.gainPayments ?? 0; });

      const pompistes = (usersData.users ?? []).filter(u => u.role === "pompiste");

      state.pompistes = pompistes.map(u => ({
        userId:             u.userId || u.$id,
        name:               u.name,
        email:              u.email,
        mustChangePassword: u.mustChangePassword ?? false,
      }));

      _allPompistes = pompistes;

      if (pompistes.length === 0) {
        if (listEl) listEl.innerHTML = "<div class='empty-state'>No pompistes found.</div>";
        return;
      }

      _render();
    } catch (err) {
      toast("Could not load pompistes: " + err.message, "error");
    }
  };

  document.getElementById("addPompisteBtn")?.addEventListener("click", () => {
    window._dash.openAddUserModal("pompiste");
  });

})();
