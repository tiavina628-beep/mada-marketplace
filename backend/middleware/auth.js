const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

/**
 * Vérifie le token JWT envoyé dans l'en-tête Authorization: Bearer <token>,
 * puis vérifie que le compte est toujours actif en base (pour qu'une
 * suppression ou désactivation de compte prenne effet immédiatement,
 * sans attendre l'expiration naturelle du token).
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query('SELECT is_active FROM users WHERE id = $1', [payload.id]);
    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Compte désactivé ou supprimé.' });
    }

    req.user = payload; // { id, role, email, full_name }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session invalide ou expirée.' });
  }
}

/**
 * Restreint l'accès à une ou plusieurs roles.
 * Usage : requireRole('admin') ou requireRole('admin', 'supplier')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé pour ce rôle." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
