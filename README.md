# Baobab Bazar — Boutique en ligne avec paiement mobile money

## ⚠️ Version 12 — annulation de commande côté client

- **Le client peut annuler sa commande lui-même**, tant que le paiement n'a pas encore été validé par l'admin (statuts : en attente de paiement, en vérification, ou paiement rejeté). Le stock est automatiquement restitué (par couleur si le produit en a, sinon stock global).
- **Limite volontaire** : une fois le paiement confirmé par l'admin, la commande est déjà transmise au fournisseur et sa part déjà créditée sur son solde — l'annulation n'est alors plus libre-service (ça éviterait de devoir reprendre de l'argent déjà versé). Le client doit passer par le feedback pour ce cas, l'admin gère à la main.

Aucune réinitialisation de base nécessaire.

---

## Version 11 — catégories et filtres produits

- **Catégories** : le fournisseur choisit une catégorie à la proposition d'un produit (Alimentation, Mode & Vêtements, Électronique, Maison & Déco, Beauté & Santé, Enfants & Bébés, Sports & Loisirs, Autre). Modifiable tant que le produit n'est pas encore validé.
- **Filtres côté boutique** : chips de catégories cliquables (n'affichent que celles réellement utilisées dans le catalogue), tri (plus récents / prix croissant / prix décroissant / mieux notés), et fourchette de prix min/max. Un bouton "↺ Réinitialiser" remet tout à zéro.
- **Visible aussi côté admin et fournisseur** : colonne catégorie dans les tableaux catalogue, et dans les cartes "À valider" pour que l'admin voie la catégorie déclarée avant validation.

⚠️ Aucune réinitialisation de base nécessaire — la migration ajoute automatiquement la colonne `category` (valeur par défaut `"Autre"` pour les produits déjà existants).

---

## Version 10 — installable comme une vraie application (PWA)

Les 3 interfaces (client, admin, fournisseur) sont maintenant des **Progressive Web Apps** :
- **Installable sur l'écran d'accueil** — icône, lancement en plein écran (sans barre d'adresse du navigateur), comme une appli native.
- **Bandeau d'installation automatique** — proposé une fois par appareil (Android/Chrome via un vrai bouton "Installer" ; iOS/Safari avec des instructions, car Apple n'autorise pas l'installation automatique).
- **Fonctionnement minimal hors-ligne** — un service worker garde en cache les fichiers de l'appli (HTML/CSS/JS) et les dernières données déjà chargées (catalogue, commandes...), donc l'appli s'ouvre même sans réseau, avec les dernières données connues. Toute action qui modifie des données (commande, paiement, validation...) exige toujours une vraie connexion, pour la sécurité.
- **Icônes** générées à partir du logo baobab existant (192×192, 512×512, et une version pour iOS).

### Comment tester après déploiement
1. Ouvre le site sur ton téléphone (Chrome sur Android, Safari sur iPhone).
2. Android : un bandeau "Installer" apparaît en bas — appuie dessus, ou utilise le menu ⋮ → "Ajouter à l'écran d'accueil".
3. iPhone : appuie sur le bouton Partager 📤 → "Sur l'écran d'accueil".
4. Une icône Baobab Bazar apparaît sur ton écran d'accueil, qui ouvre l'appli en plein écran.

⚠️ Aucun changement côté base de données pour cette version — uniquement des fichiers statiques ajoutés (`manifest.json`, `sw.js`, dossier `icons/`). Redéploie simplement les 3 sites statiques.

---


- **Stock par couleur** : chaque couleur d'un produit a maintenant son propre stock, affiché à côté de son nom (ex: "Rouge (3)"). Une couleur épuisée est visuellement barrée et non sélectionnable — impossible de commander une couleur indisponible, vérifié et verrouillé côté serveur (pas seulement côté affichage).
- **Suppression définitive par le fournisseur** : possible désormais quel que soit le statut du produit (en ligne, en attente ou rejeté). L'historique des commandes déjà passées reste intact et lisible : le nom du produit et la couleur commandée sont figés dans la commande au moment de l'achat, donc rien ne se casse même après suppression du produit. Le bouton "Retirer" (réversible) reste disponible séparément pour les produits en ligne.
- **Description en plein écran** : "Afficher plus" ouvre maintenant une visionneuse plein écran (comme la photo agrandie), au lieu d'étirer la carte produit.
- **Bouton profil remplacé par l'avatar** : côté client, le bouton texte "Mon profil" a été retiré — c'est maintenant la photo de profil elle-même (ou une silhouette par défaut) qui sert de bouton, positionnée tout à droite du header.
- **Sécurité du solde fournisseur** : audit complet — aucune faille trouvée (le solde n'est jamais assigné directement depuis une valeur envoyée par le client, uniquement incrémenté/décrémenté côté serveur avec verrouillage transactionnel). Ajout d'une contrainte en base interdisant tout solde négatif, et d'une limite de fréquence sur les demandes de retrait.

⚠️ Important : la commande d'un produit avec couleurs exige maintenant une couleur choisie (`color_name`) — si tu avais du code ou des scripts externes qui appellent l'API `/api/orders` directement, pense à l'adapter. Aucune réinitialisation de base nécessaire, la migration est automatique.

---


- **Correctif** : les numéros de paiement affichaient "[object Object]" dans le formulaire de commande — corrigé, le numéro **et** le nom du titulaire du compte s'affichent maintenant correctement.
- **Chargement global** : chaque appel réseau (n'importe lequel) affiche désormais une animation du logo Baobab Bazar en plein écran, qui **bloque les clics** pendant ce temps — plus de doublons possibles (double-commande, double-clic sur "Valider"...).
- **Confirmations Oui/Non** : toutes les actions sensibles (déconnexion, suppression de compte, rejet de paiement...) utilisent maintenant une modale personnalisée à deux boutons, sur les 3 interfaces — plus de popup navigateur générique.
- **Avatar en haut à gauche** : photo de profil visible en petit format à côté du logo, sur les 3 interfaces. Dans l'onglet profil, la photo est bien affichée au-dessus du bouton "Changer la photo", avec une silhouette par défaut si aucune photo n'est encore choisie.
- **Galerie produit interactive** : cliquer "Agrandir" ouvre une visionneuse plein écran avec **glissement tactile gauche/droite** entre les photos, et le nom de la couleur affiché en bas **dans une teinte qui correspond** (rouge écrit en rouge, bleu en bleu...).
- **Avis clients** : après une livraison, le client peut noter (1 à 5 étoiles) et commenter un produit. La note moyenne s'affiche sur chaque fiche produit du catalogue.
- **Feedback** : clients et fournisseurs peuvent écrire directement à l'administration (bouton "Nous écrire" côté client, panneau dédié côté fournisseur) ; l'admin les consulte dans un nouvel onglet "💬 Feedback".
- **Sécurité renforcée** : en-têtes de sécurité (Helmet), limitation anti-bruteforce sur les connexions/inscriptions (30 tentatives / 15 min par IP), CORS configurable via `ALLOWED_ORIGINS`.
- **Suppression de produit rejeté côté fournisseur** : vérifié fonctionnel (déjà en place depuis une version précédente).

⚠️ Le backend a deux nouvelles dépendances (`helmet`, `express-rate-limit`) — Render les installera automatiquement au prochain déploiement (`npm install` fait partie du build). Aucune réinitialisation de base nécessaire, la migration est automatique.

---


- **Nouveau nom : Baobab Bazar** (garde l'ancrage Madagascar, "bazar" évoque bien "on vend un peu de tout" sans reprendre "market").
- **Galerie photo (jusqu'à 5) + couleurs** : le fournisseur ajoute plusieurs photos par produit, avec une couleur optionnelle par photo. Côté boutique, cliquer une couleur affiche la photo correspondante ; des miniatures permettent aussi de parcourir toutes les photos.
- **Description "Afficher plus/moins"** : tronquée par défaut, dépliable au clic.
- **Confirmation avant déconnexion** sur les 3 interfaces.
- **"Bonjour [nom]" et le logo/nom de la boutique agrandis**.
- **Portefeuille recentré définitivement sur le fournisseur, retrait uniquement** : plus de dépôt (ses gains sont crédités automatiquement à chaque vente). Le client n'a plus de portefeuille du tout — chaque commande se paie directement par référence, avec le bouton "📲 Composer".
- **Numéros de paiement configurables par l'admin depuis l'interface** (onglet Paramètres), avec le **nom du titulaire du compte** affiché aux clients/fournisseurs pour vérifier qu'ils transfèrent au bon endroit — fini les variables d'environnement à éditer sur Render.
- **Plus de notifications pour admin/fournisseur** : remplacées par de petites pastilles numériques directement sur les boutons d'onglet (produits à valider, transactions, retraits en attente, commandes à préparer...). Le client garde ses notifications (paiement validé/rejeté, expédition, livraison).
- **Le fournisseur peut voir à quoi ressemble la boutique** (nouvel onglet "🛍️ Voir la boutique", aperçu en lecture seule du catalogue public).
- **Renforcement de la confiance** : bandeau "produits vérifiés / paiement vérifié manuellement / vendeurs à Madagascar" sur la page d'accueil et le pied de page.

⚠️ Comme pour les versions précédentes, **aucune réinitialisation de base n'est nécessaire** — tout passe par la migration automatique au démarrage du serveur.

---


- **Numéros de réception réels** : les faux numéros codés en dur (`034 00 000 00`...) sont remplacés par de vrais numéros configurables **sans toucher au code**, via 3 variables d'environnement sur Render : `MVOLA_RECEIVE_NUMBER`, `ORANGE_MONEY_RECEIVE_NUMBER`, `AIRTEL_MONEY_RECEIVE_NUMBER`. Tant qu'un numéro n'est pas renseigné, le site affiche "Non configuré" plutôt qu'un faux numéro.
- **Bouton "📲 Composer"** : ouvre directement le menu mobile money du bon opérateur sur le téléphone (Mvola `#111#`, Orange Money `#144#`, Airtel Money `*436#` — codes confirmés par les opérateurs). ⚠️ Il n'existe pas de code officiel public pour pré-remplir automatiquement le numéro et le montant : le menu s'ouvre, et le numéro + montant à saisir restent affichés à l'écran à côté, pour éviter tout risque d'erreur de transfert avec un code non vérifié.
- **Rôles du portefeuille corrigés** :
  - **Client** : dépôt ET retrait.
  - **Fournisseur** : dépôt uniquement (ses gains sont crédités automatiquement à chaque commande payée ; pas de retrait libre-service).
  - **Admin** : aucun portefeuille personnel — il valide seulement les mouvements des autres.

⚠️ **Pense à renseigner les 3 variables `*_RECEIVE_NUMBER`** dans les Environment Variables de ton service backend sur Render avec de vrais numéros, sinon le bouton "Composer" reste désactivé et les clients/fournisseurs ne sauront pas où transférer l'argent.

---

## Version 5 — menu fixe, notifications supprimables (3 rôles), portefeuille intégré

- **Menu admin/fournisseur toujours visible** : sur mobile, le menu ne glisse plus horizontalement — il se replie sur plusieurs lignes pour rester entièrement lisible sans swiper.
- **Onglet "🏠 Aperçu"** côté admin : cartes cliquables montrant tout d'un coup d'œil (produits à valider, transactions, dépôts/retraits en attente, produits en ligne, fournisseurs actifs).
- **Notifications sur les 3 interfaces** (client, admin, fournisseur), avec suppression individuelle ou totale par chacun. Déclenchées automatiquement : nouveau produit à valider, nouvelle transaction, produit approuvé/rejeté, nouvelle commande reçue, paiement validé/rejeté, expédition/livraison, dépôt/retrait validé/rejeté.
- **Portefeuille intégré ("solde Baobab Bazar")** pour clients et fournisseurs :
  - **Dépôt** : l'utilisateur transfère lui-même l'argent puis indique une référence ; l'admin valide → le solde augmente.
  - **Retrait** : demandé par l'utilisateur (le montant est réservé immédiatement) ; l'admin envoie l'argent puis confirme avec sa propre référence de virement.
  - **Gains fournisseur automatiques** : à la validation d'un paiement client, la part de chaque fournisseur concerné est **créditée automatiquement** sur son portefeuille (remplace l'ancien système de "reversement manuel par commande").

⚠️ Comme pour la v4, **aucune réinitialisation de base n'est nécessaire** — tout passe par la migration automatique au démarrage du serveur (`db/migrate.js`), qui ajoute la table `notifications`, la table `wallet_entries` et le champ `balance_ar` sans toucher aux données existantes.

---

- **Renommage** : "Marketplace Mada" devient **Baobab Bazar**, avec un nouveau logo (silhouette de baobab, l'arbre emblématique de Madagascar) sur les 3 interfaces.
- **Thème noir** sur la boutique client (fond sombre, accents jaune/rose/violet vifs). Admin et fournisseur restent en thème clair (tableaux de bord).
- **En-tête agrandi** côté boutique : logo et nom plus grands et plus visibles.
- **Notifications client** : nouvelle table `notifications`. Quand l'admin rejette un paiement (ex: montant transféré incorrect) ou le valide, le client reçoit une notification visible via la cloche 🔔 dans le header, avec badge de compteur non lu.

---

## ⚠️ Version 3 — style, favoris, upload de photos, politique de confidentialité

- **Nouveau design** côté boutique client, inspiré d'une référence fournie : bordures épaisses, ombres portées franches, palette vive (jaune "zap", rose "pop", violet "grape"), polices Baloo 2 / Poppins / Space Mono.
- **Icônes panier 🛍️ et favoris ♡** dans le header, avec badges de compteur. Les favoris sont stockés dans le navigateur (localStorage), pas besoin de compte pour les utiliser.
- **Photos uploadées directement**, plus d'URL à copier-coller : compression automatique côté navigateur (redimensionnement + JPEG qualité réduite) puis envoi en base64, pour les photos de profil (3 interfaces) et les photos produit (fournisseur). Aucun service de stockage externe requis.
- **Responsive renforcé** : grille produits qui s'adapte (jusqu'à 1 colonne sur très petit écran), tableaux admin/fournisseur scrollables horizontalement plutôt que cassés, sidebar mobile qui scroll au lieu de déborder.
- **Politique de confidentialité** ajoutée (`frontend/client/politique-confidentialite.html`), conforme à la loi malgache n°2014-038, liée depuis le pied de page de la boutique.
- **Suppression de compte** : confirmé disponible pour les 3 rôles (client, fournisseur, admin), avec confirmation avant suppression — déjà en place depuis la v2.

⚠️ Comme les photos sont désormais stockées en base64 directement en base de données (colonnes `image_url` / `avatar_url`, déjà de type `TEXT`), **aucune migration de schéma n'est nécessaire** pour cette version — pas besoin de relancer `/api/setup/reset`.

---


## ⚠️ Version 2 — changements de workflow importants

Cette version change des règles clés par rapport à la v1 :

- **Les produits sont proposés par le fournisseur**, pas par l'admin. L'admin ne fait que **valider** (fixe le prix public) ou **rejeter** (avec motif) une proposition. Statuts d'un produit : `pending_review` → `active` (ou `rejected`).
- **Deux prix par produit** : `supplier_price_ar` (ce que le fournisseur demande) et `public_price_ar` (prix affiché au client, fixé par l'admin à la validation). La différence est la marge de la plateforme, calculée automatiquement à chaque commande.
- **Paiement manuel avec référence** : plus d'appel API automatique. Le client transfère lui-même l'argent vers un numéro affiché dans l'app, puis indique la référence reçue par SMS. L'admin vérifie et valide dans l'onglet "Transactions".
- **Transmission automatique au fournisseur** : dès que l'admin valide un paiement, la commande devient immédiatement visible côté fournisseur (adresse de livraison incluse), sans étape manuelle supplémentaire.
- **Reversement fournisseur tracé** : l'admin transfère lui-même (hors app) la part du fournisseur, puis enregistre la référence de ce virement dans l'onglet "Reversements".
- **Photo de profil** modifiable sur les 3 interfaces (`avatar_url`, une URL externe comme pour les images produit).

⚠️ **Le schéma de base de données a changé.** Si tu avais déjà des données avec la v1, il faut réinitialiser la base — voir la section "Mise à jour depuis la v1" plus bas.

---


Application complète : backend Node.js/Express + PostgreSQL, et 3 interfaces web
statiques indépendantes (client, administration, fournisseur).

## Architecture

```
mada-marketplace/
├── backend/
│   ├── db/schema.sql          → schéma PostgreSQL complet
│   ├── db/pool.js             → connexion PostgreSQL
│   ├── middleware/auth.js     → JWT + contrôle de rôle
│   ├── routes/auth.js         → inscription client / connexion (tous rôles)
│   ├── routes/products.js     → catalogue PUBLIC (sans compte)
│   ├── routes/orders.js       → commande + paiement (client connecté uniquement)
│   ├── routes/admin.js        → produits, fournisseurs, commandes/paiements
│   ├── routes/supplier.js     → commandes assignées au fournisseur connecté
│   ├── utils/mobileMoney.js   → abstraction Mvola / Orange Money / Airtel Money
│   ├── scripts/seed.js        → création du 1er compte admin
│   └── server.js
└── frontend/
    ├── client/     → boutique publique (index.html, css/, js/)
    ├── admin/      → back-office administration
    └── supplier/   → espace fournisseur (page à part, jamais liée au site client)
```

## Comment les règles demandées sont implémentées

- **Base PostgreSQL unique** pour produits, comptes clients, admin et fournisseurs
  (table `users` avec un enum `role`, tables `products`, `orders`, `order_items`, `payments`).
- **L'administration ajoute/retire les produits** : `POST/PATCH/DELETE /api/admin/products`
  (le "retrait" passe le produit en `status='inactive'`, il disparaît alors du catalogue public).
- **Catalogue visible sans compte** : `GET /api/products` est public, aucune authentification requise.
- **Compte obligatoire uniquement au moment de commander** : le panier fonctionne sans compte
  côté client (JS en mémoire), mais `POST /api/orders` exige un token JWT avec le rôle `client`.
  Le frontend ouvre automatiquement le formulaire de création de compte quand on clique sur
  "Commander" sans être connecté.
- **Pas d'auto-inscription fournisseur** : il n'existe aucune route publique pour créer un
  compte fournisseur. Seul un admin connecté peut le faire via `POST /api/admin/suppliers`.
- **Page fournisseur non associée à l'interface client** : `frontend/supplier/` est un dossier
  HTML/CSS/JS totalement séparé de `frontend/client/`, avec son propre stockage de session
  (`localStorage` sous une clé différente) — aucun lien n'existe entre les deux dans le code.
- **Contrôle admin sur produits et paiements/commandes** : l'onglet "Commandes & paiements"
  de `frontend/admin/` liste toutes les commandes avec leur statut de paiement mobile money
  en direct (`GET /api/admin/orders`), et permet de transmettre une commande payée au fournisseur.

## Installation

### 1. Base de données

```bash
createdb mada_marketplace
psql mada_marketplace -f backend/db/schema.sql
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
# Éditez .env : renseignez DATABASE_URL et JWT_SECRET au minimum

# Crée le premier compte administrateur
npm run seed -- admin@mada-marketplace.mg "MotDePasseSolide123!" "Admin Principal" "0340000000"

npm start
# API disponible sur http://localhost:4000
```

### 3. Frontend

Chaque dossier (`client`, `admin`, `supplier`) est un site statique indépendant.
Le plus simple en développement :

```bash
cd frontend/client && npx serve -l 3000
cd frontend/admin && npx serve -l 3001
cd frontend/supplier && npx serve -l 3002
```

Ou ouvrez directement les fichiers `index.html` dans le navigateur (adaptez alors
`API_BASE` en haut de chaque `js/app.js` si besoin).

## Paiement mobile money

Par défaut, `MOCK_PAYMENTS=true` dans `.env` : les paiements Mvola/Orange Money/Airtel
Money sont **simulés** (aucun vrai appel API), ce qui permet de tester tout le flux de
commande immédiatement, sans compte marchand.

Pour brancher les vraies API :
1. Obtenez vos identifiants marchands auprès de Telma (Mvola), Orange et Airtel.
2. Renseignez-les dans `.env`.
3. Passez `MOCK_PAYMENTS=false`.
4. Complétez les fonctions `callMvolaApi`, `callOrangeMoneyApi`, `callAirtelMoneyApi`
   dans `backend/utils/mobileMoney.js` avec les appels réels (chaque opérateur a sa
   propre documentation d'intégration OAuth2 + paiement marchand).

## Mise à jour depuis la v1 (réinitialisation de la base)

Le nouveau schéma n'est pas compatible avec l'ancien. En phase de test (avant
de vraies données de production), le plus simple est de tout réinitialiser
via le navigateur :

```
https://TON-BACKEND.onrender.com/api/setup/reset?token=TON_SETUP_TOKEN&confirm=RESET&admin_email=admin@mada-marketplace.mg&admin_password=MotDePasseSolide123!&admin_name=Admin+Principal&admin_phone=0340000000
```

⚠️ Ceci supprime **toutes** les données existantes (comptes, produits,
commandes) et recrée les tables vides + un compte admin. Le paramètre
`confirm=RESET` est obligatoire pour éviter un déclenchement accidentel.

Après ça, redéploie aussi les 3 sites statiques (Manual Deploy) pour que le
nouveau frontend (nouveaux formulaires, nouveaux statuts) soit servi.

## Déploiement sur Render — 100% depuis un navigateur (téléphone compris)

Cette méthode ne demande aucun terminal : tout se fait via le dashboard Render
et une URL à visiter dans le navigateur.

### 1. Mettre le code sur GitHub
Depuis github.com (fonctionne dans un navigateur mobile) : crée un dépôt, puis
"Add file → Upload files" et dépose le contenu du dossier `mada-marketplace/`.

### 2. Créer la base PostgreSQL
Sur render.com : **New +** → **PostgreSQL** → plan gratuit → créer.
Une fois créée, copie l'**Internal Database URL** affichée sur la page de la base.

### 3. Créer le service backend
**New +** → **Web Service** → connecte le dépôt GitHub.
- Root Directory : `backend`
- Build Command : `npm install`
- Start Command : `npm start`

Dans l'onglet **Environment**, ajoute :
- `DATABASE_URL` = l'Internal Database URL copiée à l'étape 2
- `JWT_SECRET` = une chaîne aléatoire longue
- `SETUP_TOKEN` = une autre chaîne secrète, choisie par toi
- `MOCK_PAYMENTS` = `true` (tant que tu n'as pas d'accès marchand mobile money)

Clique sur **Create Web Service** et attends que le déploiement passe à "Live".
Note l'URL fournie (ex : `https://mada-backend.onrender.com`).

### 4. Initialiser la base et créer le premier admin — juste une URL à visiter
Une fois le backend "Live", ouvre cette URL dans ton navigateur (adapte les valeurs) :

```
https://mada-backend.onrender.com/api/setup/migrate?token=TON_SETUP_TOKEN&admin_email=admin@mada-marketplace.mg&admin_password=MotDePasseSolide123!&admin_name=Admin+Principal&admin_phone=0340000000
```

La réponse JSON confirme la création des tables et du compte admin.
⚠️ Une fois fait, change `SETUP_TOKEN` dans les variables d'environnement Render
pour désactiver l'accès à cette route.

### 5. Déployer les 3 interfaces frontend (sites statiques)
Avant de déployer, édite `API_BASE` en haut de chaque fichier `js/app.js`
(`frontend/client/`, `frontend/admin/`, `frontend/supplier/`) directement sur
GitHub (bouton crayon "Edit" sur la page du fichier, ça marche au téléphone)
pour remplacer `http://localhost:4000/api` par
`https://mada-backend.onrender.com/api`.

Puis, pour chacun des 3 dossiers, sur Render : **New +** → **Static Site** →
même dépôt → Root Directory = `frontend/client` (puis répéter pour `admin` et
`supplier`) → Build Command vide → Publish directory = `.`

Tu obtiens 3 URLs Render distinctes, une par interface — exactement la
séparation demandée entre boutique, administration et espace fournisseur.

## Prochaines étapes suggérées

- Ajouter l'upload d'images produit (actuellement, on renseigne une URL) — au besoin
  je peux ajouter un stockage local ou S3-compatible.
- Ajouter un webhook de confirmation asynchrone (les vraies API mobile money confirment
  souvent le paiement par callback, pas de façon synchrone comme dans ce mock).
- Ajouter la pagination sur les listes de produits/commandes si le volume grossit.
