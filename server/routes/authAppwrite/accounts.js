const express = require('express');
const router  = express.Router();
const { users, db, ID, Query } = require('../../appwrite');
const { verifyJWT, requireRole } = require('../../middleware/auth');

const DB_ID    = process.env.APPWRITE_DATABASE_ID;
const USERS_ID = process.env.APPWRITE_USERS_ID;

/**
 * POST /
 * Create a new Appwrite account + users-collection document.
 * Owner can create managers or pompistes; manager can only create pompistes for their station.
 * Body: { name, email, password, role, stationId }
 */
router.post('/', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    let { name, email, password, role = 'pompiste', stationId } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required.' });
    }

    // Managers can only create pompistes scoped to their own station
    if (req.user.role === 'manager') {
      role      = 'pompiste';
      stationId = req.user.stationId;
    }

    const companyId = req.user.companyId;

    // One manager per station — reject if station already has a manager
    if (role === 'manager' && stationId) {
      const existing = await db.listDocuments(DB_ID, USERS_ID, [
        Query.equal('role', 'manager'),
        Query.equal('stationId', stationId),
        Query.limit(1),
      ]);
      if (existing.documents.length > 0) {
        return res.status(400).json({ error: `Station already has a manager (${existing.documents[0].name || existing.documents[0].email}). Reassign or remove them first.` });
      }
    }

    // 1. Create the Appwrite account
    const account = await users.create(ID.unique(), email, undefined, password, name);

    // 2. Set prefs so verifyJWT uses fast path
    await users.updatePrefs(account.$id, { role, companyId, stationId: stationId || '' });

    // 3. Create the users-collection document
    const doc = await db.createDocument(DB_ID, USERS_ID, ID.unique(), {
      userId:              account.$id,
      name,
      email,
      role,
      companyId,
      stationId:           stationId || null,
      createdBy:           req.user.$id,
      mustChangePassword:  true,   // force password change on first login
      active:              true,
    });

    res.json({ success: true, account: { $id: account.$id, name, email }, user: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /
 * List all Appwrite accounts (admin overview). Owner only.
 */
router.get('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { limit = 100, offset = 0, search } = req.query;
    const queries = [Query.limit(Number(limit)), Query.offset(Number(offset))];
    const result  = await users.list(queries, search || undefined);
    res.json({ accounts: result.users, total: result.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /:userId/name
 * Update the display name of an account.
 */
router.patch('/:userId/name', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required.' });
    const updated = await users.updateName(req.params.userId, name.trim());
    res.json({ success: true, account: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /:userId/password
 * Reset another user's password. Owner only (admin SDK — no current pwd needed).
 */
router.patch('/:userId/password', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    await users.updatePassword(req.params.userId, password);

    // Mark mustChangePassword on the users-collection doc so the UI prompts them
    const existing = await db.listDocuments(DB_ID, USERS_ID, [
      Query.equal('userId', req.params.userId),
    ]);
    if (existing.documents.length > 0) {
      await db.updateDocument(DB_ID, USERS_ID, existing.documents[0].$id, {
        mustChangePassword: true,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /:userId/prefs
 * Update account prefs (role, companyId, stationId). Owner only.
 */
router.patch('/:userId/prefs', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const prefs = req.body;
    if (!prefs || Object.keys(prefs).length === 0) {
      return res.status(400).json({ error: 'Prefs body is required.' });
    }
    const updated = await users.updatePrefs(req.params.userId, prefs);
    res.json({ success: true, prefs: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:userId
 * Delete an Appwrite account. Owner only.
 */
router.delete('/:userId', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const { userId } = req.params;

    // Delete users-collection document
    const lookup = await db.listDocuments(DB_ID, USERS_ID, [Query.equal('userId', userId), Query.limit(1)]);
    if (lookup.documents.length > 0) {
      await db.deleteDocument(DB_ID, USERS_ID, lookup.documents[0].$id);
    }

    // Delete the Appwrite account
    await users.delete(userId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
