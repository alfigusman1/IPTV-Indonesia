// app-advanced-FINAL.js - Complete & Verified Version
// Ready for production - All issues fixed

// ============================================
// GLOBAL VARIABLES
// ============================================

let channelManager;
let videoPlayer;
let playlistManagerUI;

// DOM elements - akan di-initialize di initApp
let channelsGrid;
let searchInput;
let countryFilter;
let categoryFilter;
let favoritesBtn;

// State
let currentFilter = {
  search: '',
  country: '',
  category: '',
  favoritesOnly: false,
};

// ============================================
// HELPER FUNCTIONS - DEFINED EARLY
// ============================================

function showLoading() {
  if (channelsGrid) {
    channelsGrid.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="spinner-border text-light" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-3 text-muted">Memuat channel...</p>
            </div>
        `;
  }
}

function hideLoading() {
  // Will auto-hide when channels render
}

function showEmptyState() {
  if (channelsGrid) {
    channelsGrid.innerHTML = `
            <div class="col-12">
                <div class="empty-state">
                    <i class="bi bi-inbox"></i>
                    <h4>Tidak ada channel ditemukan</h4>
                    <p>Coba ubah filter atau import playlist baru</p>
                </div>
            </div>
        `;
  }
}

// ============================================
// MAIN INITIALIZATION
// ============================================

async function initApp() {
  try {
    console.log('🚀 Initializing IPTV App (Final Version)...');

    // Step 1: Get DOM elements
    console.log('📍 Step 1: Getting DOM elements...');
    channelsGrid = document.getElementById('channelsGrid');
    searchInput = document.getElementById('searchInput');
    countryFilter = document.getElementById('countryFilter');
    categoryFilter = document.getElementById('categoryFilter');
    favoritesBtn = document.getElementById('favoritesBtn');

    // Validate DOM elements
    if (!channelsGrid) {
      throw new Error('❌ #channelsGrid not found in DOM');
    }
    if (!searchInput) {
      throw new Error('❌ #searchInput not found in DOM');
    }
    if (!countryFilter) {
      throw new Error('❌ #countryFilter not found in DOM');
    }
    if (!categoryFilter) {
      throw new Error('❌ #categoryFilter not found in DOM');
    }
    if (!favoritesBtn) {
      throw new Error('❌ #favoritesBtn not found in DOM');
    }
    console.log('✓ All DOM elements found');

    showLoading();

    // Step 2: Initialize ChannelManager
    console.log('📦 Step 2: Initializing ChannelManager...');
    if (typeof AdvancedChannelManager === 'undefined') {
      throw new Error('AdvancedChannelManager class not loaded. Check script order.');
    }

    channelManager = new AdvancedChannelManager();
    console.log('✓ ChannelManager initialized');

    // Step 3: Initialize VideoPlayer
    console.log('📺 Step 3: Initializing VideoPlayer...');
    if (typeof VideoPlayer === 'undefined') {
      throw new Error('VideoPlayer class not loaded. Check script order.');
    }

    videoPlayer = new VideoPlayer();
    console.log('✓ VideoPlayer initialized');

    // Step 4: Load playlist management UI (optional)
    console.log('🎯 Step 4: Loading Playlist Management UI...');
    try {
      const response = await fetch('playlist-management.html');
      if (response.ok) {
        const html = await response.text();
        const container = document.getElementById('playlistManagementContainer');
        if (container) {
          container.innerHTML = html;

          if (typeof PlaylistManagerUI !== 'undefined') {
            playlistManagerUI = new PlaylistManagerUI(channelManager);
            console.log('✓ PlaylistManagerUI initialized');
            addPlaylistsButton();
          }
        }
      } else {
        console.warn('⚠️ Playlist management modal not found (optional)');
      }
    } catch (error) {
      console.warn('⚠️ Playlist management not available (optional):', error.message);
    }

    // Step 5: Load channels
    console.log('📂 Step 5: Loading channels from playlists...');
    await channelManager.loadChannels();
    console.log(`✓ Loaded ${channelManager.channels.length} channels`);

    if (channelManager.channels.length === 0) {
      console.warn('⚠️ No channels loaded. Check playlist sources.');
    }

    // Step 6: Populate filters
    console.log('🔽 Step 6: Populating filters...');
    populateCountryFilter();

    // Step 7: Render channels
    console.log('🎨 Step 7: Rendering channels...');
    renderChannels();

    // Step 8: Setup event listeners
    console.log('🔌 Step 8: Setting up event listeners...');
    setupEventListeners();

    hideLoading();

    console.log('✅ App initialization complete!');
    const info = channelManager.getPlaylistInfo();
    console.log(`📊 Final Stats: ${info.totalChannels} channels, ${info.countries} countries`);
  } catch (error) {
    console.error('❌ CRITICAL ERROR during initialization:', error);
    showEmptyState();

    // Show user-friendly error
    if (channelsGrid) {
      channelsGrid.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger" role="alert">
                        <h4 class="alert-heading">Error initializing app!</h4>
                        <p><strong>${error.message}</strong></p>
                        <hr>
                        <p class="mb-0">Check browser console (F12) for more details.</p>
                    </div>
                </div>
            `;
    }
  }
}

// ============================================
// DOM MANIPULATION FUNCTIONS
// ============================================

function addPlaylistsButton() {
  if (!favoritesBtn || !favoritesBtn.parentElement) return;
  if (favoritesBtn.parentElement.querySelector('[data-bs-target="#playlistModal"]')) return;

  const playlistBtn = document.createElement('button');
  playlistBtn.className = 'btn btn-outline-light me-2';
  playlistBtn.innerHTML = '<i class="bi bi-list"></i> Playlists';
  playlistBtn.setAttribute('data-bs-toggle', 'modal');
  playlistBtn.setAttribute('data-bs-target', '#playlistModal');

  favoritesBtn.parentElement.insertBefore(playlistBtn, favoritesBtn);
  console.log('✓ Playlists button added');
}

function populateCountryFilter() {
  if (!countryFilter) return;

  const countries = channelManager.getCountries();
  countryFilter.innerHTML = '<option value="">Semua Negara</option>';

  countries.forEach(country => {
    const option = document.createElement('option');
    option.value = country;
    option.textContent = country;
    countryFilter.appendChild(option);
  });

  console.log(`✓ Populated ${countries.length} countries in filter`);
}

function renderChannels() {
  const channels = getFilteredChannels();

  if (channels.length === 0) {
    showEmptyState();
    return;
  }

  channelsGrid.innerHTML = '';

  channels.forEach(channel => {
    const card = createChannelCard(channel);
    channelsGrid.appendChild(card);
  });
}

function getFilteredChannels() {
  let channels = channelManager.filterChannels(
    currentFilter.search,
    currentFilter.country,
    currentFilter.category
  );

  if (currentFilter.favoritesOnly) {
    channels = channels.filter(ch => channelManager.isFavorite(ch.id));
  }

  return channels;
}

function createChannelCard(channel) {
  const col = document.createElement('div');
  col.className = 'col-6 col-md-4 col-lg-3 col-xl-2';

  const isFavorite = channelManager.isFavorite(channel.id);

  col.innerHTML = `
        <div class="channel-card" data-channel-id="${channel.id}">
            <div class="channel-card-image">
                ${
                  channel.logo
                    ? `<img src="${channel.logo}" alt="${channel.name}" style="width: 100%; height: 100%; object-fit: contain; background: #000; padding: 10px;" onerror="this.style.display='none'">`
                    : `<i class="bi bi-tv"></i>`
                }
            </div>
            <div class="channel-card-body">
                <h6 class="channel-card-title">${channel.name}</h6>
                <p class="channel-card-country">
                    <i class="bi bi-geo-alt"></i> ${channel.country}
                </p>
                <div class="channel-card-footer">
                    <div>
                        <span class="status-indicator ${channel.status}"></span>
                        <small class="text-muted">${getCategoryName(channel.category)}</small>
                    </div>
                    <button class="favorite-btn ${isFavorite ? 'active' : ''}"
                            data-channel-id="${channel.id}"
                            onclick="toggleFavorite('${channel.id}', event)">
                        <i class="bi bi-heart${isFavorite ? '-fill' : ''}"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

  // Add click event
  const card = col.querySelector('.channel-card');
  card.addEventListener('click', e => {
    if (!e.target.closest('.favorite-btn')) {
      playChannel(channel);
    }
  });

  return col;
}

function getCategoryName(category) {
  const names = {
    news: 'Berita',
    entertainment: 'Hiburan',
    sports: 'Olahraga',
    music: 'Musik',
    kids: 'Anak-anak',
    movies: 'Film',
    general: 'Umum',
  };
  return names[category] || category;
}

function playChannel(channel) {
  console.log(`▶️ Playing channel: ${channel.name}`);
  videoPlayer.playChannel(channel);

  // Scroll to player on mobile
  if (window.innerWidth < 768) {
    const playerWrapper = document.getElementById('playerWrapper');
    if (playerWrapper) {
      playerWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function toggleFavorite(channelId, event) {
  event.stopPropagation();
  const isFavorite = channelManager.toggleFavorite(channelId);

  const btn = event.currentTarget;
  const icon = btn.querySelector('i');

  if (isFavorite) {
    btn.classList.add('active');
    icon.className = 'bi bi-heart-fill';
    console.log(`❤️ Added to favorites: ${channelId}`);
  } else {
    btn.classList.remove('active');
    icon.className = 'bi bi-heart';
    console.log(`🤍 Removed from favorites: ${channelId}`);
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // Search
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      currentFilter.search = e.target.value;
      renderChannels();
    });
  }

  // Country filter
  if (countryFilter) {
    countryFilter.addEventListener('change', e => {
      currentFilter.country = e.target.value;
      renderChannels();
    });
  }

  // Category filter
  if (categoryFilter) {
    categoryFilter.addEventListener('change', e => {
      currentFilter.category = e.target.value;
      renderChannels();
    });
  }

  // Favorites toggle
  if (favoritesBtn) {
    favoritesBtn.addEventListener('click', () => {
      currentFilter.favoritesOnly = !currentFilter.favoritesOnly;
      favoritesBtn.classList.toggle('btn-primary', currentFilter.favoritesOnly);
      favoritesBtn.classList.toggle('btn-outline-light', !currentFilter.favoritesOnly);
      renderChannels();

      const status = currentFilter.favoritesOnly ? '❤️ ON' : '🤍 OFF';
      console.log(`Favorites filter: ${status}`);
    });
  }
}

// ============================================
// CLEANUP
// ============================================

window.addEventListener('beforeunload', () => {
  if (videoPlayer) {
    videoPlayer.destroy();
    console.log('🛑 App cleanup complete');
  }
});

// ============================================
// START APP
// ============================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
