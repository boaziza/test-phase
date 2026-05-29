const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_STOCK_DAILY_ID = process.env.APPWRITE_STOCK_DAILY_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /stock Daily
 * Creates a new stock Daily.
 */
router.post('/', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
     return res.status(400).json({ error: "Stock body is required." });
    }

    const newStockDaily = await db.createDocument(
      DATABASE_ID,
      COLLECTION_STOCK_DAILY_ID,
      ID.unique(),
      body
    );

    res.json({ message: "Stock created successfully", stock: newStockDaily });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /stock Daily
 * Returns the stock details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {

    const logDate = req.query.logDate;
    const fuelType = req.query.fuelType;

    if (!logDate && !fuelType) {
      return res.status(404).json({ error: "No log date or fuel type provided." });
    }

    const stockDaily = await db.listDocuments(
      DATABASE_ID,
      COLLECTION_STOCK_DAILY_ID,
      [
        Query.equal('logDate', logDate),
        Query.equal('fuelType', fuelType)
      ]
    );
    res.json({ stockDaily });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /stock Daily
 * Returns the stock details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { limit = 100, offset = 0, logdate } = req.query;
    const queries = [
      Query.orderDesc('logDate'),
      Query.limit(Number(limit)),
      Query.offset(Number(offset)),
    ];
    if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));
    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_STOCK_DAILY_ID, queries);
    res.json({ stockDaily: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /stock Daily
 * Updates stock information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Stock body is required." });
    }

    const updatedStockDaily = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_STOCK_DAILY_ID,
      id,
      body
    );

    res.json({ message: "Stock updated successfully", stock: updatedStockDaily });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /stock Daily
 * Deletes stock information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
  try {

    const { id } = req.params;

    if (!id){
        return res.status(400).json({ error: "Stock ID is required." });
    }

    const deletedStockDaily = await db.deleteDocument(
        DATABASE_ID,
        COLLECTION_STOCK_DAILY_ID,
        id
    );

    return res.json({message : "Stock deleted successfully", stock: deletedStockDaily});
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});
module.exports = router;
