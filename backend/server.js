require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const supplierRoutes = require('./routes/supplier');
const setupRoutes = require('./routes/setup');
const notificationRoutes = require('./routes/notifications');
const walletRoutes = require('./routes/wallet');
const configRoutes = require('./routes/config');
const reviewRoutes = require('./routes/reviews');
const feedbackRoutes = require('./routes/feedback');

const app = express();

// Render est derrière un proxy inverse : nécessaire pour que express-rate-limit
// identifie correctement l'IP de chaque visiteur (sinon tout le monde partage
// la même limite).
app.set('trust proxy', 1);

// En-têtes de sécurité standards (protection XSS, clickjacking, sniffing MIME...)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // nécessaire pour servir les images base64 aux 3 sites séparés
}));

// CORS configurable : par défaut ouvert (compatible avec le déploiement actuel),
// mais peut être restreint aux vrais domaines une fois connus, via la variable
// d'environnement ALLOWED_ORIGINS (séparés par des virgules).
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : null;
app.use(cors({
  origin: allowedOrigins || true,
}));

// Limite augmentée : les photos de profil/produit sont envoyées en base64
// (compressées côté navigateur avant envoi, voir frontend/*/js/image-utils.js)
app.use(express.json({ limit: '8mb' }));

// Anti-bruteforce sur les routes d'authentification (login/register) :
// 30 tentatives max par IP toutes les 15 minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/config', configRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/feedback', feedbackRoutes);

// Gestion des routes inconnues
app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }));

// Gestionnaire d'erreurs global (filet de sécurité)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur interne.' });
});

const PORT = process.env.PORT || 4000;

const { runIncrementalMigrations } = require('./db/migrate');

runIncrementalMigrations()
  .catch((err) => console.error('Erreur lors des migrations incrémentales :', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`API marketplace démarrée sur http://localhost:${PORT}`);
    });
  });
