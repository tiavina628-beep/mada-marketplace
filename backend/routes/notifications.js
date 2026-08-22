const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/** GET /api/notifications — les notifications de l'utilisateur connecté, plus récentes d'abord */
router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT id, order_id, type, message, is_read, created_at
     FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const unread = result.rows.filter((n) => !n.is_read).length;
  res.json({ notifications: result.rows, unread_count: unread });
});

/** PATCH /api/notifications/:id/read — marque une notification comme lue */
router.patch('/:id/read', async (req, res) => {
  const result = await pool.query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Notification introuvable.' });
  res.json({ message: 'Notification marquée comme lue.' });
});

/** PATCH /api/notifications/read-all — marque tout comme lu */
router.patch('/read-all', async (req, res) => {
  await pool.query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [req.user.id]);
  res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
});

/** DELETE /api/notifications/:id — supprime une notification (chacun supprime les siennes) */
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Notification introuvable.' });
  res.json({ message: 'Notification supprimée.' });
});

/** DELETE /api/notifications — supprime toutes les notifications de l'utilisateur connecté */
router.delete('/', async (req, res) => {
  await pool.query(`DELETE FROM notifications WHERE user_id = $1`, [req.user.id]);
  res.json({ message: 'Toutes les notifications ont été supprimées.' });
});

module.exports = router;
