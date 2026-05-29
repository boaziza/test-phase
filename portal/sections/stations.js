(function () {

  let _editingStationId   = null;
  let _archivingStationId = null;

  const { openModal, closeModal, toast, apiFetch, state } = window._dash;

  // ── Load ──────────────────────────────────────────────────────────────────
  window._sections.stations = async function loadStations() {
    const listEl       = document.getElementById("stationsList");
    const showArchived = document.getElementById("showArchivedToggle")?.checked || false;
    if (listEl) listEl.innerHTML = "<div class='loading-state'>Loading…</div>";
    try {
      const res  = await apiFetch("/stations" + (showArchived ? "?archived=true" : ""));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load stations");

      const all = data.stations || [];
      // Active stations go into state; archived are display-only
      if (!showArchived) state.stations = all.filter(s => !s.archived);
      const display = showArchived ? all.filter(s => s.archived) : state.stations;

      if (display.length === 0) {
        if (listEl) listEl.innerHTML = showArchived
          ? "<div class='empty-state'>No archived stations.</div>"
          : "<div class='empty-state'>No stations yet. Click + Add Station.</div>";
        return;
      }

      if (listEl) listEl.innerHTML = display.map(s => `
        <div class="station-card" data-id="${s.$id}" ${s.archived ? 'style="opacity:0.6;"' : ""}>
          <div class="station-card-name">${s.name} ${s.archived ? '<span class="badge" style="font-size:10px;">Archived</span>' : ""}</div>
          <div class="station-card-address">${s.address || "No address"}</div>
          ${s.momoFee != null ? `<div class="station-card-momo">MoMo Fee: ${s.momoFee}%</div>` : ""}
          <div class="station-card-actions">
            ${s.archived
              ? `<button class="btn-ghost btn-sm" data-action="restore-station" data-id="${s.$id}" data-name="${s.name}">Restore</button>`
              : `<button class="btn-ghost btn-sm" data-action="view-station" data-id="${s.$id}">View</button>
                 <button class="btn-ghost btn-sm" data-action="edit-station" data-id="${s.$id}">Edit</button>
                 <button class="btn-danger btn-sm" data-action="archive-station" data-id="${s.$id}" data-name="${s.name}">Archive</button>`
            }
          </div>
        </div>
      `).join("");

      listEl.querySelectorAll("[data-action='view-station']").forEach(btn =>
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const station = state.stations.find(s => s.$id === btn.dataset.id);
          if (station) window._dash.enterStationView(station);
        })
      );

      listEl.querySelectorAll("[data-action='edit-station']").forEach(btn =>
        btn.addEventListener("click", e => {
          e.stopPropagation();
          const station = state.stations.find(s => s.$id === btn.dataset.id);
          if (!station) return;
          _editingStationId = station.$id;
          document.getElementById("editStationName").value    = station.name    || "";
          document.getElementById("editStationAddress").value = station.address || "";
          document.getElementById("editStationMomo").value    = station.momoFee ?? "";
          openModal("editStationModal");
        })
      );

      listEl.querySelectorAll("[data-action='archive-station']").forEach(btn =>
        btn.addEventListener("click", e => {
          e.stopPropagation();
          _archivingStationId = btn.dataset.id;
          document.getElementById("archiveStationMsg").textContent =
            `Are you sure you want to archive "${btn.dataset.name}"? It will no longer appear in the dashboard.`;
          openModal("archiveStationModal");
        })
      );

      listEl.querySelectorAll("[data-action='restore-station']").forEach(btn =>
        btn.addEventListener("click", async e => {
          e.stopPropagation();
          btn.disabled = true;
          try {
            const res = await apiFetch(`/stations/${btn.dataset.id}`, {
              method: "PATCH",
              body:   JSON.stringify({ archived: false }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Failed");
            toast(`"${btn.dataset.name}" restored.`, "success");
            window._dash.reload("stations");
          } catch (err) {
            toast(err.message || "Could not restore station.", "error");
          } finally {
            btn.disabled = false;
          }
        })
      );

    } catch (err) {
      toast("Could not load stations: " + err.message, "error");
    }
  };

  // ── Add ───────────────────────────────────────────────────────────────────
  document.getElementById("showArchivedToggle")?.addEventListener("change", () => {
    window._dash.reload("stations");
  });

  document.getElementById("addStationBtn")?.addEventListener("click", () => {
    document.getElementById("addStationName").value    = "";
    document.getElementById("addStationAddress").value = "";
    document.getElementById("addStationMomo").value    = "";
    openModal("addStationModal");
  });

  document.getElementById("confirmAddStationBtn")?.addEventListener("click", async () => {
    const name    = document.getElementById("addStationName").value.trim();
    const address = document.getElementById("addStationAddress").value.trim();
    const momoFee = parseFloat(document.getElementById("addStationMomo").value) || 0;
    if (!name) { toast("Station name is required.", "warning"); return; }

    const btn = document.getElementById("confirmAddStationBtn");
    btn.disabled = true;
    try {
      const res  = await apiFetch("/stations", {
        method: "POST",
        body:   JSON.stringify({ name, address, momoFee, company: state.profile.companyId, archived: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      closeModal("addStationModal");
      toast(`Station "${name}" added.`, "success");
      window._dash.reload("stations");
    } catch (err) {
      toast(err.message || "Could not add station.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── Edit ──────────────────────────────────────────────────────────────────
  document.getElementById("confirmEditStationBtn")?.addEventListener("click", async () => {
    const name    = document.getElementById("editStationName").value.trim();
    const address = document.getElementById("editStationAddress").value.trim();
    const momoFee = parseFloat(document.getElementById("editStationMomo").value) || 0;
    if (!name) { toast("Station name is required.", "warning"); return; }

    const btn = document.getElementById("confirmEditStationBtn");
    btn.disabled = true;
    try {
      const res  = await apiFetch(`/stations/${_editingStationId}`, {
        method: "PATCH",
        body:   JSON.stringify({ name, address, momoFee }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      closeModal("editStationModal");
      toast("Station updated.", "success");
      window._dash.reload("stations");
    } catch (err) {
      toast(err.message || "Could not update station.", "error");
    } finally {
      btn.disabled = false;
    }
  });

  // ── Archive ───────────────────────────────────────────────────────────────
  document.getElementById("confirmArchiveStationBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("confirmArchiveStationBtn");
    btn.disabled = true;
    try {
      const res  = await apiFetch(`/stations/${_archivingStationId}`, {
        method: "PATCH",
        body:   JSON.stringify({ archived: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      closeModal("archiveStationModal");
      toast("Station archived.", "success");
      window._dash.reload("stations");
    } catch (err) {
      toast(err.message || "Could not archive station.", "error");
    } finally {
      btn.disabled = false;
    }
  });

})();
