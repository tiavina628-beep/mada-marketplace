// ============================================================
// Configuration
// ============================================================
const API_BASE = 'https://mada-marketplace1.onrender.com/api';
const AVATAR_PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="%23EDE6FF"/><circle cx="40" cy="31" r="13" fill="%23B5ACD6"/><ellipse cx="40" cy="68" rx="22" ry="16" fill="%23B5ACD6"/></svg>';

// ============================================================
// État local
// ============================================================
let cart = []; // [{ product_id, name, price_ar, quantity, stock }]
let products = [];
let wishlist = JSON.parse(localStorage.getItem('mada_wishlist') || '[]'); // [product_id, ...]
let searchQuery = '';
let activeCategory = 'Toutes';
let sortMode = 'newest';
let minPrice = null;
let maxPrice = null;

function getToken() { return localStorage.getItem('mada_token'); }
function getUser() {
  const raw = localStorage.getItem('mada_user');
  return raw ? JSON.parse(raw) : null;
}
function setSession(token, user) {
  localStorage.setItem('mada_token', token);
  localStorage.setItem('mada_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('mada_token');
  localStorage.removeItem('mada_user');
}

function formatAr(amount) {
  return Number(amount).toLocaleString('fr-FR') + ' Ar';
}

// ============================================================
// Overlays
// ============================================================
function openOverlay(id) { document.getElementById(id).classList.add('open'); }
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
});

// ============================================================
// Chargement du catalogue (PUBLIC — pas besoin de compte)
// ============================================================
async function loadProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`);
    products = await res.json();
    renderCategoryChips();
    renderProducts();
  } catch (err) {
    console.error('Erreur de chargement des produits', err);
  }
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  const countEl = document.getElementById('searchCount');
  grid.innerHTML = '';

  const q = searchQuery.trim().toLowerCase();
  let visible = q
    ? products.filter((p) => (p.name + ' ' + (p.description || '')).toLowerCase().includes(q))
    : products.slice();

  if (activeCategory !== 'Toutes') {
    visible = visible.filter((p) => (p.category || 'Autre') === activeCategory);
  }
  if (minPrice !== null && !isNaN(minPrice)) {
    visible = visible.filter((p) => Number(p.public_price_ar) >= minPrice);
  }
  if (maxPrice !== null && !isNaN(maxPrice)) {
    visible = visible.filter((p) => Number(p.public_price_ar) <= maxPrice);
  }

  const sorters = {
    newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    price_asc: (a, b) => a.public_price_ar - b.public_price_ar,
    price_desc: (a, b) => b.public_price_ar - a.public_price_ar,
    rating: (a, b) => (b.avg_rating || 0) - (a.avg_rating || 0),
  };
  visible.sort(sorters[sortMode] || sorters.newest);

  const activeFilters = q || activeCategory !== 'Toutes' || minPrice !== null || maxPrice !== null;
  if (activeFilters) {
    countEl.style.display = 'block';
    countEl.textContent = visible.length
      ? `${visible.length} résultat${visible.length > 1 ? 's' : ''}${q ? ` pour "${searchQuery}"` : ''}`
      : `Aucun résultat${q ? ` pour "${searchQuery}"` : ''}`;
  } else {
    countEl.style.display = 'none';
  }

  if (!visible.length) {
    empty.style.display = 'block';
    empty.textContent = activeFilters ? 'Aucun produit ne correspond à ces filtres.' : 'Aucun produit disponible pour le moment.';
    return;
  }
  empty.style.display = 'none';

  for (const p of visible) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const isWished = wishlist.includes(p.id);
    const images = (p.images && p.images.length) ? p.images : (p.image_url ? [{ image_url: p.image_url, color_name: null }] : []);
    const mainImage = images[0] ? images[0].image_url : '';
    const colors = [...new Set(images.filter((i) => i.color_name).map((i) => i.color_name))];
    const isLongDesc = (p.description || '').length > 90;

    card.innerHTML = `
      <div class="product-image" data-zoom="${mainImage}" data-name="${p.name}">
        ${mainImage ? `<img src="${mainImage}" alt="${p.name}" data-main-img><span class="zoom-hint">🔍 Agrandir</span>` : 'Pas de photo'}
        <button class="wish-toggle ${isWished ? 'active' : ''}" data-wish="${p.id}" aria-label="Ajouter aux favoris">${isWished ? '♥' : '♡'}</button>
      </div>
      ${images.length > 1 ? `
        <div class="thumb-strip">
          ${images.map((img, i) => `<img src="${img.image_url}" class="${i === 0 ? 'active-thumb' : ''}" data-thumb="${img.image_url}" title="${img.color_name || ''}" />`).join('')}
        </div>` : ''}
      ${colors.length ? `
        <div class="color-row">
          <span class="color-label">Couleur :</span>
          ${colors.map((c, i) => {
            const img = images.find((im) => im.color_name === c);
            const colorStock = img.stock === null || img.stock === undefined ? 0 : img.stock;
            const disabled = colorStock < 1;
            return `<button type="button" class="color-swatch ${i === 0 && !disabled ? 'active-color' : ''}" data-color-img="${img.image_url}" data-color-name="${c}" data-color-stock="${colorStock}" ${disabled ? 'disabled' : ''}>${c} <small>(${colorStock})</small></button>`;
          }).join('')}
        </div>` : ''}
      <div class="product-body">
        <h3>${p.name}</h3>
        ${p.review_count > 0 ? `<div class="rating-line">${'★'.repeat(Math.round(p.avg_rating))}${'☆'.repeat(5 - Math.round(p.avg_rating))} <span>(${p.review_count})</span></div>` : ''}
        <div class="desc-wrap">
          <p class="desc">${p.description || ''}</p>
          ${isLongDesc ? `<button type="button" class="desc-toggle" data-full-desc="${encodeURIComponent(p.description || '')}" data-desc-name="${p.name}">Afficher plus</button>` : ''}
        </div>
        <div class="price-row">
          <span class="price">${formatAr(p.public_price_ar)}</span>
          <span class="stock-tag" data-stock-label>${colors.length ? '' : (p.stock > 0 ? p.stock + ' en stock' : 'Rupture')}</span>
        </div>
        <button class="add-btn" data-id="${p.id}" data-selected-color="${colors.length ? (colors.find((c) => (images.find((im) => im.color_name === c).stock || 0) >= 1) || '') : ''}" ${(colors.length ? !colors.some((c) => (images.find((im) => im.color_name === c).stock || 0) >= 1) : p.stock < 1) ? 'disabled' : ''}>Ajouter au panier</button>
      </div>`;
    grid.appendChild(card);

    // Miniatures : cliquer change la photo principale affichée
    card.querySelectorAll('[data-thumb]').forEach((thumb) => {
      thumb.addEventListener('click', () => {
        const url = thumb.dataset.thumb;
        card.querySelector('[data-main-img]').src = url;
        card.querySelector('.product-image').dataset.zoom = url;
        card.querySelectorAll('[data-thumb]').forEach((t) => t.classList.toggle('active-thumb', t.dataset.thumb === url));
      });
    });

    // Couleurs : cliquer affiche la photo correspondante ET sélectionne cette couleur pour l'achat
    card.querySelectorAll('[data-color-img]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.colorImg;
        const mainImg = card.querySelector('[data-main-img]');
        if (mainImg) mainImg.src = url;
        card.querySelector('.product-image').dataset.zoom = url;
        card.querySelectorAll('[data-color-img]').forEach((b) => b.classList.toggle('active-color', b === btn));
        card.querySelectorAll('[data-thumb]').forEach((t) => t.classList.toggle('active-thumb', t.dataset.thumb === url));
        const addBtn = card.querySelector('.add-btn');
        addBtn.dataset.selectedColor = btn.dataset.colorName;
        addBtn.disabled = Number(btn.dataset.colorStock) < 1;
      });
    });

    // Description : ouvre une visionneuse plein écran (comme la lightbox photo)
    const toggleBtn = card.querySelector('.desc-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => openDescriptionViewer(toggleBtn.dataset.descName, decodeURIComponent(toggleBtn.dataset.fullDesc)));
    }
  }

  grid.querySelectorAll('.add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.selectedColor || null;
      const card = btn.closest('.product-card');
      let maxStock;
      if (color) {
        const swatch = card.querySelector(`[data-color-name="${CSS.escape(color)}"]`);
        maxStock = swatch ? Number(swatch.dataset.colorStock) : 0;
      }
      addToCart(Number(btn.dataset.id), color, maxStock);
    });
  });
  grid.querySelectorAll('[data-wish]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWishlist(Number(btn.dataset.wish));
    });
  });
  grid.querySelectorAll('.product-image[data-zoom]').forEach((el, idx) => {
    el.addEventListener('click', () => {
      const p = visible[idx];
      const imgs = (p.images && p.images.length) ? p.images : (p.image_url ? [{ image_url: p.image_url, color_name: null }] : []);
      if (!imgs.length) return;
      const currentSrc = el.querySelector('[data-main-img]') ? el.querySelector('[data-main-img]').src : imgs[0].image_url;
      const startIndex = Math.max(0, imgs.findIndex((im) => currentSrc.endsWith(im.image_url.slice(-40))));
      openLightbox(imgs, startIndex === -1 ? 0 : startIndex, p.name);
    });
  });
}

// ============================================================
// Lightbox — agrandir une image, glisser pour naviguer, couleur en bas
// ============================================================
const COLOR_HEX = {
  rouge:'#D6362E', bleu:'#2B5FD9', vert:'#2FA84F', jaune:'#E8C13B', orange:'#E8792B',
  rose:'#E85AA0', violet:'#7B3FE0', mauve:'#8B5FBF', noir:'#1B1035', blanc:'#8A8A8A',
  gris:'#7A7A7A', marron:'#7A4B2E', beige:'#B9A57C', turquoise:'#22B5AE', doré:'#C9A227',
  or:'#C9A227', argenté:'#9A9A9A', "bleu ciel":'#4FA8E0', "bleu marine":'#1B2E5C',
  "vert foncé":'#1F6B3A', "rouge bordeaux":'#7A1F2B',
};
function colorToHex(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return COLOR_HEX[key] || null;
}

let lightboxImages = [];
let lightboxIndex = 0;

// ============================================================
// Description en plein écran (comme la lightbox photo)
// ============================================================
function openDescriptionViewer(name, description) {
  document.getElementById('descViewerTitle').textContent = name;
  document.getElementById('descViewerText').textContent = description;
  document.getElementById('descOverlay').classList.add('open');
}
document.getElementById('descClose').addEventListener('click', () => {
  document.getElementById('descOverlay').classList.remove('open');
});
document.getElementById('descOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'descOverlay') document.getElementById('descOverlay').classList.remove('open');
});

function openLightbox(images, startIndex, productName) {
  lightboxImages = images;
  lightboxIndex = startIndex || 0;
  renderLightboxImage(productName);
  document.getElementById('lightboxOverlay').classList.add('open');
}

function renderLightboxImage(productName) {
  const current = lightboxImages[lightboxIndex];
  const img = document.getElementById('lightboxImg');
  img.src = current.image_url;
  img.alt = productName || 'Image agrandie';

  const caption = document.getElementById('lightboxCaption');
  const hex = colorToHex(current.color_name);
  if (current.color_name) {
    caption.textContent = current.color_name;
    caption.style.color = hex || '#fff';
    caption.style.display = 'block';
  } else {
    caption.style.display = 'none';
  }

  const counter = document.getElementById('lightboxCounter');
  if (lightboxImages.length > 1) {
    counter.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
    counter.style.display = 'block';
  } else {
    counter.style.display = 'none';
  }

  document.getElementById('lightboxPrev').style.display = lightboxImages.length > 1 ? 'flex' : 'none';
  document.getElementById('lightboxNext').style.display = lightboxImages.length > 1 ? 'flex' : 'none';
}

function lightboxGo(delta) {
  if (!lightboxImages.length) return;
  lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
  renderLightboxImage(document.getElementById('lightboxImg').alt);
}

document.getElementById('lightboxPrev').addEventListener('click', (e) => { e.stopPropagation(); lightboxGo(-1); });
document.getElementById('lightboxNext').addEventListener('click', (e) => { e.stopPropagation(); lightboxGo(1); });

// Glisser gauche/droite (tactile) pour naviguer entre les photos
let lightboxTouchStartX = null;
const lightboxOverlayEl = document.getElementById('lightboxOverlay');
lightboxOverlayEl.addEventListener('touchstart', (e) => {
  lightboxTouchStartX = e.touches[0].clientX;
}, { passive: true });
lightboxOverlayEl.addEventListener('touchend', (e) => {
  if (lightboxTouchStartX === null) return;
  const delta = e.changedTouches[0].clientX - lightboxTouchStartX;
  if (Math.abs(delta) > 40) lightboxGo(delta > 0 ? -1 : 1);
  lightboxTouchStartX = null;
});
document.addEventListener('keydown', (e) => {
  if (!lightboxOverlayEl.classList.contains('open')) return;
  if (e.key === 'ArrowLeft') lightboxGo(-1);
  if (e.key === 'ArrowRight') lightboxGo(1);
  if (e.key === 'Escape') lightboxOverlayEl.classList.remove('open');
});
document.getElementById('lightboxClose').addEventListener('click', () => {
  document.getElementById('lightboxOverlay').classList.remove('open');
});
document.getElementById('lightboxOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'lightboxOverlay') document.getElementById('lightboxOverlay').classList.remove('open');
});

// ============================================================
// Favoris (localStorage, propre à cet appareil/navigateur)
// ============================================================
function toggleWishlist(productId) {
  if (wishlist.includes(productId)) {
    wishlist = wishlist.filter((id) => id !== productId);
  } else {
    wishlist.push(productId);
  }
  localStorage.setItem('mada_wishlist', JSON.stringify(wishlist));
  renderProducts();
  renderWishBadge();
}

function renderWishBadge() {
  const badge = document.getElementById('wishCount');
  badge.textContent = wishlist.length;
  badge.dataset.count = wishlist.length;
}

function renderWishlist() {
  const lines = document.getElementById('wishLines');
  const items = products.filter((p) => wishlist.includes(p.id));
  if (!items.length) {
    lines.innerHTML = '<p class="empty-state">Aucun favori pour le moment.</p>';
    return;
  }
  lines.innerHTML = items.map((p) => `
    <div class="cart-line">
      <span>${p.name}</span>
      <span>${formatAr(p.public_price_ar)}
        <button data-addcart="${p.id}">ajouter</button>
        <button data-unwish="${p.id}">retirer</button>
      </span>
    </div>`).join('');

  lines.querySelectorAll('[data-addcart]').forEach((btn) => btn.addEventListener('click', () => {
    addToCart(Number(btn.dataset.addcart));
    showQuickToast('Ajouté au panier 🛍️');
  }));
  lines.querySelectorAll('[data-unwish]').forEach((btn) => btn.addEventListener('click', () => {
    toggleWishlist(Number(btn.dataset.unwish));
    renderWishlist();
  }));
}

function showQuickToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--ink); color:#fff; padding:12px 20px; border-radius:14px; font-weight:600; font-size:0.85rem; z-index:200; box-shadow:var(--shadow-lg);';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

document.getElementById('wishBtn').addEventListener('click', () => {
  renderWishlist();
  openOverlay('wishOverlay');
});

// ============================================================
// Panier (en mémoire, pas besoin de compte pour l'utiliser)
// ============================================================
function addToCart(productId, colorName, maxStock) {
  const product = products.find((p) => p.id === productId);
  if (!product) return;
  const stock = maxStock !== undefined ? maxStock : product.stock;
  const color = colorName || null;

  const existing = cart.find((c) => c.product_id === productId && c.color_name === color);
  if (existing) {
    if (existing.quantity < stock) existing.quantity++;
    else showQuickToast('Stock maximum atteint pour cette couleur.');
  } else {
    if (stock < 1) { showQuickToast('Rupture de stock.'); return; }
    cart.push({
      product_id: product.id, color_name: color,
      name: color ? `${product.name} (${color})` : product.name,
      price_ar: product.public_price_ar, quantity: 1, stock,
    });
  }
  renderCart();
}

function cartKey(productId, colorName) { return `${productId}::${colorName || ''}`; }

function removeFromCart(productId, colorName) {
  cart = cart.filter((c) => cartKey(c.product_id, c.color_name) !== cartKey(productId, colorName));
  renderCart();
}

function cartTotal() {
  return cart.reduce((sum, c) => sum + c.price_ar * c.quantity, 0);
}

function renderCart() {
  const cartBadge = document.getElementById('cartCount');
  const count = cart.reduce((n, c) => n + c.quantity, 0);
  cartBadge.textContent = count;
  cartBadge.dataset.count = count;
  const lines = document.getElementById('cartLines');
  lines.innerHTML = '';
  if (!cart.length) {
    lines.innerHTML = '<p class="empty-state">Votre panier est vide.</p>';
  }
  for (const c of cart) {
    const key = cartKey(c.product_id, c.color_name);
    const line = document.createElement('div');
    line.className = 'cart-line';
    line.innerHTML = `
      <span>${c.name}</span>
      <span class="qty-stepper">
        <button data-minus="${key}" aria-label="Diminuer">−</button>
        <span class="qty-value">${c.quantity}</span>
        <button data-plus="${key}" aria-label="Augmenter" ${c.quantity >= c.stock ? 'disabled' : ''}>+</button>
      </span>
      <span>${formatAr(c.price_ar * c.quantity)}</span>
    `;
    lines.appendChild(line);
  }
  document.getElementById('cartTotal').textContent = formatAr(cartTotal());
  lines.querySelectorAll('[data-minus]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [pid, color] = splitCartKey(btn.dataset.minus);
      changeQuantity(pid, color, -1);
    });
  });
  lines.querySelectorAll('[data-plus]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [pid, color] = splitCartKey(btn.dataset.plus);
      changeQuantity(pid, color, 1);
    });
  });
}

function splitCartKey(key) {
  const idx = key.indexOf('::');
  return [Number(key.slice(0, idx)), key.slice(idx + 2) || null];
}

function changeQuantity(productId, colorName, delta) {
  const item = cart.find((c) => cartKey(c.product_id, c.color_name) === cartKey(productId, colorName));
  if (!item) return;
  const newQty = item.quantity + delta;
  if (newQty < 1) {
    removeFromCart(productId, colorName);
    return;
  }
  if (newQty > item.stock) return;
  item.quantity = newQty;
  renderCart();
}

document.getElementById('cartBtn').addEventListener('click', () => openOverlay('cartOverlay'));

// ============================================================
// Profil (PDP) — modification et suppression de compte
// ============================================================
document.getElementById('profileBtn').addEventListener('click', async () => {
  document.getElementById('profileError').textContent = '';
  document.getElementById('profileSuccess').textContent = '';
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const user = await res.json();
    if (!res.ok) throw new Error(user.error || 'Erreur de chargement du profil.');
    const form = document.getElementById('profileForm');
    form.full_name.value = user.full_name;
    form.email.value = user.email;
    form.phone.value = user.phone;
    form.current_password.value = '';
    form.new_password.value = '';
    pendingAvatarDataUrl = null;
    const preview = document.getElementById('profileAvatarPreview');
    if (user.avatar_url) preview.src = user.avatar_url; else preview.removeAttribute('src');
    openOverlay('profileOverlay');
  } catch (err) {
    alert(err.message);
  }
});

let pendingAvatarDataUrl = null;
document.getElementById('avatarFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingAvatarDataUrl = await compressImageToDataUrl(file, 400, 0.75);
    document.getElementById('profileAvatarPreview').src = pendingAvatarDataUrl;
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('profileError');
  const successEl = document.getElementById('profileSuccess');
  errorEl.textContent = '';
  successEl.textContent = '';
  const data = Object.fromEntries(new FormData(e.target));
  if (!data.current_password) delete data.current_password;
  if (!data.new_password) delete data.new_password;
  if (pendingAvatarDataUrl) data.avatar_url = pendingAvatarDataUrl;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) { errorEl.textContent = body.error || (body.errors && body.errors[0].msg) || 'Erreur.'; return; }
    setSession(body.token, body.user);
    refreshAuthUI();
    successEl.textContent = 'Profil mis à jour.';
    e.target.current_password.value = '';
    e.target.new_password.value = '';
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  if (!(await customConfirm('Supprimer définitivement ton compte ? Cette action est irréversible.'))) return;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const body = await res.json();
    if (!res.ok) { alert(body.error || 'Erreur lors de la suppression.'); return; }
    clearSession();
    refreshAuthUI();
    closeOverlay('profileOverlay');
    alert('Ton compte a été supprimé.');
  } catch (err) {
    alert('Erreur réseau.');
  }
});

// ============================================================
// Authentification — un compte est exigé uniquement à la commande
// ============================================================
function refreshAuthUI() {
  const user = getUser();
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const ordersBtn = document.getElementById('ordersBtn');
  const profileBtn = document.getElementById('profileBtn');
  const greeting = document.getElementById('userGreeting');
  const avatar = document.getElementById('userAvatar');

  if (user) {
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
    ordersBtn.style.display = 'inline-block';
    profileBtn.style.display = 'inline-block';
    greeting.style.display = 'inline-block';
    greeting.textContent = `Bonjour, ${user.full_name.split(' ')[0]}`;
    avatar.src = user.avatar_url || AVATAR_PLACEHOLDER;
    document.getElementById('notifBtn').style.display = 'inline-flex';
    loadNotifCount();
  } else {
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    ordersBtn.style.display = 'none';
    profileBtn.style.display = 'none';
    greeting.style.display = 'none';
    document.getElementById('notifBtn').style.display = 'none';
  }
}

// ============================================================
// Notifications
// ============================================================
async function loadNotifCount() {
  try {
    const res = await fetch(`${API_BASE}/notifications`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const body = await res.json();
    if (!res.ok) return;
    const badge = document.getElementById('notifCount');
    badge.textContent = body.unread_count;
    badge.dataset.count = body.unread_count;
  } catch (err) { /* silencieux */ }
}

document.getElementById('notifBtn').addEventListener('click', async () => {
  const list = document.getElementById('notifList');
  list.innerHTML = 'Chargement…';
  openOverlay('notifOverlay');
  await loadAndRenderNotifs();

  try {
    const countRes = await fetch(`${API_BASE}/notifications`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const countBody = await countRes.json();
    if (countBody.unread_count > 0) {
      await fetch(`${API_BASE}/notifications/read-all`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${getToken()}` },
      });
      loadNotifCount();
    }
  } catch (err) { /* silencieux */ }
});

async function loadAndRenderNotifs() {
  const list = document.getElementById('notifList');
  try {
    const res = await fetch(`${API_BASE}/notifications`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);

    if (!body.notifications.length) {
      list.innerHTML = '<p class="empty-state">Aucune notification pour le moment.</p>';
      return;
    }
    list.innerHTML = body.notifications.map((n) => `
      <div class="notif-card type-${n.type} ${n.is_read ? '' : 'unread'}">
        <div>${n.message}</div>
        <div class="notif-date">${new Date(n.created_at).toLocaleString('fr-FR')}</div>
        <button class="notif-del" data-del-notif="${n.id}">Supprimer</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-del-notif]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await fetch(`${API_BASE}/notifications/${btn.dataset.delNotif}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
        });
        loadAndRenderNotifs();
      } catch (err) { /* silencieux */ }
    }));
  } catch (err) {
    list.innerHTML = '<p class="form-error">Erreur de chargement.</p>';
  }
}

document.getElementById('clearNotifsBtn').addEventListener('click', async () => {
  if (!(await customConfirm('Supprimer toutes tes notifications ?'))) return;
  try {
    await fetch(`${API_BASE}/notifications`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } });
    loadAndRenderNotifs();
    loadNotifCount();
  } catch (err) { /* silencieux */ }
});

document.getElementById('loginBtn').addEventListener('click', () => openOverlay('authOverlay'));
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!(await customConfirm('Se déconnecter ?'))) return;
  clearSession();
  refreshAuthUI();
});

document.getElementById('tabLogin').addEventListener('click', () => switchAuthTab('login'));
document.getElementById('tabRegister').addEventListener('click', () => switchAuthTab('register'));

function switchAuthTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';
  const data = Object.fromEntries(new FormData(e.target));

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) { errorEl.textContent = body.error || 'Connexion impossible.'; return; }
    if (body.user.role !== 'client') {
      errorEl.textContent = "Ce compte n'est pas un compte client.";
      return;
    }
    setSession(body.token, body.user);
    refreshAuthUI();
    closeOverlay('authOverlay');
    afterAuthSuccess();
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('registerError');
  errorEl.textContent = '';
  const data = Object.fromEntries(new FormData(e.target));

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
      errorEl.textContent = body.error || (body.errors && body.errors[0].msg) || 'Inscription impossible.';
      return;
    }
    setSession(body.token, body.user);
    refreshAuthUI();
    closeOverlay('authOverlay');
    afterAuthSuccess();
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

// Si l'utilisateur vient de se connecter alors qu'il essayait de commander,
// on enchaîne directement sur le formulaire de commande.
let pendingCheckout = false;
function afterAuthSuccess() {
  if (pendingCheckout) {
    pendingCheckout = false;
    closeOverlay('cartOverlay');
    openCheckout();
  }
}

// ============================================================
// Commande — compte obligatoire à cette étape uniquement
// ============================================================
document.getElementById('checkoutBtn').addEventListener('click', () => {
  if (!cart.length) return;
  if (!getUser()) {
    pendingCheckout = true;
    closeOverlay('cartOverlay');
    switchAuthTab('register'); // on encourage la création de compte, plus naturel pour un 1er achat
    openOverlay('authOverlay');
    return;
  }
  closeOverlay('cartOverlay');
  openCheckout();
});

// ============================================================
// Numéros de réception mobile money (configurés par l'admin)
// ============================================================
let paymentNumbersCache = null;

async function getPaymentNumbers() {
  if (paymentNumbersCache) return paymentNumbersCache;
  try {
    const res = await fetch(`${API_BASE}/config/payment-numbers`);
    paymentNumbersCache = await res.json();
  } catch (err) {
    paymentNumbersCache = { mvola: null, orange_money: null, airtel_money: null };
  }
  return paymentNumbersCache;
}

function renderPaymentNumbersList(containerId, numbers) {
  const labels = { mvola: '📱 Mvola', orange_money: '🍊 Orange Money', airtel_money: '💳 Airtel Money' };
  const container = document.getElementById(containerId);
  container.innerHTML = Object.entries(labels).map(([key, label]) => {
    const entry = numbers[key];
    const detail = entry
      ? `${entry.phone_number}${entry.account_name ? ` — au nom de ${entry.account_name}` : ''}`
      : 'Non configuré — contacte la boutique';
    return `
    <li>
      <span class="op-info">${label}<small>${detail}</small></span>
      <button type="button" class="dial-btn" data-dial="${key}" ${entry ? '' : 'disabled'}>📲 Composer</button>
    </li>`;
  }).join('');
  container.querySelectorAll('[data-dial]').forEach((btn) => {
    btn.addEventListener('click', () => openMobileMoneyMenu(btn.dataset.dial));
  });
}

function openCheckout() {
  document.getElementById('checkoutTotal').textContent = formatAr(cartTotal());
  getPaymentNumbers().then((numbers) => renderPaymentNumbersList('checkoutPaymentNumbers', numbers));
  openOverlay('checkoutOverlay');
}

document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('checkoutError');
  errorEl.textContent = '';
  const form = Object.fromEntries(new FormData(e.target));

  const payload = {
    items: cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, color_name: c.color_name || undefined })),
    shipping_address: form.shipping_address,
    payment: { provider: form.provider, phone_number: form.phone_number, client_reference: form.client_reference },
  };

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) { errorEl.textContent = body.error || (body.errors && body.errors[0].msg) || 'La commande a échoué.'; return; }

    alert(`Commande #${body.order_id} enregistrée ! Un administrateur va vérifier ton paiement — tu peux suivre le statut dans "Mes commandes".`);
    cart = [];
    renderCart();
    closeOverlay('checkoutOverlay');
    loadProducts();
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

// ============================================================
// Historique des commandes
// ============================================================
document.getElementById('ordersBtn').addEventListener('click', async () => {
  openOverlay('ordersOverlay');
  const list = document.getElementById('ordersList');
  list.innerHTML = 'Chargement…';

  try {
    const res = await fetch(`${API_BASE}/orders/mine`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const orders = await res.json();
    if (!orders.length) { list.innerHTML = '<p class="empty-state">Aucune commande pour le moment.</p>'; return; }

    list.innerHTML = orders.map((o) => `
      <div class="order-card">
        <div class="row">
          <strong>Commande #${o.id}</strong>
          <span class="badge-status badge-${o.status}">${statusLabel(o.status)}</span>
        </div>
        <div class="row"><span>${new Date(o.created_at).toLocaleDateString('fr-FR')}</span><span>${formatAr(o.total_amount_ar)}</span></div>
        ${o.items.map((i) => `
          <div class="item-line">
            <span>${i.name} × ${i.quantity}</span>
            <span>${statusLabel(i.item_status)}</span>
          </div>
          ${i.item_status === 'delivered' && !i.reviewed ? `<button class="review-btn" data-review-item="${i.item_id}" data-review-product="${i.name}">⭐ Laisser un avis</button>` : ''}
          ${i.item_status === 'delivered' && i.reviewed ? `<div class="reviewed-hint">✅ Avis envoyé, merci !</div>` : ''}
        `).join('')}
        ${o.payment ? `<div class="item-line" style="border-top:1px dashed var(--line); margin-top:6px; padding-top:8px;"><span>Référence : ${o.payment.client_reference}</span><span>${statusLabel(o.payment.status)}</span></div>` : ''}
        ${o.payment && o.payment.admin_note ? `<div class="item-line" style="color:var(--pop);"><span>Motif : ${o.payment.admin_note}</span></div>` : ''}
        ${o.status === 'payment_rejected' ? `<button class="primary-btn" style="margin-top:10px;" data-resubmit="${o.id}">🔁 Renvoyer une référence</button>` : ''}
        ${['pending_payment', 'awaiting_verification', 'payment_rejected'].includes(o.status) ? `<button class="cancel-order-btn" data-cancel-order="${o.id}">Annuler la commande</button>` : ''}
      </div>
    `).join('');

    list.querySelectorAll('[data-resubmit]').forEach((btn) => btn.addEventListener('click', () => {
      document.getElementById('resubmitForm').order_id.value = btn.dataset.resubmit;
      document.getElementById('resubmitError').textContent = '';
      closeOverlay('ordersOverlay');
      openOverlay('resubmitOverlay');
    }));

    list.querySelectorAll('[data-cancel-order]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await customConfirm('Annuler définitivement cette commande ?'))) return;
      try {
        const res = await fetch(`${API_BASE}/orders/${btn.dataset.cancelOrder}/cancel`, {
          method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
        });
        const body = await res.json();
        if (!res.ok) { showQuickToast(body.error || 'Erreur.'); return; }
        showQuickToast('Commande annulée.');
        document.getElementById('ordersBtn').click();
      } catch (err) {
        showQuickToast('Erreur réseau.');
      }
    }));

    list.querySelectorAll('[data-review-item]').forEach((btn) => btn.addEventListener('click', () => {
      document.getElementById('reviewForm').dataset.itemId = btn.dataset.reviewItem;
      document.getElementById('reviewProductName').textContent = btn.dataset.reviewProduct;
      document.getElementById('reviewError').textContent = '';
      setReviewStars(0);
      document.getElementById('reviewComment').value = '';
      closeOverlay('ordersOverlay');
      openOverlay('reviewOverlay');
    }));
  } catch (err) {
    list.innerHTML = '<p class="form-error">Erreur de chargement.</p>';
  }
});

document.getElementById('resubmitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('resubmitError');
  errorEl.textContent = '';
  const form = Object.fromEntries(new FormData(e.target));
  const orderId = form.order_id;
  delete form.order_id;

  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(form),
    });
    const body = await res.json();
    if (!res.ok) { errorEl.textContent = body.error || (body.errors && body.errors[0].msg) || 'Erreur.'; return; }
    alert('Nouvelle référence envoyée ! Un administrateur va la vérifier.');
    closeOverlay('resubmitOverlay');
    e.target.reset();
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

function statusLabel(status) {
  const labels = {
    pending_payment: 'Paiement en attente', awaiting_verification: 'Vérification en cours',
    paid: 'Payée', shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée',
    payment_rejected: 'Paiement rejeté', pending: 'En préparation',
    submitted: 'En attente de vérification', confirmed: 'Confirmé', rejected: 'Rejeté',
  };
  return labels[status] || status;
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderProducts();
});

// ============================================================
// Filtres — catégories, tri, fourchette de prix
// ============================================================
function renderCategoryChips() {
  const container = document.getElementById('categoryChips');
  const used = new Set(products.map((p) => p.category || 'Autre'));
  const available = CATEGORIES.filter((c) => used.has(c));
  const chips = ['Toutes', ...available];

  container.innerHTML = chips.map((c) =>
    `<button type="button" class="chip ${c === activeCategory ? 'active' : ''}" data-category="${c}">${c}</button>`
  ).join('');

  container.querySelectorAll('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.category;
      renderCategoryChips();
      renderProducts();
    });
  });
}

document.getElementById('sortSelect').addEventListener('change', (e) => {
  sortMode = e.target.value;
  renderProducts();
});
document.getElementById('minPriceInput').addEventListener('input', (e) => {
  minPrice = e.target.value === '' ? null : Number(e.target.value);
  renderProducts();
});
document.getElementById('maxPriceInput').addEventListener('input', (e) => {
  maxPrice = e.target.value === '' ? null : Number(e.target.value);
  renderProducts();
});
document.getElementById('resetFiltersBtn').addEventListener('click', () => {
  searchQuery = ''; activeCategory = 'Toutes'; sortMode = 'newest'; minPrice = null; maxPrice = null;
  document.getElementById('searchInput').value = '';
  document.getElementById('sortSelect').value = 'newest';
  document.getElementById('minPriceInput').value = '';
  document.getElementById('maxPriceInput').value = '';
  renderCategoryChips();
  renderProducts();
});

// ============================================================
// Avis produit (après livraison)
// ============================================================
let selectedRating = 0;
function setReviewStars(rating) {
  selectedRating = rating;
  document.querySelectorAll('.star-input').forEach((s, i) => {
    s.textContent = i < rating ? '★' : '☆';
    s.classList.toggle('filled', i < rating);
  });
}
document.querySelectorAll('.star-input').forEach((star, i) => {
  star.addEventListener('click', () => setReviewStars(i + 1));
});

document.getElementById('reviewForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('reviewError');
  errorEl.textContent = '';
  const itemId = e.target.dataset.itemId;
  if (!selectedRating) { errorEl.textContent = 'Choisis une note (clique sur les étoiles).'; return; }

  try {
    const res = await fetch(`${API_BASE}/reviews/items/${itemId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ rating: selectedRating, comment: document.getElementById('reviewComment').value }),
    });
    const body = await res.json();
    if (!res.ok) { errorEl.textContent = body.error || (body.errors && body.errors[0].msg) || 'Erreur.'; return; }
    showQuickToast('Merci pour ton avis ! ⭐');
    closeOverlay('reviewOverlay');
    loadProducts();
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

// ============================================================
// Feedback — envoyer un message à l'administration
// ============================================================
document.getElementById('feedbackBtn').addEventListener('click', () => {
  if (!getUser()) {
    switchAuthTab('login');
    openOverlay('authOverlay');
    return;
  }
  document.getElementById('feedbackError').textContent = '';
  document.getElementById('feedbackSuccess').textContent = '';
  document.getElementById('feedbackForm').reset();
  openOverlay('feedbackOverlay');
});

document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('feedbackError');
  const successEl = document.getElementById('feedbackSuccess');
  errorEl.textContent = ''; successEl.textContent = '';
  const message = document.getElementById('feedbackMessage').value.trim();
  if (message.length < 3) { errorEl.textContent = 'Ton message est trop court.'; return; }

  try {
    const res = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ message }),
    });
    const body = await res.json();
    if (!res.ok) { errorEl.textContent = body.error || (body.errors && body.errors[0].msg) || 'Erreur.'; return; }
    successEl.textContent = 'Message envoyé, merci !';
    e.target.reset();
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

// ============================================================
// Initialisation
// ============================================================
refreshAuthUI();
loadProducts();
renderCart();
renderWishBadge();
setInterval(() => { if (getUser()) loadNotifCount(); }, 45000);

// ============================================================
// PWA — installation sur l'écran d'accueil
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* silencieux */ });
  });
}

let deferredInstallPrompt = null;
const installBanner = document.getElementById('installBanner');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!localStorage.getItem('mada_install_dismissed')) installBanner.classList.add('visible');
});

document.getElementById('installBtn').addEventListener('click', async () => {
  installBanner.classList.remove('visible');
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

document.getElementById('installDismiss').addEventListener('click', () => {
  installBanner.classList.remove('visible');
  localStorage.setItem('mada_install_dismissed', '1');
});

// iOS (Safari) ne déclenche jamais beforeinstallprompt : instructions manuelles
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
if (isIOS && !isStandalone && !localStorage.getItem('mada_install_dismissed')) {
  document.getElementById('installText').textContent = "Installe Baobab Bazar : appuie sur Partager 📤 puis \"Sur l'écran d'accueil\".";
  document.getElementById('installBtn').style.display = 'none';
  installBanner.classList.add('visible');
}
