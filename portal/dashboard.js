// ── DASHBOARD SHELL ───────────────────────────────────────────────────────────
// Handles: auth, nav, role visibility, shared modals, shared state.
// Section logic lives in sections/*.js — each file registers on window._sections.

(function () {

  // ── TOAST ──────────────────────────────────────────────────────
  function toast(msg, type = "info") {
    let c = document.getElementById("toast-container");
    if (!c) { c = document.createElement("div"); c.id = "toast-container"; document.body.appendChild(c); }
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3500);
  }

  function fmt(v) { return (Number(v) || 0).toLocaleString(); }

  // ── SHARED STATE ───────────────────────────────────────────────
  const _state = {
    profile:        null,
    role:           null,
    stations:       [],
    managers:       [],
    pompistes:      [],
    company:        null,
    station:        null,
    viewingStation: null,
  };

  // Shared modal state
  let _addingRole     = null;
  let _editUserId     = null;
  let _resetPwdUserId = null;

  // ── ROLE VISIBILITY ────────────────────────────────────────────
  function applyRoleVisibility(role) {
    document.querySelectorAll("[data-roles]").forEach(el => {
      el.style.display = el.dataset.roles.split(",").includes(role) ? "" : "none";
    });
    document.getElementById("sidebarRole").textContent =
      role === "owner" ? "Owner Portal" : "Manager Portal";
  }

  // ── NAV ────────────────────────────────────────────────────────
  function showSection(name) {
    document.querySelectorAll(".section").forEach(s => s.style.display = "none");
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const sec = document.getElementById(`section-${name}`);
    if (sec) sec.style.display = "block";
    const nav = document.querySelector(`.nav-item[data-section="${name}"]`);
    if (nav) nav.classList.add("active");
    if (location.hash.slice(1) !== name) history.pushState(null, "", `#${name}`);
  }

  function callLoader(name) {
    const fn = window._sections && window._sections[name];
    if (fn) fn();
  }

  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", e => {
      e.preventDefault();
      const sec = item.dataset.section;
      showSection(sec);
      callLoader(sec);
    });
  });

  window.addEventListener("hashchange", () => {
    const name = location.hash.slice(1);
    const nav  = document.querySelector(`.nav-item[data-section="${name}"]`);
    if (nav && nav.style.display !== "none") { showSection(name); callLoader(name); }
  });

  // ── MODAL HELPERS ──────────────────────────────────────────────
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "flex";
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
  document.querySelectorAll("[data-close]").forEach(btn =>
    btn.addEventListener("click", () => closeModal(btn.dataset.close))
  );
  document.querySelectorAll(".modal-overlay").forEach(overlay =>
    overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(overlay.id); })
  );

  // ── SHARED: ADD USER MODAL ─────────────────────────────────────
  // Used by both managers.js and pompistes.js
  function openAddUserModal(role) {
    _addingRole = role;
    document.getElementById("addUserModalTitle").textContent =
      role === "manager" ? "Add Manager" : "Add Pompiste";
    const stationRow = document.getElementById("stationSelectRow");
    if (stationRow) stationRow.style.display = role === "manager" ? "" : "none";
    if (role === "manager") {
      const sel = document.getElementById("newUserStation");
      if (sel) sel.innerHTML = _state.stations.map(s => `<option value="${s.$id}">${s.name}</option>`).join("");
    }
    document.getElementById("newUserName").value     = "";
    document.getElementById("newUserEmail").value    = "";
    document.getElementById("newUserPassword").value = "";
    openModal("addUserModal");
  }

  document.getElementById("confirmAddUserBtn").addEventListener("click", async () => {
    const name      = document.getElementById("newUserName").value.trim();
    const email     = document.getElementById("newUserEmail").value.trim();
    const password  = document.getElementById("newUserPassword").value.trim();
    const stationId = _addingRole === "manager"
      ? document.getElementById("newUserStation").value
      : _state.profile.stationId;

    if (!name || !email || !password) { toast("All fields are required.", "warning"); return; }
    if (password.length < 8)          { toast("Password must be at least 8 characters.", "warning"); return; }

    const btn = document.getElementById("confirmAddUserBtn");
    btn.disabled = true;
    try {
      const res  = await apiFetch("/accounts", {
        method: "POST",
        body:   JSON.stringify({
          name, email, password,
          role:      _addingRole,
          stationId: stationId || null,
          companyId: _state.profile.companyId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      closeModal("addUserModal");
      document.getElementById("credEmail").textContent    = email;
      document.getElementById("credPassword").textContent = password;
      openModal("credentialModal");
      callLoader(_addingRole === "pompiste" ? "pompistes" : "managers");
    } catch (err) {
      toast(err.message || `Could not create ${_addingRole}.`, "error");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("credDoneBtn").addEventListener("click", () => closeModal("credentialModal"));

  // ── SHARED: EDIT USER MODAL ────────────────────────────────────
  let _editingManagerStation = false;

  function openEditUser(userId) {
    const isOwner = _state.role === "owner" || _state.viewingStation;
    const list    = isOwner ? _state.managers : _state.pompistes;
    const user    = list.find(u => u.userId === userId);
    if (!user) return;
    _editUserId = userId;
    _editingManagerStation = isOwner;
    document.getElementById("editUserName").value = user.name || "";

    const stationRow = document.getElementById("editStationRow");
    if (stationRow) {
      stationRow.style.display = isOwner ? "" : "none";
      if (isOwner) {
        const sel = document.getElementById("editUserStation");
        if (sel) {
          sel.innerHTML = _state.stations.map(s =>
            `<option value="${s.$id}" ${s.$id === user.stationId ? "selected" : ""}>${s.name}</option>`
          ).join("");
        }
      }
    }
    openModal("editUserModal");
  }

  document.getElementById("confirmEditUserBtn").addEventListener("click", async () => {
    const name = document.getElementById("editUserName").value.trim();
    if (!name) { toast("Name is required.", "warning"); return; }
    const btn = document.getElementById("confirmEditUserBtn");
    btn.disabled = true;
    try {
      // Update name
      const nameRes = await apiFetch(`/accounts/${_editUserId}/name`, {
        method: "PATCH",
        body:   JSON.stringify({ name }),
      });
      if (!nameRes.ok) throw new Error((await nameRes.json()).error);

      // Update station if editing a manager
      if (_editingManagerStation) {
        const stationId = document.getElementById("editUserStation")?.value;
        if (stationId) {
          await apiFetch(`/accounts/${_editUserId}/prefs`, {
            method: "PATCH",
            body:   JSON.stringify({ stationId }),
          });
          // Also update the users-collection document
          await apiFetch(`/users/${_editUserId}`, {
            method: "PATCH",
            body:   JSON.stringify({ stationId }),
          });
        }
      }

      closeModal("editUserModal");
      toast("Account updated.", "success");
      callLoader(_editingManagerStation ? "managers" : "pompistes");
    } catch (err) {
      toast(err.message || "Update failed.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── SHARED: DELETE USER ────────────────────────────────────────
  let _deleteUserId = null;
  function openDeleteUser(userId, name) {
    _deleteUserId = userId;
    document.getElementById("deleteUserHint").textContent = `Delete "${name}" permanently? This cannot be undone.`;
    openModal("deleteUserModal");
  }

  document.getElementById("confirmDeleteUserBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("confirmDeleteUserBtn");
    btn.disabled = true;
    try {
      const res = await apiFetch(`/accounts/${_deleteUserId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      closeModal("deleteUserModal");
      toast("Account deleted.", "success");
      callLoader(_state.role === "manager" ? "pompistes" : "managers");
    } catch (err) {
      toast(err.message || "Delete failed.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── SHARED: RESET PASSWORD MODAL ───────────────────────────────
  function openResetPwd(userId, name) {
    _resetPwdUserId = userId;
    document.getElementById("resetPwdHint").textContent = `Set a new temporary password for ${name}.`;
    document.getElementById("resetPwdInput").value = "";
    openModal("resetPwdModal");
  }

  document.getElementById("confirmResetPwdBtn").addEventListener("click", async () => {
    const password = document.getElementById("resetPwdInput").value.trim();
    if (password.length < 8) { toast("Password must be at least 8 characters.", "warning"); return; }
    try {
      const res = await apiFetch(`/users/${_resetPwdUserId}/password`, {
        method: "PATCH",
        body:   JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      closeModal("resetPwdModal");
      toast("Password reset.", "success");
    } catch (err) {
      toast(err.message || "Reset failed.", "error");
    }
  });

  // ── STATION VIEW MODE ──────────────────────────────────────────
  function enterStationView(station) {
    _state.viewingStation = station;
    applyRoleVisibility("manager");
    const banner = document.getElementById("stationViewBanner");
    const label  = document.getElementById("stationViewName");
    if (banner) banner.style.display = "flex";
    if (label)  label.textContent    = station.name;
    showSection("overview");
    callLoader("overview");
  }

  function exitStationView() {
    _state.viewingStation = null;
    applyRoleVisibility("owner");
    const banner = document.getElementById("stationViewBanner");
    if (banner) banner.style.display = "none";
    showSection("stations");
    callLoader("stations");
  }

  document.getElementById("exitStationViewBtn")?.addEventListener("click", () => exitStationView());

  // ── LOGOUT ─────────────────────────────────────────────────────
  document.getElementById("logoutBtn").addEventListener("click", () => logout());

  // ── PUBLIC API (for external scripts) ─────────────────────────
  window._sections = {};

  window._dash = {
    toast,
    fmt,
    apiFetch,
    openModal,
    closeModal,
    openEditUser,
    openDeleteUser,
    openResetPwd,
    openAddUserModal,
    enterStationView,
    exitStationView,
    reload: (section) => callLoader(section),
    state:  _state,
  };

  window.Option = {
    navigate(name)        { showSection(name); callLoader(name); },
    showToast(msg, type)  { toast(msg, type); },
    getCurrentUser()      { return _state.profile; },
  };

  // ── INIT ───────────────────────────────────────────────────────
  (async function init() {
    _state.profile = await requireAuth({ roles: ["owner", "manager"] });
    if (!_state.profile) return;

    // Enrich profile with companyId, stationId, and real role from users collection
    const meRes = await apiFetch("/users/me");
    if (meRes.ok) {
      const { user } = await meRes.json();
      const doc = user?.documents?.[0];
      if (doc) {
        _state.profile.companyId = doc.companyId;
        _state.profile.stationId = doc.stationId || _state.profile.stationId;
        _state.profile.role      = doc.role;
      }
    }

    _state.role = _state.profile.role;
    applyRoleVisibility(_state.role);

    // Reveal page only after role visibility applied — prevents flash of wrong sections
    document.body.style.visibility = "visible";

    document.getElementById("userName").textContent    = _state.profile.name || _state.role;
    document.getElementById("userAvatar").textContent  = (_state.profile.name || _state.role)[0].toUpperCase();

    // Show skeleton overview cards while data loads
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    document.getElementById("overviewTitle").textContent = `${greeting}, ${(_state.profile.name || "").split(" ")[0]}`;
    document.getElementById("overviewStats").innerHTML = `
      <div class="stat-card skeleton-card"><div class="stat-val">—</div><div class="stat-label">Loading…</div></div>
      <div class="stat-card skeleton-card"><div class="stat-val">—</div><div class="stat-label">Loading…</div></div>
      <div class="stat-card skeleton-card"><div class="stat-val">—</div><div class="stat-label">Loading…</div></div>
    `;

    const hash    = location.hash.slice(1);
    const hashNav = document.querySelector(`.nav-item[data-section="${hash}"]`);
    const start   = (hash && hashNav && hashNav.style.display !== "none") ? hash : "overview";
    showSection(start);

    if (_state.role === "owner") {
      const [compRes, stRes, usersRes] = await Promise.all([
        apiFetch("/companies"),
        apiFetch("/stations"),
        apiFetch("/users"),
      ]);
      if (compRes.ok)  { const d = await compRes.json(); _state.company  = (d.companies || [])[0] || null; }
      if (stRes.ok)    { const d = await stRes.json();   _state.stations = d.stations  || []; }
      if (usersRes.ok) {
        const users      = (await usersRes.json()).users || [];
        _state.managers  = users.filter(u => u.role === "manager");
        _state.pompistes = users.filter(u => u.role === "pompiste");
      }
      document.getElementById("userContext").textContent = _state.company?.name || "—";
    } else {
      const [stRes, pmpRes] = await Promise.all([
        apiFetch("/stations"),
        apiFetch("/users"),
      ]);
      if (stRes.ok)  { const d = await stRes.json();  _state.station   = (d.stations || []).find(s => s.$id === _state.profile.stationId) || null; }
      if (pmpRes.ok) { const d = await pmpRes.json(); _state.pompistes = (d.users || []).filter(u => u.role === "pompiste"); }
      document.getElementById("userContext").textContent = _state.station?.name || "No station assigned";
    }

    callLoader(start);
  })();

})();
