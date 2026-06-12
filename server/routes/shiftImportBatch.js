const express = require('express');
const router  = express.Router();
const { db, ID, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { submitShiftCore }        = require('../lib/shiftSubmitCore');

const DB       = process.env.APPWRITE_DATABASE_ID;
const C_GAIN   = process.env.APPWRITE_GAIN_ID;
const C_NOZZLE = process.env.APPWRITE_NOZZLE_READINGS_ID;
const C_SIT    = process.env.APPWRITE_SITUATION_ID;
const C_REPORT = process.env.APPWRITE_DAILY_REPORTS_ID;
const C_PAY    = process.env.APPWRITE_PAYMENTS_ID;
const C_FICHE  = process.env.APPWRITE_FICHE_ID;
const C_LOANS  = process.env.APPWRITE_LOANS_ID;

const IDS = { C_GAIN, C_NOZZLE, C_SIT, C_REPORT, C_PAY, C_FICHE, C_LOANS };

const SHIFT_ORDER  = ['Morning', 'Afternoon', 'Evening', 'Night'];
const VALID_SHIFTS = new Set(SHIFT_ORDER);

/**
 * POST /shift-import-batch
 * Owner/manager backfill: takes a day's worth of shifts (parsed from a CSV
 * via the Shift Import page) and runs each one through the same
 * create/upsert/rollback pipeline as POST /shift-submit, in shift order,
 * accumulating the day's situation as it goes.
 *
 * Body: { stationId?, shifts: [{ shift, logDate, monthYear, email, employeeName,
 *         userId, startTime, endTime, nozzleReadings, gainPayments, payments,
 *         totals, fiche, loans }, ...] }
 */
router.post('/', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  const { shifts = [] } = req.body;
  const companyId = req.user.companyId;

  // Managers are locked to their own station; owners may target any station
  // in their company by passing stationId in the body.
  const stationId = req.user.role === 'manager' ? req.user.stationId : (req.body.stationId || req.user.stationId);

  if (!companyId)  return res.status(400).json({ error: 'No company associated with this account.' });
  if (!stationId)  return res.status(400).json({ error: 'No station specified.' });
  if (!Array.isArray(shifts) || shifts.length === 0) {
    return res.status(400).json({ error: 'No shifts provided.' });
  }

  const sorted = [...shifts].sort((a, b) => {
    const ai = SHIFT_ORDER.indexOf(a.shift);
    const bi = SHIFT_ORDER.indexOf(b.shift);
    return ai - bi;
  });

  const situationCache = {}; // logDate -> situation doc | null
  const results = [];

  for (const item of sorted) {
    const {
      shift, logDate, monthYear,
      email, employeeName, userId,
      startTime = '', endTime = '',
      nozzleReadings = [], gainPayments = 0,
      payments = {}, totals = {}, fiche = [], loans = [],
    } = item;

    const label = `${employeeName || email || '?'} — ${shift || '?'} (${logDate || '?'})`;

    // ── Validate ───────────────────────────────────────────────────────────
    const missing = ['shift', 'logDate', 'monthYear', 'email'].filter(k => !item[k]);
    if (missing.length) {
      results.push({ label, status: 'error', error: `Missing fields: ${missing.join(', ')}` });
      continue;
    }
    if (!VALID_SHIFTS.has(shift)) {
      results.push({ label, status: 'error', error: `Invalid shift: ${shift}` });
      continue;
    }

    const shiftKey = `${email}_${logDate}_${shift}`;

    try {
      // ── Duplicate check ────────────────────────────────────────────────────
      const dupCheck = await db.listDocuments(DB, C_REPORT, [
        Query.equal('shiftKey', shiftKey), Query.limit(1),
      ]);
      if (dupCheck.documents.length > 0) {
        results.push({ label, shiftKey, status: 'skipped-duplicate' });
        continue;
      }

      // ── Situation lookup (cached per logDate) ────────────────────────────────
      if (!(logDate in situationCache)) {
        const sitKey = `${stationId}_${logDate}`;
        const sitExisting = await db.listDocuments(DB, C_SIT, [
          Query.equal('situationKey', sitKey), Query.limit(1),
        ]);
        situationCache[logDate] = sitExisting.documents[0] || null;
      }

      const { situationDoc } = await submitShiftCore({
        db, ID, Query, DB, ids: IDS,
        data: {
          companyId, stationId, email, employeeName, userId,
          shift, logDate, monthYear, shiftKey, startTime, endTime,
          nozzleReadings, gainPayments, payments, totals, fiche, loans,
        },
        existingSituation: situationCache[logDate],
      });

      situationCache[logDate] = situationDoc;
      results.push({ label, shiftKey, status: 'ok' });
    } catch (err) {
      results.push({ label, shiftKey, status: 'error', error: err.message });
    }
  }

  res.json({ results });
});

module.exports = router;
