const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const router = express.Router();
const SALT_ROUNDS = 10;

router.use(requireAuth, requireRole('admin'));

// ============================================================
// PRODUITS — l'admin VALIDE (n'en crée plus lui-même)
// ============================================================

/** GET /api/admin/products — tous les produits, tous statuts, avec leur galerie photo */
router.get('/products', async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, u.full_name AS supplier_name, u.email AS supplier_email
     FROM products p JOIN users u ON u.id = p.supplier_id
     ORDER BY
       CASE p.status WHEN 'pending_review' THEN 0 ELSE 1 END,
       p.created_at DESC`
  );

  const productIds = result.rows.map((p) => p.id);
  let imagesByProduct = {};
  if (productIds.length > 0) {
    const images = await pool.query(
      `SELECT * FROM product_images WHERE product_id = ANY($1::int[]) ORDER BY display_order ASC, id ASC`,
      [productIds]
    );
    imagesByProduct = images.rows.reduce((acc, img) => {
      (acc[img.product_id] ||= []).push(img);
      return acc;
    }, {});
  }

  res.json(result.rows.map((p) => ({ ...p, images: imagesByProduct[p.id] || [] })));
});

/**
 * PATCH /api/admin/products/:id/review
 * Valide ou rejette une proposition de produit.
 * body: { action: 'approve', public_price_ar } ou { action: 'reject', rejection_reason }
 */
router.patch(
  '/products/:id/review',
  [
    body('action').isIn(['approve', 'reject']),
    body('public_price_ar').if(body('action').equals('approve')).isFloat({ min: 0 }),
    body('rejection_reason').if(body('action').equals('reject')).trim().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const product = await pool.query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
    if (product.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

    if (req.body.action === 'approve') {
      const publicPrice = Number(req.body.public_price_ar);
      if (publicPrice < Number(product.rows[0].supplier_price_ar)) {
        return res.status(400).json({
          error: 'Le prix public doit être supérieur ou égal au prix fournisseur.',
        });
      }
      const result = await pool.query(
        `UPDATE products
         SET status = 'active', public_price_ar = $1, rejection_reason = NULL,
             reviewed_by = $2, reviewed_at = now()
         WHERE id = $3 RETURNING *`,
        [publicPrice, req.user.id, req.params.id]
      );
      return res.json(result.rows[0]);
    }

    const result = await pool.query(
      `UPDATE products
       SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = now()
       WHERE id = $3 RETURNING *`,
      [req.body.rejection_reason, req.user.id, req.params.id]
    );
    res.json(result.rows[0]);
  }
);

/**
 * PATCH /api/admin/products/:id
 * Ajustements limités sur un produit déjà validé : prix public, stock,
 * ou remise hors ligne (status='inactive') / réactivation (status='active').
 */
router.patch('/products/:id', async (req, res) => {
  const fields = ['public_price_ar', 'stock', 'status'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${i++}`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE products SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json(result.rows[0]);
});

/** DELETE /api/admin/products/:id — retire un produit de la vente (passe 'inactive') */
router.delete('/products/:id', async (req, res) => {
  const result = await pool.query(
    `UPDATE products SET status = 'inactive' WHERE id = $1 RETURNING id, status`,
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json({ message: 'Produit retiré de la boutique.', product: result.rows[0] });
});

// ============================================================
// COMPTES FOURNISSEURS
// ============================================================

router.get('/suppliers', async (req, res) => {
  const result = await pool.query(
    `SELECT id, full_name, email, phone, avatar_url, balance_ar, is_active, created_at
     FROM users WHERE role = 'supplier' ORDER BY full_name`
  );
  res.json(result.rows);
});

router.post(
  '/suppliers',
  [
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    body('full_name').trim().notEmpty(),
    body('phone').trim().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, full_name, phone } = req.body;
    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
      }
      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      const result = await pool.query(
        `INSERT INTO users (role, email, password_hash, full_name, phone)
         VALUES ('supplier', $1, $2, $3, $4)
         RETURNING id, role, email, full_name, phone, is_active, created_at`,
        [email, password_hash, full_name, phone]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

router.patch('/suppliers/:id', async (req, res) => {
  if (typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active (booléen) requis.' });
  }
  const result = await pool.query(
    `UPDATE users SET is_active = $1 WHERE id = $2 AND role = 'supplier'
     RETURNING id, full_name, email, is_active`,
    [req.body.is_active, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Fournisseur introuvable.' });
  res.json(result.rows[0]);
});

// ============================================================
// TRANSACTIONS — validation manuelle des paiements mobile money
// ============================================================

/** GET /api/admin/payments?status=submitted — transactions à traiter (ou tout statut donné) */
router.get('/payments', async (req, res) => {
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status) {
    where = `WHERE p.status = $1`;
    params.push(status);
  }
  const result = await pool.query(
    `SELECT p.*, o.total_amount_ar, o.status AS order_status,
            u.full_name AS client_name, u.phone AS client_registered_phone
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     JOIN users u ON u.id = o.client_id
     ${where}
     ORDER BY p.created_at DESC`,
    params
  );
  res.json(result.rows);
});

/**
 * PATCH /api/admin/payments/:id/confirm
 * Valide la réception du paiement. Effet en cascade automatique :
 *  - la commande passe à 'paid'
 *  - elle devient immédiatement visible côté fournisseur (adresse incluse)
 *  - la part de CHAQUE fournisseur concerné est créditée automatiquement
 *    sur son portefeuille Baobab Market (plus besoin de reversement manuel
 *    par commande : le fournisseur retire ensuite quand il veut)
 */
router.patch('/payments/:id/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payment = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND status = 'submitted' FOR UPDATE`,
      [req.params.id]
    );
    if (payment.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Transaction introuvable ou déjà traitée.' });
    }

    await client.query(
      `UPDATE payments SET status = 'confirmed', verified_by = $1, verified_at = now() WHERE id = $2`,
      [req.user.id, req.params.id]
    );
    const order = await client.query(
      `UPDATE orders SET status = 'paid' WHERE id = $1 RETURNING *`,
      [payment.rows[0].order_id]
    );

    await notify(client, {
      userId: order.rows[0].client_id,
      orderId: order.rows[0].id,
      type: 'payment_confirmed',
      message: `Ton paiement pour la commande #${order.rows[0].id} a été validé ✅ Elle est transmise au fournisseur.`,
    });

    // Crédite automatiquement le portefeuille de chaque fournisseur concerné
    const earnings = await client.query(
      `SELECT supplier_id, SUM(unit_supplier_price_ar * quantity) AS amount_ar
       FROM order_items WHERE order_id = $1 GROUP BY supplier_id`,
      [order.rows[0].id]
    );
    for (const row of earnings.rows) {
      await client.query(`UPDATE users SET balance_ar = balance_ar + $1 WHERE id = $2`, [row.amount_ar, row.supplier_id]);
      await client.query(
        `INSERT INTO wallet_entries (user_id, type, amount_ar, order_id, status, verified_by, verified_at)
         VALUES ($1, 'order_earning', $2, $3, 'confirmed', $4, now())`,
        [row.supplier_id, row.amount_ar, order.rows[0].id, req.user.id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Paiement validé, commande transmise au(x) fournisseur(s), soldes crédités.', order: order.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/admin/payments/:id/reject
 * body: { admin_note }
 */
router.patch('/payments/:id/reject', [body('admin_note').trim().notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await client.query(
      `UPDATE payments SET status = 'rejected', admin_note = $1, verified_by = $2, verified_at = now()
       WHERE id = $3 AND status = 'submitted' RETURNING *`,
      [req.body.admin_note, req.user.id, req.params.id]
    );
    if (payment.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Transaction introuvable ou déjà traitée.' });
    }
    await client.query(`UPDATE orders SET status = 'payment_rejected' WHERE id = $1`, [payment.rows[0].order_id]);

    await client.query(
      `INSERT INTO notifications (user_id, order_id, type, message)
       SELECT client_id, id, 'payment_rejected', $2
       FROM orders WHERE id = $1`,
      [payment.rows[0].order_id, `Ton paiement pour la commande #${payment.rows[0].order_id} n'a pas pu être validé : ${req.body.admin_note}`]
    );

    await client.query('COMMIT');
    res.json({ message: 'Paiement rejeté.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// ============================================================
// COMMANDES — vue de contrôle globale
// ============================================================

router.get('/orders', async (req, res) => {
  const result = await pool.query(
    `SELECT o.id, o.status, o.total_amount_ar, o.shipping_address, o.created_at,
            u.full_name AS client_name, u.email AS client_email, u.phone AS client_phone
     FROM orders o JOIN users u ON u.id = o.client_id
     ORDER BY o.created_at DESC`
  );
  res.json(result.rows);
});

router.get('/orders/:id', async (req, res) => {
  const order = await pool.query(
    `SELECT o.*, u.full_name AS client_name, u.email AS client_email, u.phone AS client_phone
     FROM orders o JOIN users u ON u.id = o.client_id WHERE o.id = $1`,
    [req.params.id]
  );
  if (order.rows.length === 0) return res.status(404).json({ error: 'Commande introuvable.' });

  const items = await pool.query(
    `SELECT oi.*, COALESCE(pr.name, oi.product_name) AS product_name, su.full_name AS supplier_name, su.phone AS supplier_phone
     FROM order_items oi
     LEFT JOIN products pr ON pr.id = oi.product_id
     JOIN users su ON su.id = oi.supplier_id
     WHERE oi.order_id = $1`,
    [req.params.id]
  );
  const payments = await pool.query(`SELECT * FROM payments WHERE order_id = $1`, [req.params.id]);

  res.json({ ...order.rows[0], items: items.rows, payments: payments.rows });
});

// ============================================================
// PORTEFEUILLE — validation des dépôts et retraits (clients + fournisseurs)
// ============================================================

/** GET /api/admin/wallet?status=pending — mouvements de portefeuille à traiter */
router.get('/wallet', async (req, res) => {
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status) {
    where = `WHERE w.status = $1`;
    params.push(status);
  }
  const result = await pool.query(
    `SELECT w.*, u.full_name AS user_name, u.role AS user_role, u.phone AS user_phone
     FROM wallet_entries w JOIN users u ON u.id = w.user_id
     ${where}
     ORDER BY w.created_at DESC`,
    params
  );
  res.json(result.rows);
});

/**
 * PATCH /api/admin/wallet/:id/confirm
 * Dépôt : crédite le solde (le virement a été vérifié reçu par l'admin).
 * Retrait : le solde a déjà été débité à la demande ; on confirme juste
 * que l'admin a bien envoyé l'argent, avec sa propre référence de virement.
 * body: { admin_reference } (requis pour un retrait)
 */
/**
 * PATCH /api/admin/wallet/:id/confirm
 * Uniquement des demandes de retrait fournisseur désormais (plus de
 * dépôt). Le solde a déjà été débité à la demande ; on confirme juste
 * que l'admin a bien envoyé l'argent, avec sa propre référence de virement.
 * body: { admin_reference } (requis)
 */
router.patch('/wallet/:id/confirm', [body('admin_reference').trim().notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await client.query(
      `SELECT * FROM wallet_entries WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [req.params.id]
    );
    if (entry.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Mouvement introuvable ou déjà traité.' });
    }

    await client.query(
      `UPDATE wallet_entries SET status = 'confirmed', admin_reference = $1, verified_by = $2, verified_at = now()
       WHERE id = $3`,
      [req.body.admin_reference, req.user.id, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Retrait confirmé.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/admin/wallet/:id/reject
 * Rejette une demande de retrait — le solde bloqué est remboursé.
 * body: { admin_note }
 */
router.patch('/wallet/:id/reject', [body('admin_note').trim().notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await client.query(
      `SELECT * FROM wallet_entries WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [req.params.id]
    );
    if (entry.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Mouvement introuvable ou déjà traité.' });
    }
    const e = entry.rows[0];

    await client.query(
      `UPDATE wallet_entries SET status = 'rejected', admin_note = $1, verified_by = $2, verified_at = now()
       WHERE id = $3`,
      [req.body.admin_note, req.user.id, e.id]
    );
    await client.query(`UPDATE users SET balance_ar = balance_ar + $1 WHERE id = $2`, [e.amount_ar, e.user_id]);

    await client.query('COMMIT');
    res.json({ message: 'Retrait rejeté et solde remboursé.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// ============================================================
// PARAMÈTRES — numéros de réception mobile money de la plateforme
// ============================================================

/** GET /api/admin/settings/payment-numbers */
router.get('/settings/payment-numbers', async (req, res) => {
  const result = await pool.query(`SELECT provider, phone_number, account_name FROM platform_settings`);
  res.json(result.rows);
});

/**
 * PATCH /api/admin/settings/payment-numbers
 * body: { provider, phone_number, account_name }
 * Le nom du titulaire est demandé explicitement pour que les clients et
 * fournisseurs puissent vérifier qu'ils transfèrent au bon compte avant
 * de valider (les apps mobile money affichent ce nom à la confirmation).
 */
router.patch(
  '/settings/payment-numbers',
  [
    body('provider').isIn(['mvola', 'orange_money', 'airtel_money']),
    body('phone_number').trim().notEmpty().withMessage('Numéro requis.'),
    body('account_name').trim().notEmpty().withMessage('Nom du titulaire du compte requis.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { provider, phone_number, account_name } = req.body;
    const result = await pool.query(
      `UPDATE platform_settings SET phone_number = $1, account_name = $2, updated_at = now()
       WHERE provider = $3 RETURNING *`,
      [phone_number, account_name, provider]
    );
    res.json(result.rows[0]);
  }
);

// ============================================================
// FEEDBACK — messages envoyés par les clients/fournisseurs
// ============================================================

/** GET /api/admin/feedback — tous les messages, plus récents d'abord */
router.get('/feedback', async (req, res) => {
  const result = await pool.query(
    `SELECT f.*, u.full_name, u.role, u.email
     FROM feedback_messages f JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC`
  );
  res.json(result.rows);
});

/** PATCH /api/admin/feedback/:id/read */
router.patch('/feedback/:id/read', async (req, res) => {
  const result = await pool.query(
    `UPDATE feedback_messages SET is_read = true WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Message introuvable.' });
  res.json({ message: 'Marqué comme lu.' });
});

module.exports = router;
