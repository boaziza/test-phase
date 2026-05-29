const express = require('express');
const router  = express.Router();
const { db, ID, Query } = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const DB  = process.env.APPWRITE_DATABASE_ID;
const COL = process.env.APPWRITE_NOZZLES_ID;

// GET /api/nozzles?pump=<id>   — list nozzles for a pump
// GET /api/nozzles?station=<id> — list all nozzles for a station
router.get('/', verifyJWT, requireRole(['owner', 'manager', 'pompiste']), async (req, res) => {
  try {
    const { role, stationId: myStation } = req.user;
    const { pump, station } = req.query;

    if (!pump && !station) {
      return res.status(400).json({ error: 'pump or station query param required' });
    }

    const queries = [Query.limit(500)];

    if (pump) {
      queries.push(Query.equal('pumpId', pump));
    } else {
      if (role === 'manager' && station !== myStation) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      queries.push(Query.equal('stationId', station));
    }

    queries.push(Query.orderAsc('nozzleNumber'));

    const { documents, total } = await db.listDocuments(DB, COL, queries);
    res.json({ nozzles: documents, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/nozzles
router.post('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { pumpId, stationId, companyId, nozzleNumber, fuelType, label, active = true } = req.body;
    if (!pumpId || !stationId || !companyId || nozzleNumber == null || !fuelType) {
      return res.status(400).json({ error: 'pumpId, stationId, companyId, nozzleNumber, fuelType required' });
    }
    const VALID_FUELS = ['PMS', 'AGO', 'Kerosene'];
    if (!VALID_FUELS.includes(fuelType)) {
      return res.status(400).json({ error: `fuelType must be one of: ${VALID_FUELS.join(', ')}` });
    }
    const doc = await db.createDocument(DB, COL, ID.unique(), {
      pumpId, stationId, companyId, nozzleNumber, fuelType, label: label || '', active,
    });
    res.status(201).json({ nozzle: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/nozzles/:id
router.patch('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const allowed = ['label', 'active', 'fuelType', 'nozzleNumber'];
    const update  = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    if (update.fuelType) {
      const VALID_FUELS = ['PMS', 'AGO', 'Kerosene'];
      if (!VALID_FUELS.includes(update.fuelType)) {
        return res.status(400).json({ error: `fuelType must be one of: ${VALID_FUELS.join(', ')}` });
      }
    }
    const doc = await db.updateDocument(DB, COL, req.params.id, update);
    res.json({ nozzle: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/nozzles/:id
router.delete('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    await db.deleteDocument(DB, COL, req.params.id);
    res.json({ message: 'Nozzle deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
