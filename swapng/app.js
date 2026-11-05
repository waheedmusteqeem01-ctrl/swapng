import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, getDocs, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, where, increment, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const API_BASE = 'https://swapngai.waheedmusteqeem01.workers.dev';

const firebaseConfig = {
  apiKey: "AIzaSyDW4rzLNWdQZbh2Dvtt1CjrRlot6yEqRG0",
  authDomain: "swapng-30adc.firebaseapp.com",
  projectId: "swapng-30adc",
  storageBucket: "swapng-30adc.firebasestorage.app",
  messagingSenderId: "375390444183",
  appId: "1:375390444183:web:453e2843481320572127d2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_UIDS = []; // Add your Firebase UID here to access admin
const VERIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;
const CATEGORY_ICONS = { phones: 'fa-mobile-screen', jerseys: 'fa-tshirt', shoes: 'fa-shoe-prints', electronics: 'fa-laptop', cars: 'fa-car', fashion: 'fa-vest', properties: 'fa-house', books: 'fa-book' };

// ==========================================
// 2. STATE VARIABLES
// ==========================================
let allItems = [], filteredItems = [], renderedCount = 0;
let sellerProfiles = {}, currentCategory = 'all', currentSearch = '', currentSort = 'newest';
let priceMin = null, priceMax = null, filterLocation = '', filterSeller = '', filterRating = null, verifiedOnly = false, filterCondition = '';
let currentUser = null, sellerProfile = null, editingId = null, openDetailId = null;
let favoritedIds = new Set();
let pendingImages = [], existingImages = [];
let currentHeroIndex = 0;
let currentChatId = null, chatUnsub = null;
let recentlyViewed = [];
const reviewCache = {}, reviewStats = {};
let lastReadMap = {};
try { lastReadMap = JSON.parse(localStorage.getItem('swapng-chat-read') || '{}'); } catch { }

const $ = id => document.getElementById(id);
const grid = $('marketplaceGrid'), toastContainer = $('toastContainer');

// ==========================================
// 3. UTILITIES & HELPERS
// ==========================================
function toast(msg, type = 'info', duration = 2800) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(msg)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300) }, duration);
}

function friendlyError(err) {
  const m = (err && err.message) || '', c = (err && err.code) || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password') return 'Incorrect email or password';
  if (c === 'auth/user-not-found') return 'No account with that email';
  if (c === 'auth/email-already-in-use') return 'That email is already registered';
  if (c === 'auth/weak-password') return 'Password is too weak';
  if (c === 'auth/invalid-email') return 'Please enter a valid email';
  if (c === 'permission-denied' || m.includes('permission-denied')) return 'Permission denied';
  if (m.includes('offline')) return 'You appear to be offline';
  return m.replace('Firebase: ', '').replace(/\(auth\/.*\)\.?/, '').trim() || 'Something went wrong';
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') }
function timeAgo(ts) { if (!ts) return 'just now'; const d = ts.toDate ? ts.toDate() : new Date(ts); const df = Math.floor((Date.now() - d.getTime()) / 1000); if (df < 60) return 'just now'; if (df < 3600) return `${Math.floor(df / 60)}m ago`; if (df < 86400) return `${Math.floor(df / 3600)}h ago`; if (df < 604800) return `${Math.floor(df / 86400)}d ago`; return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
function parsePrice(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n }
function getDisplayName(u) { if (!u) return 'User'; if (u.displayName && u.displayName.trim()) return u.displayName.trim(); if (u.email && u.email.indexOf('@') > 0) return u.email.split('@')[0]; return 'User' }
function haptic(ms = 12) { try { if (navigator.vibrate) navigator.vibrate(ms) } catch { } }
function isNew(ts) { if (!ts) return false; const d = ts.toDate ? ts.toDate() : new Date(ts); return (Date.now() - d.getTime()) < 86400000 }
function isPriceDrop(item) { return item.originalPriceValue && item.priceValue && item.priceValue < item.originalPriceValue }
function getVerificationStatus(s) { if (!s) return 'unverified'; const v = s.verificationStatus; if (v === 'verified' || v === 'pending' || v === 'rejected') return v; return 'unverified' }
function cooldownRemainingMs(s) { if (!s) return 0; const l = s.lastVerificationRequestAt || s.verificationRequestedAt || s.rejectedAt; if (!l) return 0; const ts = l.toDate ? l.toDate().getTime() : new Date(l).getTime(); const r = VERIFICATION_COOLDOWN_MS - (Date.now() - ts); return r > 0 ? r : 0 }
function formatCooldown(ms) { const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); return h > 0 ? `${h}h ${m}m` : `${m}m` }
function isVerifiedSeller(u) { return getVerificationStatus(sellerProfiles[u]) === 'verified' }
function isPendingSeller(u) { return getVerificationStatus(sellerProfiles[u]) === 'pending' }
function getSellerRating(u) { return reviewStats[u] || { avg: 0, count: 0 } }

// ==========================================
// 4. SYSTEM & UI SETUP
// ==========================================
function updateOnlineStatus() { $('offlineBanner').classList.toggle('show', !navigator.onLine) }
window.addEventListener('online', updateOnlineStatus); window.addEventListener('offline', updateOnlineStatus); updateOnlineStatus();

const themeIcon = $('themeIcon');
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); if (t === 'dark') { themeIcon.classList.remove('fa-moon'); themeIcon.classList.add('fa-sun') } else { themeIcon.classList.remove('fa-sun'); themeIcon.classList.add('fa-moon') } }
let storedTheme = 'auto'; try { storedTheme = localStorage.getItem('swapng-theme') || 'auto' } catch { }
function resolveTheme() { if (storedTheme === 'auto') return matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'; return storedTheme }
applyTheme(resolveTheme());
matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => { if (storedTheme === 'auto') applyTheme(resolveTheme()) });
$('themeToggle').addEventListener('click', () => { const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; storedTheme = n; try { localStorage.setItem('swapng-theme', n) } catch { } applyTheme(n); toast(n === 'dark' ? 'Dark mode' : 'Light mode', 'info', 1400); haptic() });

function openModal(m) { m.classList.add('open'); document.body.style.overflow = 'hidden' }
function closeModal(m) { m.classList.remove('open'); if (!document.querySelector('.modal-overlay.open') && !document.querySelector('.support-panel.open')) document.body.style.overflow = '' }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal($(b.getAttribute('data-close')))));
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeModal(o) }));
document.querySelectorAll('[data-switch]').forEach(l => l.addEventListener('click', () => { const t = l.getAttribute('data-switch'); if (t === 'signup') { closeModal($('loginModal')); setTimeout(() => openModal($('signupModal')), 200) } else { closeModal($('signupModal')); setTimeout(() => openModal($('loginModal')), 200) } }));

// ==========================================
// 5. CLOUDFLARE API INTEGRATION (UPLOAD & AI)
// ==========================================
async function uploadFile(file) {
  if (!currentUser) throw new Error('Log in first');
  const token = await currentUser.getIdToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  const { url } = await res.json();
  return url;
}

async function uploadAllPending() {
  const urls = [...existingImages];
  for (const img of pendingImages) {
    const url = await uploadFile(img.file);
    urls.push(url);
  }
  return urls;
}

// ==========================================
// 6. DATA LOADING (LISTINGS, REVIEWS, FAVORITES)
// ==========================================
function showSkeleton() {
  let h = '';
  for (let i = 0; i < 8; i++)h += `<div class="skeleton-card"><div class="skeleton-block skeleton-img"></div><div class="skeleton-body"><div class="skeleton-block skeleton-line long"></div><div class="skeleton-block skeleton-line short"></div><div class="skeleton-block skeleton-line tiny"></div></div></div>`;
  grid.innerHTML = h;
}

async function loadSellerProfile(uid) { try { const s = await getDoc(doc(db, 'sellers', uid)); if (s.exists()) { sellerProfile = s.data(); sellerProfiles[uid] = sellerProfile } else sellerProfile = null } catch (e) { sellerProfile = null } }
async function loadAllSellers() { try { const s = await getDocs(collection(db, 'sellers')); s.docs.forEach(d => { sellerProfiles[d.id] = d.data() }) } catch (e) { console.error(e) } }

async function prefetchReviewStats() {
  try {
    const s = await getDocs(collection(db, 'reviews'));
    const g = {};
    s.docs.forEach(d => { const x = d.data(); const u = x.sellerUid; if (!u) return; (g[u] = g[u] || []).push({ id: d.id, reviewerUid: x.reviewerUid || '', reviewerName: x.reviewerName || 'Anonymous', sellerUid: u, rating: Number(x.rating) || 0, comment: x.comment || '', createdAt: x.createdAt }) });
    Object.keys(g).forEach(u => { const r = g[u].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)); reviewCache[u] = r; const s2 = r.reduce((a, x) => a + x.rating, 0); reviewStats[u] = { avg: r.length ? s2 / r.length : 0, count: r.length } });
  } catch (e) { console.error(e) }
}

async function loadFavorites() {
  if (!currentUser) { favoritedIds = new Set(); updateFavBadge(); return }
  try {
    const s = await getDocs(collection(db, 'favorites', currentUser.uid, 'items'));
    favoritedIds = new Set(s.docs.map(d => d.id)); updateFavBadge();
  } catch (e) { console.error(e) }
}
function updateFavBadge() { const b = $('favCount'); if (favoritedIds.size > 0) { b.textContent = favoritedIds.size; b.style.display = 'flex' } else b.style.display = 'none' }

async function fetchListings() {
  showSkeleton();
  try {
    const ref = collection(db, 'listings');
    let snap;
    try { snap = await getDocs(query(ref, orderBy('createdAt', 'desc'))) } catch { snap = await getDocs(ref) }
    allItems = snap.docs.map(d => {
      const x = d.data();
      return {
        id: d.id, title: x.title || 'Untitled', price: x.price || '₦0', priceValue: parsePrice(x.price),
        originalPriceValue: x.originalPrice ? parsePrice(x.originalPrice) : null, originalPrice: x.originalPrice || null,
        category: x.category || 'all', condition: x.condition || '', negotiable: x.negotiable === true || x.negotiable === 'yes',
        sold: x.sold === true, location: x.location || 'Nigeria', seller: x.seller || 'Anonymous',
        sellerUid: x.sellerUid || '', sellerEmail: x.sellerEmail || '', sellerPhone: x.sellerPhone || '',
        description: x.description || '', images: Array.isArray(x.images) ? x.images : [],
        lat: x.lat || null, lng: x.lng || null, views: x.views || 0, createdAt: x.createdAt,
        icon: CATEGORY_ICONS[x.category] || 'fa-box'
      };
    });
    await loadAllSellers();
    await prefetchReviewStats();
    await loadFavorites();
    populateFilterOptions();
    buildTrending();
    renderRecentlyViewed();
    renderItems();
    updateActiveFiltersUI();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load listings.</p><p class="sub">${escapeHtml(friendlyError(err))}</p></div>`;
  }
}

function populateFilterOptions() {
  const locs = [...new Set(allItems.map(i => i.location).filter(Boolean))].sort();
  const slr = [...new Set(allItems.map(i => i.seller).filter(Boolean))].sort();
  ['locationFilter', 'locationFilterMobile'].forEach(id => { const s = $(id), v = s.value; s.innerHTML = '<option value="">All locations</option>' + locs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join(''); s.value = v });
  ['sellerFilter', 'sellerFilterMobile'].forEach(id => { const s = $(id), v = s.value; s.innerHTML = '<option value="">All sellers</option>' + slr.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join(''); s.value = v });
}

// ==========================================
// 7. RENDERING THE UI
// ==========================================
function getFilteredSorted() {
  return allItems.filter(item => {
    const mc = currentCategory === 'all' || item.category === currentCategory;
    const q = currentSearch.toLowerCase();
    const ms = !q || item.title.toLowerCase().includes(q) || item.seller.toLowerCase().includes(q) || item.location.toLowerCase().includes(q);
    const mn = priceMin === null || item.priceValue >= priceMin;
    const mx = priceMax === null || item.priceValue <= priceMax;
    const ml = !filterLocation || item.location === filterLocation;
    const msl = !filterSeller || item.seller === filterSeller;
    const mv = !verifiedOnly || isVerifiedSeller(item.sellerUid);
    const mcond = !filterCondition || item.condition === filterCondition;
    let mr = true;
    if (filterRating !== null) { const { avg } = getSellerRating(item.sellerUid); mr = avg >= filterRating }
    return mc && ms && mn && mx && ml && msl && mv && mr && mcond;
  }).sort((a, b) => {
    if (currentSort === 'price-asc') return a.priceValue - b.priceValue;
    if (currentSort === 'price-desc') return b.priceValue - a.priceValue;
    if (currentSort === 'rating-desc') return getSellerRating(b.sellerUid).avg - getSellerRating(a.sellerUid).avg;
    if (currentSort === 'title-asc') return a.title.localeCompare(b.title);
    return 0;
  });
}

function cardHtml(item) {
  const isS = item.sellerUid && item.sellerUid.length > 0;
  const ver = isVerifiedSeller(item.sellerUid);
  const pen = isPendingSeller(item.sellerUid);
  const { avg, count } = getSellerRating(item.sellerUid);
  const isFav = favoritedIds.has(item.id);
  const nw = isNew(item.createdAt);
  const dr = isPriceDrop(item);
  let badges = '';
  if (item.sold) badges += '<span class="card-badge sold">Sold</span>';
  else if (nw) badges += '<span class="card-badge new">New</span>';
  if (dr) badges += '<span class="card-badge dropped">↓ Price Drop</span>';
  if (item.negotiable) badges += '<span class="card-badge negotiable">Negotiable</span>';
  let bh = '';
  if (ver) bh = '<span class="verified-badge"><i class="fa-solid fa-circle-check"></i></span>';
  else if (pen) bh = '<span class="pending-badge"><i class="fa-solid fa-hourglass-half"></i></span>';
  else if (isS) bh = '<span class="seller-badge">Seller</span>';
  const img = item.images && item.images.length ? `<img src="${escapeHtml(item.images[0])}" loading="lazy" alt="">` : `<i class="fa-solid ${item.icon}"></i>`;
  return `<div class="card ${item.sold ? 'sold' : ''}" data-id="${item.id}">
    <div class="card-img">${img}${badges ? `<div class="card-badges">${badges}</div>` : ''}<button type="button" class="card-fav ${isFav ? 'active' : ''}" data-fav="${item.id}"><i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button></div>
    <div class="card-body">
      <div class="card-title">${escapeHtml(item.title)}</div>
      <div class="card-price">${escapeHtml(item.price)}</div>
      <div class="card-location"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.location)}</div>
      <div class="card-footer"><span class="card-tag">${escapeHtml(item.category)}</span><span class="card-seller"><span class="seller-name">${escapeHtml(item.seller)}</span>${bh}${count > 0 ? `<span class="rating-inline"><i class="fa-solid fa-star"></i>${avg.toFixed(1)}</span>` : ''}</span></div>
    </div>
  </div>`;
}

function renderItems() {
  filteredItems = getFilteredSorted();
  const cn = currentCategory === 'all' ? 'All' : currentCategory.charAt(0).toUpperCase() + currentCategory.slice(1);
  $('sectionTitle').innerHTML = `${cn} <span>Listings</span>`;
  $('resultCount').textContent = `${filteredItems.length} item${filteredItems.length === 1 ? '' : 's'} found`;
  if (filteredItems.length === 0) {
    const hf = currentSearch || priceMin !== null || priceMax !== null || filterLocation || filterSeller || verifiedOnly || filterRating !== null || currentCategory !== 'all' || filterCondition;
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>${hf ? 'No items match your filters.' : 'No listings yet.'}</p><p class="sub">${hf ? 'Try clearing filters.' : 'Be the first to post!'}</p>${hf ? '<button type="button" class="btn btn-outline" id="emptyClearBtn"><i class="fa-solid fa-xmark"></i> Clear filters</button>' : ''}${currentUser ? '<button type="button" class="btn btn-primary" id="emptySellBtn"><i class="fa-solid fa-plus"></i> Sell something</button>' : ''}</div>`;
    $('emptyClearBtn')?.addEventListener('click', () => $('clearFilters').click());
    $('emptySellBtn')?.addEventListener('click', () => $('sellBtn').click());
    return;
  }
  renderedCount = Math.min(PAGE_SIZE, filteredItems.length);
  const page = filteredItems.slice(0, renderedCount);
  let html = page.map(i => cardHtml(i)).join('');
  if (filteredItems.length > renderedCount) {
    html += `<div class="load-more-wrap"><button type="button" class="load-more-btn" id="loadMoreBtn"><i class="fa-solid fa-arrow-down"></i> Load more (${filteredItems.length - renderedCount} left)</button></div>`;
  }
  grid.innerHTML = html;
  bindLoadMore();
}

function bindLoadMore() {
  const btn = $('loadMoreBtn');
  if (!btn) return;
  btn.onclick = () => {
    const next = Math.min(renderedCount + PAGE_SIZE, filteredItems.length);
    const more = filteredItems.slice(renderedCount, next);
    btn.parentElement.remove();
    grid.insertAdjacentHTML('beforeend', more.map(i => cardHtml(i)).join(''));
    renderedCount = next;
    if (filteredItems.length > renderedCount) {
      grid.insertAdjacentHTML('beforeend', `<div class="load-more-wrap"><button type="button" class="load-more-btn" id="loadMoreBtn"><i class="fa-solid fa-arrow-down"></i> Load more (${filteredItems.length - renderedCount} left)</button></div>`);
      bindLoadMore();
    }
  };
}

function crossfadeRender() { grid.classList.add('fading'); setTimeout(() => { renderItems(); updateActiveFiltersUI(); grid.classList.remove('fading') }, 140) }

// ==========================================
// 8. LISTENERS & FILTERS
// ==========================================
$('categoriesContainer').addEventListener('click', e => {
  const btn = e.target.closest('.cat-btn'); if (!btn) return;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.category;
  btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  crossfadeRender(); haptic();
});

let searchTimer;
$('searchInput').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { currentSearch = e.target.value.trim(); crossfadeRender() }, 180) });

function syncSortSelects(v) { $('sortSelect').value = v; $('sortSelectMobile').value = v }
function syncPriceInputs(a, b) { $('priceMin').value = a ?? ''; $('priceMax').value = b ?? ''; $('priceMinMobile').value = a ?? ''; $('priceMaxMobile').value = b ?? '' }
function syncLocationSelects(v) { $('locationFilter').value = v; $('locationFilterMobile').value = v }
function syncSellerSelects(v) { $('sellerFilter').value = v; $('sellerFilterMobile').value = v }
function syncRatingSelects(v) { $('ratingFilter').value = v ?? ''; $('ratingFilterMobile').value = v ?? '' }
function syncCondition(v) { $('conditionFilter').value = v; $('conditionFilterMobile').value = v }
function syncVerified(v) { $('verifiedOnly').checked = v; $('verifiedOnlyMobile').checked = v; $('verifiedToggle').classList.toggle('active', v); const m = $('verifiedOnlyMobile'); if (m) m.closest('.verified-toggle').classList.toggle('active', v) }

$('sortSelect').addEventListener('change', e => { syncSortSelects(e.target.value); currentSort = e.target.value; crossfadeRender() });
$('sortSelectMobile').addEventListener('change', e => { syncSortSelects(e.target.value); currentSort = e.target.value; crossfadeRender() });
$('priceMin').addEventListener('input', e => { syncPriceInputs(e.target.value, priceMax); priceMin = e.target.value === '' ? null : parseFloat(e.target.value); crossfadeRender() });
$('priceMax').addEventListener('input', e => { syncPriceInputs(priceMin, e.target.value); priceMax = e.target.value === '' ? null : parseFloat(e.target.value); crossfadeRender() });
$('priceMinMobile').addEventListener('input', e => { syncPriceInputs(e.target.value, priceMax); priceMin = e.target.value === '' ? null : parseFloat(e.target.value); crossfadeRender() });
$('priceMaxMobile').addEventListener('input', e => { syncPriceInputs(priceMin, e.target.value); priceMax = e.target.value === '' ? null : parseFloat(e.target.value); crossfadeRender() });
$('locationFilter').addEventListener('change', e => { syncLocationSelects(e.target.value); filterLocation = e.target.value; crossfadeRender() });
$('locationFilterMobile').addEventListener('change', e => { syncLocationSelects(e.target.value); filterLocation = e.target.value; crossfadeRender() });
$('sellerFilter').addEventListener('change', e => { syncSellerSelects(e.target.value); filterSeller = e.target.value; crossfadeRender() });
$('sellerFilterMobile').addEventListener('change', e => { syncSellerSelects(e.target.value); filterSeller = e.target.value; crossfadeRender() });
$('ratingFilter').addEventListener('change', e => { syncRatingSelects(e.target.value); filterRating = e.target.value === '' ? null : parseFloat(e.target.value); crossfadeRender() });
$('ratingFilterMobile').addEventListener('change', e => { syncRatingSelects(e.target.value); filterRating = e.target.value === '' ? null : parseFloat(e.target.value); crossfadeRender() });
$('conditionFilter').addEventListener('change', e => { syncCondition(e.target.value); filterCondition = e.target.value; crossfadeRender() });
$('conditionFilterMobile').addEventListener('change', e => { syncCondition(e.target.value); filterCondition = e.target.value; crossfadeRender() });
$('verifiedOnly').addEventListener('change', e => { verifiedOnly = e.target.checked; syncVerified(verifiedOnly); crossfadeRender() });
$('verifiedOnlyMobile').addEventListener('change', e => { verifiedOnly = e.target.checked; syncVerified(verifiedOnly); crossfadeRender() });

$('clearFilters').addEventListener('click', () => {
  syncSortSelects('newest'); syncPriceInputs('', ''); syncLocationSelects(''); syncSellerSelects(''); syncRatingSelects(''); syncCondition(''); syncVerified(false);
  $('searchInput').value = '';
  currentSort = 'newest'; priceMin = null; priceMax = null; filterLocation = ''; filterSeller = ''; filterRating = null; verifiedOnly = false; currentSearch = ''; filterCondition = '';
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.category === 'all'));
  currentCategory = 'all'; crossfadeRender(); toast('Filters cleared', 'info', 1500);
});

function updateActiveFiltersUI() {
  const p = [];
  if (currentSearch) p.push({ l: `"${currentSearch}"`, c: () => { $('searchInput').value = ''; currentSearch = '' } });
  if (filterLocation) p.push({ l: filterLocation, c: () => { filterLocation = ''; syncLocationSelects('') } });
  if (filterSeller) p.push({ l: filterSeller, c: () => { filterSeller = ''; syncSellerSelects('') } });
  if (priceMin !== null) p.push({ l: `Min ₦${priceMin}`, c: () => { priceMin = null; syncPriceInputs('', priceMax) } });
  if (priceMax !== null) p.push({ l: `Max ₦${priceMax}`, c: () => { priceMax = null; syncPriceInputs(priceMin, '') } });
  if (filterRating !== null) p.push({ l: `${filterRating}★+`, c: () => { filterRating = null; syncRatingSelects('') } });
  if (filterCondition) p.push({ l: filterCondition, c: () => { filterCondition = ''; syncCondition('') } });
  if (verifiedOnly) p.push({ l: 'Verified only', c: () => { verifiedOnly = false; syncVerified(false) } });
  if (!p.length) { $('activeFilters').innerHTML = ''; return }
  $('activeFilters').innerHTML = p.map((x, i) => `<span class="filter-pill">${escapeHtml(x.l)}<button type="button" data-pill="${i}"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
  $('activeFilters').querySelectorAll('[data-pill]').forEach(b => b.addEventListener('click', () => { const i = parseInt(b.dataset.pill, 10); p[i].c(); crossfadeRender() }));
}

const md = $('mobileFilterDrawer');
$('mobileFilterToggle').addEventListener('click', () => { md.classList.add('open'); document.body.style.overflow = 'hidden' });
md.addEventListener('click', e => { if (e.target === md) { md.classList.remove('open'); document.body.style.overflow = '' } });
$('mobileFilterApply').addEventListener('click', () => { md.classList.remove('open'); document.body.style.overflow = '' });
$('mobileFilterClear').addEventListener('click', () => $('clearFilters').click());

grid.addEventListener('click', e => {
  const fav = e.target.closest('[data-fav]');
  if (fav) { e.stopPropagation(); toggleFavorite(fav.dataset.fav); return }
  const c = e.target.closest('.card');
  if (c) { openDetail(c.dataset.id); haptic() }
});

async function toggleFavorite(id) {
  if (!currentUser) { openModal($('loginModal')); toast('Log in to save', 'info'); return }
  haptic();
  try {
    const ref = doc(db, 'favorites', currentUser.uid, 'items', id);
    if (favoritedIds.has(id)) { await deleteDoc(ref); favoritedIds.delete(id); toast('Removed', 'info', 1500) }
    else { await setDoc(ref, { listingId: id, savedAt: serverTimestamp() }); favoritedIds.add(id); toast('Saved ❤', 'success', 1500) }
    updateFavBadge();
    document.querySelectorAll(`[data-fav="${id}"]`).forEach(b => { b.classList.toggle('active', favoritedIds.has(id)); b.innerHTML = `<i class="${favoritedIds.has(id) ? 'fa-solid' : 'fa-regular'} fa-heart"></i>` });
  } catch (e) { toast(friendlyError(e), 'error') }
}

// ==========================================
// 9. UPLOADER & SELL LOGIC
// ==========================================
function renderUploader() {
  const up = $('uploader');
  let h = '';
  existingImages.forEach((url, i) => { h += `<div class="upload-tile"><img src="${escapeHtml(url)}" alt=""><button type="button" class="remove" data-rm-existing="${i}"><i class="fa-solid fa-xmark"></i></button></div>` });
  pendingImages.forEach((img, i) => { h += `<div class="upload-tile"><img src="${img.url}" alt=""><button type="button" class="remove" data-rm-pending="${i}"><i class="fa-solid fa-xmark"></i></button></div>` });
  if (existingImages.length + pendingImages.length < 5) h += `<div class="upload-tile" id="addPhotoBtn"><i class="fa-solid fa-camera"></i></div>`;
  up.innerHTML = h;
  $('addPhotoBtn')?.addEventListener('click', () => $('fileInput').click());
  up.querySelectorAll('[data-rm-existing]').forEach(b => b.addEventListener('click', () => { existingImages.splice(parseInt(b.dataset.rmExisting, 10), 1); renderUploader() }));
  up.querySelectorAll('[data-rm-pending]').forEach(b => b.addEventListener('click', () => { pendingImages.splice(parseInt(b.dataset.rmPending, 10), 1); renderUploader() }));
}
$('fileInput').addEventListener('change', e => {
  const files = [...e.target.files].slice(0, 5 - existingImages.length - pendingImages.length);
  files.forEach(f => {
    if (f.size > 5 * 1024 * 1024) { toast(`${f.name} too large (max 5MB)`, 'error'); return }
    if (!f.type.startsWith('image/')) return;
    pendingImages.push({ file: f, url: URL.createObjectURL(f) });
  });
  renderUploader(); e.target.value = '';
});

const sellPriceInput = $('sellPrice');
sellPriceInput.addEventListener('input', e => {
  const cp = e.target.selectionStart, b = e.target.value.length;
  const f = formatPriceField(e.target.value);
  e.target.value = f;
  const np = Math.max(0, cp + (f.length - b));
  try { e.target.setSelectionRange(np, np) } catch { }
});
sellPriceInput.addEventListener('focus', e => { if (!e.target.value) e.target.value = '₦' });
sellPriceInput.addEventListener('blur', e => { if (e.target.value === '₦') e.target.value = '' });
function formatPriceField(raw) { const d = String(raw).replace(/[^\d]/g, ''); if (!d) return ''; const n = parseInt(d, 10); if (isNaN(n)) return ''; return '₦' + n.toLocaleString('en-NG') }

// ==========================================
// 10. AUTHENTICATION
// ==========================================
$('loginBtn').addEventListener('click', () => openModal($('loginModal')));
$('signupBtn').addEventListener('click', () => openModal($('signupModal')));
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('loginEmail').value.trim(), pw = $('loginPassword').value;
  const b = $('loginSubmit'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try { await signInWithEmailAndPassword(auth, email, pw); closeModal($('loginModal')); e.target.reset(); toast('Logged in', 'success') }
  catch (err) { toast(friendlyError(err), 'error') }
  finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Log In' }
});
$('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const n = $('signupName').value.trim(), em = $('signupEmail').value.trim(), pw = $('signupPassword').value;
  const b = $('signupSubmit'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try { const c = await createUserWithEmailAndPassword(auth, em, pw); if (n) await updateProfile(c.user, { displayName: n }); closeModal($('signupModal')); e.target.reset(); toast('Account created', 'success') }
  catch (err) { toast(friendlyError(err), 'error') }
  finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-user-plus"></i> Sign Up' }
});
$('logoutBtn').addEventListener('click', async () => { await signOut(auth); sellerProfile = null; favoritedIds = new Set(); updateFavBadge(); toast('Logged out', 'info', 1500) });

// ==========================================
// 11. SELLING & POSTING
// ==========================================
$('sellBtn').addEventListener('click', async () => {
  if (!currentUser) { openModal($('loginModal')); toast('Please log in', 'info'); return }
  await loadSellerProfile(currentUser.uid);
  if (!sellerProfile) openModal($('sellerModal'));
  else {
    setSellModalForCreate();
    $('sellForm').reset();
    existingImages = []; pendingImages = []; renderUploader();
    $('sellLocation').value = sellerProfile.location || '';
    $('sellPhone').value = sellerProfile.phone || '';
    openModal($('sellModal'));
  }
});
function setSellModalForCreate() { editingId = null; existingImages = []; pendingImages = []; renderUploader(); $('sellModalTitle').textContent = 'Post a listing'; $('sellModalSub').textContent = 'Sell your item on SwapNG'; document.querySelector('#sellSubmitText').textContent = 'Post Listing'; $('sellPhone').value = (sellerProfile && sellerProfile.phone) || '' }
function setSellModalForEdit() { $('sellModalTitle').textContent = 'Edit listing'; $('sellModalSub').textContent = 'Update your listing details'; document.querySelector('#sellSubmitText').textContent = 'Update Listing' }

$('sellerForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser) return;
  const n = $('sellerName').value.trim(), ph = $('sellerPhone').value.trim(), loc = $('sellerLocation').value.trim();
  if (!n || !ph || !loc) { toast('Fill all fields', 'error'); return }
  const b = $('sellerSubmit'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await setDoc(doc(db, 'sellers', currentUser.uid), { uid: currentUser.uid, name: n, phone: ph, location: loc, email: currentUser.email, verificationStatus: 'unverified', createdAt: serverTimestamp() });
    sellerProfile = { name: n, phone: ph, location: loc, email: currentUser.email, verificationStatus: 'unverified' };
    sellerProfiles[currentUser.uid] = sellerProfile;
    closeModal($('sellerModal')); e.target.reset();
    toast('Seller account created 🎉', 'success');
    setTimeout(() => { setSellModalForCreate(); $('sellForm').reset(); $('sellLocation').value = loc; $('sellPhone').value = ph; openModal($('sellModal')) }, 250);
  } catch (err) { toast(friendlyError(err), 'error') }
  finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-store"></i> Create Seller Account' }
});

// AI Write Button (Connected to Cloudflare Worker)
$('aiDescBtn').addEventListener('click', async () => {
  const title = $('sellTitle').value.trim();
  const cat = $('sellCategory').value;
  const cond = $('sellCondition').value;
  if (!title) { toast('Enter a title first', 'info'); return; }
  if (!currentUser) { toast('Log in first', 'error'); return; }

  const b = $('aiDescBtn');
  b.disabled = true;
  b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const token = await currentUser.getIdToken();
    const prompt = `Write a short, friendly marketplace listing description (3-4 sentences, max 80 words) for: "${title}". Category: ${cat || 'general'}. Condition: ${cond || 'used'}. Nigerian marketplace, be natural. No emojis.`;

    const res = await fetch(`${API_BASE}/api/ai`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'AI unavailable');
    }

    const { text } = await res.json();
    $('sellDescription').value = text.trim().slice(0, 500);
    toast('Description written ✨', 'success');
  } catch (err) {
    toast(err.message || 'AI unavailable — write manually', 'error');
  } finally {
    b.disabled = false;
    b.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> AI write';
  }
});

$('sellForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser || !sellerProfile) { toast('Complete seller account first', 'error'); return }
  const title = $('sellTitle').value.trim();
  const price = $('sellPrice').value.trim();
  const category = $('sellCategory').value;
  const condition = $('sellCondition').value;
  const negotiable = $('sellNegotiable').value === 'yes';
  const sellerPhone = $('sellPhone').value.trim();
  const location = $('sellLocation').value.trim();
  const description = $('sellDescription').value.trim();
  if (!title || !price || !category || !location) { toast('Fill required fields', 'error'); return }
  if (price === '₦') { toast('Enter a price', 'error'); return }
  if (!sellerPhone) { toast('Enter WhatsApp number', 'error'); return }
  const b = $('sellSubmit'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
  const wasEditing = !!editingId;
  try {
    if (wasEditing) {
      const item = allItems.find(i => i.id === editingId);
      const op = parsePrice(item.price), np = parsePrice(price);
      const data = { title, price, category, condition, negotiable, location, description, sellerPhone, updatedAt: serverTimestamp() };
      if (np < op) data.originalPrice = item.originalPrice || item.price;
      if (pendingImages.length) {
        const urls = [...existingImages];
        for (const img of pendingImages) {
          const u = await uploadFile(img.file);
          urls.push(u);
        }
        data.images = urls;
      } else data.images = existingImages;
      await updateDoc(doc(db, 'listings', editingId), data);
      toast('Listing updated', 'success');
    } else {
      const urls = pendingImages.length ? await uploadAllPending() : [];
      await addDoc(collection(db, 'listings'), {
        title, price, category, condition, negotiable, location, description,
        seller: sellerProfile.name, sellerPhone, sellerEmail: currentUser.email,
        sellerUid: currentUser.uid, createdAt: serverTimestamp(), views: 0, sold: false, images: urls
      });
      toast('Listing posted 🎉', 'success');
    }
    editingId = null; pendingImages = []; existingImages = [];
    $('sellForm').reset(); closeModal($('sellModal'));
    await fetchListings();
  } catch (err) { console.error(err); toast(friendlyError(err), 'error') }
  finally { b.disabled = false; b.innerHTML = `<i class="fa-solid fa-upload"></i> <span>${wasEditing ? 'Update Listing' : 'Post Listing'}</span>` }
});

// ==========================================
// 12. DETAIL MODAL & ACTIONS
// ==========================================
function openDetail(id) {
  const item = allItems.find(i => i.id === id); if (!item) return;
  openDetailId = id;
  addRecentlyViewed(id);
  incrementViews(id);
  currentHeroIndex = 0;
  const hero = $('detailHero');
  if (item.images && item.images.length) {
    hero.innerHTML = item.images.map((u, i) => `<div class="slide ${i === 0 ? 'active' : ''}"><img src="${escapeHtml(u)}" alt=""></div>`).join('')
      + (item.images.length > 1 ? `<button type="button" class="hero-nav prev" id="heroPrev"><i class="fa-solid fa-chevron-left"></i></button><button type="button" class="hero-nav next" id="heroNext"><i class="fa-solid fa-chevron-right"></i></button><div class="hero-dots">${item.images.map((_, i) => `<span class="${i === 0 ? 'active' : ''}" data-dot="${i}"></span>`).join('')}</div>` : '');
    if (item.images.length > 1) {
      $('heroPrev').onclick = () => { currentHeroIndex = (currentHeroIndex - 1 + item.images.length) % item.images.length; updateHero() };
      $('heroNext').onclick = () => { currentHeroIndex = (currentHeroIndex + 1) % item.images.length; updateHero() };
      hero.querySelectorAll('[data-dot]').forEach(d => d.onclick = () => { currentHeroIndex = parseInt(d.dataset.dot, 10); updateHero() });
    }
  } else hero.innerHTML = `<div class="slide active"><i class="fa-solid ${item.icon}"></i></div>`;
  $('detailTitle').textContent = item.title;
  let ph = escapeHtml(item.price);
  if (isPriceDrop(item)) ph += `<span class="was">${escapeHtml(item.originalPrice)}</span>`;
  $('detailPrice').innerHTML = ph;
  let meta = '';
  meta += `<span class="detail-chip"><i class="fa-solid fa-tag"></i> ${escapeHtml(item.category)}</span>`;
  meta += `<span class="detail-chip"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.location)}</span>`;
  if (item.condition) meta += `<span class="detail-chip"><i class="fa-solid fa-star-half-stroke"></i> ${escapeHtml(item.condition)}</span>`;
  if (item.negotiable) meta += `<span class="detail-chip negotiable"><i class="fa-solid fa-comments"></i> Negotiable</span>`;
  if (item.sold) meta += `<span class="detail-chip sold-chip"><i class="fa-solid fa-circle-check"></i> SOLD</span>`;
  $('detailMeta').innerHTML = meta;
  $('detailDescription').textContent = item.description || 'No description provided.';
  $('detailSellerAvatar').textContent = (item.seller || 'S').charAt(0).toUpperCase();
  const isS = item.sellerUid && item.sellerUid.length > 0, ver = isVerifiedSeller(item.sellerUid);
  const { avg, count } = getSellerRating(item.sellerUid);
  let bh = ''; if (ver) bh = ' <span class="verified-badge"><i class="fa-solid fa-circle-check"></i> Verified</span>'; else if (isS) bh = ' <span class="seller-badge">Seller</span>';
  $('detailSellerName').innerHTML = escapeHtml(item.seller) + bh;
  $('detailSellerSub').innerHTML = isS ? `Registered seller${count > 0 ? ` · <span style="color:var(--star)"><i class="fa-solid fa-star"></i> ${avg.toFixed(1)} (${count})</span>` : ''}` : 'SwapNG user';
  const phone = (item.sellerPhone || '').replace(/[^\d]/g, '');
  const msg = encodeURIComponent(`Hello, I'm interested in your SwapNG listing: ${item.title}.`);
  $('contactSellerBtn').onclick = () => { if (phone) window.open(`https://wa.me/${phone}?text=${msg}`, '_blank'); else toast('No phone on file', 'info') };
  $('chatSellerBtn').onclick = () => { if (!currentUser) { openModal($('loginModal')); return } if (item.sellerUid === currentUser.uid) { toast("Can't chat yourself", 'info'); return } openChatWith(item) };
  $('shareBtn').onclick = () => shareListing(item);
  $('swapOfferBtn').onclick = () => openSwapModal(item);
  $('reportBtn').onclick = () => { if (!currentUser) { openModal($('loginModal')); return } openModal($('reportModal')) };
  const fb = $('favToggleBtn');
  const upd = () => { const f = favoritedIds.has(id); fb.querySelector('span').textContent = f ? 'Saved' : 'Save'; fb.querySelector('i').className = f ? 'fa-solid fa-heart' : 'fa-regular fa-heart'; fb.style.color = f ? 'var(--danger)' : '' };
  fb.onclick = async () => { await toggleFavorite(id); upd() }; upd();
  const isOwner = currentUser && item.sellerUid === currentUser.uid;
  $('ownerActions').style.display = isOwner ? 'grid' : 'none';
  if (isOwner) { $('markSoldBtn').querySelector('span').textContent = item.sold ? 'Mark available' : 'Mark sold'; $('markSoldBtn').onclick = () => toggleSold(id, item.sold) }
  $('detailSellerBox').onclick = () => { if (item.sellerUid) openSellerProfile(item.sellerUid) };
  renderVerifyBanner(isOwner, item.sellerUid);
  openModal($('detailModal'));
  renderReviewsForSeller(item.sellerUid, item.seller);
}
function updateHero() { document.querySelectorAll('.detail-hero .slide').forEach((s, i) => s.classList.toggle('active', i === currentHeroIndex)); document.querySelectorAll('.hero-dots span').forEach((d, i) => d.classList.toggle('active', i === currentHeroIndex)) }
async function incrementViews(id) {
  const item = allItems.find(i => i.id === id);
  if (currentUser && item && item.sellerUid === currentUser.uid) return;
  try { await updateDoc(doc(db, 'listings', id), { views: increment(1) }) } catch { }
}
async function toggleSold(id, cur) { try { await updateDoc(doc(db, 'listings', id), { sold: !cur }); toast(!cur ? 'Marked sold' : 'Marked available', 'success'); closeModal($('detailModal')); await fetchListings() } catch (e) { toast(friendlyError(e), 'error') } }

async function shareListing(item) {
  const url = `${location.origin}${location.pathname}?item=${item.id}`;
  const text = `Check out "${item.title}" (${item.price}) on SwapNG`;
  if (navigator.share) { try { await navigator.share({ title: item.title, text, url }); return } catch { } }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Link copied', 'success') } catch { toast('Share not supported', 'error') }
}

$('editFromDetailBtn').addEventListener('click', () => {
  const item = allItems.find(i => i.id === openDetailId); if (!item) return;
  closeModal($('detailModal'));
  setTimeout(() => {
    editingId = item.id; setSellModalForEdit();
    existingImages = [...(item.images || [])]; pendingImages = []; renderUploader();
    $('sellTitle').value = item.title; $('sellPrice').value = item.price; $('sellCategory').value = item.category;
    $('sellCondition').value = item.condition || 'used'; $('sellNegotiable').value = item.negotiable ? 'yes' : 'no';
    $('sellLocation').value = item.location; $('sellDescription').value = item.description || '';
    $('sellPhone').value = item.sellerPhone || (sellerProfile && sellerProfile.phone) || '';
    openModal($('sellModal'));
  }, 220);
});

$('deleteFromDetailBtn').addEventListener('click', async () => {
  const item = allItems.find(i => i.id === openDetailId); if (!item) return;
  if (!confirm(`Delete "${item.title}"?`)) return;
  try {
    await deleteDoc(doc(db, 'listings', item.id));
    toast('Deleted', 'success');
    closeModal($('detailModal'));
    await fetchListings();
  } catch (e) { toast(friendlyError(e), 'error') }
});

// ==========================================
// 13. VERIFICATION, REVIEWS, MY LISTINGS
// ==========================================
function renderVerifyBanner(isOwner, sellerUid) {
  const w = $('verifyBannerWrap'); w.innerHTML = '';
  if (!isOwner || !sellerProfile) return;
  const st = getVerificationStatus(sellerProfile);
  if (st === 'verified') w.innerHTML = `<div class="verify-banner verified"><i class="fa-solid fa-circle-check big"></i><div class="verify-banner-text"><div class="verify-banner-title">Verified Seller ✓</div><div class="verify-banner-sub">Listings show the blue badge.</div></div></div>`;
  else if (st === 'pending') w.innerHTML = `<div class="verify-banner pending"><i class="fa-solid fa-hourglass-half big"></i><div class="verify-banner-text"><div class="verify-banner-title">Verification Pending</div><div class="verify-banner-sub">Can take up to 24 hours.</div></div></div>`;
  else if (st === 'rejected') { const r = cooldownRemainingMs(sellerProfile); const ok = r === 0; w.innerHTML = `<div class="verify-banner rejected"><i class="fa-solid fa-circle-xmark big"></i><div class="verify-banner-text"><div class="verify-banner-title">Not Approved</div><div class="verify-banner-sub">${ok ? 'You may request again.' : `Retry in ${formatCooldown(r)}.`}</div></div>${ok ? '<button type="button" class="btn btn-primary btn-sm" id="requestVerifyBtn">Retry</button>' : ''}</div>`; $('requestVerifyBtn')?.addEventListener('click', openVerifyRequestModal) }
  else { w.innerHTML = `<div class="verify-banner"><i class="fa-solid fa-circle-check big"></i><div class="verify-banner-text"><div class="verify-banner-title">Get verified</div><div class="verify-banner-sub">Earn more trust.</div></div><button type="button" class="btn btn-primary btn-sm" id="requestVerifyBtn"><i class="fa-solid fa-paper-plane"></i> Request</button></div>`; $('requestVerifyBtn').addEventListener('click', openVerifyRequestModal) }
}

function openVerifyRequestModal() {
  if (!currentUser || !sellerProfile) { toast('Log in first', 'error'); return }
  const st = getVerificationStatus(sellerProfile);
  if (st === 'pending') { toast('Already pending', 'info'); return }
  if (st === 'verified') { toast('Already verified', 'info'); return }
  if (st === 'rejected') { const r = cooldownRemainingMs(sellerProfile); if (r > 0) { toast(`Retry in ${formatCooldown(r)}`, 'info'); return } }
  $('verifyName').value = sellerProfile.name || '';
  $('verifyPhone').value = sellerProfile.phone || '';
  $('verifyLocation').value = sellerProfile.location || '';
  $('verifyNotes').value = '';
  openModal($('verifyRequestModal'));
}

$('verifyRequestForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser || !sellerProfile) return;
  const n = $('verifyName').value.trim(), ph = $('verifyPhone').value.trim(), loc = $('verifyLocation').value.trim(), notes = $('verifyNotes').value.trim();
  if (!n || !ph || !loc) { toast('Fill required', 'error'); return }
  const b = $('verifyRequestSubmit'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await addDoc(collection(db, 'verificationRequests'), { sellerUid: currentUser.uid, sellerName: n, sellerEmail: currentUser.email || '', sellerPhone: ph, sellerLocation: loc, notes, status: 'pending', requestedAt: serverTimestamp() });
    await updateDoc(doc(db, 'sellers', currentUser.uid), { verificationStatus: 'pending', verificationRequestedAt: serverTimestamp(), lastVerificationRequestAt: serverTimestamp() });
    sellerProfile.verificationStatus = 'pending'; sellerProfiles[currentUser.uid] = { ...sellerProfile };
    closeModal($('verifyRequestModal')); toast('Request submitted. Up to 24h.', 'success', 5000);
    if ($('detailModal').classList.contains('open')) renderVerifyBanner(true, currentUser.uid);
    renderItems();
  } catch (err) { toast(friendlyError(err), 'error') }
  finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Request' }
});

function renderStars(r) { let h = '<span class="stars-display">'; for (let i = 1; i <= 5; i++)h += i <= Math.round(r) ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-solid fa-star empty"></i>'; return h + '</span>' }

function renderReviewsForSeller(sellerUid, sellerName) {
  const sum = $('reviewsSummaryWrap'), form = $('reviewFormWrap'), list = $('reviewList');
  if (!sellerUid) { sum.innerHTML = ''; form.innerHTML = ''; list.innerHTML = '<div class="empty-state" style="padding:20px 0"><i class="fa-solid fa-star-half-stroke"></i><p class="sub">No reviews.</p></div>'; return }
  const rv = reviewCache[sellerUid] || [];
  const avg = rv.length ? rv.reduce((s, r) => s + r.rating, 0) / rv.length : 0;
  if (rv.length > 0) sum.innerHTML = `<div class="reviews-summary"><div class="reviews-avg-wrap"><div class="reviews-avg">${avg.toFixed(1)}</div>${renderStars(avg)}<div class="reviews-count">${rv.length} review${rv.length === 1 ? '' : 's'}</div></div><div style="flex:1;font-size:.82rem;color:var(--text-muted)">Based on buyer ratings.</div></div>`;
  else sum.innerHTML = `<div class="reviews-summary" style="justify-content:center;text-align:center"><div style="font-size:.85rem;color:var(--text-muted)"><i class="fa-regular fa-star" style="color:var(--star);font-size:1.2rem;margin-bottom:6px;display:block"></i>No reviews yet.</div></div>`;
  if (!currentUser) form.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);text-align:center;padding:8px">Log in to review.</div>';
  else if (sellerUid === currentUser.uid) form.innerHTML = '<div style="font-size:.82rem;color:var(--text-muted);text-align:center;padding:8px">You can\'t review yourself.</div>';
  else {
    const my = rv.find(r => r.reviewerUid === currentUser.uid);
    if (my) {
      form.innerHTML = `<div class="review-form"><div class="review-form-title"><i class="fa-solid fa-pen"></i> Your review</div><div class="star-picker" id="starPicker" data-value="${my.rating}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" class="${n <= my.rating ? 'active' : ''}"><i class="fa-solid fa-star"></i></button>`).join('')}</div><textarea id="reviewText" maxlength="1000">${escapeHtml(my.comment || '')}</textarea><div class="review-form-actions"><button type="button" class="btn btn-outline" id="deleteMyReview"><i class="fa-solid fa-trash"></i> Delete</button><button type="button" class="btn btn-primary" id="submitReview"><i class="fa-solid fa-check"></i> Update</button></div></div>`;
      wireReviewForm(sellerUid, sellerName, my);
    } else {
      form.innerHTML = `<div class="review-form"><div class="review-form-title">Write a review</div><div class="star-picker" id="starPicker" data-value="0">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}"><i class="fa-solid fa-star"></i></button>`).join('')}</div><textarea id="reviewText" placeholder="Share your experience..." maxlength="1000"></textarea><div class="review-form-actions"><button type="button" class="btn btn-primary" id="submitReview"><i class="fa-solid fa-paper-plane"></i> Submit</button></div></div>`;
      wireReviewForm(sellerUid, sellerName, null);
    }
  }
  if (!rv.length) list.innerHTML = '';
  else list.innerHTML = rv.map(r => { const own = currentUser && r.reviewerUid === currentUser.uid; return `<div class="review-item"><div class="review-item-head"><div class="review-author">${escapeHtml(r.reviewerName)}${own ? '<span style="font-size:.65rem;background:var(--brand-soft);color:var(--brand);padding:2px 6px;border-radius:20px">You</span>' : ''}</div><div class="review-meta">${renderStars(r.rating)}<span>${timeAgo(r.createdAt)}</span></div></div>${r.comment ? `<div class="review-text">${escapeHtml(r.comment)}</div>` : ''}</div>` }).join('');
}

function wireReviewForm(sellerUid, sellerName, existing) {
  const p = $('starPicker'), t = $('reviewText'), s = $('submitReview'), d = $('deleteMyReview');
  let r = p.dataset.value ? parseInt(p.dataset.value, 10) : 0;
  p.querySelectorAll('button[data-star]').forEach(b => b.addEventListener('click', () => { r = parseInt(b.dataset.star, 10); p.dataset.value = r; p.querySelectorAll('button').forEach(x => x.classList.toggle('active', parseInt(x.dataset.star, 10) <= r)) }));
  if (d) d.addEventListener('click', async () => { if (!confirm('Delete review?')) return; try { await deleteDoc(doc(db, 'reviews', existing.id)); toast('Deleted', 'success'); await refreshReviewCache(sellerUid); renderReviewsForSeller(sellerUid, sellerName); renderItems() } catch (e) { toast(friendlyError(e), 'error') } });
  s.addEventListener('click', async () => {
    if (!r) { toast('Select stars', 'error'); return }
    const c = t.value.trim().slice(0, 1000);
    s.disabled = true; const o = s.innerHTML; s.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      if (existing) { await updateDoc(doc(db, 'reviews', existing.id), { rating: r, comment: c, updatedAt: serverTimestamp() }); toast('Updated', 'success') }
      else { await setDoc(doc(db, 'reviews', `${sellerUid}_${currentUser.uid}`), { reviewerUid: currentUser.uid, reviewerName: getDisplayName(currentUser), sellerUid, rating: r, comment: c, createdAt: serverTimestamp() }); toast('Submitted', 'success') }
      await refreshReviewCache(sellerUid); renderReviewsForSeller(sellerUid, sellerName); renderItems();
    } catch (e) { toast(friendlyError(e), 'error') }
    finally { s.disabled = false; s.innerHTML = o }
  });
}

async function refreshReviewCache(sellerUid) {
  try {
    const q = query(collection(db, 'reviews'), where('sellerUid', '==', sellerUid));
    const snap = await getDocs(q);
    const rv = snap.docs.map(d => { const x = d.data(); return { id: d.id, reviewerUid: x.reviewerUid || '', reviewerName: x.reviewerName || 'Anonymous', sellerUid: x.sellerUid || '', rating: Number(x.rating) || 0, comment: x.comment || '', createdAt: x.createdAt } }).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    reviewCache[sellerUid] = rv;
    const s = rv.reduce((a, x) => a + x.rating, 0);
    reviewStats[sellerUid] = { avg: rv.length ? s / rv.length : 0, count: rv.length };
  } catch (e) { console.error(e) }
}

$('myListingsBtn').addEventListener('click', () => {
  if (!currentUser) return;
  const mine = allItems.filter(i => i.sellerUid === currentUser.uid);
  const list = $('myListingsList'), banner = $('mySellerBanner');
  banner.innerHTML = '';
  if (sellerProfile) {
    const st = getVerificationStatus(sellerProfile);
    if (st === 'verified') banner.innerHTML = `<div class="verify-banner verified"><i class="fa-solid fa-circle-check big"></i><div class="verify-banner-text"><div class="verify-banner-title">Verified Seller ✓</div></div></div>`;
    else if (st === 'pending') banner.innerHTML = `<div class="verify-banner pending"><i class="fa-solid fa-hourglass-half big"></i><div class="verify-banner-text"><div class="verify-banner-title">Verification Pending</div><div class="verify-banner-sub">Up to 24 hours.</div></div></div>`;
    else if (st === 'rejected') { const r = cooldownRemainingMs(sellerProfile); const ok = r === 0; banner.innerHTML = `<div class="verify-banner rejected"><i class="fa-solid fa-circle-xmark big"></i><div class="verify-banner-text"><div class="verify-banner-title">Not Approved</div><div class="verify-banner-sub">${ok ? 'You may retry.' : `Retry in ${formatCooldown(r)}.`}</div></div>${ok ? '<button type="button" class="btn btn-primary btn-sm" id="bannerVerifyBtn">Retry</button>' : ''}</div>`; $('bannerVerifyBtn')?.addEventListener('click', () => { closeModal($('myListingsModal')); setTimeout(openVerifyRequestModal, 250) }) }
    else { banner.innerHTML = `<div class="verify-banner"><i class="fa-solid fa-circle-check big"></i><div class="verify-banner-text"><div class="verify-banner-title">Become a Verified Seller</div></div><button type="button" class="btn btn-primary btn-sm" id="bannerVerifyBtn">Get Verified</button></div>`; $('bannerVerifyBtn').addEventListener('click', () => { closeModal($('myListingsModal')); setTimeout(openVerifyRequestModal, 250) }) }
  }
  if (mine.length === 0) {
    list.innerHTML = `<div class="empty-state" style="padding:30px 10px"><i class="fa-solid fa-box-open"></i><p>No listings yet.</p><button type="button" class="btn btn-primary" id="emptySellBtn2"><i class="fa-solid fa-plus"></i> Post your first</button></div>`;
    $('emptySellBtn2').addEventListener('click', () => { closeModal($('myListingsModal')); setTimeout(() => $('sellBtn').click(), 220) });
  } else {
    list.innerHTML = '';
    mine.forEach(item => {
      const el = document.createElement('div');
      el.className = 'my-listing-item';
      const th = item.images && item.images.length ? `<img src="${escapeHtml(item.images[0])}" alt="">` : `<i class="fa-solid ${item.icon}"></i>`;
      el.innerHTML = `<div class="my-listing-thumb">${th}</div><div class="my-listing-info"><div class="my-listing-title">${escapeHtml(item.title)}</div><div class="my-listing-meta">${escapeHtml(item.price)} · ${escapeHtml(item.location)}</div></div><div class="my-listing-actions"><button type="button" class="icon-btn"><i class="fa-solid fa-pen"></i></button><button type="button" class="icon-btn"><i class="fa-solid fa-trash" style="color:var(--danger)"></i></button></div>`;
      const [eb, db2] = el.querySelectorAll('button');
      eb.addEventListener('click', ev => {
        ev.stopPropagation(); closeModal($('myListingsModal'));
        setTimeout(() => {
          editingId = item.id; setSellModalForEdit();
          existingImages = [...(item.images || [])]; pendingImages = []; renderUploader();
          $('sellTitle').value = item.title; $('sellPrice').value = item.price; $('sellCategory').value = item.category;
          $('sellCondition').value = item.condition || 'used'; $('sellNegotiable').value = item.negotiable ? 'yes' : 'no';
          $('sellLocation').value = item.location; $('sellDescription').value = item.description || '';
          $('sellPhone').value = item.sellerPhone || (sellerProfile && sellerProfile.phone) || '';
          openModal($('sellModal'));
        }, 220);
      });
      db2.addEventListener('click', async ev => {
        ev.stopPropagation();
        if (!confirm(`Delete "${item.title}"?`)) return;
        try { await deleteDoc(doc(db, 'listings', item.id)); toast('Deleted', 'success'); await fetchListings(); closeModal($('myListingsModal')); setTimeout(() => $('myListingsBtn').click(), 250) } catch (e) { toast(friendlyError(e), 'error') }
      });
      list.appendChild(el);
    });
  }
  openModal($('myListingsModal'));
});

// ==========================================
// 14. REPORTS, FAVORITES, SELLER PROFILE
// ==========================================
$('reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!openDetailId) return;
  const r = $('reportReason').value, n = $('reportNotes').value.trim();
  if (!r) { toast('Select reason', 'error'); return }
  const b = $('reportSubmit'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try { await addDoc(collection(db, 'reports'), { listingId: openDetailId, reason: r, notes: n, reporterUid: currentUser ? currentUser.uid : 'anonymous', createdAt: serverTimestamp() }); closeModal($('reportModal')); e.target.reset(); toast('Report submitted', 'success') }
  catch (err) { toast(friendlyError(err), 'error') }
  finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-flag"></i> Submit Report' }
});

$('favBtn').addEventListener('click', () => {
  if (!currentUser) { openModal($('loginModal')); return }
  const favs = allItems.filter(i => favoritedIds.has(i.id));
  const list = $('favList');
  if (favs.length === 0) list.innerHTML = '<div class="empty-state"><i class="fa-regular fa-heart"></i><p>No saved items yet.</p><p class="sub">Tap the heart on any listing.</p></div>';
  else {
    list.innerHTML = '';
    favs.forEach(item => {
      const el = document.createElement('div');
      el.className = 'my-listing-item';
      const th = item.images && item.images.length ? `<img src="${escapeHtml(item.images[0])}" alt="">` : `<i class="fa-solid ${item.icon}"></i>`;
      el.innerHTML = `<div class="my-listing-thumb">${th}</div><div class="my-listing-info"><div class="my-listing-title">${escapeHtml(item.title)}</div><div class="my-listing-meta">${escapeHtml(item.price)} · ${escapeHtml(item.location)}</div></div><div class="my-listing-actions"><button type="button" class="icon-btn"><i class="fa-solid fa-eye"></i></button><button type="button" class="icon-btn"><i class="fa-solid fa-heart" style="color:var(--danger)"></i></button></div>`;
      const [ob, rb] = el.querySelectorAll('button');
      ob.addEventListener('click', () => { closeModal($('favModal')); setTimeout(() => openDetail(item.id), 200) });
      rb.addEventListener('click', async () => { await toggleFavorite(item.id); el.remove(); if (!document.querySelectorAll('#favList .my-listing-item').length) list.innerHTML = '<div class="empty-state"><i class="fa-regular fa-heart"></i><p>No saved items.</p></div>' });
      list.appendChild(el);
    });
  }
  openModal($('favModal'));
});

async function openSellerProfile(uid) {
  const s = sellerProfiles[uid] || {};
  const { avg, count } = getSellerRating(uid);
  const mine = allItems.filter(i => i.sellerUid === uid && !i.sold);
  const st = getVerificationStatus(s);
  const ini = (s.name || 'S').charAt(0).toUpperCase();
  let bh = ''; if (st === 'verified') bh = '<span class="verified-badge"><i class="fa-solid fa-circle-check"></i> Verified</span>';
  $('sellerProfileContent').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.8rem;margin:0 auto 10px">${escapeHtml(ini)}</div>
      <h2 style="font-size:1.3rem;margin-bottom:4px;color:var(--text-strong)">${escapeHtml(s.name || 'Seller')} ${bh}</h2>
      <div style="font-size:.82rem;color:var(--text-muted)">${s.location ? `<i class="fa-solid fa-location-dot"></i> ${escapeHtml(s.location)} · ` : ''}${count > 0 ? `<span style="color:var(--star)"><i class="fa-solid fa-star"></i> ${avg.toFixed(1)} (${count})</span>` : 'No reviews yet'}</div>
    </div>
    <h3 style="font-size:1rem;margin-bottom:10px">Listings (${mine.length})</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
      ${mine.length ? mine.map(i => `<div class="h-card" data-seller-item="${i.id}"><div class="h-card-img">${i.images && i.images.length ? `<img src="${escapeHtml(i.images[0])}">` : `<i class="fa-solid ${i.icon}"></i>`}</div><div class="h-card-body"><div class="h-card-title">${escapeHtml(i.title)}</div><div class="h-card-price">${escapeHtml(i.price)}</div></div></div>`).join('') : '<p style="color:var(--text-muted);font-size:.85rem">No active listings.</p>'}
    </div>`;
  openModal($('sellerProfileModal'));
  $('sellerProfileContent').querySelectorAll('[data-seller-item]').forEach(el => el.addEventListener('click', () => { closeModal($('sellerProfileModal')); setTimeout(() => openDetail(el.dataset.sellerItem), 200) }));
}

// ==========================================
// 15. CHAT SYSTEM
// ==========================================
function chatIdFor(a, b, l) { const arr = [a, b].sort(); return `${arr[0]}_${arr[1]}_${l}` }
async function openChatWith(item) {
  if (!currentUser) { openModal($('loginModal')); return }
  if (item.sellerUid === currentUser.uid) { toast("Can't chat yourself", 'info'); return }
  const cid = chatIdFor(currentUser.uid, item.sellerUid, item.id);
  const ref = doc(db, 'chats', cid);
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, { participants: [currentUser.uid, item.sellerUid], listingId: item.id, listingTitle: item.title, lastMessage: '', lastAt: serverTimestamp(), createdAt: serverTimestamp() });
  currentChatId = cid;
  $('chatAv').textContent = (item.seller || 'S').charAt(0).toUpperCase();
  $('chatName').textContent = item.seller || 'Seller';
  $('chatSub').textContent = item.title;
  closeModal($('detailModal'));
  setTimeout(() => { openModal($('chatModal')); attachChatListener(cid) }, 220);
}
function attachChatListener(cid) {
  if (chatUnsub) chatUnsub();
  markChatRead(cid);
  const msgs = $('chatMessages'); msgs.innerHTML = '';
  const q = query(collection(db, 'chats', cid, 'messages'), orderBy('createdAt', 'asc'));
  chatUnsub = onSnapshot(q, snap => {
    msgs.innerHTML = '';
    snap.docs.forEach(d => {
      const m = d.data();
      const isMe = m.senderUid === currentUser.uid;
      const el = document.createElement('div');
      el.className = `chat-msg ${isMe ? 'me' : 'them'}`;
      el.innerHTML = `${escapeHtml(m.text)}<span class="time">${timeAgo(m.createdAt)}</span>`;
      msgs.appendChild(el);
    });
    msgs.scrollTop = msgs.scrollHeight;
  });
}
function markChatRead(chatId) {
  lastReadMap[chatId] = Date.now();
  try { localStorage.setItem('swapng-chat-read', JSON.stringify(lastReadMap)); } catch { }
  updateChatBadge();
}
async function updateChatBadge() {
  if (!currentUser) return;
  try {
    const q = query(collection(db, 'chats'), where('participants', 'array-contains', currentUser.uid));
    const snap = await getDocs(q);
    let unread = 0;
    snap.docs.forEach(d => {
      const c = d.data();
      const last = c.lastAt?.toMillis?.() || 0;
      const read = lastReadMap[d.id] || 0;
      if (last > read) unread++;
    });
    const btn = $('chatBtn');
    if (!btn) return;
    let badge = btn.querySelector('.badge');
    if (unread > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; btn.appendChild(badge); }
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = 'flex';
    } else if (badge) {
      badge.style.display = 'none';
    }
  } catch { }
}
$('chatSend').addEventListener('click', sendChatMsg);
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendChatMsg() } });
async function sendChatMsg() {
  const t = $('chatInput').value.trim();
  if (!t || !currentChatId) return;
  $('chatInput').value = '';
  try {
    await addDoc(collection(db, 'chats', currentChatId, 'messages'), { text: t, senderUid: currentUser.uid, createdAt: serverTimestamp() });
    await updateDoc(doc(db, 'chats', currentChatId), { lastMessage: t.slice(0, 80), lastAt: serverTimestamp() });
  } catch (e) { toast(friendlyError(e), 'error') }
}
$('chatBtn').addEventListener('click', async () => {
  if (!currentUser) return;
  const listEl = $('chatListEl');
  listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try {
    const q = query(collection(db, 'chats'), where('participants', 'array-contains', currentUser.uid));
    const snap = await getDocs(q);
    if (snap.empty) listEl.innerHTML = '<div class="empty-state"><i class="fa-regular fa-comment"></i><p>No messages yet.</p></div>';
    else {
      const chats = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.lastAt?.toMillis?.() || 0) - (a.lastAt?.toMillis?.() || 0));
      listEl.innerHTML = chats.map(c => {
        const otherUid = c.participants.find(p => p !== currentUser.uid);
        const o = sellerProfiles[otherUid] || {};
        const nm = o.name || 'User';
        return `<div class="chat-list-item" data-chat="${c.id}" data-title="${escapeHtml(c.listingTitle || '')}"><div class="av">${escapeHtml(nm.charAt(0).toUpperCase())}</div><div class="info"><div class="name">${escapeHtml(nm)}</div><div class="last">${escapeHtml(c.lastMessage || 'No messages')}</div></div><div class="time">${c.lastAt ? timeAgo(c.lastAt) : ''}</div></div>`;
      }).join('');
      listEl.querySelectorAll('[data-chat]').forEach(el => el.addEventListener('click', () => {
        currentChatId = el.dataset.chat;
        const nm = el.querySelector('.name').textContent;
        $('chatAv').textContent = (nm || 'U').charAt(0).toUpperCase();
        $('chatName').textContent = nm;
        $('chatSub').textContent = el.dataset.title || 'Chat';
        closeModal($('chatListModal'));
        setTimeout(() => { openModal($('chatModal')); attachChatListener(currentChatId) }, 220);
      }));
    }
  } catch (e) { listEl.innerHTML = `<div class="empty-state"><p>${escapeHtml(friendlyError(e))}</p></div>` }
  openModal($('chatListModal'));
});

// ==========================================
// 16. SWAP OFFERS, TRENDING, MAP, PWA
// ==========================================
function openSwapModal(item) {
  if (!currentUser) { openModal($('loginModal')); return }
  if (item.sellerUid === currentUser.uid) { toast("Can't swap yourself", 'info'); return }
  const mine = allItems.filter(i => i.sellerUid === currentUser.uid && !i.sold);
  if (mine.length === 0) { toast('Post a listing first', 'info'); return }
  $('swapMyItem').innerHTML = '<option value="">Select your item...</option>' + mine.map(i => `<option value="${i.id}">${escapeHtml(i.title)} (${escapeHtml(i.price)})</option>`).join('');
  $('swapCash').value = ''; $('swapMsg').value = '';
  openModal($('swapModal'));
}
$('swapForm').addEventListener('submit', async e => {
  e.preventDefault();
  const target = allItems.find(i => i.id === openDetailId); if (!target) return;
  const myItemId = $('swapMyItem').value, cash = $('swapCash').value, msg = $('swapMsg').value.trim();
  if (!myItemId) { toast('Choose your item', 'error'); return }
  const myItem = allItems.find(i => i.id === myItemId);
  const b = $('swapSubmit'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await addDoc(collection(db, 'tradeOffers'), {
      fromUid: currentUser.uid, fromName: getDisplayName(currentUser),
      toUid: target.sellerUid, toName: target.seller,
      targetListingId: target.id, targetTitle: target.title,
      offeredListingId: myItemId, offeredTitle: myItem.title,
      cash: parseFloat(cash) || 0, message: msg, status: 'pending', createdAt: serverTimestamp()
    });
    closeModal($('swapModal'));
    toast('Swap offer sent! 🎉', 'success');
  } catch (err) { toast(friendlyError(err), 'error') }
  finally { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Swap Offer' }
});

function buildTrending() {
  const t = [...allItems].filter(i => !i.sold).map(i => ({ ...i, score: (i.views || 0) + (getSellerRating(i.sellerUid).avg * 10) + (favoritedIds.has(i.id) ? 5 : 0) })).sort((a, b) => b.score - a.score).slice(0, 8);
  if (t.length < 3) { $('trendingWrap').innerHTML = ''; return }
  $('trendingWrap').innerHTML = `<div class="section-row"><div class="section-row-header"><div class="section-row-title"><i class="fa-solid fa-fire"></i> Trending now</div></div><div class="h-scroll">${t.map(i => `<div class="h-card" data-id="${i.id}"><div class="h-card-img">${i.images && i.images.length ? `<img src="${escapeHtml(i.images[0])}" loading="lazy">` : `<i class="fa-solid ${i.icon}"></i>`}</div><div class="h-card-body"><div class="h-card-title">${escapeHtml(i.title)}</div><div class="h-card-price">${escapeHtml(i.price)}</div></div></div>`).join('')}</div></div>`;
  $('trendingWrap').querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.id)));
}

function loadRecentlyViewed() { try { recentlyViewed = JSON.parse(localStorage.getItem('swapng-recent') || '[]') } catch { recentlyViewed = [] } }
function saveRecentlyViewed() { try { localStorage.setItem('swapng-recent', JSON.stringify(recentlyViewed.slice(0, 20))) } catch { } }
function addRecentlyViewed(id) { recentlyViewed = recentlyViewed.filter(x => x !== id); recentlyViewed.unshift(id); saveRecentlyViewed(); renderRecentlyViewed() }
function renderRecentlyViewed() {
  const items = recentlyViewed.map(id => allItems.find(i => i.id === id)).filter(Boolean).slice(0, 8);
  if (items.length < 3) { $('recentlyViewedWrap').innerHTML = ''; return }
  $('recentlyViewedWrap').innerHTML = `<div class="section-row"><div class="section-row-header"><div class="section-row-title"><i class="fa-solid fa-clock-rotate-left"></i> Recently viewed</div></div><div class="h-scroll">${items.map(i => `<div class="h-card" data-id="${i.id}"><div class="h-card-img">${i.images && i.images.length ? `<img src="${escapeHtml(i.images[0])}" loading="lazy">` : `<i class="fa-solid ${i.icon}"></i>`}</div><div class="h-card-body"><div class="h-card-title">${escapeHtml(i.title)}</div><div class="h-card-price">${escapeHtml(i.price)}</div></div></div>`).join('')}</div></div>`;
  $('recentlyViewedWrap').querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.id)));
}

let mapInstance = null;
$('mapBtn').addEventListener('click', () => {
  openModal($('mapModal'));
  setTimeout(() => {
    if (!mapInstance) { mapInstance = L.map('mapView').setView([9.082, 8.6753], 6); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance) }
    mapInstance.invalidateSize();
    mapInstance.eachLayer(l => { if (l instanceof L.Marker) mapInstance.removeLayer(l) });
    const cc = { lagos: [6.5244, 3.3792], abuja: [9.0765, 7.3986], kano: [12.0022, 8.5920], ibadan: [7.3775, 3.9470], port: [4.8156, 7.0498], benin: [6.3350, 5.6037], kaduna: [10.5264, 7.4388], enugu: [6.4584, 7.5464] };
    allItems.forEach(item => {
      if (!item.location) return;
      const city = item.location.toLowerCase().split(' ')[0];
      const c = cc[city]; if (!c) return;
      const jitter = [c[0] + (Math.random() - .5) * .1, c[1] + (Math.random() - .5) * .1];
      L.marker(jitter).addTo(mapInstance).bindPopup(`<b>${escapeHtml(item.title)}</b><br>${escapeHtml(item.price)}<br><small>${escapeHtml(item.location)}</small>`);
    });
  }, 300);
});

let startY = 0, startX = 0, pulling = false, swipeLocked = false;
document.addEventListener('touchstart', e => { if (window.scrollY === 0 && e.touches.length === 1) { startY = e.touches[0].clientY; startX = e.touches[0].clientX; swipeLocked = false; } }, { passive: true });
document.addEventListener('touchmove', e => {
  if (startY === 0 || window.scrollY > 0 || swipeLocked) return;
  const dy = e.touches[0].clientY - startY, dx = Math.abs(e.touches[0].clientX - startX);
  if (dx > Math.abs(dy)) { swipeLocked = true; return }
  if (dy > 70 && !pulling) { pulling = true; $('ptr').classList.add('show') }
}, { passive: true });
document.addEventListener('touchend', async () => {
  if (pulling) {
    $('ptr').classList.add('spinning');
    try { await fetchListings() } catch { }
    setTimeout(() => { $('ptr').classList.remove('show', 'spinning'); pulling = false; startY = 0; startX = 0 }, 600);
  } else { startY = 0; startX = 0 }
});

const isAdmin = () => currentUser && ADMIN_UIDS.includes(currentUser.uid);
async function openAdmin() {
  if (!isAdmin()) return;
  openModal($('adminModal'));
  try {
    const [rs, vs, ls] = await Promise.all([getDocs(collection(db, 'reports')), getDocs(collection(db, 'verificationRequests')), getDocs(collection(db, 'listings'))]);
    $('adminStats').innerHTML = `<div class="admin-stat"><div class="num">${ls.size}</div><div class="lbl">Listings</div></div><div class="admin-stat"><div class="num">${rs.size}</div><div class="lbl">Reports</div></div><div class="admin-stat"><div class="num">${vs.size}</div><div class="lbl">Verify Req</div></div><div class="admin-stat"><div class="num">${Object.keys(sellerProfiles).length}</div><div class="lbl">Sellers</div></div>`;
    renderAdminList('reports', rs.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { toast(friendlyError(e), 'error') }
}
document.querySelectorAll('[data-admin-tab]').forEach(b => b.addEventListener('click', async () => {
  const tab = b.dataset.adminTab;
  if (tab === 'reports') { const s = await getDocs(collection(db, 'reports')); renderAdminList('reports', s.docs.map(d => ({ id: d.id, ...d.data() }))) }
  if (tab === 'verifications') { const s = await getDocs(collection(db, 'verificationRequests')); renderAdminList('verifications', s.docs.map(d => ({ id: d.id, ...d.data() }))) }
  if (tab === 'listings') { renderAdminList('listings', allItems) }
}));
function renderAdminList(type, items) {
  const el = $('adminList');
  if (!items.length) { el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Empty</div>'; return }
  el.innerHTML = items.map(i => {
    if (type === 'reports') return `<div class="admin-item"><div><b>${escapeHtml(i.reason || '')}</b><div class="meta">${escapeHtml(i.notes || '')} · ${timeAgo(i.createdAt)}</div></div><div class="acts"><button class="btn btn-sm btn-danger" data-del-report="${i.id}">Dismiss</button></div></div>`;
    if (type === 'verifications') return `<div class="admin-item"><div><b>${escapeHtml(i.sellerName || '')}</b><div class="meta">${escapeHtml(i.sellerPhone || '')} · ${escapeHtml(i.sellerLocation || '')}</div></div><div class="acts"><button class="btn btn-sm btn-primary" data-approve="${i.id}|${i.sellerUid}">Approve</button><button class="btn btn-sm btn-danger" data-reject="${i.id}|${i.sellerUid}">Reject</button></div></div>`;
    if (type === 'listings') return `<div class="admin-item"><div><b>${escapeHtml(i.title)}</b><div class="meta">${escapeHtml(i.price)} · ${escapeHtml(i.seller)}</div></div><div class="acts"><button class="btn btn-sm btn-danger" data-del-listing="${i.id}">Delete</button></div></div>`;
    return '';
  }).join('');
  el.querySelectorAll('[data-del-report]').forEach(b => b.addEventListener('click', async () => { await deleteDoc(doc(db, 'reports', b.dataset.delReport)); b.closest('.admin-item').remove() }));
  el.querySelectorAll('[data-del-listing]').forEach(b => b.addEventListener('click', async () => { if (confirm('Delete?')) { await deleteDoc(doc(db, 'listings', b.dataset.delListing)); b.closest('.admin-item').remove() } }));
  el.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => { const [id, uid] = b.dataset.approve.split('|'); await updateDoc(doc(db, 'sellers', uid), { verificationStatus: 'verified', verifiedAt: serverTimestamp() }); await updateDoc(doc(db, 'verificationRequests', id), { status: 'approved', reviewedAt: serverTimestamp() }); sellerProfiles[uid] = { ...sellerProfiles[uid], verificationStatus: 'verified' }; toast('Approved', 'success'); b.closest('.admin-item').remove(); renderItems() }));
  el.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => { const [id, uid] = b.dataset.reject.split('|'); await updateDoc(doc(db, 'sellers', uid), { verificationStatus: 'rejected', rejectedAt: serverTimestamp() }); await updateDoc(doc(db, 'verificationRequests', id), { status: 'rejected', reviewedAt: serverTimestamp() }); sellerProfiles[uid] = { ...sellerProfiles[uid], verificationStatus: 'rejected' }; toast('Rejected', 'info'); b.closest('.admin-item').remove(); renderItems() }));
}
if (location.hash === '#admin' || location.search.includes('admin=1')) setTimeout(() => { if (isAdmin()) openAdmin() }, 1500);

// ==========================================
// 17. INITIALIZATION
// ==========================================
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (user) {
    $('authButtons').style.display = 'none';
    $('userChip').style.display = 'flex';
    $('sellBtn').style.display = 'inline-flex';
    $('myListingsBtn').style.display = 'inline-flex';
    $('chatBtn').style.display = 'flex';
    $('fabNew').style.display = 'flex';
    $('userEmail').textContent = user.displayName || user.email;
    await loadSellerProfile(user.uid);
    await loadFavorites();
    updateChatBadge();
    checkVerifyStatus(user);
  } else {
    $('authButtons').style.display = 'flex';
    $('userChip').style.display = 'none';
    $('sellBtn').style.display = 'none';
    $('myListingsBtn').style.display = 'none';
    $('chatBtn').style.display = 'none';
    $('fabNew').style.display = 'none';
    sellerProfile = null; favoritedIds = new Set(); updateFavBadge();
  }
});

async function checkVerifyStatus(user) {
  try {
    const s = await getDoc(doc(db, 'sellers', user.uid));
    if (!s.exists()) return;
    const d = s.data(); const c = d.verificationStatus || 'unverified';
    let last = null; try { last = localStorage.getItem('swapng-last-verify-status') } catch { }
    if (last && last !== c) { if (c === 'verified') toast('🎉 Your account is now verified!', 'success', 6000); else if (c === 'rejected') toast('Verification not approved.', 'error', 6000) }
    try { localStorage.setItem('swapng-last-verify-status', c) } catch { }
  } catch (e) { }
}
$('fabNew').addEventListener('click', () => $('sellBtn').click());

loadRecentlyViewed();
(function () { const p = new URLSearchParams(location.search); const id = p.get('item'); if (id) setTimeout(() => { if (allItems.find(i => i.id === id)) openDetail(id) }, 1500) })();
fetchListings();

if ('serviceWorker' in navigator) {
  const sw = `self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>self.clients.claim());self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});`;
  try { const b = new Blob([sw], { type: 'application/javascript' }); navigator.serviceWorker.register(URL.createObjectURL(b)).catch(() => { }) } catch { }
}

// ==========================================
// 18. SUPPORT BOT
// ==========================================
(function () {
  'use strict';
  const SUPPORT_WHATSAPP = '2347072521841';
  const GREETING = "Hi 👋 I'm the SwapNG assistant. Ask me anything about listings, seller accounts, verification, reviews, or how to use the app.";
  const KB = [
    { id: 'listing-create', keywords: ['post', 'create listing', 'add listing', 'sell', 'sell item', 'upload item'], reply: "To post a listing:\n\n1. Tap the green Sell button.\n2. Create a seller account (first time).\n3. Fill in title, price, category, WhatsApp number, location, description.\n4. Add up to 5 photos.\n5. Tap Post Listing.", actions: [{ label: 'Open Sell form', icon: 'fa-plus', type: 'action', run: 'openSell' }] },
    { id: 'images', keywords: ['image', 'photo', 'picture', 'upload image', 'add photo'], reply: "Up to 5 photos per listing. Tap the camera icon in the Sell form. Max 5MB each.", actions: [{ label: 'Open Sell form', icon: 'fa-plus', type: 'action', run: 'openSell' }] },
    { id: 'favorite', keywords: ['favorite', 'save item', 'wishlist', 'heart', 'saved'], reply: "Tap the heart on any card to save. Find saved items via the heart in the header.", actions: [] },
    { id: 'share', keywords: ['share', 'send to friend', 'share listing'], reply: "Open any listing → Share. Mobile: native share. Desktop: copies link.", actions: [] },
    { id: 'chat', keywords: ['chat', 'message', 'dm', 'in-app chat'], reply: "Open a listing → Chat. Messages arrive instantly.", actions: [] },
    { id: 'swap', keywords: ['swap', 'trade', 'exchange', 'offer'], reply: "Open a listing → Swap. Choose your item + optional cash.", actions: [] },
    { id: 'contact-seller', keywords: ['contact seller', 'message seller', 'whatsapp seller'], reply: "Two ways:\n\n1. WhatsApp.\n2. In-app Chat.", actions: [] },
    { id: 'seller-account', keywords: ['become seller', 'seller account', 'start selling'], reply: "Sign up → tap Sell → enter name, phone, location.", actions: [{ label: 'Open Sell form', icon: 'fa-plus', type: 'action', run: 'openSell' }] },
    { id: 'signup', keywords: ['sign up', 'register', 'create account'], reply: "Tap Sign Up in the header.", actions: [{ label: 'Sign Up', icon: 'fa-user-plus', type: 'action', run: 'openSignup' }] },
    { id: 'login', keywords: ['log in', 'login', 'sign in'], reply: "Tap Login in the header.", actions: [{ label: 'Login', icon: 'fa-right-to-bracket', type: 'action', run: 'openLogin' }] },
    { id: 'verify-how', keywords: ['get verified', 'verification request', 'blue badge'], reply: "1. Post a listing.\n2. My Listings → Get Verified.\n3. Submit. Review takes up to 24h.", actions: [{ label: 'My Listings', icon: 'fa-list', type: 'action', run: 'openMyListings' }] },
    { id: 'review-leave', keywords: ['leave review', 'write review', 'rate seller'], reply: "Open any listing → scroll to Reviews → tap stars → submit.", actions: [] },
    { id: 'search', keywords: ['search', 'find item'], reply: "Type in the search bar at the top.", actions: [] },
    { id: 'filters', keywords: ['filter', 'sort'], reply: "Filters are above listings: Sort, Price, Location, Seller, Rating, Condition, Verified.", actions: [] },
    { id: 'map', keywords: ['map', 'near me'], reply: "Tap the map icon in the header.", actions: [] },
    { id: 'offline', keywords: ['offline', 'no internet'], reply: "SwapNG needs internet. An offline banner appears at the top.", actions: [] },
    { id: 'scam', keywords: ['scam', 'fraud', 'fake'], reply: "Report suspicious listings. Meet in public. Don't send money upfront.", actions: [{ label: 'WhatsApp us', icon: 'fa-brands fa-whatsapp', type: 'whatsapp' }] },
    { id: 'dark-mode', keywords: ['dark mode', 'theme'], reply: "Tap the moon/sun icon in the header.", actions: [] },
    { id: 'ai-write', keywords: ['ai write', 'auto description'], reply: "In Sell form, tap 'AI write' near Description.", actions: [] }
  ];
  const TOPIC_MAP = { listing: 'listing-create', seller: 'contact-seller', review: 'review-leave', verify: 'verify-how', account: 'signup', offline: 'offline' };
  const messagesEl = $('supportMessages'), inputEl = $('supportInput'), sendBtn = $('supportSend'), quickTopics = $('supportQuickTopics'), panel = $('supportPanel'), fab = $('supportFab'), closeBtn = $('supportClose');
  let welcomeShown = false;
  function openSupport() { panel.classList.add('open'); document.body.style.overflow = 'hidden'; if (!welcomeShown) { welcomeShown = true; setTimeout(() => addMessage(GREETING, 'bot', []), 250) } }
  function closeSupport() { panel.classList.remove('open'); if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '' }
  fab.addEventListener('click', openSupport); closeBtn.addEventListener('click', closeSupport);
  panel.addEventListener('click', e => { if (e.target === panel) closeSupport() });
  function runAction(n) {
    try {
      switch (n) {
        case 'openSell': closeSupport(); setTimeout(() => document.getElementById('sellBtn')?.click(), 220); break;
        case 'openMyListings': closeSupport(); setTimeout(() => document.getElementById('myListingsBtn')?.click(), 220); break;
        case 'openLogin': closeSupport(); setTimeout(() => document.getElementById('loginBtn')?.click(), 220); break;
        case 'openSignup': closeSupport(); setTimeout(() => document.getElementById('signupBtn')?.click(), 220); break;
        case 'scrollTop': closeSupport(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      }
    } catch (e) { }
  }
  function openWhatsApp() { const m = encodeURIComponent("Hi SwapNG, I need help."); window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${m}`, '_blank') }
  function escapeText(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
  function addMessage(text, from = 'bot', actions = []) {
    const w = document.createElement('div'); w.className = `support-msg ${from}`;
    w.innerHTML = escapeText(text).replace(/\n/g, '<br>');
    if (actions && actions.length) { const r = document.createElement('div'); r.className = 'support-actions'; actions.forEach(a => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<i class="${a.icon}"></i> ${a.label}`; b.addEventListener('click', () => { if (a.type === 'whatsapp') openWhatsApp(); else if (a.type === 'action') runAction(a.run) }); r.appendChild(b) }); w.appendChild(r) }
    messagesEl.appendChild(w); messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function showTyping() { const t = document.createElement('div'); t.className = 'support-msg bot typing'; t.id = 'supportTyping'; t.innerHTML = '<span></span><span></span><span></span>'; messagesEl.appendChild(t); messagesEl.scrollTop = messagesEl.scrollHeight }
  function hideTyping() { document.getElementById('supportTyping')?.remove() }
  function scoreKb(e, q) { let s = 0; q = q.toLowerCase(); for (const kw of e.keywords) { if (q.includes(kw)) s += kw.length * 2; const ws = kw.split(' '); for (const w of ws) { if (w.length > 3 && q.includes(w)) s += w.length } } return s }
  function findBestMatch(q) { q = q.trim(); if (!q) return null; let b = null, bs = 0; for (const e of KB) { const s = scoreKb(e, q); if (s > bs) { bs = s; b = e } } return bs >= 4 ? b : null }
  function fallback() { return { reply: "I'm not sure. For help:\n\n💬 WhatsApp us at 07072521841", actions: [{ label: 'WhatsApp us', icon: 'fa-brands fa-whatsapp', type: 'whatsapp' }] } }
  function handleUserMessage(t) { if (!t || !t.trim()) return; addMessage(t.trim(), 'user'); inputEl.value = ''; showTyping(); setTimeout(() => { hideTyping(); const m = findBestMatch(t); if (m) addMessage(m.reply, 'bot', m.actions || []); else { const f = fallback(); addMessage(f.reply, 'bot', f.actions) } }, 400 + Math.random() * 400) }
  function handleQuickTopic(t) { const e = KB.find(k => k.id === TOPIC_MAP[t]); if (!e) return; addMessage(e.reply, 'bot', e.actions || []) }
  sendBtn.addEventListener('click', () => handleUserMessage(inputEl.value));
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleUserMessage(inputEl.value) } });
  quickTopics.addEventListener('click', e => { const b = e.target.closest('button'); if (b) handleQuickTopic(b.dataset.topic) });
})();