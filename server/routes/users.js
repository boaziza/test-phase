const express = require('express');
const router = express.Router();
const { db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_USERS_ID = process.env.APPWRITE_USERS_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /user
 * Creates a new user.
 */

router.post('/', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "User body is required." });
    }

    const newUser = await db.createDocument(
      DATABASE_ID,
      COLLECTION_USERS_ID,
      ID.unique(),
      body
    );

    res.json({ message: "User created successfully", user: newUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /user
 * Returns the user details for the logged-in user.
 */
router.get('/me', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const email = req.user.email;
    if (!email) {
      return res.status(404).json({ error: "No email associated with this account." });
    }

    const user = await db.listDocuments(
        DATABASE_ID,
        COLLECTION_USERS_ID,
        [
            Query.equal('email', email) // The search filter
        ]
    );
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /user
 * Returns the user details for the logged-in user.
 */
router.get('/', verifyJWT, requireRole(['owner','manager']), async (req, res) => {
  try {
    const { limit = 50, offset = 0, station } = req.query;
    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset))];

    // Managers see only pompistes at their station; owners see all users
    if (req.user.role === 'manager') {
      queries.push(Query.equal('role', 'pompiste'));
      if (req.user.stationId) queries.push(Query.equal('stationId', req.user.stationId));
    }

    const scopedStation = station || (req.user.role !== 'owner' ? req.user.stationId : null);
    if (scopedStation) queries.push(Query.equal('stationId', scopedStation));

    const { documents, total } = await db.listDocuments(DATABASE_ID, COLLECTION_USERS_ID, queries);
    res.json({ users: documents, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /user
 * Updates user information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner','manager','pompiste']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "User body is required." });
    }

    const updatedUser = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_USERS_ID,
      id,
      body
    );

    res.json({ message: "User updated successfully", user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /user
 * Deletes user information (e.g., name).
 */
router.delete('/:id',verifyJWT,requireRole(['owner','manager']), async (req, res) => {
    try {

    const id = req.params.id;

        if (!id){
            return res.status(400).json({ error: "User ID is required." });
        }

        const deletedUser = await db.deleteDocument(
            DATABASE_ID,
            COLLECTION_USERS_ID,
            id
        );

        return res.json({message : "User deleted successfully", user: deletedUser});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
module.exports = router;
