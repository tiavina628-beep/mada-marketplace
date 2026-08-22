const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/feedback
 * Réservé aux clients et fournisseurs — un canal simple pour remonter
 * un problème ou une suggestion à l'administration.
 */
router.post(
  '/',
  requireAuth,
  requireRole('client', 'supplier'),
  [body('message').trim().isLength({ min: 3, max: 2000 }).withMessage('Message trop court ou trop long.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const result = await pool.query(
      `INSERT INTO feedback_messages (user_id, message) VALUES ($1, $2) RETURNING *`,
      [req.user.id, req.body.message]
    );
    res.status(201).json(result.rows[0]);
  }
);

module.exports = router;
