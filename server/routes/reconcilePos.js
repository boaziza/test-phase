const express = require('express');
const router  = express.Router();
const { db, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const DB        = process.env.APPWRITE_DATABASE_ID;
const SIT_COL   = process.env.APPWRITE_SITUATION_ID;
const NOZ_COL   = process.env.APPWRITE_NOZZLE_READINGS_ID;
const FICHE_COL = process.env.APPWRITE_FICHE_ID;

const AMT_TOL = 200;  // RWF rounding buffer
const VOL_TOL = 0.5;  // litres sensor precision buffer

function sumWhere(rows, filterFn, valueFn) {
  return rows.filter(filterFn).reduce((s, r) => s + valueFn(r), 0);
}

// POST /api/reconcile-pos
// Body: { date: "YYYY-MM-DD", stationId?: string, csvRows: [{method, amount, volume, fuelType, customerId}] }
// csvRows should be pre-filtered client-side to the selected date only (keeps payload small under the 50kb body limit)
router.post('/', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const { date, csvRows = [], stationId: clientStation } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    if (!Array.isArray(csvRows) || csvRows.length === 0)
      return res.status(400).json({ error: 'csvRows must be a non-empty array' });

    const stationId = req.user.role === 'owner'
      ? (clientStation || req.user.stationId)
      : req.user.stationId;
    if (!stationId) return res.status(400).json({ error: 'stationId could not be resolved' });

    // Fetch RP data for this date — fiche query may fail if logDate not indexed, handled below
    const fichePromise = db.listDocuments(DB, FICHE_COL, [
      Query.equal('logDate', date),
      Query.equal('stationId', stationId),
      Query.limit(200),
    ]).catch(() => null);

    const [sitRes, nozRes, ficheRes] = await Promise.all([
      db.listDocuments(DB, SIT_COL, [
        Query.equal('logDate', date),
        Query.equal('stationId', stationId),
        Query.limit(1),
      ]),
      db.listDocuments(DB, NOZ_COL, [
        Query.equal('logDate', date),
        Query.equal('stationId', stationId),
        Query.limit(500),
      ]),
      fichePromise,
    ]);

    const sitDoc   = sitRes.documents[0] || null;
    const nozzles  = nozRes.documents;
    const rpFiches = ficheRes ? ficheRes.documents : null; // null = index unavailable

    // ── Check 1: Payment-method matching ─────────────────────────────────
    // RP has no separate airtel field — MTN MOMO + AIRTEL MONEY both map to rp.momo
    const csvMoMo  = sumWhere(csvRows,
      r => r.method === 'MTN MOMO' || r.method === 'AIRTEL MONEY', r => r.amount);
    const csvCash  = sumWhere(csvRows, r => r.method === 'CASH',  r => r.amount);
    const csvFiche = sumWhere(csvRows, r => r.method === 'FICHE', r => r.amount);
    const csvGrand = sumWhere(csvRows, () => true, r => r.amount);

    const rpMoMo   = (Number(sitDoc?.momo)        || 0) - (Number(sitDoc?.momoLoss) || 0);
    const rpCash   = Number(sitDoc?.totalCash)     || 0;
    const rpFicheT = Number(sitDoc?.totalFiche)    || 0;
    const rpGrand  = Number(sitDoc?.totalPayments) || 0;

    const payChecks = [
      { label: 'Mobile Money (MTN + Airtel)', csv: csvMoMo,  rp: rpMoMo   },
      { label: 'Cash',                        csv: csvCash,  rp: rpCash   },
      { label: 'Fiche (credit total)',        csv: csvFiche, rp: rpFicheT },
    ].map(c => ({ ...c, gap: c.csv - c.rp }));

    const payFlags = payChecks.filter(c => Math.abs(c.gap) > AMT_TOL);

    // ── Check 2: Volume shortfall ─────────────────────────────────────────
    const csvPms = sumWhere(csvRows, r => r.fuelType === 'PMS', r => r.volume);
    const csvAgo = sumWhere(csvRows, r => r.fuelType === 'AGO', r => r.volume);

    const rpPms = nozzles
      .filter(r => r.fuelType === 'PMS')
      .reduce((s, r) => s + (Number(r.venteLitres) || 0), 0);
    const rpAgo = nozzles
      .filter(r => r.fuelType === 'AGO')
      .reduce((s, r) => s + (Number(r.venteLitres) || 0), 0);

    const volChecks = [
      { label: 'Essence (PMS)', csv: csvPms, rp: rpPms },
      { label: 'Diesel (AGO)',  csv: csvAgo, rp: rpAgo },
    ].map(c => ({ ...c, gap: c.csv - c.rp }));

    const volFlags = volChecks.filter(c => Math.abs(c.gap) > VOL_TOL);

    // ── Checks 3 & 4: Fiche ghost / suppressed ───────────────────────────
    let ficheGhosts = [];
    let ficheSuppressed = [];
    let ficheSkipped = false;

    if (rpFiches === null) {
      ficheSkipped = true;
    } else {
      const csvFicheRows = csvRows.filter(r => r.method === 'FICHE');

      ficheGhosts = rpFiches
        .filter(rpF => {
          const a = Number(rpF.amount) || 0;
          return !csvFicheRows.some(c => Math.abs(c.amount - a) <= AMT_TOL);
        })
        .map(f => ({
          amount:     Number(f.amount) || 0,
          customerId: f.customerId || f.customer || '—',
          note:       'In RP only — possible fictitious entry',
        }));

      ficheSuppressed = csvFicheRows
        .filter(c => !rpFiches.some(rpF => Math.abs(Number(rpF.amount) - c.amount) <= AMT_TOL))
        .map(c => ({
          amount:     c.amount,
          customerId: c.customerId || '—',
          note:       'In CSV only — possible unreported credit sale',
        }));
    }

    // ── Check 5: Grand total ──────────────────────────────────────────────
    const grandGap  = csvGrand - rpGrand;
    const grandFlag = Math.abs(grandGap) > AMT_TOL;

    res.json({
      date,
      stationId,
      csvRowCount: csvRows.length,
      hasRpData:   !!sitDoc,
      checks: {
        payments: {
          rows:  payChecks,
          flags: payFlags,
          clean: payFlags.length === 0,
        },
        volume: {
          rows:  volChecks,
          flags: volFlags,
          clean: volFlags.length === 0,
        },
        ficheGhosts:     { items: ficheGhosts,    clean: ficheGhosts.length === 0,    skipped: ficheSkipped },
        ficheSuppressed: { items: ficheSuppressed, clean: ficheSuppressed.length === 0, skipped: ficheSkipped },
        grandTotal: {
          csv: csvGrand, rp: rpGrand, gap: grandGap, clean: !grandFlag,
        },
      },
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
