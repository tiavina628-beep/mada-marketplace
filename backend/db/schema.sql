-- ============================================================
-- Schéma PostgreSQL — Baobab Market (v2)
-- ============================================================
-- Changements clés par rapport à la v1 :
--  - Les produits sont proposés par le FOURNISSEUR (plus par l'admin),
--    l'admin les VALIDE (approuve/rejette) et fixe le prix public.
--  - Deux prix distincts par produit : prix fournisseur (coût) et
--    prix public (prix de vente), la différence = marge plateforme.
--  - Paiement mobile money manuel : le client indique une référence de
--    transaction après avoir lui-même effectué le virement, l'admin
--    valide ensuite. Pas d'appel API automatique pour l'instant.
--  - Reversement fournisseur tracé séparément (référence du virement
--    fait par l'admin vers le fournisseur).
-- ============================================================

DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS product_status CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS payment_provider CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS payout_status CASCADE;

CREATE TYPE user_role AS ENUM ('client', 'admin', 'supplier');

-- pending_review : proposé par le fournisseur, en attente de validation admin
-- active         : validé par l'admin, visible dans la boutique
-- rejected       : refusé par l'admin (le fournisseur peut corriger et resoumettre)
-- inactive       : retiré de la boutique (par l'admin ou l'auteur, après avoir été actif)
CREATE TYPE product_status AS ENUM ('pending_review', 'active', 'rejected', 'inactive');

CREATE TYPE order_status AS ENUM (
  'pending_payment',
  'awaiting_verification',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
  'payment_rejected'
);

CREATE TYPE payment_provider AS ENUM ('mvola', 'orange_money', 'airtel_money');
CREATE TYPE payment_status AS ENUM ('submitted', 'confirmed', 'rejected');
CREATE TYPE payout_status AS ENUM ('pending', 'paid');
CREATE TYPE notification_type AS ENUM ('payment_rejected', 'payment_confirmed', 'order_shipped', 'order_delivered', 'general');

-- ------------------------------------------------------------
-- Utilisateurs
-- ------------------------------------------------------------
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  role          user_role NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  phone         VARCHAR(20) NOT NULL,
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users(role);

-- ------------------------------------------------------------
-- Produits — proposés par le fournisseur, validés par l'admin
-- ------------------------------------------------------------
CREATE TABLE products (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  supplier_price_ar NUMERIC(12,2) NOT NULL CHECK (supplier_price_ar >= 0),
  public_price_ar   NUMERIC(12,2) CHECK (public_price_ar IS NULL OR public_price_ar >= supplier_price_ar),
  stock             INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url         TEXT,
  status            product_status NOT NULL DEFAULT 'pending_review',
  rejection_reason  TEXT,
  supplier_id       INTEGER NOT NULL REFERENCES users(id),
  reviewed_by       INTEGER REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_supplier ON products(supplier_id);

-- ------------------------------------------------------------
-- Commandes
-- ------------------------------------------------------------
CREATE TABLE orders (
  id                SERIAL PRIMARY KEY,
  client_id         INTEGER NOT NULL REFERENCES users(id),
  status            order_status NOT NULL DEFAULT 'pending_payment',
  total_amount_ar   NUMERIC(12,2) NOT NULL CHECK (total_amount_ar >= 0),
  shipping_address  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
  id                      SERIAL PRIMARY KEY,
  order_id                INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id              INTEGER NOT NULL REFERENCES products(id),
  supplier_id             INTEGER NOT NULL REFERENCES users(id),
  quantity                INTEGER NOT NULL CHECK (quantity > 0),
  unit_public_price_ar    NUMERIC(12,2) NOT NULL,
  unit_supplier_price_ar  NUMERIC(12,2) NOT NULL,
  item_status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  supplier_payout_status  payout_status NOT NULL DEFAULT 'pending',
  supplier_payout_ref     VARCHAR(120),
  supplier_payout_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_supplier ON order_items(supplier_id);
CREATE INDEX idx_order_items_payout ON order_items(supplier_payout_status);

-- ------------------------------------------------------------
-- Paiements — validation manuelle par référence
-- ------------------------------------------------------------
CREATE TABLE payments (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider          payment_provider NOT NULL,
  phone_number      VARCHAR(20) NOT NULL,
  amount_ar         NUMERIC(12,2) NOT NULL,
  client_reference  VARCHAR(120) NOT NULL,
  status            payment_status NOT NULL DEFAULT 'submitted',
  admin_note        TEXT,
  verified_by       INTEGER REFERENCES users(id),
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);

-- ------------------------------------------------------------
-- Notifications — informer le client (paiement rejeté/validé, etc.)
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  type        notification_type NOT NULL DEFAULT 'general',
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read);

-- ------------------------------------------------------------
-- Notifications — informer le client (paiement rejeté, validé, etc.)
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  type        VARCHAR(40) NOT NULL DEFAULT 'info', -- 'payment_rejected' | 'payment_confirmed' | 'info'
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);

-- ------------------------------------------------------------
-- Trigger générique pour updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
