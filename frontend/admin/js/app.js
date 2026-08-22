const API_BASE = 'https://mada-marketplace1.onrender.com/api';

function getToken() { return localStorage.getItem('mada_admin_token'); }
function getUser() {
  const raw = localStorage.getItem('mada_admin_user');
  return raw ? JSON.parse(raw) : null;
}
function setSession(token, user) {
  localStorage.setItem('mada_admin_token', token);
  localStorage.setItem('mada_admin_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('mada_admin_token');
  localStorage.removeItem('mada_admin_user');
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
    pending_review: 'À valider', active: 'En ligne', rejected: 'Rejeté', inactive: 'Retiré',
    pending_payment: 'Paiement en attente', awaiting_verification: 'Vérification en cours',
    paid: 'Payée', shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée',
    payment_rejected: 'Paiement rejeté', submitted: 'En attente', confirmed: 'Confirmé',
  };
  return labels[status] || status;
}

// ============================================================
// Lightbox — agrandir une image pour l'examiner avant validation
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
// Connexion (réservée aux comptes role='admin')
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
    if (body.user.role !== 'admin') { errorEl.textContent = 'Ce compte n\'a pas les droits administration.'; return; }
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
  loadSuppliers();
  loadProducts();
  loadReview();
  loadPayments();
  loadWallet();
  loadProfile();
  loadSettings();
  loadOverview();
  loadFeedback();
}

// ============================================================
// Navigation entre onglets
// ============================================================
const TABS = ['overview', 'review', 'products', 'payments', 'wallet', 'suppliers', 'settings', 'feedback', 'profile'];
document.querySelectorAll('.sidebar nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar nav button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    TABS.forEach((t) => {
      document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? 'block' : 'none';
    });
    if (btn.dataset.tab === 'overview') loadOverview();
  });
});

function goToTab(tabName) {
  document.querySelector(`.sidebar nav button[data-tab="${tabName}"]`)?.click();
}

// ============================================================
// Aperçu — tout au premier regard
// ============================================================
async function loadOverview() {
  try {
    const [products, payments, wallet, suppliers] = await Promise.all([
      api('/admin/products'),
      api('/admin/payments?status=submitted'),
      api('/admin/wallet?status=pending'),
      api('/admin/suppliers'),
    ]);

    const pendingProducts = products.filter((p) => p.status === 'pending_review').length;
    const activeProducts = products.filter((p) => p.status === 'active').length;
    const activeSuppliers = suppliers.filter((s) => s.is_active).length;

    const cards = [
      { num: pendingProducts, label: 'Produits à valider', tab: 'review', alert: pendingProducts > 0 },
      { num: payments.length, label: 'Transactions à vérifier', tab: 'payments', alert: payments.length > 0 },
      { num: wallet.length, label: 'Retraits fournisseurs en attente', tab: 'wallet', alert: wallet.length > 0 },
      { num: activeProducts, label: 'Produits en ligne', tab: 'products' },
      { num: activeSuppliers, label: 'Fournisseurs actifs', tab: 'suppliers' },
    ];

    document.getElementById('overviewGrid').innerHTML = cards.map((c) => `
      <div class="overview-card ${c.alert ? 'alert' : ''}" data-goto="${c.tab}">
        <div class="num">${c.num}</div>
        <div class="label">${c.label}</div>
      </div>`).join('');

    document.querySelectorAll('[data-goto]').forEach((el) => {
      el.addEventListener('click', () => goToTab(el.dataset.goto));
    });
  } catch (err) {
    showToast(err.message);
  }
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.close).classList.remove('open'));
});

// ============================================================
// Produits à valider
// ============================================================
async function loadReview() {
  try {
    const products = await api('/admin/products');
    const pending = products.filter((p) => p.status === 'pending_review');
    document.getElementById('pendingCount').textContent = pending.length || '';

    const list = document.getElementById('reviewList');
    const empty = document.getElementById('reviewEmpty');

    if (!pending.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    list.innerHTML = pending.map((p) => {
      const images = (p.images && p.images.length) ? p.images : (p.image_url ? [{ image_url: p.image_url }] : []);
      const cover = images[0];
      return `
      <div class="review-card">
        <div class="review-photo" ${cover ? `data-zoom="${cover.image_url}" data-name="${p.name}"` : ''}>
          ${cover ? `<img src="${cover.image_url}" alt="${p.name}"><span class="zoom-hint">🔍 Agrandir</span>` : '⚠️ Aucune photo fournie'}
        </div>
        ${images.length > 1 ? `<div class="review-thumbs">${images.map((img) => `<img src="${img.image_url}" data-zoom-thumb="${img.image_url}" title="${img.color_name || ''}" />`).join('')}</div>` : ''}
        <h4>${p.name}</h4>
        <div class="meta">Par ${p.supplier_name} — ${p.category || 'Autre'} — stock proposé : ${p.stock}${images.length ? ` — ${images.length} photo${images.length > 1 ? 's' : ''}` : ''}</div>
        ${p.description ? `<div class="meta">${p.description}</div>` : ''}
        <div class="price-tag">Prix fournisseur : ${formatAr(p.supplier_price_ar)}</div>
        <label class="moderation-check">
          <input type="checkbox" data-check="${p.id}" />
          <span>Je confirme avoir examiné ${images.length > 1 ? 'toutes les photos' : 'cette photo'} en grand format : ${images.length > 1 ? 'elles ne posent' : 'elle ne pose'} pas de problème de droit d'image et ne ${images.length > 1 ? 'contiennent' : 'contient'} rien d'inapproprié (pornographie, violence...).</span>
        </label>
        <div class="review-form">
          <div style="flex:1;">
            <label style="margin:0 0 4px;">Prix public (Ar)</label>
            <input type="number" min="${p.supplier_price_ar}" placeholder="ex: ${Math.round(p.supplier_price_ar * 1.2)}" data-price-input="${p.id}" />
          </div>
          <button class="btn primary" data-approve="${p.id}" disabled>✅ Valider</button>
        </div>
        <div class="actions-row">
          <button class="btn danger" data-reject="${p.id}" style="flex:1;">Rejeter</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-zoom]').forEach((el) => {
      el.addEventListener('click', () => openLightbox(el.dataset.zoom, el.dataset.name));
    });
    list.querySelectorAll('[data-zoom-thumb]').forEach((el) => {
      el.addEventListener('click', () => openLightbox(el.dataset.zoomThumb, ''));
    });

    list.querySelectorAll('[data-check]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const approveBtn = list.querySelector(`[data-approve="${chk.dataset.check}"]`);
        approveBtn.disabled = !chk.checked;
      });
    });

    list.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', async () => {
      const input = list.querySelector(`[data-price-input="${btn.dataset.approve}"]`);
      const publicPrice = Number(input.value);
      if (!publicPrice || publicPrice < 0) { showToast('Indique un prix public valide.'); return; }
      try {
        await api(`/admin/products/${btn.dataset.approve}/review`, {
          method: 'PATCH', body: JSON.stringify({ action: 'approve', public_price_ar: publicPrice }),
        });
        showToast('Produit validé et mis en ligne 🎉');
        loadReview(); loadProducts();
      } catch (err) { showToast(err.message); }
    }));

    list.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', async () => {
      const reason = prompt('Motif du rejet (visible par le fournisseur) :');
      if (!reason) return;
      try {
        await api(`/admin/products/${btn.dataset.reject}/review`, {
          method: 'PATCH', body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
        });
        showToast('Produit rejeté.');
        loadReview(); loadProducts();
      } catch (err) { showToast(err.message); }
    }));
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Catalogue complet
// ============================================================
async function loadProducts() {
  try {
    const products = await api('/admin/products');
    const tbody = document.getElementById('productsTableBody');
    tbody.innerHTML = products.map((p) => `
      <tr>
        <td>${p.image_url ? `<img class="thumb" src="${p.image_url}" data-zoom="${p.image_url}" data-name="${p.name}" alt="${p.name}">` : '—'}</td>
        <td>${p.name}</td>
        <td><small>${p.category || 'Autre'}</small></td>
        <td class="mono">${formatAr(p.supplier_price_ar)}</td>
        <td class="mono">${p.public_price_ar ? formatAr(p.public_price_ar) : '—'}</td>
        <td>${p.stock}</td>
        <td>${p.supplier_name}</td>
        <td><span class="badge-status badge-${p.status}">${statusLabel(p.status)}</span></td>
        <td>
          ${p.status === 'active' ? `<button class="btn danger" data-remove="${p.id}">Retirer</button>` : ''}
          ${p.status === 'inactive' ? `<button class="btn primary" data-restore="${p.id}">Réactiver</button>` : ''}
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-zoom]').forEach((el) => {
      el.addEventListener('click', () => openLightbox(el.dataset.zoom, el.dataset.name));
    });

    tbody.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await customConfirm('Retirer ce produit de la boutique ?'))) return;
      try { await api(`/admin/products/${btn.dataset.remove}`, { method: 'DELETE' }); showToast('Produit retiré.'); loadProducts(); }
      catch (err) { showToast(err.message); }
    }));
    tbody.querySelectorAll('[data-restore]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/admin/products/${btn.dataset.restore}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }); showToast('Produit réactivé.'); loadProducts(); }
      catch (err) { showToast(err.message); }
    }));
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Transactions à vérifier / historique
// ============================================================
async function loadPayments() {
  try {
    const pending = await api('/admin/payments?status=submitted');
    document.getElementById('paymentsCount').textContent = pending.length || '';

    const tbody = document.getElementById('paymentsTableBody');
    tbody.innerHTML = pending.map((p) => `
      <tr>
        <td class="mono">#${p.order_id}</td>
        <td>${p.client_name}<br><small style="color:var(--ink-soft)">${p.client_registered_phone}</small></td>
        <td class="mono">${formatAr(p.amount_ar)}</td>
        <td>${p.provider.replace('_', ' ')}<br><small style="color:var(--ink-soft)">${p.phone_number}</small></td>
        <td class="mono">${p.client_reference}</td>
        <td>
          <button class="btn primary" data-confirm="${p.id}">Valider</button>
          <button class="btn danger" data-reject="${p.id}">Rejeter</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" style="color:var(--ink-soft);">Aucune transaction en attente.</td></tr>';

    tbody.querySelectorAll('[data-confirm]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!(await customConfirm('Confirmes-tu avoir bien reçu ce paiement sur ton compte mobile money ?'))) return;
      try {
        await api(`/admin/payments/${btn.dataset.confirm}/confirm`, { method: 'PATCH' });
        showToast('Paiement validé — commande transmise au fournisseur.');
        loadPayments(); loadPayouts();
      } catch (err) { showToast(err.message); }
    }));
    tbody.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', async () => {
      const row = pending.find((p) => String(p.id) === btn.dataset.reject);
      const suggestion = row ? `Montant reçu incorrect. ${formatAr(row.amount_ar)} attendus — vérifie et complète le virement, puis renvoie ta référence.` : '';
      const note = prompt('Motif du rejet (visible par le client) :', suggestion);
      if (!note) return;
      try {
        await api(`/admin/payments/${btn.dataset.reject}/reject`, { method: 'PATCH', body: JSON.stringify({ admin_note: note }) });
        showToast('Paiement rejeté — le client a été notifié.');
        loadPayments();
      } catch (err) { showToast(err.message); }
    }));

    const history = await api('/admin/payments');
    const historyTbody = document.getElementById('paymentsHistoryTableBody');
    historyTbody.innerHTML = history
      .filter((p) => p.status !== 'submitted')
      .map((p) => `
        <tr>
          <td class="mono">#${p.order_id}</td>
          <td>${p.client_name}</td>
          <td class="mono">${formatAr(p.amount_ar)}</td>
          <td class="mono">${p.client_reference}</td>
          <td><span class="badge-status badge-${p.status}">${statusLabel(p.status)}</span></td>
        </tr>`).join('') || '<tr><td colspan="5" style="color:var(--ink-soft);">Rien pour le moment.</td></tr>';
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Retraits fournisseurs
// ============================================================
async function loadWallet() {
  try {
    const pending = await api('/admin/wallet?status=pending');
    document.getElementById('walletCount').textContent = pending.length || '';

    const tbody = document.getElementById('walletTableBody');
    tbody.innerHTML = pending.map((w) => `
      <tr>
        <td>${w.user_name}</td>
        <td class="mono">${formatAr(w.amount_ar)}</td>
        <td>${w.provider.replace('_', ' ')} — ${w.phone_number}</td>
        <td>
          <button class="btn primary" data-confirm="${w.id}">Valider</button>
          <button class="btn danger" data-reject="${w.id}">Rejeter</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="4" style="color:var(--ink-soft);">Rien en attente.</td></tr>';

    tbody.querySelectorAll('[data-confirm]').forEach((btn) => btn.addEventListener('click', async () => {
      const adminReference = prompt('Référence de TON virement envoyé au fournisseur :');
      if (!adminReference) return;
      try {
        await api(`/admin/wallet/${btn.dataset.confirm}/confirm`, {
          method: 'PATCH', body: JSON.stringify({ admin_reference: adminReference }),
        });
        showToast('Retrait confirmé.');
        loadWallet(); loadSuppliers(); loadOverview();
      } catch (err) { showToast(err.message); }
    }));

    tbody.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', async () => {
      const note = prompt('Motif du rejet (le solde sera remboursé au fournisseur) :');
      if (!note) return;
      try {
        await api(`/admin/wallet/${btn.dataset.reject}/reject`, { method: 'PATCH', body: JSON.stringify({ admin_note: note }) });
        showToast('Retrait rejeté, solde remboursé.');
        loadWallet(); loadSuppliers(); loadOverview();
      } catch (err) { showToast(err.message); }
    }));

    const history = await api('/admin/wallet');
    const historyTbody = document.getElementById('walletHistoryTableBody');
    historyTbody.innerHTML = history
      .filter((w) => w.status !== 'pending')
      .map((w) => `
        <tr>
          <td>${w.user_name}</td>
          <td class="mono">${formatAr(w.amount_ar)}</td>
          <td><span class="badge-status badge-${w.status === 'confirmed' ? 'active' : 'rejected'}">${w.status === 'confirmed' ? 'Confirmé' : 'Rejeté'}</span></td>
        </tr>`).join('') || '<tr><td colspan="3" style="color:var(--ink-soft);">Rien pour le moment.</td></tr>';
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Paramètres de paiement
// ============================================================
const PROVIDER_LABELS = { mvola: '📱 Mvola', orange_money: '🍊 Orange Money', airtel_money: '💳 Airtel Money' };

async function loadSettings() {
  try {
    const settings = await api('/admin/settings/payment-numbers');
    const panel = document.getElementById('settingsPanel');
    panel.innerHTML = settings.map((s) => `
      <div class="settings-row">
        <div class="provider-label">${PROVIDER_LABELS[s.provider]}</div>
        <div class="field">
          <label>Numéro</label>
          <input type="tel" placeholder="034xxxxxxx" value="${s.phone_number || ''}" data-phone="${s.provider}" />
        </div>
        <div class="field">
          <label>Nom du titulaire du compte</label>
          <input type="text" placeholder="ex: Baobab Bazar SARL" value="${s.account_name || ''}" data-name="${s.provider}" />
        </div>
        <button class="btn primary" data-save="${s.provider}">Enregistrer</button>
      </div>`).join('');

    panel.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
      const errorEl = document.getElementById('settingsError');
      const successEl = document.getElementById('settingsSuccess');
      errorEl.textContent = ''; successEl.textContent = '';
      const provider = btn.dataset.save;
      const phone_number = panel.querySelector(`[data-phone="${provider}"]`).value.trim();
      const account_name = panel.querySelector(`[data-name="${provider}"]`).value.trim();
      try {
        await api('/admin/settings/payment-numbers', {
          method: 'PATCH', body: JSON.stringify({ provider, phone_number, account_name }),
        });
        successEl.textContent = `${PROVIDER_LABELS[provider]} mis à jour.`;
      } catch (err) {
        errorEl.textContent = err.message;
      }
    }));
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Feedback
// ============================================================
async function loadFeedback() {
  try {
    const messages = await api('/admin/feedback');
    const unread = messages.filter((m) => !m.is_read).length;
    document.getElementById('feedbackCount').textContent = unread || '';

    const list = document.getElementById('feedbackList');
    const empty = document.getElementById('feedbackEmpty');
    if (!messages.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    list.innerHTML = messages.map((m) => `
      <div class="panel" style="margin-bottom:12px; ${m.is_read ? '' : 'border-left:4px solid var(--gold);'}">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <strong>${m.full_name} <span style="font-weight:400; color:var(--ink-soft);">(${m.role === 'client' ? 'client' : 'fournisseur'})</span></strong>
          <small style="color:var(--ink-soft);">${new Date(m.created_at).toLocaleDateString('fr-FR')}</small>
        </div>
        <p style="margin:0;">${m.message}</p>
        ${!m.is_read ? `<button class="btn" data-mark-read="${m.id}" style="margin-top:8px;">Marquer comme lu</button>` : ''}
      </div>`).join('');

    list.querySelectorAll('[data-mark-read]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/admin/feedback/${btn.dataset.markRead}/read`, { method: 'PATCH' }); loadFeedback(); }
      catch (err) { showToast(err.message); }
    }));
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// Fournisseurs
// ============================================================
async function loadSuppliers() {
  try {
    const suppliers = await api('/admin/suppliers');
    const tbody = document.getElementById('suppliersTableBody');
    tbody.innerHTML = suppliers.map((s) => `
      <tr>
        <td>${s.full_name}</td>
        <td>${s.email}</td>
        <td>${s.phone}</td>
        <td class="mono">${formatAr(s.balance_ar)}</td>
        <td><span class="badge-status badge-${s.is_active ? 'active' : 'inactive'}">${s.is_active ? 'Actif' : 'Désactivé'}</span></td>
        <td><button class="btn ${s.is_active ? 'danger' : 'primary'}" data-toggle="${s.id}" data-state="${s.is_active}">${s.is_active ? 'Désactiver' : 'Réactiver'}</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api(`/admin/suppliers/${btn.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ is_active: btn.dataset.state !== 'true' }) });
        loadSuppliers();
      } catch (err) { showToast(err.message); }
    }));
  } catch (err) {
    showToast(err.message);
  }
}

document.getElementById('supplierForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('supplierFormError');
  errorEl.textContent = '';
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await api('/admin/suppliers', { method: 'POST', body: JSON.stringify(data) });
    showToast('Fournisseur créé.');
    e.target.reset();
    loadSuppliers();
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
  if (!(await customConfirm('Supprimer définitivement ton compte admin ? Cette action est irréversible.'))) return;
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
  if (!localStorage.getItem('mada_admin_install_dismissed')) installBanner.classList.add('visible');
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
  localStorage.setItem('mada_admin_install_dismissed', '1');
});

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
if (isIOS && !isStandalone && !localStorage.getItem('mada_admin_install_dismissed')) {
  document.getElementById('installText').textContent = "Installe cette appli : appuie sur Partager 📤 puis \"Sur l'écran d'accueil\".";
  document.getElementById('installBtn').style.display = 'none';
  installBanner.classList.add('visible');
}
