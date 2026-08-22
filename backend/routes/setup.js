const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const router = express.Router();

/**
 * GET /api/setup/migrate
 *
 * Route pensée pour un déploiement fait entièrement depuis un téléphone
 * (ex: sur Render), sans accès à un terminal. Elle permet de :
 *   1) appliquer le schéma SQL (une seule fois — elle vérifie d'abord
 *      si les tables existent déjà),
 *   2) créer le premier compte admin dans la foulée,
 * simplement en visitant une URL depuis un navigateur mobile.
 *
 * Protégée par un token secret (SETUP_TOKEN dans les variables d'env).
 *
 * ⚠️ Une fois la mise en route terminée, il est recommandé de retirer
 * cette route (ou de changer SETUP_TOKEN) pour ne pas la laisser
 * accessible indéfiniment en production.
 *
 * Exemple d'URL à visiter depuis le téléphone :
 * https://ton-backend.onrender.com/api/setup/migrate
 *   ?token=TON_SETUP_TOKEN
 *   &admin_email=admin@example.mg
 *   &admin_password=MotDePasseSolide123!
 *   &admin_name=Admin+Principal
 *   &admin_phone=0340000000
 */
router.get('/migrate', async (req, res) => {
  const { token, admin_email, admin_password, admin_name, admin_phone } = req.query;

  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) {
    return res.status(403).json({ error: 'Token de setup invalide ou manquant.' });
  }

  const log = [];

  try {
    // 1) Le schéma est-il déjà appliqué ?
    const check = await pool.query(`SELECT to_regclass('public.users') AS exists`);
    if (!check.rows[0].exists) {
      const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schemaSql);
      log.push('Schéma SQL appliqué avec succès (tables créées).');
    } else {
      log.push('Schéma déjà présent — étape ignorée.');
    }

    // 2) Création du premier admin, si des paramètres sont fournis
    if (admin_email && admin_password && admin_name && admin_phone) {
      if (admin_password.length < 8) {
        log.push('Mot de passe admin ignoré : 8 caractères minimum requis.');
      } else {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [admin_email]);
        if (existing.rows.length > 0) {
          log.push(`Un compte existe déjà avec l'email ${admin_email} — création ignorée.`);
        } else {
          const password_hash = await bcrypt.hash(admin_password, 10);
          await pool.query(
            `INSERT INTO users (role, email, password_hash, full_name, phone)
             VALUES ('admin', $1, $2, $3, $4)`,
            [admin_email, password_hash, admin_name, admin_phone]
          );
          log.push(`Compte admin créé : ${admin_email}`);
        }
      }
    } else {
      log.push('Aucun paramètre admin_* fourni — création du compte admin ignorée.');
    }

    res.json({ status: 'ok', log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', error: err.message, log });
  }
});

/**
 * GET /api/setup/reset
 *
 * ⚠️ DANGER : supprime TOUTES les données (users, products, orders...)
 * et réapplique le schéma depuis zéro. Utile uniquement en phase de
 * développement/test, avant l'arrivée de vraies données de production.
 *
 * Protégée par SETUP_TOKEN + confirmation explicite (confirm=RESET).
 */
router.get('/reset', async (req, res) => {
  const { token, confirm, admin_email, admin_password, admin_name, admin_phone } = req.query;

  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) {
    return res.status(403).json({ error: 'Token de setup invalide ou manquant.' });
  }
  if (confirm !== 'RESET') {
    return res.status(400).json({
      error: "Ajoute &confirm=RESET à l'URL pour confirmer la suppression complète des données.",
    });
  }

  const log = [];
  try {
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schemaSql);
    log.push('Base réinitialisée avec le nouveau schéma.');

    if (admin_email && admin_password && admin_name && admin_phone && admin_password.length >= 8) {
      const password_hash = await bcrypt.hash(admin_password, 10);
      await pool.query(
        `INSERT INTO users (role, email, password_hash, full_name, phone)
         VALUES ('admin', $1, $2, $3, $4)`,
        [admin_email, password_hash, admin_name, admin_phone]
      );
      log.push(`Compte admin recréé : ${admin_email}`);
    } else {
      log.push('Aucun compte admin recréé — fournis admin_email/admin_password/admin_name/admin_phone si besoin.');
    }

    res.json({ status: 'ok', log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', error: err.message, log });
  }
});

/**
 * GET /api/setup/migrate-notifications
 *
 * Migration additive et sûre : crée uniquement la table `notifications`
 * si elle n'existe pas encore, SANS toucher au reste des données
 * (contrairement à /reset qui efface tout). À utiliser une fois après
 * la mise à jour du code, pour les bases déjà en production.
 */
router.get('/migrate-notifications', async (req, res) => {
  const { token } = req.query;
  if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) {
    return res.status(403).json({ error: 'Token de setup invalide ou manquant.' });
  }

  try {
    const check = await pool.query(`SELECT to_regclass('public.notifications') AS exists`);
    if (check.rows[0].exists) {
      return res.json({ status: 'ok', log: ['Table notifications déjà présente — rien à faire.'] });
    }

    await pool.query(`
      CREATE TABLE notifications (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        type        VARCHAR(40) NOT NULL DEFAULT 'info',
        message     TEXT NOT NULL,
        is_read     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id);
    `);

    res.json({ status: 'ok', log: ['Table notifications créée avec succès.'] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

module.exports = router;
