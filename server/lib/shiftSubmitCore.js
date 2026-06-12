// ── Shared shift-submission core ────────────────────────────────────────────
// Used by both POST /shift-submit (single shift, pompiste device) and
// POST /shift-import-batch (owner/manager offline-CSV backfill, multiple
// shifts for a day in one call). Performs the same upserts/creates with the
// same per-shift rollback-on-error guarantee.

// ── Rollback ──────────────────────────────────────────────────────────────────
// created  = [{ col, id }]            → delete these docs
// patched  = [{ col, id, snapshot }]  → restore these docs to their old values
async function rollback(db, DB, created, patched) {
  for (const { col, id, snapshot } of [...patched].reverse()) {
    try { await db.updateDocument(DB, col, id, snapshot); } catch { /* best-effort */ }
  }
  for (const { col, id } of [...created].reverse()) {
    try { await db.deleteDocument(DB, col, id); } catch { /* best-effort */ }
  }
}

/**
 * Runs the full per-shift write pipeline (nozzle readings, daily report,
 * payments, fiche, loans, gain, situation) with rollback on failure.
 *
 * @param {object} opts
 * @param {object} opts.db      Appwrite Databases client
 * @param {object} opts.ID      Appwrite ID helper
 * @param {object} opts.Query   Appwrite Query helper
 * @param {string} opts.DB      Database ID
 * @param {object} opts.ids     Collection IDs: { C_GAIN, C_NOZZLE, C_SIT, C_REPORT, C_PAY, C_FICHE, C_LOANS }
 * @param {object} opts.data    Shift payload (companyId, stationId, email, employeeName, userId,
 *                               shift, logDate, monthYear, shiftKey, startTime, endTime,
 *                               nozzleReadings, gainPayments, payments, totals, fiche, loans)
 * @param {object|null} opts.existingSituation  The current situation doc for this logDate, or null.
 * @returns {{ reportId: string, situationDoc: object }}
 */
async function submitShiftCore({ db, ID, Query, DB, ids, data, existingSituation }) {
  const { C_GAIN, C_NOZZLE, C_SIT, C_REPORT, C_PAY, C_FICHE, C_LOANS } = ids;
  const {
    companyId, stationId, email, employeeName, userId,
    shift, logDate, monthYear, shiftKey,
    startTime = '', endTime = '',
    nozzleReadings = [],
    gainPayments   = 0,
    payments       = {},
    totals         = {},
    fiche          = [],
    loans          = [],
  } = data;

  const created = [];
  const patched = [];

  try {
    // ── 1. Nozzle readings (upsert) ───────────────────────────────────────────
    const activeReadings = nozzleReadings.filter(r => r.startReading > 0 || r.endReading > 0);
    for (const r of activeReadings) {
      const nozzleShiftKey = `${r.nozzleId}_${logDate}_${shift}`;
      const existing = await db.listDocuments(DB, C_NOZZLE, [
        Query.equal('shiftKey', nozzleShiftKey), Query.limit(1),
      ]);
      const payload = {
        nozzleId: r.nozzleId, pumpId: r.pumpId, stationId, companyId,
        fuelType: r.fuelType, pumpNumber: r.pumpNumber, nozzleNumber: r.nozzleNumber,
        startReading: r.startReading, endReading: r.endReading, venteLitres: r.venteLitres,
        logDate, shift, userId, email, employeeName,
        shiftKey: nozzleShiftKey,
      };
      if (existing.documents.length > 0) {
        const old = existing.documents[0];
        patched.push({ col: C_NOZZLE, id: old.$id, snapshot: {
          startReading: old.startReading, endReading: old.endReading, venteLitres: old.venteLitres,
        }});
        await db.updateDocument(DB, C_NOZZLE, old.$id, payload);
      } else {
        const doc = await db.createDocument(DB, C_NOZZLE, ID.unique(), payload);
        created.push({ col: C_NOZZLE, id: doc.$id });
      }
    }

    // ── 2. Daily report ───────────────────────────────────────────────────────
    const report = await db.createDocument(DB, C_REPORT, ID.unique(), {
      companyId, stationId, email,
      employeeName, shift, logDate, shiftKey,
      startTime, endTime,
      pmsPrice:       totals.pmsPrice,
      agoPrice:       totals.agoPrice,
      totalPms:       totals.totalPms       || 0,
      totalAgo:       totals.totalAgo       || 0,
      totalVente:     totals.totalVente     || 0,
      venteLitresPms: totals.venteLitresPms || 0,
      venteLitresAgo: totals.venteLitresAgo || 0,
    });
    created.push({ col: C_REPORT, id: report.$id });

    // ── 3. Payments ───────────────────────────────────────────────────────────
    const pay = await db.createDocument(DB, C_PAY, ID.unique(), {
      companyId, stationId, email, employeeName,
      shift, logDate, shiftKey,
      momo:          payments.momo          || 0,
      momoLoss:      payments.momoLoss      || 0,
      totalFiche:    payments.totalFiche    || 0,
      bon:           payments.bon           || 0,
      spFuelCard:    payments.spFuelCard    || 0,
      bankCard:      payments.bankCard      || 0,
      cash5000:      payments.cash5000      || 0,
      cash2000:      payments.cash2000      || 0,
      cash1000:      payments.cash1000      || 0,
      cash500:       payments.cash500       || 0,
      totalCash:     payments.totalCash     || 0,
      totalPayments: payments.totalPayments || 0,
      gainPayments,
      totalLoans:    payments.totalLoans    || 0,
      totalVente:    totals.totalVente      || 0,
      listBC:        (payments.listBC  || []).map(v => String(v)),
      listSFC:       (payments.listSFC || []).map(v => String(v)),
    });
    created.push({ col: C_PAY, id: pay.$id });

    // ── 4. Fiche entries ──────────────────────────────────────────────────────
    for (const item of fiche) {
      const f = await db.createDocument(DB, C_FICHE, ID.unique(), {
        companyId, stationId, email, employeeName,
        shift, logDate, shiftKey,
        plate:        item.plate        || '',
        amount:       item.amount       || 0,
        customerId:   item.customerId   || '',
        customerName: item.customerName || item.company || '',
      });
      created.push({ col: C_FICHE, id: f.$id });
    }

    // ── 5. Loan entries ───────────────────────────────────────────────────────
    for (const item of loans) {
      const l = await db.createDocument(DB, C_LOANS, ID.unique(), {
        companyId, stationId, email, employeeName,
        shift, logDate, shiftKey, monthYear,
        plate:        item.plate        || '',
        amount:       item.amount       || 0,
        customerId:   item.customerId   || '',
        customerName: item.customerName || item.company || '',
      });
      created.push({ col: C_LOANS, id: l.$id });
    }

    // ── 6. Gain (upsert) — snapshot before patching ───────────────────────────
    const gainKey      = `${stationId}_${userId}_${monthYear}`;
    const existingGain = await db.listDocuments(DB, C_GAIN, [
      Query.equal('gainKey', gainKey), Query.limit(1),
    ]);
    if (existingGain.documents.length > 0) {
      const g = existingGain.documents[0];
      patched.push({ col: C_GAIN, id: g.$id, snapshot: { gainPayments: g.gainPayments } });
      await db.updateDocument(DB, C_GAIN, g.$id, {
        gainPayments: (g.gainPayments || 0) + gainPayments,
      });
    } else {
      const g = await db.createDocument(DB, C_GAIN, ID.unique(), {
        gainKey, gainPayments, companyId, stationId, userId,
        email, employeeName, monthYear, logDate,
      });
      created.push({ col: C_GAIN, id: g.$id });
    }

    // ── 7. Situation (create/patch) — snapshot before patching ───────────────
    const sitAccum = (existing) => ({
      momo:           (payments.momo          || 0) + (existing.momo           || 0),
      momoLoss:       (payments.momoLoss      || 0) + (existing.momoLoss       || 0),
      totalFiche:     (payments.totalFiche    || 0) + (existing.totalFiche     || 0),
      bon:            (payments.bon           || 0) + (existing.bon            || 0),
      spFuelCard:     (payments.spFuelCard    || 0) + (existing.spFuelCard     || 0),
      bankCard:       (payments.bankCard      || 0) + (existing.bankCard       || 0),
      totalCash:      (payments.totalCash     || 0) + (existing.totalCash      || 0),
      totalLoans:     (payments.totalLoans    || 0) + (existing.totalLoans     || 0),
      totalPayments:  (payments.totalPayments || 0) + (existing.totalPayments  || 0),
      gainPayments:   gainPayments                  + (existing.gainPayments   || 0),
      venteLitresPms: (totals.venteLitresPms  || 0) + (existing.venteLitresPms || 0),
      totalPms:       (totals.totalPms        || 0) + (existing.totalPms       || 0),
      venteLitresAgo: (totals.venteLitresAgo  || 0) + (existing.venteLitresAgo || 0),
      totalAgo:       (totals.totalAgo        || 0) + (existing.totalAgo       || 0),
      totalVente:     (totals.totalVente      || 0) + (existing.totalVente     || 0),
      pmsPrice:       totals.pmsPrice,
      agoPrice:       totals.agoPrice,
    });

    let situationDoc;
    if (!existingSituation) {
      const sitKey = `${stationId}_${logDate}`;
      const sit = await db.createDocument(DB, C_SIT, ID.unique(), {
        companyId, stationId, situationKey: sitKey, logDate,
        pmsPrice:       totals.pmsPrice,
        agoPrice:       totals.agoPrice,
        momo:           payments.momo          || 0,
        momoLoss:       payments.momoLoss      || 0,
        totalFiche:     payments.totalFiche    || 0,
        bon:            payments.bon           || 0,
        spFuelCard:     payments.spFuelCard    || 0,
        bankCard:       payments.bankCard      || 0,
        totalCash:      payments.totalCash     || 0,
        totalLoans:     payments.totalLoans    || 0,
        totalPayments:  payments.totalPayments || 0,
        gainPayments,
        venteLitresPms: totals.venteLitresPms  || 0,
        totalPms:       totals.totalPms        || 0,
        venteLitresAgo: totals.venteLitresAgo  || 0,
        totalAgo:       totals.totalAgo        || 0,
        totalVente:     totals.totalVente      || 0,
      });
      created.push({ col: C_SIT, id: sit.$id });
      situationDoc = sit;
    } else {
      patched.push({ col: C_SIT, id: existingSituation.$id, snapshot: {
        momo:           existingSituation.momo,           momoLoss:       existingSituation.momoLoss,
        totalFiche:     existingSituation.totalFiche,     bon:            existingSituation.bon,
        spFuelCard:     existingSituation.spFuelCard,     bankCard:       existingSituation.bankCard,
        totalCash:      existingSituation.totalCash,      totalLoans:     existingSituation.totalLoans,
        totalPayments:  existingSituation.totalPayments,  gainPayments:   existingSituation.gainPayments,
        venteLitresPms: existingSituation.venteLitresPms, totalPms:       existingSituation.totalPms,
        venteLitresAgo: existingSituation.venteLitresAgo, totalAgo:       existingSituation.totalAgo,
        totalVente:     existingSituation.totalVente,     pmsPrice:       existingSituation.pmsPrice,
        agoPrice:       existingSituation.agoPrice,
      }});
      const accumPayload = sitAccum(existingSituation);
      await db.updateDocument(DB, C_SIT, existingSituation.$id, accumPayload);
      situationDoc = { ...existingSituation, ...accumPayload };
    }

    return { reportId: report.$id, situationDoc };
  } catch (err) {
    await rollback(db, DB, created, patched);
    throw err;
  }
}

module.exports = { submitShiftCore };
