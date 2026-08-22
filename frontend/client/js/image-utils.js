/**
 * Compresse une image choisie par l'utilisateur (photo de profil, photo
 * produit) en un data URL base64 raisonnablement léger, entièrement dans
 * le navigateur — pas besoin de service de stockage externe (S3, imgbb...).
 *
 * L'image est redimensionnée (dimension max) et réencodée en JPEG avec une
 * qualité réduite, pour éviter d'envoyer plusieurs Mo issus d'une photo de
 * téléphone directement en base64 vers le serveur.
 *
 * @param {File} file
 * @param {number} maxDim - dimension max (largeur ou hauteur) en pixels
 * @param {number} quality - qualité JPEG (0 à 1)
 * @returns {Promise<string>} data URL (ex: "data:image/jpeg;base64,...")
 */
function compressImageToDataUrl(file, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Le fichier choisi n\'est pas une image.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image invalide ou corrompue.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Ouvre le menu USSD du bon opérateur mobile money sur le téléphone —
 * la composition se fait automatiquement (pas besoin de connaître ou
 * taper le code), il ne reste plus qu'à suivre le menu et entrer le
 * code PIN.
 *
 * Note honnête : seuls les codes de MENU PRINCIPAL sont confirmés par
 * les opérateurs eux-mêmes (Mvola #111#, Orange Money #144#, Airtel
 * Money *436#). Il n'existe pas de confirmation officielle publique
 * d'un code "tout-en-un" qui pré-remplirait automatiquement le numéro
 * et le montant — utiliser un code non vérifié risquerait un mauvais
 * transfert. Le menu s'ouvre donc directement, et le numéro + montant
 * à saisir sont affichés à l'écran juste à côté.
 */
/**
 * Liste fixe de catégories — doit rester synchronisée avec CATEGORIES
 * dans backend/utils/categories.js.
 */
const CATEGORIES = [
  'Alimentation',
  'Mode & Vêtements',
  'Électronique',
  'Maison & Déco',
  'Beauté & Santé',
  'Enfants & Bébés',
  'Sports & Loisirs',
  'Autre',
];

const USSD_CODES = {
  mvola: '#111#',
  orange_money: '#144#',
  airtel_money: '*436#',
};

function openMobileMoneyMenu(provider) {
  const code = USSD_CODES[provider];
  if (!code) return;
  // Encodage nécessaire : '#' est sinon interprété comme une ancre d'URL
  const encoded = code.replace(/#/g, '%23').replace(/\*/g, '%2A');
  window.location.href = `tel:${encoded}`;
}

/**
 * Chargement global — anime le logo baobab pendant CHAQUE requête réseau
 * (fetch), et bloque les clics pendant ce temps pour éviter les doubles
 * soumissions (double-commande, double-paiement, etc.). Fonctionne
 * automatiquement pour tout fetch() de la page, sans avoir à modifier
 * chaque bouton individuellement.
 */
(function setupGlobalLoader() {
  let pending = 0;
  let overlay = null;

  function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'globalLoaderOverlay';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="loader-baobab">
        <svg width="64" height="64" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="19" fill="var(--gold, #C9A227)" class="loader-circle"/>
          <rect x="17.5" y="20" width="5" height="12" rx="2.5" fill="var(--forest-deep, #0e211b)"/>
          <path d="M20 20 C20 20 12 17 10 10 M20 20 C20 20 28 17 30 10 M20 20 L20 8"
                stroke="var(--forest-deep, #0e211b)" stroke-width="2.2" stroke-linecap="round" fill="none"/>
          <circle cx="10" cy="9" r="2" fill="var(--forest-deep, #0e211b)" class="loader-leaf loader-leaf-1"/>
          <circle cx="30" cy="9" r="2" fill="var(--forest-deep, #0e211b)" class="loader-leaf loader-leaf-2"/>
          <circle cx="20" cy="7" r="2" fill="var(--forest-deep, #0e211b)" class="loader-leaf loader-leaf-3"/>
        </svg>
      </div>`;
    document.body.appendChild(el);
    return el;
  }

  function showGlobalLoader() {
    if (!overlay) overlay = buildOverlay();
    overlay.classList.add('visible');
  }
  function hideGlobalLoader() {
    if (overlay) overlay.classList.remove('visible');
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (...args) {
    pending++;
    showGlobalLoader();
    return originalFetch(...args).finally(() => {
      pending = Math.max(0, pending - 1);
      if (pending === 0) hideGlobalLoader();
    });
  };
})();

/**
 * Confirmation Oui/Non personnalisée, pour remplacer window.confirm()
 * (plus cohérente visuellement, et fonctionne pareil sur toutes les
 * interfaces). Usage : if (await customConfirm("Supprimer ?")) { ... }
 */
function customConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${message}</p>
        <div class="confirm-actions">
          <button type="button" class="confirm-no">Non</button>
          <button type="button" class="confirm-yes">Oui</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    function cleanup(result) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 150);
      resolve(result);
    }
    overlay.querySelector('.confirm-yes').addEventListener('click', () => cleanup(true));
    overlay.querySelector('.confirm-no').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
  });
}
