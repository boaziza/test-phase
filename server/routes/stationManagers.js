const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_STATION_MANAGERS = process.env.APPWRITE_STATION_MANAGERS_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /station manager
 * Creates a new station manager.
 */
router.post('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "Station manager body is required." });
    }

    const newStationManager = await db.createDocument(
        DATABASE_ID,
        COLLECTION_STATION_MANAGERS,
        ID.unique(),
        body
    );

    res.json({ message: "Station manager created successfully", stationManager: newStationManager });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /station manager
 * Returns the station manager details for the logged-in owner.
 */
router.get('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { limit = 100, offset = 0, station } = req.query;
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);

    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset))];
    if (req.user.companyId) queries.push(Query.equal('companyId', req.user.companyId));
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_STATION_MANAGERS, queries);
    res.json({ managers: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * PATCH /station manager
 * Updates station manager information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Station manager body is required." });
    }

    const updatedStationManager = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_STATION_MANAGERS,
      id,
      body
    );

    res.json({ message: "Station manager updated successfully", stationManager: updatedStationManager });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * DELETE /station manager
 * Deletes a station manager.
 */
router.delete('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Station manager ID is required." });
    }

    const deletedStationManager = await db.deleteDocument(
      DATABASE_ID,
      COLLECTION_STATION_MANAGERS,
      id
    );

    res.json({ message: "Station manager deleted successfully", stationManager: deletedStationManager });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
