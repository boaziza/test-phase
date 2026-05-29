const express = require('express');
const router = express.Router();
const {db, ID, Query} = require('../appwrite');
const { verifyJWT, requireRole } = require('../middleware/auth');

const COLLECTION_COMPANIES_ID = process.env.APPWRITE_COMPANIES_ID;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;

/**
 * POST /company
 * Creates a new company.
 */
router.post('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const body = req.body;

    if (!body){
        return res.status(400).json({ error: "Company body is required." });
    }

    const newCompany = await db.createDocument(
        DATABASE_ID,
        COLLECTION_COMPANIES_ID,
        ID.unique(),
        body
    );

    res.json({ message: "Company created successfully", company: newCompany });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /company
 * Returns the company details for the logged-in owner.
 */
router.get('/', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(404).json({ error: "No company associated with this account." });
    }

    const company = await db.getDocument(DATABASE_ID, COLLECTION_COMPANIES_ID, companyId);
    res.json({ companies: [company], total: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * PATCH /company
 * Updates company information (e.g., name).
 */
router.patch('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;

    if (!body) {
      return res.status(400).json({ error: "Company body is required." });
    }

    const updatedCompany = await db.updateDocument(
      DATABASE_ID,
      COLLECTION_COMPANIES_ID,
      id,
      body
    );

    res.json({ message: "Company updated successfully", company: updatedCompany });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * DELETE /company
 * Deletes a company.
 */
router.delete('/:id', verifyJWT, requireRole(['owner']), async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Company ID is required." });
    }

    const deletedCompany = await db.deleteDocument(
      DATABASE_ID,
      COLLECTION_COMPANIES_ID,
      id
    );

    res.json({ message: "Company deleted successfully", company: deletedCompany });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
