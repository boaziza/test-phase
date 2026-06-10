const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_FUEL_PRICE_HISTORY_ID = process.env.APPWRITE_FUEL_PRICE_HISTORY_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /fuel-price-history
 * Creates a new fuel price history entry.
 */

router.post('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "Fuel price history body is required." });
    }

    const newFuelPriceHistory = await db.createDocument(
      DATABASE_ID,
      COLLECTION_FUEL_PRICE_HISTORY_ID,
      ID.unique(),
      body
    );

    res.json({ message: "Fuel price history created successfully", fuelPriceHistory: newFuelPriceHistory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /fuel-price-history
 * Returns the fuel price history details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const { stationId } = req.user;
    if (!stationId) {
      return res.status(404).json({ error: "No station ID associated with this account." });
    }

    const fuelPriceHistory = await db.listDocuments(
      DATABASE_ID,
      COLLECTION_FUEL_PRICE_HISTORY_ID,
      [Query.equal('stationId', stationId)]
    );

    res.json({ fuelPriceHistory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /fuel-price-history
 * Returns the fuel price history details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { limit = 25, offset = 0, station } = req.query;
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);

    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset)), Query.orderDesc('effectiveFrom')];
    if (scopedStation) {
      queries.push(Query.equal('stationId', scopedStation));
    }

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_FUEL_PRICE_HISTORY_ID, queries);
    res.json({ fuelPriceHistory: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /fuel-price-history
 * Updates fuel price history information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Fuel price history body is required." });
    }

    const updatedFuelPriceHistory = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_FUEL_PRICE_HISTORY_ID,
      id,
      body
    );

    res.json({ message: "Fuel price history updated successfully", fuelPriceHistory: updatedFuelPriceHistory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /fuel-price-history
 * Deletes fuel price history information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
    try {
    const id = req.params.id;

        if (!id){
            return res.status(400).json({ error: "Fuel price history ID is required." });
        }

        const deletedFuelPriceHistory = await db.deleteDocument(
            DATABASE_ID,
            COLLECTION_FUEL_PRICE_HISTORY_ID,
            id
        );

        return res.json({message : "Fuel price history deleted successfully", fuelPriceHistory: deletedFuelPriceHistory});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;
