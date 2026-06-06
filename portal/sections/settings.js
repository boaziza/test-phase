(function () {

  const _statusTimers = new WeakMap();

  const { apiFetch, state } = window._dash;
  

  function showStatus(el, msg, type) {
    if (!el) return;
    if (_statusTimers.has(el)) clearTimeout(_statusTimers.get(el));
    el.textContent = msg; el.className = "status-msg " + type;
    const t = setTimeout(() => { el.textContent = ""; el.className = "status-msg"; _statusTimers.delete(el); }, 4000);
    _statusTimers.set(el, t);
  }

  function switchTab(tab, btn) {
    document.querySelectorAll(".tab-content").forEach(el => el.style.display = "none");
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    const tabEl = document.getElementById("tab-" + tab);
    if (tabEl) tabEl.style.display = "block";
    btn.classList.add("active");
    if (tab === "teams")     loadTeams();
    if (tab === "employees") loadPeopleTab();
    if (tab === "devices")   initDevicesTab();
    if (tab === "pumps")     initPumpsTab();
  }

  async function loadFuelSettings() {
    try {
      const stationRes  = await apiFetch('/stations').then(r => r.json());
      const stationDocs = (stationRes.stations ?? []).filter(s => !s.archived);
      state.stations    = stationDocs;

      if (!stationDocs.length) return;
      const first = stationDocs[0];

      const momoEl = document.getElementById("momoFeeInput");
      if (momoEl) momoEl.value = first.momoFee ?? "";

      const fuelPrices = await apiFetch(`/fuel-prices?station=${first.$id}`).then(r => r.json());
      const priceDocs  = fuelPrices.fuelPriceHistory ?? [];
      const sorted     = [...priceDocs].sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""));
      const pmsEl = document.getElementById("pmsPriceInput");
      const agoEl = document.getElementById("agoPriceInput");
      if (pmsEl) pmsEl.value = sorted.find(p => p.fuelType === "PMS")?.price ?? "";
      if (agoEl) agoEl.value = sorted.find(p => p.fuelType === "AGO")?.price ?? "";
    } catch (err) { console.error("Could not load settings:", err); }
  }

  async function handleSavePrices(btn) {
    btn.disabled = true;
    try { await saveFuelPrices(); } finally { btn.disabled = false; }
  }

  async function saveFuelPrices() {
    const stations = (state.stations ?? []).filter(s => !s.archived);
    const userId   = state.profile.userId;
    const pmsPrice = parseInt(document.getElementById("pmsPriceInput")?.value || "");
    const agoPrice = parseInt(document.getElementById("agoPriceInput")?.value || "");
    const momoFeePercent = parseFloat(document.getElementById("momoFeeInput")?.value || "");
    const statusEl = document.getElementById("fuelStatus");

    if (!pmsPrice || !agoPrice) { showStatus(statusEl, "Both fuel prices are required.", "error"); return; }
    if (isNaN(momoFeePercent) || momoFeePercent < 0) { showStatus(statusEl, "Enter a valid MoMo fee percentage.", "error"); return; }
    if (!stations.length) { showStatus(statusEl, "No stations found.", "error"); return; }

    const formattedDate = new Date().toLocaleDateString('en-CA');

    const created = []; // new fuel-price docs → DELETE on rollback
    const patched = []; // patched docs → restore on rollback

    async function rollbackFuel() {
      for (const { id } of [...created].reverse()) {
        try { await apiFetch(`/fuel-prices/${id}`, { method: "DELETE" }); } catch {}
      }
      for (const { url, id, snapshot } of [...patched].reverse()) {
        try { await apiFetch(`${url}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) }); } catch {}
      }
    }

    try {
      for (const station of stations) {
        const r = await apiFetch(`/stations/${station.$id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ momoFee: momoFeePercent }),
        });
        if (!r.ok) { const e = await r.json(); throw new Error(`Station ${station.name}: ${e.error}`); }
        patched.push({ url: "/stations", id: station.$id, snapshot: { momoFee: station.momoFee ?? 0 } });

        const fuelPrices = await apiFetch(`/fuel-prices?station=${station.$id}`).then(r => r.json());
        const priceDocs  = fuelPrices.fuelPriceHistory ?? [];
        const sorted     = [...priceDocs].sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || ""));
        const pmsPriceDoc = sorted.find(p => p.fuelType === "PMS");
        const agoPriceDoc = sorted.find(p => p.fuelType === "AGO");

        if (!pmsPriceDoc || pmsPriceDoc.price !== pmsPrice) {
          if (pmsPriceDoc) {
            const rp = await apiFetch(`/fuel-prices/${pmsPriceDoc.$id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ effectiveTo: formattedDate }),
            });
            if (!rp.ok) { const e = await rp.json(); throw new Error(`PMS price: ${e.error}`); }
            patched.push({ url: "/fuel-prices", id: pmsPriceDoc.$id, snapshot: { effectiveTo: pmsPriceDoc.effectiveTo ?? null } });
          }
          const rn = await apiFetch(`/fuel-prices`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stationId: station.$id, effectiveFrom: formattedDate, fuelType: "PMS", price: pmsPrice, setByUserId: userId }),
          });
          if (!rn.ok) { const e = await rn.json(); throw new Error(`New PMS price: ${e.error}`); }
          const rnd = await rn.json();
          created.push({ id: rnd.fuelPrice?.$id || rnd.$id });
        }

        if (!agoPriceDoc || agoPriceDoc.price !== agoPrice) {
          if (agoPriceDoc) {
            const ra = await apiFetch(`/fuel-prices/${agoPriceDoc.$id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ effectiveTo: formattedDate }),
            });
            if (!ra.ok) { const e = await ra.json(); throw new Error(`AGO price: ${e.error}`); }
            patched.push({ url: "/fuel-prices", id: agoPriceDoc.$id, snapshot: { effectiveTo: agoPriceDoc.effectiveTo ?? null } });
          }
          const rna = await apiFetch(`/fuel-prices`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stationId: station.$id, effectiveFrom: formattedDate, fuelType: "AGO", price: agoPrice, setByUserId: userId }),
          });
          if (!rna.ok) { const e = await rna.json(); throw new Error(`New AGO price: ${e.error}`); }
          const rnad = await rna.json();
          created.push({ id: rnad.fuelPrice?.$id || rnad.$id });
        }
      }

      showStatus(statusEl, "✓ Settings saved for all stations.", "success");
    } catch (err) {
      await rollbackFuel();
      showStatus(statusEl, "Error saving settings: " + err.message, "error");
    }
  }

  async function loadTeams() {
    const { apiFetch } = window._dash;
    const listEl = document.getElementById("teamsList");
    listEl.innerHTML = `<div class="loading">Loading...</div>`;
    try {

      const res = await apiFetch(`/teams`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.teams.length === 0) { listEl.innerHTML = `<div class="loading">No teams yet. Create one below.</div>`; return; }
      listEl.innerHTML = data.teams.map(t => renderTeamCard(t)).join("");
    } catch { listEl.innerHTML = `<div class="loading">Error loading teams.</div>`; }
  }

  function renderTeamCard(team) {
    return `
      <div class="team-card" id="team-${team.$id}">
        <div class="team-header" onclick="window._set.toggleTeam('${team.$id}')" role="button" tabindex="0" aria-expanded="false" id="team-header-${team.$id}">
          <span class="team-chevron">▶</span>
          <span class="team-name">${team.name}</span>
          <button class="btn-remove" onclick="event.stopPropagation(); window._set.promptDeleteTeam('${team.$id}', '${team.name.replace(/'/g, "\\'")}')">Delete</button>
        </div>
        <div class="team-body" id="team-body-${team.$id}" style="display:none;">
          <div class="team-members" id="members-${team.$id}"><div class="loading">Loading members...</div></div>
          <div class="add-member-row">
            <input type="email" id="memberEmail-${team.$id}" placeholder="Enter email to add">
            <button class="btn-primary" onclick="window._set.promptAddMember('${team.$id}', '${team.name.replace(/'/g, "\\'")}', this)">Add Member</button>
          </div>
          <div id="teamStatus-${team.$id}" class="status-msg" aria-live="polite"></div>
        </div>
      </div>`;
  }

  function toggleTeam(teamId) {
    const body = document.getElementById(`team-body-${teamId}`);
    const header = document.getElementById(`team-header-${teamId}`);
    const chevron = header?.querySelector(".team-chevron");
    const isOpen = body.style.display !== "none";
    if (isOpen) { body.style.display = "none"; chevron.textContent = "▶"; header.setAttribute("aria-expanded", "false"); }
    else {
      body.style.display = "block"; chevron.textContent = "▼"; header.setAttribute("aria-expanded", "true");
      const membersEl = document.getElementById(`members-${teamId}`);
      if (membersEl?.querySelector(".loading")) loadTeamMembers(teamId);
    }
  }

  async function loadTeamMembers(teamId) {
    const { apiFetch } = window._dash;
    const el = document.getElementById(`members-${teamId}`);
    if (!el) return;
    try {
      const res = await apiFetch(`/teams/${teamId}/members`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.memberships.length === 0) { el.innerHTML = `<div class="loading">No members yet.</div>`; return; }
      el.innerHTML = data.memberships.map(m => `
        <div class="admin-row" id="membership-${m.$id}">
          <span class="admin-email">${m.userName || "—"}</span>
          <span class="admin-role">${m.userEmail}</span>
          <button class="btn-remove" onclick="window._set.promptRemoveMember('${teamId}', '${m.$id}', '${(m.userName || m.userEmail).replace(/'/g, "\\'")}')">Remove</button>
        </div>`).join("");
    } catch { el.innerHTML = `<div class="loading">Error loading members.</div>`; }
  }

  let _pendingDeleteTeamId = null;

  function promptCreateTeam() {
    const nameEl = document.getElementById("newTeamName");
    const name = nameEl?.value.trim();
    const statusEl = document.getElementById("teamsStatus");
    if (!name) { showStatus(statusEl, "Enter a team name.", "error"); return; }
    const subEl = document.getElementById("createTeamPopupSub");
    if (subEl) subEl.textContent = `Create team "${name}"?`;
    openDialog("confirmCreateTeamPopup");
  }

  async function handleCreateTeam(btn) {
    const nameEl = document.getElementById("newTeamName");
    const name = nameEl?.value.trim();
    btn.disabled = true;
    try {
      const res = await apiFetch(`/teams`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ name }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (nameEl) nameEl.value = "";
      const statusEl = document.getElementById("teamsStatus");
      showStatus(statusEl, `✓ Team "${name}" created.`, "success");
      loadTeams();
    } catch (err) { 
      const statusEl = document.getElementById("teamsStatus");
      showStatus(statusEl, "Error: " + err.message, "error"); 
    }
    finally { btn.disabled = false; }
  }

  function promptDeleteTeam(teamId, teamName) {
    _pendingDeleteTeamId = teamId;
    const subEl = document.getElementById("deleteTeamPopupSub");
    if (subEl) subEl.textContent = `Delete "${teamName}"? All memberships will be removed.`;
    openDialog("confirmDeleteTeamPopup");
  }

  async function handleDeleteTeam(btn) {
    closeDialog("confirmDeleteTeamPopup");
    if (!_pendingDeleteTeamId) return;
    const teamId = _pendingDeleteTeamId; _pendingDeleteTeamId = null; btn.disabled = true;
    try {
      const res = await apiFetch(`/teams/${teamId}`, { method:"DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      document.getElementById(`team-${teamId}`)?.remove();
      const listEl = document.getElementById("teamsList");
      if (listEl && !listEl.querySelector(".team-card")) listEl.innerHTML = `<div class="loading">No teams yet. Create one below.</div>`;
      const statusEl = document.getElementById("teamsStatus");
      showStatus(statusEl, "Team deleted.", "success");
    } catch (err) { 
      const statusEl = document.getElementById("teamsStatus");
      showStatus(statusEl, "Error: " + err.message, "error"); 
    }
    finally { btn.disabled = false; }
  }

  let _pendingAddMember = null;

  function promptAddMember(teamId, teamName, btn) {
    const emailEl = document.getElementById(`memberEmail-${teamId}`);
    const email = emailEl?.value.trim();
    const statusEl = document.getElementById(`teamStatus-${teamId}`);
    if (!email) { showStatus(statusEl, "Enter an email address.", "error"); return; }
    _pendingAddMember = { teamId, email, btn };
    const subEl = document.getElementById("addMemberPopupSub");
    if (subEl) subEl.textContent = `Add ${email} to team "${teamName}"?`;
    openDialog("confirmAddMemberPopup");
  }

  async function handleAddMember(confirmBtn) {
    closeDialog("confirmAddMemberPopup");
    if (!_pendingAddMember) return;
    const { teamId, email, btn } = _pendingAddMember; _pendingAddMember = null;
    const statusEl = document.getElementById(`teamStatus-${teamId}`);
    if (btn) btn.disabled = true;
    try {
      const res = await apiFetch(`/teams/${teamId}/members`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ email }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const inputEl = document.getElementById(`memberEmail-${teamId}`);
      if (inputEl) inputEl.value = "";
      showStatus(statusEl, `✓ ${email} added.`, "success");
      loadTeamMembers(teamId);
    } catch (err) { showStatus(statusEl, "Error: " + err.message, "error"); }
    finally { if (btn) btn.disabled = false; }
  }

  let _pendingRemoveMember = null;

  function promptRemoveMember(teamId, membershipId, name) {
    _pendingRemoveMember = { teamId, membershipId };
    const subEl = document.getElementById("removeMemberPopupSub");
    if (subEl) subEl.textContent = `Remove ${name} from this team?`;
    openDialog("confirmRemoveMemberPopup");
  }

  async function handleRemoveMember(btn) {
    closeDialog("confirmRemoveMemberPopup");
    if (!_pendingRemoveMember) return;
    const { teamId, membershipId } = _pendingRemoveMember; _pendingRemoveMember = null; btn.disabled = true;
    try {
      const res = await apiFetch(`/teams/${teamId}/members/${membershipId}`, { method:"DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      document.getElementById(`membership-${membershipId}`)?.remove();
      const membersEl = document.getElementById(`members-${teamId}`);
      if (membersEl && !membersEl.querySelector(".admin-row")) membersEl.innerHTML = `<div class="loading">No members yet.</div>`;
    } catch (err) { 
      const statusEl = document.getElementById("teamsStatus");
      showStatus(statusEl, "Error: " + err.message, "error"); 
    }
    finally { btn.disabled = false; }
  }

  function promptCreateEmployee() {
    const name      = document.getElementById("empName")?.value.trim();
    const email     = document.getElementById("empEmail")?.value.trim();
    const password  = document.getElementById("empPassword")?.value;
    const role      = document.getElementById("empRole")?.value || "pompiste";
    const stationId = document.getElementById("empStation")?.value;
    const statusEl  = document.getElementById("empStatus");
    if (!name || !email || !password) { showStatus(statusEl, "Name, email, and password are all required.", "error"); return; }
    if (password.length < 8) { showStatus(statusEl, "Password must be at least 8 characters.", "error"); return; }
    if (!stationId) { showStatus(statusEl, "Please select a station.", "error"); return; }
    const subEl = document.getElementById("createEmpPopupSub");
    if (subEl) subEl.textContent = `Create ${role} account for ${name} (${email})?`;
    openDialog("confirmCreateEmpPopup");
  }

  async function handleCreateEmployee(btn) {
    const nameEl      = document.getElementById("empName");
    const emailEl     = document.getElementById("empEmail");
    const passwordEl  = document.getElementById("empPassword");
    const name        = nameEl?.value.trim();
    const email       = emailEl?.value.trim();
    const password    = passwordEl?.value;
    const role        = document.getElementById("empRole")?.value || "pompiste";
    const stationId   = document.getElementById("empStation")?.value || null;
    const statusEl    = document.getElementById("empStatus");
    btn.disabled = true;
    try {
      const res = await apiFetch(`/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role, stationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create account");
      if (nameEl) nameEl.value = "";
      if (emailEl) emailEl.value = "";
      if (passwordEl) passwordEl.value = "";
      showStatus(statusEl, `✓ ${role} account created for ${name}.`, "success");
      loadAllEmployees();
    } catch (err) { showStatus(statusEl, "Error: " + err.message, "error"); }
    finally { btn.disabled = false; }
  }

  async function loadPeopleTab() {
    if (!state.stations?.length) {
      const res = await apiFetch('/stations').then(r => r.json());
      state.stations = (res.stations ?? []).filter(s => !s.archived);
    }
    const stationEl = document.getElementById("empStation");
    if (stationEl) {
      stationEl.innerHTML = (state.stations ?? []).map(s =>
        `<option value="${s.$id}">${s.name}</option>`
      ).join("");
    }
    await loadAllEmployees();
  }

  async function loadAllEmployees() {
    const listEl = document.getElementById("allEmployeesList");
    if (!listEl) return;
    listEl.innerHTML = `<div class="loading">Loading...</div>`;
    const now       = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const hintEl    = document.getElementById("perfMonthLabel");
    if (hintEl) hintEl.textContent = now.toLocaleString("default", { month: "long", year: "numeric" });
    try {
      const [usersRes, gainRes] = await Promise.all([
        apiFetch(`/users`),
        apiFetch(`/gain-pompiste?monthYear=${monthYear}`),
      ]);
      const usersData = await usersRes.json();
      const gainData  = await gainRes.json();
      if (!usersRes.ok) throw new Error(usersData.error);

      const gainMap = {};
      (gainData.gains ?? []).forEach(d => { gainMap[d.email] = d.gainPayments ?? 0; });

      // exclude owners from the people list
      const users = (usersData.users ?? []).filter(u => u.role !== "owner");
      if (!users.length) { listEl.innerHTML = `<div class="people-empty">No accounts found.</div>`; return; }

      const stationNameMap = {};
      (state.stations ?? []).forEach(s => { stationNameMap[s.$id] = s.name; });

      const byStation = {};
      users.forEach(u => {
        const sid = u.stationId || "__none__";
        if (!byStation[sid]) byStation[sid] = [];
        byStation[sid].push(u);
      });

      const unassigned = byStation["__none__"] ?? [];

      const renderAccordion = (label, members, defaultOpen = false) => {
        const manager   = members.find(u => u.role === "manager");
        const pompistes = members.filter(u => u.role === "pompiste");
        const summary   = [
          manager ? "1 manager" : "no manager",
          `${pompistes.length} pompiste${pompistes.length !== 1 ? "s" : ""}`,
        ].join(" · ");

        return `
          <div class="people-acc">
            <button class="people-acc-hdr ${defaultOpen ? "open" : ""}">
              <span class="people-acc-chevron">${defaultOpen ? "▼" : "▶"}</span>
              <span class="people-acc-name">${label}</span>
              <span class="people-acc-summary">${summary}</span>
            </button>
            <div class="people-acc-body" style="display:${defaultOpen ? "block" : "none"};">
              <div class="people-role-label">Manager</div>
              ${manager
                ? _renderPersonRow(manager, gainMap, false)
                : `<div class="people-empty-role">No manager assigned</div>`}
              <div class="people-role-label" style="margin-top:10px;">Pompistes</div>
              ${pompistes.length
                ? pompistes.map(u => _renderPersonRow(u, gainMap, true)).join("")
                : `<div class="people-empty-role">No pompistes assigned</div>`}
            </div>
          </div>`;
      };

      const sections = (state.stations ?? []).map((s, i) =>
        renderAccordion(s.name, byStation[s.$id] ?? [], i === 0)
      );

      if (unassigned.length) {
        sections.push(renderAccordion("Unassigned", unassigned, false));
      }

      listEl.innerHTML = sections.join("");

      // accordion toggle
      listEl.querySelectorAll(".people-acc-hdr").forEach(hdr => {
        hdr.addEventListener("click", () => {
          const body    = hdr.nextElementSibling;
          const chevron = hdr.querySelector(".people-acc-chevron");
          const open    = body.style.display !== "none";
          body.style.display = open ? "none" : "block";
          chevron.textContent = open ? "▶" : "▼";
          hdr.classList.toggle("open", !open);
        });
      });

      // row actions
      listEl.querySelectorAll("[data-action='edit-person']").forEach(btn =>
        btn.addEventListener("click", () =>
          openEditEmployee(btn.dataset.docId, btn.dataset.name))
      );
      listEl.querySelectorAll("[data-action='reset-pwd-person']").forEach(btn =>
        btn.addEventListener("click", () =>
          promptResetPassword(btn.dataset.userId, btn.dataset.name))
      );
      listEl.querySelectorAll("[data-action='move-person']").forEach(btn =>
        btn.addEventListener("click", () =>
          promptMoveEmployee(btn.dataset.docId, btn.dataset.userId, btn.dataset.name))
      );
    } catch { listEl.innerHTML = `<div class="people-empty">Error loading accounts.</div>`; }
  }

  function _renderPersonRow(u, gainMap, showMove) {
    const hasGain  = u.email in gainMap;
    const gain     = gainMap[u.email] ?? 0;
    const gainHtml = hasGain
      ? `<span class="emp-gain ${gain >= 0 ? "gain-pos" : "gain-neg"}">${gain >= 0 ? "+" : ""}${gain.toLocaleString()} RWF</span>`
      : `<span class="emp-gain emp-gain-none">No shifts</span>`;
    const docId    = u.$id;
    const userId   = u.userId || u.$id;
    const safeName = (u.name || "").replace(/"/g, "&quot;");
    return `<div class="people-person-row">
      <div class="people-person-info">
        <span class="people-person-name">${u.name || "—"}</span>
        <span class="people-person-email">${u.email}</span>
      </div>
      ${gainHtml}
      <div class="people-person-actions">
        ${showMove ? `<button class="btn-ghost btn-sm" data-action="move-person" data-doc-id="${docId}" data-user-id="${userId}" data-name="${safeName}">Move</button>` : ""}
        <button class="btn-ghost btn-sm" data-action="edit-person" data-doc-id="${docId}" data-name="${safeName}">Edit</button>
        <button class="btn-reset-pwd" data-action="reset-pwd-person" data-user-id="${userId}" data-name="${safeName}">Reset Pwd</button>
      </div>
    </div>`;
  }

  let _pendingMove = null;

  function promptMoveEmployee(docId, userId, name) {
    _pendingMove = { docId, userId };
    const msgEl = document.getElementById("movePompisteMsg");
    if (msgEl) msgEl.textContent = `Move "${name}" to a different station.`;
    const sel = document.getElementById("moveToStation");
    if (sel) sel.innerHTML = (state.stations ?? []).map(s => `<option value="${s.$id}">${s.name}</option>`).join("");
    openModal("movePompisteModal");
  }

  async function handleMoveEmployee(btn) {
    if (!_pendingMove) { btn.disabled = false; return; }
    const { docId, userId } = _pendingMove;
    _pendingMove = null;
    const newStationId = document.getElementById("moveToStation")?.value;
    if (!newStationId) { btn.disabled = false; return; }
    try {
      await Promise.all([
        apiFetch(`/users/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stationId: newStationId }),
        }),
        apiFetch(`/accounts/${encodeURIComponent(userId)}/prefs`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stationId: newStationId }),
        }),
      ]);
      closeModal("movePompisteModal");
      window._dash.toast("Employee moved successfully.", "success");
      loadAllEmployees();
    } catch (err) {
      window._dash.toast("Error: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  let _setEditUserId = null;

  function openEditEmployee(docId, name) {
    _setEditUserId = docId;
    const nameEl = document.getElementById("editEmpName");
    if (nameEl) nameEl.value = name;
    openDialog("editEmployeePopup");
  }

  async function handleEditEmployee(btn) {
    if (!_setEditUserId) return;
    const name   = document.getElementById("editEmpName")?.value.trim();
    const userId = _setEditUserId;
    btn.disabled = true;
    try {
      const res = await apiFetch(`/users/${userId}`, {
        method: "PATCH",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      closeDialog("editEmployeePopup"); _setEditUserId = null; loadAllEmployees();
    } catch (err) { window._dash.toast(err.message, "error"); }
    finally { btn.disabled = false; }
  }

  let _setResetPwdUserId = null;

  function promptResetPassword(userId, name) {
    _setResetPwdUserId = userId;
    const subEl = document.getElementById("resetPwdPopupSub");
    if (subEl) subEl.textContent = `Set a new password for ${name || "this account"}.`;
    const pwdEl = document.getElementById("set-resetPwdInput");
    if (pwdEl) pwdEl.value = "";
    openDialog("resetPasswordPopup");
  }

  async function handleResetPassword(btn) {
    if (!_setResetPwdUserId) return;
    const pwdEl = document.getElementById("set-resetPwdInput");
    const password = pwdEl?.value || "";
    if (!password || password.length < 8) { window._dash.toast("Password must be at least 8 characters.", "warning"); btn.disabled = false; return; }
    const userId = _setResetPwdUserId; _setResetPwdUserId = null;
    try {
      const res = await apiFetch(`/accounts/${encodeURIComponent(userId)}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      closeDialog("resetPasswordPopup");
      window._dash.toast("Password reset. User will be prompted to change it on next login.", "success");
    } catch (err) { window._dash.toast("Error: " + err.message, "error"); }
    finally { btn.disabled = false; }
  }

  async function handleChangeOwnPassword(btn) {
    const currentPwdEl = document.getElementById("ownCurrentPwd");
    const newPwdEl = document.getElementById("ownNewPwd");
    const confirmPwdEl = document.getElementById("ownConfirmPwd");
    const currentPwd = currentPwdEl?.value;
    const newPwd = newPwdEl?.value;
    const confirmPwd = confirmPwdEl?.value;
    const statusEl = document.getElementById("ownPwdStatus");
    if (!currentPwd || !newPwd || !confirmPwd) { showStatus(statusEl, "All three fields are required.", "error"); btn.disabled = false; return; }
    if (newPwd.length < 8) { showStatus(statusEl, "New password must be at least 8 characters.", "error"); btn.disabled = false; return; }
    if (newPwd !== confirmPwd) { showStatus(statusEl, "New passwords do not match.", "error"); btn.disabled = false; return; }
    try {
      await _AW.account.updatePassword(newPwd, currentPwd);
      if (currentPwdEl) currentPwdEl.value = "";
      if (newPwdEl) newPwdEl.value = "";
      if (confirmPwdEl) confirmPwdEl.value = "";
      showStatus(statusEl, "✓ Password changed successfully.", "success");
    } catch (err) { showStatus(statusEl, "Error: " + err.message, "error"); }
    finally { btn.disabled = false; }
  }

  async function saveCompanyName(btn) {
    const nameEl = document.getElementById("companyName");
    const name   = nameEl?.value.trim();
    const statusEl = document.getElementById("companyStatus");
    if (!name) { showStatus(statusEl, "Company name is required.", "error"); return; }
    const companyId = state.company?.$id;
    if (!companyId) { showStatus(statusEl, "No company found.", "error"); return; }
    btn.disabled = true;
    try {
      const res  = await apiFetch(`/companies/${companyId}`, {
        method: "PATCH",
        body:   JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      state.company.name = name;
      showStatus(statusEl, "✓ Company name saved.", "success");
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  // ─────────────────────────────────────────────────────────
  // PUMPS & NOZZLES
  // ─────────────────────────────────────────────────────────

  const _pumps = {
    stationId:    null,
    selectedPump: null,   // full pump doc
    stations:     [],
  };

  async function initPumpsTab() {
    try {
      const res   = await apiFetch("/stations").then(r => r.json());
      _pumps.stations = res.stations ?? [];

      const row = document.getElementById("pumpsStationRow");
      const sel = document.getElementById("pumpsStationSelect");

      if (state.role === "owner" && _pumps.stations.length > 1) {
        row.style.display = "";
        sel.innerHTML = _pumps.stations.map(s =>
          `<option value="${s.$id}">${s.name}</option>`
        ).join("");
        _pumps.stationId = sel.value;
      } else {
        row.style.display = "none";
        _pumps.stationId = state.profile?.stationId || _pumps.stations[0]?.$id;
      }

      await loadPumps();
    } catch (err) {
      document.getElementById("pumpList").innerHTML =
        `<div class="pumps-empty">Error: ${err.message}</div>`;
    }
  }

  function onPumpsStationChange() {
    _pumps.stationId    = document.getElementById("pumpsStationSelect").value;
    _pumps.selectedPump = null;
    document.getElementById("nozzlePanelTitle").textContent = "Select a pump";
    document.getElementById("addNozzleBtn").style.display   = "none";
    document.getElementById("nozzleList").innerHTML =
      `<div class="loading">Click a pump on the left.</div>`;
    loadPumps();
  }

  async function loadPumps() {
    const list = document.getElementById("pumpList");
    list.innerHTML = `<div class="loading">Loading…</div>`;
    try {
      const res   = await apiFetch(`/pumps?station=${_pumps.stationId}`).then(r => r.json());
      const pumps = res.pumps ?? res.documents ?? [];
      if (!pumps.length) {
        list.innerHTML = `<div class="pumps-empty">No pumps yet. Add one above.</div>`;
        return;
      }
      list.innerHTML = pumps.map(p => renderPumpItem(p)).join("");
      // re-select previously selected pump if still present
      if (_pumps.selectedPump) {
        const still = pumps.find(p => p.$id === _pumps.selectedPump.$id);
        if (still) _pumps.selectedPump = still;
      }
    } catch (err) {
      list.innerHTML = `<div class="pumps-empty">Error: ${err.message}</div>`;
    }
  }

  function fuelPill(type) {
    const cls = type === "PMS" ? "pms" : type === "AGO" ? "ago" : "kero";
    return `<span class="fuel-pill ${cls}">${type}</span>`;
  }

  function renderPumpItem(pump) {
    const sel     = _pumps.selectedPump?.$id === pump.$id ? " selected" : "";
    const inact   = pump.active === false ? " inactive" : "";
    const badge   = pump.active === false
      ? `<span class="pump-status-badge badge-inactive">Off</span>`
      : `<span class="pump-status-badge badge-active">On</span>`;
    const toggleBtn = pump.active === false
      ? `<button class="btn-react" onclick="event.stopPropagation(); window._set.promptTogglePump('${pump.$id}', false)">On</button>`
      : `<button class="btn-deact" onclick="event.stopPropagation(); window._set.promptTogglePump('${pump.$id}', true)">Off</button>`;
    const label   = pump.label || `Pump ${pump.pumpNumber}`;
    return `
      <div class="pump-item${sel}${inact}" onclick="window._set.selectPump('${pump.$id}')">
        <div class="pump-num">${pump.pumpNumber}</div>
        <div class="pump-info">
          <div class="pump-name">${label}</div>
          <div class="pump-fuels">${badge}</div>
        </div>
        <div class="pump-item-actions">
          <button onclick="event.stopPropagation(); window._set.promptEditPump('${pump.$id}', '${(pump.label||"").replace(/'/g,"\\'")}')">Edit</button>
          ${toggleBtn}
        </div>
      </div>`;
  }

  async function selectPump(pumpId) {
    const res   = await apiFetch(`/pumps?station=${_pumps.stationId}`).then(r => r.json());
    const pumps = res.pumps ?? res.documents ?? [];
    const pump  = pumps.find(p => p.$id === pumpId);
    if (!pump) return;

    _pumps.selectedPump = pump;

    // Re-render list to show selection
    document.getElementById("pumpList").innerHTML = pumps.map(p => renderPumpItem(p)).join("");

    // Update right panel header
    const label = pump.label || `Pump ${pump.pumpNumber}`;
    document.getElementById("nozzlePanelTitle").textContent = `Nozzles — ${label}`;
    document.getElementById("addNozzleBtn").style.display   = pump.active !== false ? "" : "none";

    await loadNozzles(pumpId);
  }

  async function loadNozzles(pumpId) {
    const list = document.getElementById("nozzleList");
    list.innerHTML = `<div class="loading">Loading…</div>`;
    try {
      const res     = await apiFetch(`/nozzles?pump=${pumpId}`).then(r => r.json());
      const nozzles = res.nozzles ?? res.documents ?? [];
      if (!nozzles.length) {
        list.innerHTML = `<div class="pumps-empty">No nozzles yet. Add one above.</div>`;
        return;
      }
      list.innerHTML = `
        <table class="nozzle-table">
          <thead><tr>
            <th>#</th><th>Label</th><th>Fuel</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${nozzles.map(n => {
              const inact = n.active === false ? " inactive-row" : "";
              const badge = n.active === false
                ? `<span class="pump-status-badge badge-inactive">Off</span>`
                : `<span class="pump-status-badge badge-active">On</span>`;
              const toggleBtn = n.active === false
                ? `<button class="btn-react" onclick="window._set.promptToggleNozzle('${n.$id}', false)">On</button>`
                : `<button class="btn-deact" onclick="window._set.promptToggleNozzle('${n.$id}', true)">Off</button>`;
              return `<tr class="${inact}">
                <td>${n.nozzleNumber}</td>
                <td>${n.label || `Nozzle ${n.nozzleNumber}`}</td>
                <td>${fuelPill(n.fuelType)}</td>
                <td>${badge}</td>
                <td><div class="row-actions">
                  <button onclick="window._set.promptEditNozzle('${n.$id}','${(n.label||"").replace(/'/g,"\\'")}','${n.fuelType}')">Edit</button>
                  ${toggleBtn}
                </div></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;
    } catch (err) {
      list.innerHTML = `<div class="pumps-empty">Error: ${err.message}</div>`;
    }
  }

  // ── Add Pump ──────────────────────────────────────────────
  function promptAddPump() {
    document.getElementById("pumpLabelInput").value = "";
    openModal("addPumpModal");
  }

  async function handleAddPump(btn) {
    const label = document.getElementById("pumpLabelInput").value.trim();
    const statusEl = document.getElementById("pumpsStatus");
    try {
      const existing = await apiFetch(`/pumps?station=${_pumps.stationId}`).then(r => r.json());
      const pumps = existing.pumps ?? existing.documents ?? [];
      const pumpNumber = pumps.length > 0 ? Math.max(...pumps.map(p => p.pumpNumber || 0)) + 1 : 1;

      await apiFetch("/pumps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationId:  _pumps.stationId,
          companyId:  state.company?.$id,
          pumpNumber,
          order:      pumpNumber,
          label:      label || `Pump ${pumpNumber}`,
        }),
      });
      closeModal("addPumpModal");
      showStatus(statusEl, "✓ Pump added.", "success");
      await loadPumps();
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    } finally { btn.disabled = false; }
  }

  // ── Edit Pump ─────────────────────────────────────────────
  function promptEditPump(id, label) {
    document.getElementById("editPumpLabelInput").value = label;
    document.getElementById("confirmEditPumpBtn").dataset.id = id;
    openModal("editPumpModal");
  }

  async function handleEditPump(btn) {
    const id    = document.getElementById("confirmEditPumpBtn").dataset.id;
    const label = document.getElementById("editPumpLabelInput").value.trim();
    const statusEl = document.getElementById("pumpsStatus");
    try {
      await apiFetch(`/pumps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      closeModal("editPumpModal");
      showStatus(statusEl, "✓ Pump updated.", "success");
      await loadPumps();
      if (_pumps.selectedPump?.$id === id) await selectPump(id);
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    } finally { btn.disabled = false; }
  }

  // ── Toggle Pump ───────────────────────────────────────────
  function promptTogglePump(id, currentlyActive) {
    const action = currentlyActive ? "Deactivate" : "Reactivate";
    document.getElementById("togglePumpTitle").textContent = `${action} Pump?`;
    document.getElementById("togglePumpSub").textContent =
      currentlyActive
        ? "Deactivating will also hide this pump from pompistes. Existing readings are kept."
        : "This pump will become visible to pompistes again.";
    document.getElementById("confirmTogglePump").dataset.id     = id;
    document.getElementById("confirmTogglePump").dataset.active = currentlyActive ? "1" : "0";
    openDialog("togglePumpPopup");
  }

  async function handleTogglePump(btn) {
    const id     = btn.dataset.id;
    const active = btn.dataset.active !== "1";
    const statusEl = document.getElementById("pumpsStatus");
    try {
      await apiFetch(`/pumps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      closeDialog("togglePumpPopup");
      showStatus(statusEl, `✓ Pump ${active ? "activated" : "deactivated"}.`, "success");
      await loadPumps();
      if (_pumps.selectedPump?.$id === id) await selectPump(id);
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    } finally { btn.disabled = false; }
  }

  // ── Add Nozzle ────────────────────────────────────────────
  function promptAddNozzle() {
    document.getElementById("nozzleLabelInput").value      = "";
    document.getElementById("nozzleFuelTypeInput").value   = "PMS";
    openModal("addNozzleModal");
  }

  async function handleAddNozzle(btn) {
    const fuelType = document.getElementById("nozzleFuelTypeInput").value;
    const label    = document.getElementById("nozzleLabelInput").value.trim();
    const pump     = _pumps.selectedPump;
    const statusEl = document.getElementById("pumpsStatus");
    if (!pump) { showStatus(statusEl, "Select a pump first.", "error"); btn.disabled = false; return; }
    try {
      const existing = await apiFetch(`/nozzles?pump=${pump.$id}`).then(r => r.json());
      const nozzles = existing.nozzles ?? existing.documents ?? [];
      const nozzleNumber = nozzles.length > 0 ? Math.max(...nozzles.map(n => n.nozzleNumber || 0)) + 1 : 1;

      await apiFetch("/nozzles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pumpId:       pump.$id,
          stationId:    _pumps.stationId,
          companyId:    state.company?.$id,
          nozzleNumber,
          fuelType,
          label:        label || `Nozzle ${nozzleNumber}`,
        }),
      });
      closeModal("addNozzleModal");
      showStatus(statusEl, "✓ Nozzle added.", "success");
      await loadNozzles(pump.$id);
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    } finally { btn.disabled = false; }
  }

  // ── Edit Nozzle ───────────────────────────────────────────
  function promptEditNozzle(id, label, fuelType) {
    document.getElementById("editNozzleLabelInput").value    = label;
    document.getElementById("editNozzleFuelTypeInput").value = fuelType;
    document.getElementById("confirmEditNozzleBtn").dataset.id = id;
    openModal("editNozzleModal");
  }

  async function handleEditNozzle(btn) {
    const id       = document.getElementById("confirmEditNozzleBtn").dataset.id;
    const fuelType = document.getElementById("editNozzleFuelTypeInput").value;
    const label    = document.getElementById("editNozzleLabelInput").value.trim();
    const statusEl = document.getElementById("pumpsStatus");
    try {
      await apiFetch(`/nozzles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuelType, label }),
      });
      closeModal("editNozzleModal");
      showStatus(statusEl, "✓ Nozzle updated.", "success");
      if (_pumps.selectedPump) await loadNozzles(_pumps.selectedPump.$id);
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    } finally { btn.disabled = false; }
  }

  // ── Toggle Nozzle ─────────────────────────────────────────
  function promptToggleNozzle(id, currentlyActive) {
    const action = currentlyActive ? "Deactivate" : "Reactivate";
    document.getElementById("toggleNozzleTitle").textContent = `${action} Nozzle?`;
    document.getElementById("toggleNozzleSub").textContent =
      currentlyActive
        ? "This nozzle will be hidden from pompistes."
        : "This nozzle will become visible to pompistes again.";
    document.getElementById("confirmToggleNozzle").dataset.id     = id;
    document.getElementById("confirmToggleNozzle").dataset.active = currentlyActive ? "1" : "0";
    openDialog("toggleNozzlePopup");
  }

  async function handleToggleNozzle(btn) {
    const id     = btn.dataset.id;
    const active = btn.dataset.active !== "1";
    const statusEl = document.getElementById("pumpsStatus");
    try {
      await apiFetch(`/nozzles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      closeDialog("toggleNozzlePopup");
      showStatus(statusEl, `✓ Nozzle ${active ? "activated" : "deactivated"}.`, "success");
      if (_pumps.selectedPump) await loadNozzles(_pumps.selectedPump.$id);
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    } finally { btn.disabled = false; }
  }

  function openModal(id)  { const el = document.getElementById(id); if (el) el.style.display = "flex"; }
  function closeModal(id) { const el = document.getElementById(id); if (el) el.style.display = "none"; }

  // ─────────────────────────────────────────────────────────
  // WORK DEVICES
  // ─────────────────────────────────────────────────────────

  const DEVICE_KEY = "rp_device_token";
  let _thisDeviceDocId = null;

  async function initDevicesTab() {
    // Populate station selector (owner only)
    const stationRow = document.getElementById("deviceStationRow");
    const stationSel = document.getElementById("deviceStationSelect");
    if (state.role === "owner" && stationRow && stationSel) {
      stationRow.style.display = "";
      stationSel.innerHTML = (state.stations ?? []).map(s =>
        `<option value="${s.$id}">${s.name}</option>`
      ).join("");
    } else if (stationRow) {
      stationRow.style.display = "none";
    }

    await _checkThisDevice();
    await _loadAllDevices();
  }

  async function _checkThisDevice() {
    const token     = localStorage.getItem(DEVICE_KEY);
    const statusEl  = document.getElementById("deviceCurrentStatus");
    const revokeBtn = document.getElementById("revokeThisDeviceBtn");
    if (!statusEl) return;

    if (!token) {
      statusEl.innerHTML = `<span class="device-status-badge device-unregistered">Not registered</span>`;
      if (revokeBtn) revokeBtn.style.display = "none";
      _thisDeviceDocId = null;
      return;
    }

    try {
      const data = await apiFetch(`/devices`).then(r => r.json());
      const match = (data.devices ?? []).find(d => d.token === token);
      if (match) {
        _thisDeviceDocId = match.$id;
        const stNm = (window._dash.state.stations ?? []).find(s => s.$id === match.stationId)?.name || "—";
        statusEl.innerHTML = `<span class="device-status-badge device-registered">Registered</span>
          <span class="device-status-label">${match.label || "This device"} · ${stNm}</span>`;
        if (revokeBtn) revokeBtn.style.display = "";
      } else {
        localStorage.removeItem(DEVICE_KEY);
        statusEl.innerHTML = `<span class="device-status-badge device-unregistered">Token not found on server — cleared</span>`;
        if (revokeBtn) revokeBtn.style.display = "none";
        _thisDeviceDocId = null;
      }
    } catch {
      statusEl.innerHTML = `<span class="device-status-badge" style="background:#f1f5f9;">Could not check status</span>`;
    }
  }

  async function registerThisDevice() {
    const statusEl  = document.getElementById("deviceRegStatus");
    const stationId = state.role === "owner"
      ? document.getElementById("deviceStationSelect")?.value
      : state.profile.stationId;
    const label = document.getElementById("deviceLabel")?.value.trim() || "Work Computer";

    if (!stationId) { showStatus(statusEl, "Select a station first.", "error"); return; }

    let token = localStorage.getItem(DEVICE_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, token);
    }

    try {
      const res  = await apiFetch("/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, stationId, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showStatus(statusEl, "✓ Device registered.", "success");
      await _checkThisDevice();
      await _loadAllDevices();
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    }
  }

  async function revokeThisDevice() {
    if (!_thisDeviceDocId) return;
    const statusEl = document.getElementById("deviceRegStatus");
    try {
      const res = await apiFetch(`/devices/${_thisDeviceDocId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      localStorage.removeItem(DEVICE_KEY);
      _thisDeviceDocId = null;
      showStatus(statusEl, "Device revoked.", "success");
      await _checkThisDevice();
      await _loadAllDevices();
    } catch (err) {
      showStatus(statusEl, "Error: " + err.message, "error");
    }
  }

  async function _loadAllDevices() {
    const listEl = document.getElementById("devicesList");
    if (!listEl) return;
    listEl.innerHTML = `<div class="loading">Loading...</div>`;
    try {
      const data = await apiFetch("/devices").then(r => r.json());
      const devices = data.devices ?? [];
      if (!devices.length) {
        listEl.innerHTML = `<div class="people-empty">No devices registered yet.</div>`;
        return;
      }

      const stationNameMap = {};
      (state.stations ?? []).forEach(s => { stationNameMap[s.$id] = s.name; });

      listEl.innerHTML = devices.map(d => `
        <div class="people-person-row">
          <div class="people-person-info">
            <span class="people-person-name">${d.label || "Work Computer"}</span>
            <span class="people-person-email">${stationNameMap[d.stationId] || "—"} · registered by ${d.registeredBy || "—"}</span>
          </div>
          <span class="device-status-badge ${d.token === localStorage.getItem(DEVICE_KEY) ? "device-registered" : "device-other"}">
            ${d.token === localStorage.getItem(DEVICE_KEY) ? "This device" : "Other device"}
          </span>
          <div class="people-person-actions">
            <button class="btn-danger btn-sm" data-device-id="${d.$id}">Revoke</button>
          </div>
        </div>`).join("");

      listEl.querySelectorAll("[data-device-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            const res = await apiFetch(`/devices/${btn.dataset.deviceId}`, { method: "DELETE" });
            if (!res.ok) throw new Error((await res.json()).error);
            if (btn.dataset.deviceId === _thisDeviceDocId) {
              localStorage.removeItem(DEVICE_KEY);
            }
            await _checkThisDevice();
            await _loadAllDevices();
          } catch (err) {
            window._dash.toast("Error: " + err.message, "error");
            btn.disabled = false;
          }
        });
      });
    } catch {
      listEl.innerHTML = `<div class="people-empty">Error loading devices.</div>`;
    }
  }

  // Register
  window._sections.settings = function loadSettings() {
    const { state } = window._dash;
    if (state.company) {
      const el = document.getElementById("companyName");
      if (el) el.value = state.company.name || "";
    }
    loadFuelSettings();
  };

  // Expose for onclick attributes in HTML
  window._set = {
    switchTab, saveCompanyName, handleSavePrices, promptCreateTeam, handleCreateTeam,
    promptDeleteTeam, handleDeleteTeam, toggleTeam,
    promptAddMember, handleAddMember, promptRemoveMember, handleRemoveMember,
    promptCreateEmployee, handleCreateEmployee, openEditEmployee, handleEditEmployee,
    promptResetPassword, handleResetPassword, handleChangeOwnPassword,
    promptMoveEmployee, handleMoveEmployee,
    registerThisDevice, revokeThisDevice,
    // pumps & nozzles
    onPumpsStationChange,
    selectPump,
    promptAddPump,    handleAddPump,
    promptEditPump,   handleEditPump,
    promptTogglePump, handleTogglePump,
    promptAddNozzle,    handleAddNozzle,
    promptEditNozzle,   handleEditNozzle,
    promptToggleNozzle, handleToggleNozzle,
  };

})();
