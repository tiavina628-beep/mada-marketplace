const pool = require('./pool');

/**
 * Migrations incrémentales, sûres à rejouer à chaque démarrage du serveur.
 * Chaque ALTER TYPE ... ADD VALUE tourne dans sa propre requête (pas
 * groupé avec d'autres instructions) pour rester compatible avec toutes
 * les versions de PostgreSQL récentes.
 */
async function addEnumValueIfMissing(typeName, value) {
  await pool.query(`ALTER TYPE ${typeName} ADD VALUE IF NOT EXISTS '${value}';`);
}

async function runIncrementalMigrations() {
  // --- Notifications (v3) ---
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE notification_type AS ENUM ('payment_rejected', 'payment_confirmed', 'order_shipped', 'order_delivered', 'general');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS notifications (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      type        notification_type NOT NULL DEFAULT 'general',
      message     TEXT NOT NULL,
      is_read     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);
  `);

  // --- Nouveaux types de notification (v4) : produits, commandes, portefeuille ---
  for (const value of ['product_approved', 'product_rejected', 'new_order', 'admin_alert', 'wallet_confirmed', 'wallet_rejected']) {
    await addEnumValueIfMissing('notification_type', value);
  }

  // --- Portefeuille (v4) ---
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_ar NUMERIC(12,2) NOT NULL DEFAULT 0;

    DO $$ BEGIN
      CREATE TYPE wallet_entry_type AS ENUM ('deposit', 'withdrawal', 'order_earning');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE wallet_entry_status AS ENUM ('pending', 'confirmed', 'rejected');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS wallet_entries (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type              wallet_entry_type NOT NULL,
      amount_ar         NUMERIC(12,2) NOT NULL CHECK (amount_ar > 0),
      provider          payment_provider,
      phone_number      VARCHAR(20),
      client_reference  VARCHAR(120),
      admin_reference   VARCHAR(120),
      order_id          INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      status            wallet_entry_status NOT NULL DEFAULT 'pending',
      admin_note        TEXT,
      verified_by       INTEGER REFERENCES users(id),
      verified_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_entries_user ON wallet_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_entries_status ON wallet_entries(status);
  `);

  // --- Paramètres de paiement (v5→v6) : vrais numéros + nom du titulaire du compte ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id             SERIAL PRIMARY KEY,
      provider       payment_provider NOT NULL UNIQUE,
      phone_number   VARCHAR(20),
      account_name   VARCHAR(120),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO platform_settings (provider) VALUES ('mvola'), ('orange_money'), ('airtel_money')
      ON CONFLICT (provider) DO NOTHING;
    ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS account_name VARCHAR(120);
  `);

  // --- Photos multiples (jusqu'à 5) + couleurs par produit (v6) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id             SERIAL PRIMARY KEY,
      product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_url      TEXT NOT NULL,
      color_name     VARCHAR(60),
      display_order  INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
  `);

  // --- Avis produits (v7) — un avis par ligne de commande livrée ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id             SERIAL PRIMARY KEY,
      order_item_id  INTEGER NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
      product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      client_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment        TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
  `);

  // --- Messages de feedback (v7) — clients et fournisseurs vers l'admin ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback_messages (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message     TEXT NOT NULL,
      is_read     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback_messages(user_id);
  `);

  // --- Sécurité portefeuille (v8) : le solde ne peut jamais devenir négatif,
  // même en cas de bug futur dans le code. Filet de sécurité en base, en
  // plus du verrouillage transactionnel déjà en place dans routes/wallet.js.
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT check_balance_nonnegative CHECK (balance_ar >= 0);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // --- Stock par couleur (v9) ---
  await pool.query(`
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS stock INTEGER;
  `);

  // --- Suppression définitive de produit par le fournisseur (v9) ---
  // Pour permettre de supprimer un produit même après avoir été commandé,
  // sans perdre la trace dans l'historique des commandes : on fige le nom
  // et la couleur dans order_items au moment de l'achat, et la référence
  // vers products devient facultative (SET NULL) au lieu de bloquer la
  // suppression.
  await pool.query(`
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name VARCHAR(255);
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS color_name VARCHAR(60);
    UPDATE order_items oi SET product_name = p.name
      FROM products p WHERE oi.product_id = p.id AND oi.product_name IS NULL;
  `);
  await pool.query(`ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;`);
  await pool.query(`ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL;`);
  await pool.query(`
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id)
      REFERENCES products(id) ON DELETE SET NULL;
  `);

  // --- Catégories produit (v11) ---
  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'Autre';
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  `);

  console.log('Migrations incrémentales appliquées (v11 : catégories produit).');
}

module.exports = { runIncrementalMigrations };
