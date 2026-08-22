const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const PROVIDERS = ['mvola', 'orange_money', 'airtel_money'];

/**
 * POST /api/orders
 * Réservé aux clients connectés. Le client indique la référence de
 * paiement qu'il a reçue APRÈS avoir lui-même effectué le virement
 * mobile money vers le numéro de la marketplace (bouton "Composer" côté
 * frontend). Aucun portefeuille client : chaque commande est vérifiée
 * individuellement par référence, par l'admin.
 *
 * Si un produit a des couleurs (photos avec color_name), la couleur
 * choisie est obligatoire et son stock propre est vérifié/décrémenté —
 * indépendamment du stock global du produit.
 *
 * body: {
 *   items: [{ product_id, quantity, color_name }],
 *   shipping_address,
 *   payment: { provider, phone_number, client_reference }
 * }
 */
router.post(
  '/',
  requireAuth,
  requireRole('client'),
  [
    body('items').isArray({ min: 1 }).withMessage('La commande doit contenir au moins un article.'),
    body('shipping_address').trim().notEmpty().withMessage('Adresse de livraison requise.'),
    body('payment.provider').isIn(PROVIDERS).withMessage('Opérateur mobile money invalide.'),
    body('payment.phone_number').trim().notEmpty().withMessage('Numéro utilisé pour le virement requis.'),
    body('payment.client_reference').trim().notEmpty().withMessage('Référence de paiement requise.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { items, shipping_address, payment } = req.body;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const productIds = items.map((i) => i.product_id);
      const productsResult = await client.query(
        `SELECT id, name, public_price_ar, supplier_price_ar, stock, supplier_id, status
         FROM products WHERE id = ANY($1::int[]) FOR UPDATE`,
        [productIds]
      );
      const productsById = Object.fromEntries(productsResult.rows.map((p) => [p.id, p]));

      // Verrouille aussi les lignes de couleur concernées, pour empêcher
      // deux clients de vider en même temps le stock d'une même couleur.
      const colorImages = await client.query(
        `SELECT * FROM product_images WHERE product_id = ANY($1::int[]) AND color_name IS NOT NULL FOR UPDATE`,
        [productIds]
      );
      const colorsByProduct = colorImages.rows.reduce((acc, img) => {
        (acc[img.product_id] ||= []).push(img);
        return acc;
      }, {});

      let total = 0;
      const resolved = []; // { item, product, colorImage|null }

      for (const item of items) {
        const product = productsById[item.product_id];
        if (!product || product.status !== 'active') {
          throw { status: 400, message: `Produit ${item.product_id} indisponible.` };
        }
        if (!item.quantity || item.quantity < 1) {
          throw { status: 400, message: `Quantité invalide pour ${product.name}.` };
        }

        const availableColors = colorsByProduct[item.product_id] || [];
        let colorImage = null;

        if (availableColors.length > 0) {
          // Ce produit a des couleurs : le client DOIT en choisir une.
          if (!item.color_name) {
            throw { status: 400, message: `Choisis une couleur pour "${product.name}".` };
          }
          colorImage = availableColors.find((c) => c.color_name === item.color_name);
          if (!colorImage) {
            throw { status: 400, message: `Couleur "${item.color_name}" indisponible pour "${product.name}".` };
          }
          const colorStock = colorImage.stock === null ? 0 : colorImage.stock;
          if (item.quantity > colorStock) {
            throw { status: 400, message: `Stock insuffisant pour "${product.name}" en ${item.color_name} (${colorStock} disponible${colorStock > 1 ? 's' : ''}).` };
          }
        } else {
          if (item.quantity > product.stock) {
            throw { status: 400, message: `Stock insuffisant pour "${product.name}".` };
          }
        }

        total += Number(product.public_price_ar) * item.quantity;
        resolved.push({ item, product, colorImage });
      }

      const orderResult = await client.query(
        `INSERT INTO orders (client_id, status, total_amount_ar, shipping_address)
         VALUES ($1, 'awaiting_verification', $2, $3) RETURNING id`,
        [req.user.id, total, shipping_address]
      );
      const orderId = orderResult.rows[0].id;

      for (const { item, product, colorImage } of resolved) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, supplier_id, quantity, unit_public_price_ar, unit_supplier_price_ar, product_name, color_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [orderId, item.product_id, product.supplier_id, item.quantity, product.public_price_ar, product.supplier_price_ar, product.name, colorImage ? colorImage.color_name : null]
        );

        if (colorImage) {
          await client.query(`UPDATE product_images SET stock = stock - $1 WHERE id = $2`, [item.quantity, colorImage.id]);
        } else {
          await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [item.quantity, item.product_id]);
        }
      }

      await client.query(
        `INSERT INTO payments (order_id, provider, phone_number, amount_ar, client_reference, status)
         VALUES ($1, $2, $3, $4, $5, 'submitted')`,
        [orderId, payment.provider, payment.phone_number, total, payment.client_reference]
      );

      await client.query('COMMIT');
      res.status(201).json({
        order_id: orderId,
        total_amount_ar: total,
        order_status: 'awaiting_verification',
        message: 'Commande enregistrée. Ton paiement sera vérifié par un administrateur sous peu.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      const status = err.status || 500;
      if (status === 500) console.error(err);
      res.status(status).json({ error: err.message || 'Erreur serveur lors de la création de la commande.' });
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/orders/:id/payment
 * Permet au client de renvoyer une référence de paiement corrigée, quand
 * l'admin a rejeté la précédente (montant incorrect, référence invalide...).
 * Uniquement possible si la commande lui appartient et est au statut
 * 'payment_rejected'. Repart en 'awaiting_verification'.
 */
router.post(
  '/:id/payment',
  requireAuth,
  requireRole('client'),
  [
    body('provider').isIn(PROVIDERS).withMessage('Opérateur mobile money invalide.'),
    body('phone_number').trim().notEmpty().withMessage('Numéro utilisé pour le virement requis.'),
    body('client_reference').trim().notEmpty().withMessage('Référence de paiement requise.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const order = await client.query(
        `SELECT * FROM orders WHERE id = $1 AND client_id = $2 FOR UPDATE`,
        [req.params.id, req.user.id]
      );
      if (order.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Commande introuvable.' });
      }
      if (order.rows[0].status !== 'payment_rejected') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cette commande n\'est pas en attente de renvoi de paiement.' });
      }

      await client.query(
        `INSERT INTO payments (order_id, provider, phone_number, amount_ar, client_reference, status)
         VALUES ($1, $2, $3, $4, $5, 'submitted')`,
        [req.params.id, req.body.provider, req.body.phone_number, order.rows[0].total_amount_ar, req.body.client_reference]
      );
      await client.query(`UPDATE orders SET status = 'awaiting_verification' WHERE id = $1`, [req.params.id]);

      await client.query('COMMIT');
      res.json({ message: 'Nouvelle référence envoyée. Un administrateur va la vérifier.' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    } finally {
      client.release();
    }
  }
);

/**
 * POST /api/orders/:id/cancel
 * Le client peut annuler lui-même une commande tant que le paiement n'a
 * pas encore été validé par l'admin (pending_payment, awaiting_verification,
 * payment_rejected). Une fois le paiement confirmé ('paid'), la commande
 * est déjà transmise au fournisseur et sa part déjà créditée — l'annulation
 * n'est alors plus libre-service, elle passe par le feedback/l'admin, pour
 * éviter d'avoir à reprendre de l'argent déjà versé à un fournisseur.
 * Le stock (par couleur si applicable, sinon global) est restitué.
 */
router.post('/:id/cancel', requireAuth, requireRole('client'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const order = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    if (order.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable.' });
    }
    if (!['pending_payment', 'awaiting_verification', 'payment_rejected'].includes(order.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: "Cette commande ne peut plus être annulée directement (paiement déjà validé) — contacte l'administration via le feedback.",
      });
    }

    const items = await client.query(
      `SELECT * FROM order_items WHERE order_id = $1`,
      [req.params.id]
    );
    for (const item of items.rows) {
      if (item.color_name) {
        await client.query(
          `UPDATE product_images SET stock = stock + $1
           WHERE product_id = $2 AND color_name = $3`,
          [item.quantity, item.product_id, item.color_name]
        );
      } else if (item.product_id) {
        await client.query(`UPDATE products SET stock = stock + $1 WHERE id = $2`, [item.quantity, item.product_id]);
      }
    }

    await client.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [req.params.id]);

    await client.query('COMMIT');
    res.json({ message: 'Commande annulée, le stock a été restitué.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

/** GET /api/orders/mine — historique des commandes du client connecté */
router.get('/mine', requireAuth, requireRole('client'), async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT id, status, total_amount_ar, shipping_address, created_at
       FROM orders WHERE client_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );

    const orderIds = orders.rows.map((o) => o.id);
    let itemsByOrder = {};
    let paymentsByOrder = {};

    if (orderIds.length > 0) {
      const items = await pool.query(
        `SELECT oi.id AS item_id, oi.order_id, oi.product_id, oi.color_name,
                COALESCE(p.name, oi.product_name) AS name, oi.quantity, oi.unit_public_price_ar, oi.item_status,
                (r.id IS NOT NULL) AS reviewed
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN reviews r ON r.order_item_id = oi.id
         WHERE oi.order_id = ANY($1::int[])`,
        [orderIds]
      );
      itemsByOrder = items.rows.reduce((acc, item) => {
        (acc[item.order_id] ||= []).push(item);
        return acc;
      }, {});

      const payments = await pool.query(
        `SELECT order_id, provider, client_reference, status, admin_note
         FROM payments WHERE order_id = ANY($1::int[])`,
        [orderIds]
      );
      paymentsByOrder = Object.fromEntries(payments.rows.map((p) => [p.order_id, p]));
    }

    res.json(
      orders.rows.map((o) => ({ ...o, items: itemsByOrder[o.id] || [], payment: paymentsByOrder[o.id] || null }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
