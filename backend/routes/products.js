const express = require('express');
const pool = require('../db/pool');
const { CATEGORIES } = require('../utils/categories');

const router = express.Router();

/** GET /api/products/categories — liste fixe des catégories disponibles */
router.get('/categories', (req, res) => {
  res.json(CATEGORIES);
});

/**
 * GET /api/products
 * PUBLIC — visible même sans compte, ne montre que les produits 'active'.
 * Inclut la galerie de photos (jusqu'à 5), les couleurs disponibles, et la catégorie.
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.description, p.public_price_ar, p.stock, p.image_url, p.category, p.created_at,
              COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(r.id) AS review_count
       FROM products p
       LEFT JOIN reviews r ON r.product_id = p.id
       WHERE p.status = 'active'
       GROUP BY p.id
       ORDER BY p.created_at DESC`
    );

    const productIds = result.rows.map((p) => p.id);
    let imagesByProduct = {};
    if (productIds.length > 0) {
      const images = await pool.query(
        `SELECT product_id, image_url, color_name, stock FROM product_images
         WHERE product_id = ANY($1::int[]) ORDER BY display_order ASC, id ASC`,
        [productIds]
      );
      imagesByProduct = images.rows.reduce((acc, img) => {
        (acc[img.product_id] ||= []).push(img);
        return acc;
      }, {});
    }

    res.json(result.rows.map((p) => ({
      ...p,
      avg_rating: Number(p.avg_rating),
      review_count: Number(p.review_count),
      images: imagesByProduct[p.id] || [],
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors du chargement des produits.' });
  }
});

/**
 * GET /api/products/:id
 * PUBLIC — fiche détaillée d'un produit actif, avec sa galerie.
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, public_price_ar, stock, image_url, category, created_at
       FROM products WHERE id = $1 AND status = 'active'`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit introuvable.' });
    }
    const images = await pool.query(
      `SELECT image_url, color_name, stock FROM product_images WHERE product_id = $1 ORDER BY display_order ASC, id ASC`,
      [req.params.id]
    );
    res.json({ ...result.rows[0], images: images.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
