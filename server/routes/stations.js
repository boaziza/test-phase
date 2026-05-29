const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_STATIONS_ID = process.env.APPWRITE_STATIONS_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /station
 * Creates a new station .
 */
router.post('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "Station body is required." });
    }

    const newStation = await db.createDocument(
        DATABASE_ID,
        COLLECTION_STATIONS_ID,
        ID.unique(),
        body
    );

    res.json({ message: "Station created successfully", station: newStation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /station
 * Returns the station details for the logged-in owner.
 */
router.get('/', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const { role, stationId, companyId } = req.user;

    if (role === 'manager') {
      if (!stationId) return res.status(404).json({ error: "No station associated with this account." });
      const station = await db.getDocument(DATABASE_ID, COLLECTION_STATIONS_ID, stationId);
      return res.json({ stations: [station] });
    }

    // owner — list stations for their company; ?archived=true shows archived ones
    const showArchived = req.query.archived === 'true';
    const queries = [Query.limit(100), Query.equal('archived', showArchived)];
    if (companyId) queries.push(Query.equal('company', companyId));
    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_STATIONS_ID, queries);
    res.json({ stations: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * PATCH /station
 * Updates station information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body

    if (!body) {
      return res.status(400).json({ error: "Station body is required." });
    }

    const updatedStation = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_STATIONS_ID,
      id,
      body
    );

    res.json({ message: "Station updated successfully", station: updatedStation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * DELETE /station
 * Deletes a station.
 */
router.delete('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const id = req.params.id;

    if (!id) {
      return res.status(400).json({ error: "Station ID is required." });
    }

    const deletedStation = await db.deleteDocument(
      DATABASE_ID,
      COLLECTION_STATIONS_ID,
      id
    );

    res.json({ message: "Station deleted successfully", station: deletedStation  });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
