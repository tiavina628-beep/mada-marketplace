/**
 * Crée une notification pour un utilisateur donné.
 * @param {object} db - pool ou client (dans une transaction)
 */
async function notify(db, { userId, orderId = null, type = 'general', message }) {
  await db.query(
    `INSERT INTO notifications (user_id, order_id, type, message) VALUES ($1, $2, $3, $4)`,
    [userId, orderId, type, message]
  );
}

/**
 * Notifie tous les comptes admin actifs (ex: nouveau produit à valider,
 * nouvelle transaction à vérifier, nouvelle demande de portefeuille).
 */
async function notifyAdmins(db, { orderId = null, type = 'admin_alert', message }) {
  await db.query(
    `INSERT INTO notifications (user_id, order_id, type, message)
     SELECT id, $1, $2, $3 FROM users WHERE role = 'admin' AND is_active = true`,
    [orderId, type, message]
  );
}

module.exports = { notify, notifyAdmins };
