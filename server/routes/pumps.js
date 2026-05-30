const express = require('express');
const router  = express.Router();
const { db, ID, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const DB      = process.env.APPWRITE_DATABASE_ID;
const COL     = process.env.APPWRITE_PUMPS_ID;

// GET /api/pumps?station=<id>
// Owner: any station in their company. Manager/Pompiste: own station only.
router.get('/', verifyJWT, requireRole(['owner', 'manager', 'pompiste']), async (req, res) => {
  try {
    const { role, stationId: myStation, companyId } = req.user;
    const station = req.query.station || (role !== 'owner' ? myStation : null);

    if (!station) return res.status(400).json({ error: 'station query param required' });

    const queries = [
      Query.equal('stationId', station),
      Query.orderAsc('order'),
      Query.limit(200),
    ];

    if (role !== 'owner' && station !== myStation) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { documents, total } = await db.listDocuments(DB, COL, queries);
    res.json({ pumps: documents, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/pumps
router.post('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { stationId, companyId, pumpNumber, label, active = true, order = 0 } = req.body;
    if (!stationId || !companyId || pumpNumber == null) {
      return res.status(400).json({ error: 'stationId, companyId, pumpNumber required' });
    }
    const doc = await db.createDocument(DB, COL, ID.unique(), {
      stationId, companyId, pumpNumber, label: label || '', active, order,
    });
    res.status(201).json({ pump: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/pumps/:id
router.patch('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const allowed = ['label', 'active', 'order', 'pumpNumber'];
    const update  = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    const doc = await db.updateDocument(DB, COL, req.params.id, update);
    res.json({ pump: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/pumps/:id
router.delete('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    await db.deleteDocument(DB, COL, req.params.id);
    res.json({ message: 'Pump deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
