const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const { CATEGORIES } = require('../utils/categories');

const router = express.Router();

router.use(requireAuth, requireRole('supplier'));

// ============================================================
// PRODUITS — le fournisseur propose, l'admin valide
// ============================================================

/** GET /api/supplier/products — tous ses produits, quel que soit le statut */
router.get('/products', async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM products WHERE supplier_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
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
 * POST /api/supplier/products
 * Propose un nouveau produit. Il part toujours en 'pending_review' :
 * le fournisseur ne peut pas le mettre en ligne lui-même, ni fixer
 * le prix public (c'est l'admin qui le fera à la validation).
 */
router.post(
  '/products',
  [
    body('name').trim().notEmpty().withMessage('Nom requis.'),
    body('supplier_price_ar').isFloat({ min: 0 }).withMessage('Prix fournisseur invalide.'),
    body('stock').isInt({ min: 0 }).withMessage('Stock invalide.'),
    body('category').optional().isIn(CATEGORIES).withMessage('Catégorie invalide.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, supplier_price_ar, stock, image_url, category } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO products (name, description, supplier_price_ar, stock, image_url, category, supplier_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review') RETURNING *`,
        [name, description || null, supplier_price_ar, stock, image_url || null, category || 'Autre', req.user.id]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

/**
 * PATCH /api/supplier/products/:id
 * Modification complète — autorisée uniquement tant que le produit n'est
 * pas encore validé (pending_review) ou a été rejeté. Toute modification
 * d'un produit rejeté le repasse automatiquement en 'pending_review'.
 * Une fois 'active', seul le stock reste modifiable (route dédiée).
 */
router.patch('/products/:id', async (req, res) => {
  if (req.body.category !== undefined && !CATEGORIES.includes(req.body.category)) {
    return res.status(400).json({ error: 'Catégorie invalide.' });
  }

  const existing = await pool.query(
    `SELECT * FROM products WHERE id = $1 AND supplier_id = $2`,
    [req.params.id, req.user.id]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

  const product = existing.rows[0];
  if (!['pending_review', 'rejected'].includes(product.status)) {
    return res.status(400).json({
      error: "Ce produit est déjà validé/en ligne : seul le stock peut encore être modifié.",
    });
  }

  const fields = ['name', 'description', 'supplier_price_ar', 'stock', 'image_url', 'category'];
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

  updates.push(`status = 'pending_review'`, `rejection_reason = NULL`, `reviewed_by = NULL`, `reviewed_at = NULL`);

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE products SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  res.json(result.rows[0]);
});

/** PATCH /api/supplier/products/:id/stock — met à jour uniquement le stock, à tout moment */
router.patch('/products/:id/stock', [body('stock').isInt({ min: 0 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const result = await pool.query(
    `UPDATE products SET stock = $1 WHERE id = $2 AND supplier_id = $3 RETURNING *`,
    [req.body.stock, req.params.id, req.user.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json(result.rows[0]);
});

/**
 * GET /api/supplier/products/:id/images — liste des photos de ce produit
 */
router.get('/products/:id/images', async (req, res) => {
  const product = await pool.query(`SELECT id FROM products WHERE id = $1 AND supplier_id = $2`, [req.params.id, req.user.id]);
  if (product.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

  const images = await pool.query(
    `SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order ASC, id ASC`,
    [req.params.id]
  );
  res.json(images.rows);
});

/**
 * POST /api/supplier/products/:id/images
 * Ajoute une photo (jusqu'à 5 au total par produit), avec une couleur et
 * un stock optionnels — en cliquant cette couleur côté boutique, cette
 * photo précise s'affiche, et le stock de cette couleur précise est
 * vérifié/décrémenté à la commande. Ne déclenche pas de nouvelle
 * validation admin.
 * body: { image_url, color_name, stock }
 */
router.post(
  '/products/:id/images',
  [body('image_url').notEmpty(), body('stock').optional().isInt({ min: 0 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const product = await pool.query(`SELECT id FROM products WHERE id = $1 AND supplier_id = $2`, [req.params.id, req.user.id]);
    if (product.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

    const count = await pool.query(`SELECT COUNT(*) FROM product_images WHERE product_id = $1`, [req.params.id]);
    if (Number(count.rows[0].count) >= 5) {
      return res.status(400).json({ error: 'Maximum 5 photos par produit.' });
    }

    const result = await pool.query(
      `INSERT INTO product_images (product_id, image_url, color_name, stock, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        req.params.id, req.body.image_url, req.body.color_name || null,
        req.body.color_name && req.body.stock !== undefined ? req.body.stock : null,
        Number(count.rows[0].count),
      ]
    );

    // La première photo ajoutée devient aussi la photo de couverture (utilisée
    // dans les listes, le panier, l'historique de commandes...)
    if (Number(count.rows[0].count) === 0) {
      await pool.query(`UPDATE products SET image_url = $1 WHERE id = $2`, [req.body.image_url, req.params.id]);
    }

    res.status(201).json(result.rows[0]);
  }
);

/**
 * PATCH /api/supplier/products/:id/images/:imageId/stock
 * Met à jour le stock disponible pour une couleur précise, à tout moment.
 */
router.patch('/products/:id/images/:imageId/stock', [body('stock').isInt({ min: 0 })], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const product = await pool.query(`SELECT id FROM products WHERE id = $1 AND supplier_id = $2`, [req.params.id, req.user.id]);
  if (product.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

  const result = await pool.query(
    `UPDATE product_images SET stock = $1 WHERE id = $2 AND product_id = $3 RETURNING *`,
    [req.body.stock, req.params.imageId, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Photo introuvable.' });
  res.json(result.rows[0]);
});

/** DELETE /api/supplier/products/:id/images/:imageId — retire une photo de la galerie */
router.delete('/products/:id/images/:imageId', async (req, res) => {
  const product = await pool.query(`SELECT id FROM products WHERE id = $1 AND supplier_id = $2`, [req.params.id, req.user.id]);
  if (product.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

  const result = await pool.query(
    `DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING id`,
    [req.params.imageId, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Photo introuvable.' });
  res.json({ message: 'Photo supprimée.' });
});

/** PATCH /api/supplier/products/:id/deactivate — retire un produit actif de la vente (réversible par l'admin) */
router.patch('/products/:id/deactivate', async (req, res) => {
  const result = await pool.query(
    `UPDATE products SET status = 'inactive' WHERE id = $1 AND supplier_id = $2 AND status = 'active' RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable ou pas actif.' });
  res.json(result.rows[0]);
});

/**
 * DELETE /api/supplier/products/:id
 * Suppression DÉFINITIVE, quel que soit le statut (en attente, rejeté,
 * en ligne ou retiré). Les photos sont supprimées avec (CASCADE). Si ce
 * produit a déjà été commandé, l'historique des commandes n'est pas
 * perdu : le nom et la couleur ont été figés dans order_items au moment
 * de l'achat, donc les commandes passées restent lisibles même après
 * la suppression du produit.
 */
router.delete('/products/:id', async (req, res) => {
  const existing = await pool.query(
    `SELECT id FROM products WHERE id = $1 AND supplier_id = $2`,
    [req.params.id, req.user.id]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Produit introuvable.' });

  await pool.query(`DELETE FROM products WHERE id = $1`, [req.params.id]);
  res.json({ message: 'Produit supprimé définitivement.' });
});

// ============================================================
// COMMANDES — visibles uniquement une fois le paiement validé par l'admin
// ============================================================

router.get('/orders', async (req, res) => {
  const result = await pool.query(
    `SELECT oi.id AS item_id, oi.quantity, oi.unit_supplier_price_ar, oi.item_status, oi.color_name,
            oi.supplier_payout_status, oi.supplier_payout_ref, oi.supplier_payout_at,
            o.id AS order_id, o.status AS order_status, o.shipping_address, o.created_at,
            COALESCE(pr.name, oi.product_name) AS product_name,
            u.full_name AS client_name, u.phone AS client_phone
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products pr ON pr.id = oi.product_id
     JOIN users u ON u.id = o.client_id
     WHERE oi.supplier_id = $1 AND o.status IN ('paid', 'shipped', 'delivered')
     ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.patch('/orders/items/:itemId', async (req, res) => {
  const { item_status } = req.body;
  if (!['shipped', 'delivered'].includes(item_status)) {
    return res.status(400).json({ error: "item_status doit être 'shipped' ou 'delivered'." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemResult = await client.query(
      `UPDATE order_items SET item_status = $1 WHERE id = $2 AND supplier_id = $3 RETURNING order_id`,
      [item_status, req.params.itemId, req.user.id]
    );
    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ligne de commande introuvable pour ce fournisseur.' });
    }
    const orderId = itemResult.rows[0].order_id;

    const allItems = await client.query(`SELECT item_status FROM order_items WHERE order_id = $1`, [orderId]);
    const statuses = allItems.rows.map((r) => r.item_status);
    if (statuses.every((s) => s === 'shipped' || s === 'delivered')) {
      const globalStatus = statuses.every((s) => s === 'delivered') ? 'delivered' : 'shipped';
      const order = await client.query(`UPDATE orders SET status = $1 WHERE id = $2 RETURNING client_id`, [globalStatus, orderId]);
      await notify(client, {
        userId: order.rows[0].client_id,
        orderId,
        type: globalStatus === 'delivered' ? 'order_delivered' : 'order_shipped',
        message: globalStatus === 'delivered'
          ? `Ta commande #${orderId} a été livrée 📦`
          : `Ta commande #${orderId} a été expédiée, elle arrive bientôt 🚚`,
      });
    }

    await client.query('COMMIT');
    res.json({ message: 'Statut mis à jour.', item_status, order_id: orderId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

module.exports = router;
