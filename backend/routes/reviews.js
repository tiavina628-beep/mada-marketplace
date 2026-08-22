const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/reviews/items/:orderItemId
 * Le client note et commente un article de commande, uniquement une fois
 * livré, et une seule fois par article (contrainte UNIQUE en base).
 * body: { rating (1-5), comment }
 */
router.post(
  '/items/:orderItemId',
  requireAuth,
  requireRole('client'),
  [
    body('rating').isInt({ min: 1, max: 5 }).withMessage('La note doit être comprise entre 1 et 5.'),
    body('comment').optional().trim().isLength({ max: 1000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const item = await pool.query(
        `SELECT oi.id, oi.product_id, oi.item_status, o.client_id
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE oi.id = $1`,
        [req.params.orderItemId]
      );
      if (item.rows.length === 0) return res.status(404).json({ error: 'Article introuvable.' });
      if (item.rows[0].client_id !== req.user.id) return res.status(403).json({ error: 'Cet article ne t\'appartient pas.' });
      if (item.rows[0].item_status !== 'delivered') {
        return res.status(400).json({ error: 'Tu ne peux laisser un avis qu\'après la livraison.' });
      }
      if (!item.rows[0].product_id) {
        return res.status(400).json({ error: 'Ce produit a été retiré par le fournisseur, impossible de laisser un avis.' });
      }

      const existing = await pool.query(`SELECT id FROM reviews WHERE order_item_id = $1`, [req.params.orderItemId]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Tu as déjà laissé un avis pour cet article.' });
      }

      const result = await pool.query(
        `INSERT INTO reviews (order_item_id, product_id, client_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.params.orderItemId, item.rows[0].product_id, req.user.id, req.body.rating, req.body.comment || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

/** GET /api/reviews/products/:productId — avis publics d'un produit */
router.get('/products/:productId', async (req, res) => {
  const result = await pool.query(
    `SELECT r.rating, r.comment, r.created_at, u.full_name AS client_name
     FROM reviews r JOIN users u ON u.id = r.client_id
     WHERE r.product_id = $1 ORDER BY r.created_at DESC`,
    [req.params.productId]
  );
  res.json(result.rows);
});

module.exports = router;
