const express = require('express');
const router  = express.Router();
const { teams, users, ID, Query } = require('../../appwrite');
const { verifyJWT, requireRole }  = require('../../middleware/auth');

/**
 * GET /
 * List all teams (non-employee teams visible to owner).
 */
router.get('/', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const result = await teams.list();
    res.json({ teams: result.teams });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /
 * Create a new team.
 */
router.post('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Team name is required.' });
    const team = await teams.create(ID.unique(), name.trim());
    res.json({ success: true, team });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:teamId
 * Delete a team.
 */
router.delete('/:teamId', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    await teams.delete(req.params.teamId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:teamId/members
 * List memberships for a team.
 */
router.get('/:teamId/members', verifyJWT, requireRole(['owner', 'manager']), async (req, res) => {
  try {
    const result = await teams.listMemberships(req.params.teamId);
    res.json({ memberships: result.memberships });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:teamId/members
 * Add a user to a team by email (no invite email — direct membership).
 */
router.post('/:teamId/members', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const found = await users.list([Query.equal('email', email)]);
    if (found.users.length === 0) {
      return res.status(404).json({ error: `No account found for ${email}` });
    }
    const user = found.users[0];

    const membership = await teams.createMembership(
      req.params.teamId, ['member'], user.email, user.$id
    );
    res.json({ success: true, membership });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:teamId/members/:membershipId
 * Remove a member from a team.
 */
router.delete('/:teamId/members/:membershipId', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    await teams.deleteMembership(req.params.teamId, req.params.membershipId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
