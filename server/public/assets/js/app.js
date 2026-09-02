// app.js — frontend IPTV (lean). Sumber data = REST API backend (hanya channel aktif).
// Menggantikan channels.js / channels-advanced.js / app-advanced.js / config-playlists.js
// / playlist-manager-ui.js yang lama (fetch M3U client-side + localStorage-as-source).

const API = ''; // sama-origin (di-serve backend). Ganti bila API terpisah.

const CATEGORY_LABELS = {
  news: 'Berita', entertainment: 'Hiburan', sports: 'Olahraga', music: 'Musik',
  kids: 'Anak-anak', movies: 'Film', general: 'Umum', religious: 'Religi',
  documentary: 'Dokumenter', education: 'Edukasi', lifestyle: 'Gaya Hidup',
  business: 'Bisnis', local: 'Lokal',
};

const state = {
  channels: [],
  favorites: new Set(JSON.parse(localStorage.getItem('iptvFavorites') || '[]')),
  filter: { search: '', country: '', category: '', favoritesOnly: false },
};

let player;

const els = {
  grid: document.getElementById('channelsGrid'),
  empty: document.getElementById('gridEmpty'),
  search: document.getElementById('searchInput'),
  country: document.getElementById('countryFilter'),
  category: document.getElementById('categoryFilter'),
  favBtn: document.getElementById('favoritesBtn'),
  stats: document.getElementById('statsBadge'),
};

async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data;
}

function saveFavorites() {
  localStorage.setItem('iptvFavorites', JSON.stringify([...state.favorites]));
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();
  render();
}

function playChannel(ch) {
  if (!player) { player = new VideoPlayer(); }
  player.playChannel({ name: ch.name, url: ch.stream_url });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filtered() {
  const f = state.filter;
  return state.channels.filter(ch => {
    if (f.favoritesOnly && !state.favorites.has(ch.id)) return false;
    if (f.country && ch.country_code !== f.country) return false;
    if (f.category && ch.category !== f.category) return false;
    if (f.search && !ch.name.toLowerCase().includes(f.search.toLowerCase())) return false;
    return true;
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function card(ch) {
  const fav = state.favorites.has(ch.id);
  const cat = CATEGORY_LABELS[ch.category] || ch.category || '';
  const logo = ch.logo
    ? `<img src="${escapeHtml(ch.logo)}" alt="${escapeHtml(ch.name)}" loading="lazy" style="width:100%;height:100%;object-fit:contain;background:#000;padding:10px" onerror="this.style.display='none'">`
    : '<i class="bi bi-tv"></i>';
  return `
    <div class="col-6 col-md-4 col-lg-3 col-xl-2">
      <div class="channel-card" data-id="${ch.id}">
        <div class="channel-card-image">${logo}</div>
        <div class="channel-card-body">
          <h6 class="channel-card-title" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</h6>
          <p class="channel-card-country"><i class="bi bi-geo-alt"></i> ${escapeHtml(ch.country || ch.country_code || '')}</p>
          <div class="channel-card-footer">
            <div>
              <span class="status-indicator active"></span>
              <small class="text-muted">${escapeHtml(cat)}</small>
            </div>
            <button class="favorite-btn ${fav ? 'active' : ''}" data-fav="${ch.id}" title="Favorit">
              <i class="bi bi-heart${fav ? '-fill' : ''}"></i>
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

function render() {
  const list = filtered();
  els.empty.style.display = list.length ? 'none' : 'block';
  els.grid.innerHTML = list.map(card).join('');
  // klik card → play; klik favorit → toggle
  els.grid.querySelectorAll('.channel-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-fav]')) return;
      const ch = state.channels.find(c => c.id == el.dataset.id);
      if (ch) playChannel(ch);
    });
  });
  els.grid.querySelectorAll('[data-fav]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(Number(btn.dataset.fav)); });
  });
}

function populateFilters(countries, categories) {
  els.country.innerHTML = '<option value="">Semua Negara</option>' +
    countries.map(c => `<option value="${escapeHtml(c.country_code)}">${escapeHtml(c.country || c.country_code)} (${c.n})</option>`).join('');
  els.category.innerHTML = '<option value="">Semua Kategori</option>' +
    categories.map(c => `<option value="${escapeHtml(c.category)}">${escapeHtml(CATEGORY_LABELS[c.category] || c.category)} (${c.n})</option>`).join('');
}

async function init() {
  try {
    const [channels, countries, categories, stats] = await Promise.all([
      api('/api/channels?limit=5000'),
      api('/api/countries'),
      api('/api/categories'),
      api('/api/stats'),
    ]);
    state.channels = channels;
    populateFilters(countries, categories);
    if (els.stats) els.stats.textContent = `${stats.active} aktif`;
    render();
  } catch (err) {
    els.grid.innerHTML = `<div class="col-12 text-center text-danger py-5">Gagal memuat channel: ${escapeHtml(err.message)}</div>`;
  }
}

// Events
els.search.addEventListener('input', e => { state.filter.search = e.target.value; render(); });
els.country.addEventListener('change', e => { state.filter.country = e.target.value; render(); });
els.category.addEventListener('change', e => { state.filter.category = e.target.value; render(); });
els.favBtn.addEventListener('click', () => {
  state.filter.favoritesOnly = !state.filter.favoritesOnly;
  els.favBtn.classList.toggle('btn-outline-light', !state.filter.favoritesOnly);
  els.favBtn.classList.toggle('btn-danger', state.filter.favoritesOnly);
  render();
});

document.addEventListener('DOMContentLoaded', init);
