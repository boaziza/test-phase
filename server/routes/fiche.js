const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_FICHE_ID = process.env.APPWRITE_FICHE_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /fiche
 * Creates a new fiche.
 */

router.post('/', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "Fiche body is required." });
    }
    
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0) return res.status(400).json({ error: "Fiche body is required." });

    const results = await Promise.all(
      items.map(item => db.createDocument(DATABASE_ID, COLLECTION_FICHE_ID, ID.unique(), item))
    );

    res.json({ message: "Fiche created successfully", fiche: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /fiche
 * Returns the fiche details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const customerId = req.query.customerId;
    if (!customerId) {
      return res.status(404).json({ error: "No customer ID associated with this account." });
    }

    const queries = [Query.equal('customerId', customerId)];
    if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));

    const fiche = await db.listDocuments(DATABASE_ID, COLLECTION_FICHE_ID, queries);
    res.json({ fiche });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /fiche
 * Returns the fiche details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { search, limit = 25, offset = 0, station } = req.query;
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);

    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset))];
    if (search) queries.push(Query.search('name', search));
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_FICHE_ID, queries);
    res.json({ fiche: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /fiche
 * Updates fiche information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Fiche body is required." });
    }

    const updatedFiche = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_FICHE_ID,
      id,
      body
    );

    res.json({ message: "Fiche updated successfully", fiche: updatedFiche });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /fiche
 * Deletes fiche information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
    try {
    const { id } = req.params;

        if (!id){
            return res.status(400).json({ error: "Fiche ID is required." });
        }

        const deletedFiche = await db.deleteDocument(
            DATABASE_ID,
            COLLECTION_FICHE_ID,
            id
        );

        return res.json({message : "Fiche deleted successfully", fiche: deletedFiche});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;
