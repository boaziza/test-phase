const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { requireDevice } = require('../middleware/deviceAuth');

const COLLECTION_PAYMENTS_ID = process.env.APPWRITE_PAYMENTS_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /payment
 * Creates a new payment.
 */
router.post('/', verifyJWT, requireDevice, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
     return res.status(400).json({ error: "Payment body is required." });
    }

    const newPayment = await db.createDocument(
      DATABASE_ID,
      COLLECTION_PAYMENTS_ID,
      ID.unique(),
      body
    );

    res.json({ message: "Payment created successfully", payment: newPayment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /payment
 * Returns the payment details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {

    const email = req.query.email;
    const logDate = req.query.logDate;

    if (!email && !logDate) {
      return res.status(404).json({ error: "No email and log date provided." });
    }

    const queries = [Query.equal('email', email), Query.equal('logDate', logDate)];
    if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));

    const payment = await db.listDocuments(DATABASE_ID, COLLECTION_PAYMENTS_ID, queries);
    res.json({ payment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /payment
 * Returns the payment details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { search, limit = 25, offset = 0, station } = req.query;
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);

    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset))];
    if (search) queries.push(Query.search('name', search));
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_PAYMENTS_ID, queries);
    res.json({ payments: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /payment
 * Updates payment information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Payment body is required." });
    }

    const updatedPayment = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_PAYMENTS_ID,
      id,
      body
    );

    res.json({ message: "Payment updated successfully", payment: updatedPayment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /payment
 * Deletes payment information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
  try {

    const { id } = req.params;

    if (!id){
        return res.status(400).json({ error: "Payment ID is required." });
    }

    const deletedPayment = await db.deleteDocument(
        DATABASE_ID,
        COLLECTION_PAYMENTS_ID,
        id
    );

    return res.json({message : "Payment deleted successfully", payment: deletedPayment});
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});
module.exports = router;
