const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_STOCK_ID = process.env.APPWRITE_STOCK_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /stock
 * Creates a new stock.
 */
router.post('/', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
     return res.status(400).json({ error: "Stock body is required." });
    }

    // Trust the authenticated user's identity, not whatever the client sent
    const payload = {
      ...body,
      stationId: req.user.role === 'owner' ? (body.stationId || req.user.stationId) : req.user.stationId,
      companyId: req.user.companyId,
    };

    const newStock = await db.createDocument(
      DATABASE_ID,
      COLLECTION_STOCK_ID,
      ID.unique(),
      payload
    );

    res.json({ message: "Stock created successfully", stock: newStock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /stock
 * Returns the stock details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {

    const monthYear = req.query.monthYear;

    if (!monthYear) {
      return res.status(404).json({ error: "No month and year provided." });
    }

    const queries = [Query.equal('monthYear', monthYear)];
    if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));

    const stock = await db.listDocuments(DATABASE_ID, COLLECTION_STOCK_ID, queries);
    res.json({ stock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /stock
 * Returns the stock details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { year, month, from, to, station, limit = 31, offset = 0 } = req.query;

    const queries = [Query.orderDesc("logDate"), Query.limit(Number(limit)), Query.offset(Number(offset))];

    if (year && month) {
      const mm = String(month).padStart(2, "0");
      queries.push(Query.greaterThanEqual("logDate", `${year}-${mm}-01`));
      queries.push(Query.lessThanEqual("logDate", `${year}-${mm}-31`));
    } else if (from && to) {
      queries.push(Query.greaterThanEqual("logDate", from));
      queries.push(Query.lessThanEqual("logDate", to));
    }

    if (station) {
      queries.push(Query.equal("stationId", station));  // Assuming stationId field exists
    }

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_STOCK_ID, queries);
    res.json({ stock: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /stock
 * Updates stock information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {

    const { id } = req.params;
    const body = req.body;

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: "Stock body is required." });
    }

    const updatedStock = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_STOCK_ID,
      id,
      body
    );

    res.json({ message: "Stock updated successfully", stock: updatedStock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /stock
 * Deletes stock information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
  try {

    const { id } = req.params;

    if (!id){
        return res.status(400).json({ error: "Stock ID is required." });
    }

    const deletedStock = await db.deleteDocument(
        DATABASE_ID,
        COLLECTION_STOCK_ID,
        id
    );

    return res.json({message : "Stock deleted successfully", stock: deletedStock});
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});
module.exports = router;
