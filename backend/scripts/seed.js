/**
 * Crée le tout premier compte admin, nécessaire pour se connecter la
 * première fois (aucune interface ne permet de créer un admin autrement,
 * volontairement, pour des raisons de sécurité).
 *
 * Utilisation :
 *   node scripts/seed.js admin@example.com "MotDePasseSolide123!" "Nom Admin" "0340000000"
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

async function main() {
  const [email, password, full_name, phone] = process.argv.slice(2);

  if (!email || !password || !full_name || !phone) {
    console.error(
      'Usage : node scripts/seed.js <email> <mot_de_passe> "<nom complet>" <telephone>'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Le mot de passe doit contenir au moins 8 caractères.');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      `INSERT INTO users (role, email, password_hash, full_name, phone)
       VALUES ('admin', $1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email`,
      [email, password_hash, full_name, phone]
    );

    if (result.rows.length === 0) {
      console.log(`Un compte existe déjà avec l'email ${email}.`);
    } else {
      console.log(`Compte admin créé : ${result.rows[0].email} (id=${result.rows[0].id})`);
    }
  } catch (err) {
    console.error('Erreur lors de la création du compte admin :', err.message);
  } finally {
    await pool.end();
  }
}

main();
