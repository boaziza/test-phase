const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_GAIN_ID = process.env.APPWRITE_GAIN_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /gain
 * Creates a new gain for pompiste.
 */
router.post('/', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const body = req.body;
    if (!body) return res.status(400).json({ error: "Gain body is required." });

    const { gainKey, gainPayments = 0 } = body;

    // Upsert by gainKey (one record per pompiste per month)
    if (gainKey) {
      const existing = await db.listDocuments(DATABASE_ID, COLLECTION_GAIN_ID, [
        Query.equal('gainKey', gainKey),
        Query.limit(1),
      ]);

      if (existing.documents.length > 0) {
        const doc = existing.documents[0];
        const updated = await db.updateDocument(
          DATABASE_ID,
          COLLECTION_GAIN_ID,
          doc.$id,
          { gainPayments: (doc.gainPayments || 0) + gainPayments }
        );
        return res.json({ message: "Gain updated successfully", gain: updated });
      }
    }

    const newGain = await db.createDocument(
      DATABASE_ID,
      COLLECTION_GAIN_ID,
      ID.unique(),
      body
    );
    res.json({ message: "Gain created successfully", gain: newGain });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /gain
 * Returns the gain details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {

    const email = req.query.email;

    if (!email) {
      return res.status(404).json({ error: "No email associated with this account." });
    }

    const queries = [Query.equal('email', email)];
    if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));

    const gain = await db.listDocuments(DATABASE_ID, COLLECTION_GAIN_ID, queries);
    res.json({ gain });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /gain
 * Returns the gain details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const { limit = 100, offset = 0, monthYear, station } = req.query;
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);

    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset)), Query.orderDesc('monthYear')];
    if (monthYear) queries.push(Query.equal('monthYear', monthYear));
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_GAIN_ID, queries);
    res.json({ gains: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /gain
 * Updates gain information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager',]), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Gain body is required." });
    }

    const updatedGain = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_GAIN_ID,
      id,
      body
    );

    res.json({ message: "Gain updated successfully", gain: updatedGain });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /gain
 * Deletes gain information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
  try {

    const { id } = req.params;

    if (!id){
        return res.status(400).json({ error: "Gain ID is required." });
    }

    const deletedGain = await db.deleteDocument(
        DATABASE_ID,
        COLLECTION_GAIN_ID,
        id
    );

    return res.json({message : "Gain deleted successfully", gain: deletedGain});
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});
module.exports = router;
