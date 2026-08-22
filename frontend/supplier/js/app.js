const API_BASE = 'https://mada-marketplace1.onrender.com/api';

function getToken() { return localStorage.getItem('mada_supplier_token'); }
function getUser() {
  const raw = localStorage.getItem('mada_supplier_user');
  return raw ? JSON.parse(raw) : null;
}
function setSession(token, user) {
  localStorage.setItem('mada_supplier_token', token);
  localStorage.setItem('mada_supplier_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('mada_supplier_token');
  localStorage.removeItem('mada_supplier_user');
}

function formatAr(amount) { return Number(amount).toLocaleString('fr-FR') + ' Ar'; }

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || (body.errors && body.errors[0].msg) || 'Erreur serveur.');
  return body;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function statusLabel(status) {
  const labels = {
    pending_review: 'En attente de validation', active: 'En ligne', rejected: 'Rejeté', inactive: 'Retiré',
    pending: 'À préparer', shipped: 'Expédiée', delivered: 'Livrée',
  };
  return labels[status] || status;
}

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

// ============================================================
// Lightbox
// ============================================================
function openLightbox(src, alt) {
  const img = document.getElementById('lightboxImg');
  img.src = src;
  img.alt = alt || 'Image agrandie';
  document.getElementById('lightboxOverlay').classList.add('open');
}
document.getElementById('lightboxClose').addEventListener('click', () => {
  document.getElementById('lightboxOverlay').classList.remove('open');
});
document.getElementById('lightboxOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'lightboxOverlay') document.getElementById('lightboxOverlay').classList.remove('open');
});

// ============================================================
// Connexion (réservée aux comptes role='supplier', créés par l'admin)
// ============================================================
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
    if (body.user.role !== 'supplier') { errorEl.textContent = "Ce compte n'est pas un compte fournisseur."; return; }
    setSession(body.token, body.user);
    enterApp();
  } catch (err) {
    errorEl.textContent = 'Erreur réseau.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!(await customConfirm('Se déconnecter ?'))) return;
  clearSession();
  location.reload();
});

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').classList.add('visible');
  populateCategorySelect();
  loadProducts();
  loadOrders();
  loadProfile();
  loadWallet();
  loadCatalogPreview();
}

function populateCategorySelect() {
  const select = document.getElementById('categorySelect');
  select.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
}

document.querySelectorAll('.sidebar nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar nav button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ['products', 'orders', 'catalog', 'wallet', 'profile'].forEach((t) => {
      document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? 'block' : 'none';
    });
    if (btn.dataset.tab === 'catalog') loadCatalogPreview();
  });
});

// ============================================================
// Voir la boutique — aperçu client en lecture seule
// ============================================================
async function loadCatalogPreview() {
  try {
    const res = await fetch(`${API_BASE}/products`);
    const products = await res.json();
    const grid = document.getElementById('catalogPreviewGrid');
    const empty = document.getElementById('catalogPreviewEmpty');

    if (!products.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    grid.innerHTML = products.map((p) => `
      <div class="preview-card">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" />` : ''}
        <div class="body">
          <h4>${p.name}</h4>
          <div class="price">${formatAr(p.public_price_ar)}</div>
        </div>
      </div>`).join('');
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Mes produits — galerie (jusqu'à 5 photos + couleurs), proposer, éditer
// ============================================================
let newProductImages = []; // [{ dataUrl, colorName, colorStock }]

document.getElementById('newImageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (newProductImages.length >= 5) { showToast('Maximum 5 photos.'); e.target.value = ''; return; }
  try {
    const dataUrl = await compressImageToDataUrl(file, 900, 0.72);
    const colorName = document.getElementById('newImageColor').value.trim();
    const stockInput = document.getElementById('newImageStock').value;
    const colorStock = colorName && stockInput !== '' ? Number(stockInput) : null;
    newProductImages.push({ dataUrl, colorName, colorStock });
    document.getElementById('newImageColor').value = '';
    document.getElementById('newImageStock').value = '';
    renderNewProductGallery();
  } catch (err) {
    showToast(err.message);
  }
  e.target.value = '';
});

function renderNewProductGallery() {
  const container = document.getElementById('newProductGallery');
  container.innerHTML = newProductImages.map((img, i) => `
    <div class="gallery-thumb">
      <img src="${img.dataUrl}" />
      <button type="button" class="remove-thumb" data-remove-img="${i}">✕</button>
      ${img.colorName ? `<div class="color-tag">${img.colorName}${img.colorStock !== null ? ` (${img.colorStock})` : ''}</div>` : ''}
    </div>`).join('');
  container.querySelectorAll('[data-remove-img]').forEach((btn) => {
    btn.addEventListener('click', () => {
      newProductImages.splice(Number(btn.dataset.removeImg), 1);
      renderNewProductGallery();
    });
  });
}

document.getElementById('submitProductBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('productFormError');
  errorEl.textContent = '';
  const form = document.getElementById('productForm');
  const data = Object.fromEntries(new FormData(form));

  if (!data.name || !data.supplier_price_ar || data.stock === '') {
    errorEl.textContent = 'Remplis au moins le nom, ton prix et le stock.';
    return;
  }
  data.supplier_price_ar = Number(data.supplier_price_ar);
  data.stock = Number(data.stock);
  if (newProductImages.length) data.image_url = newProductImages[0].dataUrl;

  try {
    const product = await api('/supplier/products', { method: 'POST', body: JSON.stringify(data) });

    for (const img of newProductImages) {
      await api(`/supplier/products/${product.id}/images`, {
        method: 'POST',
        body: JSON.stringify({
          image_url: img.dataUrl,
          color_name: img.colorName || undefined,
          stock: img.colorStock !== null ? img.colorStock : undefined,
        }),
      });
    }

    showToast('Produit proposé — en attente de validation admin.');
    form.reset();
    newProductImages = [];
    renderNewProductGallery();
    loadProducts();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

async function loadProducts() {
  try {
    const products = await api('/supplier/products');
    const tbody = document.getElementById('productsTableBody');
    const rejectedCount = products.filter((p) => p.status === 'rejected').length;
    document.getElementById('rejectedCount').textContent = rejectedCount || '';

    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:var(--ink-soft);">Aucun produit proposé pour le moment.</td></tr>';
      return;
    }

    tbody.innerHTML = products.map((p) => `
      <tr>
        <td>${p.image_url ? `<img class="thumb" src="${p.image_url}" data-zoom="${p.image_url}" alt="${p.name}">` : '—'}</td>
        <td>${p.name}</td>
        <td><small>${p.category || 'Autre'}</small></td>
        <td class="mono">${formatAr(p.supplier_price_ar)}</td>
        <td class="mono">${p.public_price_ar ? formatAr(p.public_price_ar) : '—'}</td>
        <td>${p.stock}</td>
        <td>
          <span class="badge-status badge-${p.status}">${statusLabel(p.status)}</span>
          ${p.status === 'rejected' && p.rejection_reason ? `<br><small style="color:var(--terracotta)">${p.rejection_reason}</small>` : ''}
        </td>
        <td>
          ${['pending_review', 'rejected'].includes(p.status) ? `<button class="btn" data-edit="${p.id}">Modifier</button>` : ''}
          <button class="btn" data-manage-photos="${p.id}">📷 Photos (${(p.images || []).length})</button>
          ${p.status === 'active' ? `<button class="btn" data-stock="${p.id}">Stock</button><button class="btn danger" data-deactivate="${p.id}">Retirer</button>` : ''}
          <button class="btn danger" data-delete-permanent="${p.id}">🗑️ Supprimer définitivement</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-zoom]').forEach((el) => el.addEventListener('click', () => openLightbox(el.dataset.zoom, '')));

    tbody.querySelectorAll('[data-stock]').forEach((btn) => btn.addEventListener('click', async () => {
      const val = prompt('Nouveau stock disponible ?');
      if (val === null || isNaN(val)) return;
      try { await api(`/supplier/products/${btn.dataset.stock}/stock`, { method: 'PATCH', body: JSON.stringify({ stock: Number(val) }) }); showToast('Stock mis à jour.'); loadProducts(); }
      catch (err) { showToast(err.message); }
    }));

    tbody.querySelectorAll('[data-deactivate]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await customConfirm('Retirer ce produit de la vente ? (réversible par l\'administration)'))) return;
      try { await api(`/supplier/products/${btn.dataset.deactivate}/deactivate`, { method: 'PATCH' }); showToast('Produit retiré.'); loadProducts(); }
      catch (err) { showToast(err.message); }
    }));

    tbody.querySelectorAll('[data-delete-permanent]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await customConfirm('Supprimer DÉFINITIVEMENT ce produit ? Cette action est irréversible (les commandes déjà passées resteront visibles dans leur historique).'))) return;
      try { await api(`/supplier/products/${btn.dataset.deletePermanent}`, { method: 'DELETE' }); showToast('Produit supprimé définitivement.'); loadProducts(); }
      catch (err) { showToast(err.message); }
    }));

    tbody.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', async () => {
      const product = products.find((p) => String(p.id) === btn.dataset.edit);
      const name = prompt('Nom du produit :', product.name);
      if (name === null) return;
      const price = prompt('Ton prix (Ar) :', product.supplier_price_ar);
      if (price === null) return;
      const stock = prompt('Stock :', product.stock);
      if (stock === null) return;
      try {
        await api(`/supplier/products/${product.id}`, {
          method: 'PATCH', body: JSON.stringify({ name, supplier_price_ar: Number(price), stock: Number(stock) }),
        });
        showToast('Produit modifié, en attente de validation.');
        loadProducts();
      } catch (err) { showToast(err.message); }
    }));

    tbody.querySelectorAll('[data-manage-photos]').forEach((btn) => btn.addEventListener('click', () => {
      openPhotoManager(Number(btn.dataset.managePhotos), products.find((p) => p.id === Number(btn.dataset.managePhotos)));
    }));
  } catch (err) {
    showToast(err.message);
  }
}

// Gestion des photos d'un produit existant : ajouter (jusqu'à 5) / modifier le stock / supprimer
async function openPhotoManager(productId, product) {
  const images = product.images || [];
  const summary = images.length
    ? images.map((img, i) => `${i + 1}. ${img.color_name ? `${img.color_name} — stock : ${img.stock ?? 0}` : 'sans couleur'}`).join('\n')
    : 'Aucune photo pour le moment.';
  const action = prompt(
    `Photos actuelles :\n${summary}\n\nTape "ajouter" pour ajouter une photo, "stock" pour modifier le stock d'une couleur, ou le numéro d'une photo à supprimer (1, 2...) :`
  );
  if (!action) return;
  const cmd = action.trim().toLowerCase();

  if (cmd === 'ajouter') {
    if (images.length >= 5) { showToast('Maximum 5 photos par produit.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const colorName = prompt('Couleur associée à cette photo (laisser vide si aucune) :') || '';
      let stock;
      if (colorName) {
        const stockVal = prompt(`Stock disponible pour "${colorName}" :`, '0');
        if (stockVal === null || isNaN(stockVal)) return;
        stock = Number(stockVal);
      }
      try {
        const dataUrl = await compressImageToDataUrl(file, 900, 0.72);
        await api(`/supplier/products/${productId}/images`, {
          method: 'POST', body: JSON.stringify({ image_url: dataUrl, color_name: colorName || undefined, stock }),
        });
        showToast('Photo ajoutée.');
        loadProducts();
      } catch (err) { showToast(err.message); }
    };
    input.click();
    return;
  }

  if (cmd === 'stock') {
    const colored = images.filter((img) => img.color_name);
    if (!colored.length) { showToast('Aucune couleur définie pour ce produit.'); return; }
    const listStr = colored.map((img, i) => `${i + 1}. ${img.color_name} (stock actuel : ${img.stock ?? 0})`).join('\n');
    const choice = prompt(`Quelle couleur modifier ?\n${listStr}`);
    if (choice === null) return;
    const img = colored[Number(choice) - 1];
    if (!img) return;
    const newStock = prompt(`Nouveau stock pour "${img.color_name}" :`, img.stock ?? 0);
    if (newStock === null || isNaN(newStock)) return;
    try {
      await api(`/supplier/products/${productId}/images/${img.id}/stock`, { method: 'PATCH', body: JSON.stringify({ stock: Number(newStock) }) });
      showToast('Stock mis à jour.');
      loadProducts();
    } catch (err) { showToast(err.message); }
    return;
  }

  const index = Number(action) - 1;
  if (images[index]) {
    if (!(await customConfirm('Supprimer cette photo ?'))) return;
    try {
      await api(`/supplier/products/${productId}/images/${images[index].id}`, { method: 'DELETE' });
      showToast('Photo supprimée.');
      loadProducts();
    } catch (err) { showToast(err.message); }
  }
}

// ============================================================
// Commandes reçues (uniquement après validation du paiement)
// ============================================================
async function loadOrders() {
  try {
    const items = await api('/supplier/orders');
    const tbody = document.getElementById('ordersTableBody');
    const pendingCount = items.filter((i) => i.item_status === 'pending').length;
    document.getElementById('pendingOrdersCount').textContent = pendingCount || '';

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:var(--ink-soft);">Aucune commande pour le moment.</td></tr>';
      return;
    }

    tbody.innerHTML = items.map((i) => `
      <tr>
        <td class="mono">#${i.order_id}</td>
        <td>${i.product_name}</td>
        <td>${i.quantity}</td>
        <td class="mono">${formatAr(i.unit_supplier_price_ar * i.quantity)}</td>
        <td>${i.client_name}<br><small style="color:var(--ink-soft)">${i.client_phone}</small></td>
        <td style="max-width:180px;">${i.shipping_address}</td>
        <td><span class="badge-status badge-${i.item_status}">${statusLabel(i.item_status)}</span></td>
        <td>
          ${i.item_status === 'pending' ? `<button class="btn primary" data-ship="${i.item_id}">Expédiée</button>` : ''}
          ${i.item_status === 'shipped' ? `<button class="btn" data-deliver="${i.item_id}">Livrée</button>` : ''}
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-ship]').forEach((btn) => btn.addEventListener('click', () => updateItem(btn.dataset.ship, 'shipped')));
    tbody.querySelectorAll('[data-deliver]').forEach((btn) => btn.addEventListener('click', () => updateItem(btn.dataset.deliver, 'delivered')));
  } catch (err) {
    showToast(err.message);
  }
}

async function updateItem(itemId, item_status) {
  try {
    await api(`/supplier/orders/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ item_status }) });
    showToast('Statut mis à jour.');
    loadOrders();
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Portefeuille — retrait uniquement (les gains sont crédités automatiquement)
// ============================================================
async function loadWallet() {
  try {
    const data = await api('/wallet/me');
    document.getElementById('walletBalanceAmount').textContent = formatAr(data.balance_ar);

    const list = document.getElementById('walletHistoryList');
    if (!data.entries.length) {
      list.innerHTML = '<p class="empty-hint">Aucun mouvement pour le moment.</p>';
      return;
    }
    const typeLabel = { withdrawal: 'Retrait', order_earning: 'Gain commande' };
    const statusLabelWallet = { pending: 'En attente', confirmed: 'Confirmé', rejected: 'Rejeté' };
    list.innerHTML = data.entries.map((e) => `
      <div class="wallet-entry">
        <span>${typeLabel[e.type]} — ${statusLabelWallet[e.status]}</span>
        <span class="${e.type === 'withdrawal' ? 'amt-out' : 'amt-in'}">${e.type === 'withdrawal' ? '−' : '+'}${formatAr(e.amount_ar)}</span>
      </div>`).join('');
  } catch (err) {
    showToast(err.message);
  }
}

document.getElementById('withdrawForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('withdrawError');
  errorEl.textContent = '';
  const data = Object.fromEntries(new FormData(e.target));
  data.amount_ar = Number(data.amount_ar);
  try {
    await api('/wallet/withdraw', { method: 'POST', body: JSON.stringify(data) });
    showToast('Demande de retrait envoyée 🕓');
    e.target.reset();
    loadWallet();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ============================================================
// Mon profil
// ============================================================
async function loadProfile() {
  try {
    const user = await api('/auth/me');
    const form = document.getElementById('profileForm');
    form.full_name.value = user.full_name;
    form.email.value = user.email;
    form.phone.value = user.phone;
    form.current_password.value = '';
    form.new_password.value = '';
    pendingAvatarDataUrl = null;
    const preview = document.getElementById('profileAvatarPreview');
    if (user.avatar_url) preview.src = user.avatar_url; else preview.removeAttribute('src');
  } catch (err) {
    showToast(err.message);
  }
}

let pendingAvatarDataUrl = null;
document.getElementById('avatarFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingAvatarDataUrl = await compressImageToDataUrl(file, 400, 0.75);
    document.getElementById('profileAvatarPreview').src = pendingAvatarDataUrl;
  } catch (err) {
    showToast(err.message);
  }
});

document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('profileError');
  const successEl = document.getElementById('profileSuccess');
  errorEl.textContent = ''; successEl.textContent = '';
  const data = Object.fromEntries(new FormData(e.target));
  if (!data.current_password) delete data.current_password;
  if (!data.new_password) delete data.new_password;
  if (pendingAvatarDataUrl) data.avatar_url = pendingAvatarDataUrl;

  try {
    const body = await api('/auth/me', { method: 'PATCH', body: JSON.stringify(data) });
    setSession(body.token, body.user);
    successEl.textContent = 'Profil mis à jour.';
    e.target.current_password.value = '';
    e.target.new_password.value = '';
    loadProfile();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  if (!(await customConfirm('Supprimer définitivement ton compte fournisseur ? Cette action est irréversible.'))) return;
  try {
    await api('/auth/me', { method: 'DELETE' });
    clearSession();
    alert('Compte supprimé.');
    location.reload();
  } catch (err) {
    alert(err.message);
  }
});

// ============================================================
// Feedback — envoyer un message à l'administration
// ============================================================
document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('feedbackError');
  const successEl = document.getElementById('feedbackSuccess');
  errorEl.textContent = ''; successEl.textContent = '';
  const message = document.getElementById('feedbackMessage').value.trim();
  if (message.length < 3) { errorEl.textContent = 'Ton message est trop court.'; return; }

  try {
    await api('/feedback', { method: 'POST', body: JSON.stringify({ message }) });
    successEl.textContent = 'Message envoyé, merci !';
    e.target.reset();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ============================================================
// Initialisation — reprise de session si token déjà présent
// ============================================================
if (getToken() && getUser()) enterApp();

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
  if (!localStorage.getItem('mada_supplier_install_dismissed')) installBanner.classList.add('visible');
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
  localStorage.setItem('mada_supplier_install_dismissed', '1');
});

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
if (isIOS && !isStandalone && !localStorage.getItem('mada_supplier_install_dismissed')) {
  document.getElementById('installText').textContent = "Installe cette appli : appuie sur Partager 📤 puis \"Sur l'écran d'accueil\".";
  document.getElementById('installBtn').style.display = 'none';
  installBanner.classList.add('visible');
}
