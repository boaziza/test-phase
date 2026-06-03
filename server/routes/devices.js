const express  = require('express');
const router   = express.Router();
const { db, ID, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { _cacheDelete } = require('../middleware/deviceAuth');

const DB          = process.env.APPWRITE_DATABASE_ID;
const DEVICES_COL = process.env.APPWRITE_DEVICES_ID;

// GET /api/devices  — list all registered devices for the manager's station
router.get('/', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const stationId = req.user.role === 'manager'
      ? req.user.stationId
      : req.query.station || null;

    const queries = [Query.limit(100)];
    if (stationId) queries.push(Query.equal('stationId', stationId));
    else if (req.user.companyId) queries.push(Query.equal('companyId', req.user.companyId));

    const { documents, total } = await db.listDocuments(DB, DEVICES_COL, queries);
    res.json({ devices: documents, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/devices  — register a new device
router.post('/', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const { token, label, stationId: bodyStation } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const stationId = req.user.role === 'manager' ? req.user.stationId : bodyStation;
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });

    // prevent duplicate tokens for the same station
    const existing = await db.listDocuments(DB, DEVICES_COL, [
      Query.equal('token', token),
      Query.equal('stationId', stationId),
      Query.limit(1),
    ]);
    if (existing.documents.length > 0) {
      return res.json({ device: existing.documents[0], alreadyExists: true });
    }

    const doc = await db.createDocument(DB, DEVICES_COL, ID.unique(), {
      token,
      stationId,
      companyId:    req.user.companyId || '',
      label:        label || 'Work Computer',
      registeredAt: new Date().toISOString(),
      registeredBy: req.user.email,
    });

    res.status(201).json({ device: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/devices/:id  — revoke a device
router.delete('/:id', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const doc = await db.getDocument(DB, DEVICES_COL, req.params.id);

    // managers can only revoke devices for their own station
    if (req.user.role === 'manager' && doc.stationId !== req.user.stationId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    _cacheDelete(doc.token);
    await db.deleteDocument(DB, DEVICES_COL, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
