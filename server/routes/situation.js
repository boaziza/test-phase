const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');
const { requireDevice } = require('../middleware/deviceAuth');

const COLLECTION_SITUATION_ID = process.env.APPWRITE_SITUATION_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /situation
 * Creates a new situation.
 */

router.post('/', verifyJWT, requireDevice, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "Situation body is required." });
    }

    // Trust the authenticated user's identity, not whatever the client sent
    const payload = {
      ...body,
      stationId: req.user.role === 'owner' ? (body.stationId || req.user.stationId) : req.user.stationId,
      companyId: req.user.companyId,
    };

    const newSituation = await db.createDocument(
      DATABASE_ID,
      COLLECTION_SITUATION_ID,
      ID.unique(),
      payload
    );

    res.json({ message: "Situation created successfully", situation: newSituation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /situation
 * Returns the situation details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const logDate = req.query.logDate;
    if (!logDate) {
      return res.status(404).json({ error: "No log date provided." });
    }

    const queries = [Query.equal('logDate', logDate)];
    if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));

    const situation = await db.listDocuments(DATABASE_ID, COLLECTION_SITUATION_ID, queries);
    res.json({ situation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /situation
 * Returns the situation details for the logged-in user.
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

    // Scope to station: manager uses their own stationId, owner uses ?station= param
    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_SITUATION_ID, queries);
    res.json({ situations: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /situation
 * Updates situation information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!id || !body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: "Situation body and id is required." });
    }

    // Strip legacy hardcoded-pump fields no longer present in the v3 collection
    const LEGACY_FIELDS = ['pms1','pms2','pms3','pms4','ago1','ago2','ago3','ago4'];
    const cleanBody = Object.fromEntries(
      Object.entries(body).filter(([k]) => !LEGACY_FIELDS.includes(k))
    );

    const updatedSituation = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_SITUATION_ID,
      id,
      cleanBody
    );

    res.json({ message: "Situation updated successfully", situation: updatedSituation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /situation
 * Deletes situation information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
    try {
    const { id } = req.params;

        if (!id){
            return res.status(400).json({ error: "Situation ID is required." });
        }

        const deletedSituation = await db.deleteDocument(
            DATABASE_ID,
            COLLECTION_SITUATION_ID,
            id
        );

        return res.json({message : "Situation deleted successfully", situation: deletedSituation});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;
