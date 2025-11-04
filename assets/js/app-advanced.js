// Initialize managers (UPDATED)
const channelManager = new AdvancedChannelManager();
const videoPlayer = new VideoPlayer();
let playlistManagerUI; // Akan di-initialize setelah modal loaded

// Initialize app
async function initApp() {
  showLoading();

  // 1. Load playlist management modal
  try {
    const response = await fetch('playlist-management.html');
    const html = await response.text();
    document.getElementById('playlistManagementContainer').innerHTML = html;
    playlistManagerUI = new PlaylistManagerUI(channelManager);
  } catch (error) {
    console.warn('Playlist management modal not found, using basic mode', error);
  }

  // 2. Load channels dari enabled playlists
  await channelManager.loadChannels();

  // 3. Populate filters
  populateCountryFilter();

  // 4. Render channels
  renderChannels();

  // 5. Setup event listeners
  setupEventListeners();

  hideLoading();

  console.log(`✓ App initialized with ${channelManager.channels.length} channels`);
}

// Setup event listeners (UPDATED)
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', e => {
    currentFilter.search = e.target.value;
    renderChannels();
  });

  // Country filter
  countryFilter.addEventListener('change', e => {
    currentFilter.country = e.target.value;
    renderChannels();
  });

  // Category filter
  categoryFilter.addEventListener('change', e => {
    currentFilter.category = e.target.value;
    renderChannels();
  });

  // Favorites toggle
  favoritesBtn.addEventListener('click', () => {
    currentFilter.favoritesOnly = !currentFilter.favoritesOnly;
    favoritesBtn.classList.toggle('btn-primary', currentFilter.favoritesOnly);
    favoritesBtn.classList.toggle('btn-outline-light', !currentFilter.favoritesOnly);
    renderChannels();
  });

  // Import/Export toggle (UPDATED)
  const playlistToggle = document.createElement('button');
  playlistToggle.className = 'btn btn-outline-light me-2';
  playlistToggle.innerHTML = '<i class="bi bi-list"></i> Playlists';
  playlistToggle.setAttribute('data-bs-toggle', 'modal');
  playlistToggle.setAttribute('data-bs-target', '#playlistModal');

  if (favoritesBtn.parentElement) {
    favoritesBtn.parentElement.insertBefore(playlistToggle, favoritesBtn);
  }

  // File/URL import (BASIC MODE - untuk jika modal tidak ada)
  if (!playlistManagerUI) {
    setupBasicImport();
  }
}

// Basic import (jika modal tidak ada)
function setupBasicImport() {
  const importBtn = document.getElementById('importBtn');
  importBtn.addEventListener('click', () => {
    const url = prompt('Masukkan URL playlist M3U8:');
    if (url) {
      importFromUrl(url);
    }
  });
}

// Import dari URL
async function importFromUrl(url) {
  showLoading();
  const result = await channelManager.importCustomPlaylist(url);

  if (result.success) {
    populateCountryFilter();
    renderChannels();
    alert(result.message);
  } else {
    alert(result.message);
  }

  hideLoading();
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
