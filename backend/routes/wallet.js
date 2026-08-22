const express = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const PROVIDERS = ['mvola', 'orange_money', 'airtel_money'];

// Le portefeuille est réservé au FOURNISSEUR : ses gains sont crédités
// automatiquement à chaque commande payée (voir routes/admin.js), et il
// peut en retirer une partie quand il le souhaite. Le client n'a plus de
// portefeuille : il paie chaque commande directement par référence
// mobile money (voir routes/orders.js).
//
// Sécurité du solde : balance_ar n'est JAMAIS assigné directement depuis
// une valeur envoyée par le client — uniquement incrémenté/décrémenté
// (+= / -=) côté serveur, dans une transaction verrouillée (FOR UPDATE),
// ce qui empêche toute manipulation directe ou race condition (deux
// retraits simultanés ne peuvent pas dépasser le solde disponible).
// Une contrainte CHECK en base interdit aussi tout solde négatif, même en
// cas de bug futur. Ce limiteur de fréquence est une protection
// supplémentaire contre les tentatives de spam de requêtes.
router.use(requireAuth, requireRole('supplier'));

const withdrawLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes de retrait. Réessaie dans quelques minutes.' },
});

/** GET /api/wallet/me — solde actuel + historique des mouvements du fournisseur */
router.get('/me', async (req, res) => {
  const user = await pool.query(`SELECT balance_ar FROM users WHERE id = $1`, [req.user.id]);
  const entries = await pool.query(
    `SELECT id, type, amount_ar, provider, phone_number, admin_reference,
            order_id, status, admin_note, created_at
     FROM wallet_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ balance_ar: user.rows[0].balance_ar, entries: entries.rows });
});

/**
 * POST /api/wallet/withdraw
 * Demande de retrait du fournisseur. Le montant est immédiatement bloqué
 * sur le solde (pour éviter un double retrait), en attendant que l'admin
 * envoie effectivement l'argent et confirme avec sa propre référence.
 */
router.post(
  '/withdraw',
  withdrawLimiter,
  [
    body('amount_ar').isFloat({ min: 100 }).withMessage('Montant invalide.'),
    body('provider').isIn(PROVIDERS).withMessage('Opérateur mobile money invalide.'),
    body('phone_number').trim().notEmpty().withMessage('Numéro de réception requis.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { amount_ar, provider, phone_number } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const user = await client.query(`SELECT balance_ar FROM users WHERE id = $1 FOR UPDATE`, [req.user.id]);
      if (Number(user.rows[0].balance_ar) < Number(amount_ar)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Solde insuffisant.' });
      }

      await client.query(`UPDATE users SET balance_ar = balance_ar - $1 WHERE id = $2`, [amount_ar, req.user.id]);
      const entry = await client.query(
        `INSERT INTO wallet_entries (user_id, type, amount_ar, provider, phone_number, status)
         VALUES ($1, 'withdrawal', $2, $3, $4, 'pending') RETURNING *`,
        [req.user.id, amount_ar, provider, phone_number]
      );

      await client.query('COMMIT');
      res.status(201).json(entry.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
