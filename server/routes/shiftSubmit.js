const express = require('express');
const router  = express.Router();
const { db, ID, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { requireDevice }          = require('../middleware/deviceAuth');
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

  try {
    await submitShiftCore({
      db, ID, Query, DB, ids: IDS,
      data: {
        companyId, stationId, email, employeeName, userId,
        shift, logDate, monthYear, shiftKey, startTime, endTime,
        nozzleReadings, gainPayments, payments, totals, fiche, loans,
      },
      existingSituation: sitExisting.documents[0] || null,
    });

    res.status(201).json({ ok: true, shiftKey });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
