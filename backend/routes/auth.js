const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/**
 * POST /api/auth/register
 * Inscription — réservée aux CLIENTS uniquement.
 * (Les comptes admin et fournisseur sont créés par un admin via /api/admin/users)
 */
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Email invalide'),
    body('password').isLength({ min: 8 }).withMessage('Mot de passe : 8 caractères minimum'),
    body('full_name').trim().notEmpty().withMessage('Nom complet requis'),
    body('phone').trim().notEmpty().withMessage('Numéro de téléphone requis'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, full_name, phone } = req.body;

    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

      const result = await pool.query(
        `INSERT INTO users (role, email, password_hash, full_name, phone)
         VALUES ('client', $1, $2, $3, $4)
         RETURNING id, role, email, full_name, phone, avatar_url, created_at`,
        [email, password_hash, full_name, phone]
      );

      const user = result.rows[0];
      const token = signToken(user);
      res.status(201).json({ token, user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur lors de l\'inscription.' });
    }
  }
);

/**
 * POST /api/auth/login
 * Connexion commune à tous les rôles (client, admin, supplier).
 * Le frontend redirige ensuite vers la bonne interface selon user.role.
 */
router.post(
  '/login',
  [body('email').isEmail(), body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0];

      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'Identifiants incorrects ou compte désactivé.' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Identifiants incorrects.' });
      }

      const token = signToken(user);
      const { password_hash, ...safeUser } = user;
      res.json({ token, user: safeUser });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
    }
  }
);

/**
 * GET /api/auth/me
 * Profil du compte connecté, quel que soit le rôle.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, role, email, full_name, phone, avatar_url, is_active, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * PATCH /api/auth/me
 * Modifier son propre profil (nom, téléphone, email, mot de passe).
 * Le changement de mot de passe exige de fournir current_password.
 */
router.patch(
  '/me',
  requireAuth,
  [
    body('full_name').optional().trim().notEmpty(),
    body('phone').optional().trim().notEmpty(),
    body('email').optional().isEmail(),
    body('new_password').optional().isLength({ min: 8 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { full_name, phone, email, avatar_url, current_password, new_password } = req.body;

    try {
      const current = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      const user = current.rows[0];
      if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

      const updates = [];
      const values = [];
      let i = 1;

      if (full_name) { updates.push(`full_name = $${i++}`); values.push(full_name); }
      if (phone) { updates.push(`phone = $${i++}`); values.push(phone); }
      if (avatar_url !== undefined) { updates.push(`avatar_url = $${i++}`); values.push(avatar_url); }

      if (email && email !== user.email) {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
        if (existing.rows.length > 0) {
          return res.status(409).json({ error: 'Cet email est déjà utilisé par un autre compte.' });
        }
        updates.push(`email = $${i++}`); values.push(email);
      }

      if (new_password) {
        if (!current_password) {
          return res.status(400).json({ error: 'current_password requis pour changer le mot de passe.' });
        }
        const match = await bcrypt.compare(current_password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
        const password_hash = await bcrypt.hash(new_password, SALT_ROUNDS);
        updates.push(`password_hash = $${i++}`); values.push(password_hash);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Aucune modification fournie.' });
      }

      values.push(req.user.id);
      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${i}
         RETURNING id, role, email, full_name, phone, avatar_url, is_active, created_at`,
        values
      );

      // Un nouveau token est renvoyé si l'email a changé (il fait partie du payload JWT)
      const token = signToken(result.rows[0]);
      res.json({ user: result.rows[0], token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

/**
 * DELETE /api/auth/me
 * Suppression du compte connecté.
 *
 * Comme les commandes/produits passés référencent ce compte (historique,
 * factures, traçabilité fournisseur), on ne fait pas un vrai DELETE en base :
 * le compte est désactivé (is_active = false) et ses données de contact
 * anonymisées. L'email redevient libre pour une nouvelle inscription.
 *
 * Un admin ne peut pas supprimer son propre compte s'il est le dernier
 * compte admin actif (ça bloquerait l'accès à l'administration).
 */
router.delete('/me', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const otherAdmins = await pool.query(
        `SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = true AND id != $1`,
        [req.user.id]
      );
      if (Number(otherAdmins.rows[0].count) === 0) {
        return res.status(400).json({
          error: "Impossible de supprimer le dernier compte admin actif. Crée un autre compte admin avant de supprimer celui-ci.",
        });
      }
    }

    const anonymizedEmail = `deleted-${req.user.id}-${Date.now()}@deleted.local`;
    await pool.query(
      `UPDATE users SET is_active = false, email = $1, full_name = 'Compte supprimé', phone = '0000000000'
       WHERE id = $2`,
      [anonymizedEmail, req.user.id]
    );

    res.json({ message: 'Compte supprimé. Vous allez être déconnecté.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
