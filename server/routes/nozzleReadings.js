const express = require('express');
const router  = express.Router();
const { db, ID, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const DB  = process.env.APPWRITE_DATABASE_ID;
const COL = process.env.APPWRITE_NOZZLE_READINGS_ID;

// GET /api/nozzle-readings?station=<id>&date=YYYY-MM-DD[&shift=Morning]
router.get('/', verifyJWT, requireRole(['owner', 'manager', 'pompiste']), async (req, res) => {
  try {
    const { role, stationId: myStation } = req.user;
    const { station, date, shift, pump, nozzle } = req.query;

    const queries = [Query.limit(500)];

    if (station) {
      if (role === 'manager' && station !== myStation) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      queries.push(Query.equal('stationId', station));
    } else if (role !== 'owner') {
      if (!myStation) return res.status(400).json({ error: 'station query param required' });
      queries.push(Query.equal('stationId', myStation));
    }

    if (date)   queries.push(Query.equal('logDate', date));
    if (shift)  queries.push(Query.equal('shift',   shift));
    if (pump)   queries.push(Query.equal('pumpId',  pump));
    if (nozzle) queries.push(Query.equal('nozzleId', nozzle));

    queries.push(Query.orderAsc('logDate'));

    const { documents, total } = await db.listDocuments(DB, COL, queries);
    res.json({ readings: documents, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/nozzle-readings  — create or upsert a reading by shiftKey
router.post('/', verifyJWT, requireRole(['owner', 'manager', 'pompiste']), async (req, res) => {
  try {
    const {
      nozzleId, pumpId, stationId, companyId = '',
      fuelType, pumpNumber = 0, nozzleNumber = 0,
      startReading, endReading, venteLitres = 0,
      logDate, shift, userId = '', email = '', employeeName = '',
    } = req.body;

    const required = { nozzleId, pumpId, stationId, fuelType, startReading, endReading, logDate, shift };
    const missing  = Object.entries(required).filter(([, v]) => v == null || v === '').map(([k]) => k);
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const VALID_SHIFTS = ['Morning', 'Afternoon', 'Evening', 'Night'];
    if (!VALID_SHIFTS.includes(shift)) {
      return res.status(400).json({ error: `shift must be one of: ${VALID_SHIFTS.join(', ')}` });
    }

    const shiftKey = `${nozzleId}_${logDate}_${shift}`;

    // Check for existing reading with same shiftKey (upsert)
    const existing = await db.listDocuments(DB, COL, [
      Query.equal('shiftKey', shiftKey),
      Query.limit(1),
    ]);

    const payload = {
      nozzleId, pumpId, stationId, companyId,
      fuelType, pumpNumber, nozzleNumber,
      startReading, endReading, venteLitres,
      logDate, shift, userId, email, employeeName, shiftKey,
    };

    let doc;
    if (existing.documents.length > 0) {
      doc = await db.updateDocument(DB, COL, existing.documents[0].$id, payload);
      return res.json({ reading: doc, updated: true });
    }

    doc = await db.createDocument(DB, COL, ID.unique(), payload);
    res.status(201).json({ reading: doc, updated: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/nozzle-readings/:id  — correct a specific reading
router.patch('/:id', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const allowed = ['startReading', 'endReading', 'venteLitres', 'userId', 'email', 'employeeName'];
    const update  = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    const doc = await db.updateDocument(DB, COL, req.params.id, update);
    res.json({ reading: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/nozzle-readings/:id
router.delete('/:id', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    await db.deleteDocument(DB, COL, req.params.id);
    res.json({ message: 'Reading deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
