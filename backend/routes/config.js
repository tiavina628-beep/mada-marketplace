const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

/**
 * GET /api/config/payment-numbers
 * PUBLIC — pas besoin de compte pour voir où transférer l'argent.
 * Les numéros sont configurés par l'admin depuis l'interface (onglet
 * Paramètres), stockés en base — pas de redéploiement nécessaire pour
 * les changer. On renvoie aussi le nom du titulaire du compte mobile
 * money, affiché au client pour vérifier qu'il transfère au bon endroit.
 */
router.get('/payment-numbers', async (req, res) => {
  try {
    const result = await pool.query(`SELECT provider, phone_number, account_name FROM platform_settings`);
    const numbers = {};
    for (const row of result.rows) {
      numbers[row.provider] = row.phone_number
        ? { phone_number: row.phone_number, account_name: row.account_name || null }
        : null;
    }
    res.json(numbers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
