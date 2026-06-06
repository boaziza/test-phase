const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_LOANS_ID = process.env.APPWRITE_LOANS_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /loan
 * Creates a new loan for a customer.
 */
router.post('/', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {

    const body = req.body;

    if (!body){
     return res.status(400).json({ error: "Loan body is required." });
    }

    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0) return res.status(400).json({ error: "Loan body is required." });

    const created = [];
    try {
      for (const item of items) {
        const doc = await db.createDocument(DATABASE_ID, COLLECTION_LOANS_ID, ID.unique(), item);
        created.push(doc.$id);
      }
    } catch (err) {
      for (const id of [...created].reverse()) {
        try { await db.deleteDocument(DATABASE_ID, COLLECTION_LOANS_ID, id); } catch {}
      }
      return res.status(500).json({ error: err.message });
    }

    res.json({ message: "Loan created successfully", loan: created });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /loan
 * Returns the loan details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {

    const customerId = req.query.customerId;

    if (!customerId) {
      return res.status(404).json({ error: "No customer ID associated with this account." });
    }

    const queries = [Query.equal('customerId', customerId)];
    if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));

    const loan = await db.listDocuments(DATABASE_ID, COLLECTION_LOANS_ID, queries);
    res.json({ loan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /loan
 * Returns the loan details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { search, limit = 25, offset = 0, station } = req.query;
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);

    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset))];
    if (search) queries.push(Query.search('name', search));
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_LOANS_ID, queries);
    res.json({ loans: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /loan
 * Updates loan information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Loan body is required." });
    }

    const updatedLoan = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_LOANS_ID,
      id,
      body
    );

    res.json({ message: "Loan updated successfully", loan: updatedLoan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /loan
 * Deletes loan information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
  try {

    const { id } = req.params;

    if (!id){
        return res.status(400).json({ error: "Loan ID is required." });
    }

    const deletedLoan = await db.deleteDocument(
        DATABASE_ID,
        COLLECTION_LOANS_ID,
        id
    );

    return res.json({message : "Loan deleted successfully", loan: deletedLoan});
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});
module.exports = router;
