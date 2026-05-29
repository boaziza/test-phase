const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_CUSTOMERS_ID = process.env.APPWRITE_CUSTOMERS_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /customer
 * Creates a new customer.
 */

router.post('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "Customer body is required." });
    }

    const newCustomer = await db.createDocument(
      DATABASE_ID,
      COLLECTION_CUSTOMERS_ID,
      ID.unique(),
      body
    );

    res.json({ message: "Customer created successfully", customer: newCustomer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /customer
 * Returns the customer details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const tin = req.query.tin;
    if (!tin) {
      return res.status(404).json({ error: "No tin associated with this account." });
    }

    const customer = await db.listDocuments(
        DATABASE_ID,
        COLLECTION_CUSTOMERS_ID,
        [
            Query.equal('tin', tin) // The search filter
        ]
    );
    res.json({ customer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /customer
 * Returns the customer details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { search, limit = 25, offset = 0, station } = req.query;
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);

    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset))];
    if (search) queries.push(Query.search('name', search));
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_CUSTOMERS_ID, queries);
    res.json({ customers: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /customer
 * Updates customer information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Customer body is required." });
    }

    const updatedCustomer = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_CUSTOMERS_ID,
      id,
      body
    );

    res.json({ message: "Customer updated successfully", customer: updatedCustomer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /customer
 * Deletes customer information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
    try {
    const { id } = req.params;

        if (!id){
            return res.status(400).json({ error: "Customer ID is required." });
        }

        const deletedCustomer = await db.deleteDocument(
            DATABASE_ID,
            COLLECTION_CUSTOMERS_ID,
            id
        );

        return res.json({message : "Customer deleted successfully", customer: deletedCustomer});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;
