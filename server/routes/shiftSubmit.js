const express = require('express');
const router  = express.Router();
const { db, ID, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { requireDevice }          = require('../middleware/deviceAuth');

const DB       = process.env.APPWRITE_DATABASE_ID;
const C_GAIN   = process.env.APPWRITE_GAIN_ID;
const C_NOZZLE = process.env.APPWRITE_NOZZLE_READINGS_ID;
const C_SIT    = process.env.APPWRITE_SITUATION_ID;
const C_REPORT = process.env.APPWRITE_DAILY_REPORTS_ID;
const C_PAY    = process.env.APPWRITE_PAYMENTS_ID;
const C_FICHE  = process.env.APPWRITE_FICHE_ID;
const C_LOANS  = process.env.APPWRITE_LOANS_ID;

// ── Rollback ──────────────────────────────────────────────────────────────────
// created  = [{ col, id }]            → delete these docs
// patched  = [{ col, id, snapshot }]  → restore these docs to their old values
async function rollback(created, patched) {
  for (const { col, id, snapshot } of [...patched].reverse()) {
    try { await db.updateDocument(DB, col, id, snapshot); } catch { /* best-effort */ }
  }
  for (const { col, id } of [...created].reverse()) {
    try { await db.deleteDocument(DB, col, id); } catch { /* best-effort */ }
  }
}

router.post('/', verifyJWT, requireDevice, requireRole(['pompiste']), async (req, res) => {
  const {
    shift, logDate, monthYear,
    startTime = '', endTime = '',
    employeeName,
    nozzleReadings = [],
    gainPayments   = 0,
    payments       = {},
    totals         = {},
    fiche          = [],
    loans          = [],
  } = req.body;

  // Trust the authenticated session, not whatever the client claims to be
  const email     = req.user.email;
  const companyId = req.user.companyId;
  const stationId = req.user.stationId;
  const userId    = req.user.$id;

  // ── Validate ─────────────────────────────────────────────────────────────
  const missing = ['shift','logDate','monthYear']
    .filter(k => !req.body[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }
  if (!stationId) {
    return res.status(400).json({ error: 'No station assigned to this account.' });
  }

  const VALID_SHIFTS = ['Morning','Afternoon','Evening','Night'];
  if (!VALID_SHIFTS.includes(shift)) {
    return res.status(400).json({ error: `Invalid shift: ${shift}` });
  }

  const shiftKey = `${email}_${logDate}_${shift}`;

  // ── Duplicate check ───────────────────────────────────────────────────────
  const dupCheck = await db.listDocuments(DB, C_REPORT, [
    Query.equal('shiftKey', shiftKey), Query.limit(1),
  ]);
  if (dupCheck.documents.length > 0) {
    return res.status(409).json({ error: 'You already submitted this shift.' });
  }

  // ── Situation existence check ─────────────────────────────────────────────
  const sitKey      = `${stationId}_${logDate}`;
  const sitExisting = await db.listDocuments(DB, C_SIT, [
    Query.equal('situationKey', sitKey), Query.limit(1),
  ]);
  if (shift !== 'Morning' && sitExisting.documents.length === 0) {
    return res.status(400).json({ error: 'No situation found for this date. Morning shift must be submitted first.' });
  }

  // ── Gain existence check (snapshot before any writes) ─────────────────────
  const gainKey      = `${stationId}_${userId}_${monthYear}`;
  const existingGain = await db.listDocuments(DB, C_GAIN, [
    Query.equal('gainKey', gainKey), Query.limit(1),
  ]);

  const created = []; // new docs  → delete on rollback
  const patched = []; // updated docs → restore snapshot on rollback

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

    if (shift === 'Morning' && sitExisting.documents.length === 0) {
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
    } else {
      const sitDoc = sitExisting.documents[0];
      patched.push({ col: C_SIT, id: sitDoc.$id, snapshot: {
        momo:           sitDoc.momo,           momoLoss:       sitDoc.momoLoss,
        totalFiche:     sitDoc.totalFiche,     bon:            sitDoc.bon,
        spFuelCard:     sitDoc.spFuelCard,     bankCard:       sitDoc.bankCard,
        totalCash:      sitDoc.totalCash,      totalLoans:     sitDoc.totalLoans,
        totalPayments:  sitDoc.totalPayments,  gainPayments:   sitDoc.gainPayments,
        venteLitresPms: sitDoc.venteLitresPms, totalPms:       sitDoc.totalPms,
        venteLitresAgo: sitDoc.venteLitresAgo, totalAgo:       sitDoc.totalAgo,
        totalVente:     sitDoc.totalVente,     pmsPrice:       sitDoc.pmsPrice,
        agoPrice:       sitDoc.agoPrice,
      }});
      await db.updateDocument(DB, C_SIT, sitDoc.$id, sitAccum(sitDoc));
    }

    res.status(201).json({ ok: true, shiftKey });

  } catch (err) {
    await rollback(created, patched);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
