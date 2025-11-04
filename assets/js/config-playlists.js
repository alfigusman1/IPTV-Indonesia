// config-playlists.js - Konfigurasi Playlist IPTV

const IPTV_CONFIG = {
  // ============================================
  // APP CONFIGURATION
  // ============================================
  app: {
    name: 'IPTV Indonesia',
    version: '2.0.0',
    description: 'Live TV Streaming dengan Multi-Source Playlist',
    defaultTheme: 'dark', // dark, light
    autoRefreshInterval: 24 * 60 * 60 * 1000, // 24 hours
  },

  // ============================================
  // STORAGE CONFIGURATION
  // ============================================
  storage: {
    useLocalStorage: true,
    useIndexedDB: true, // Fallback jika localStorage penuh
    maxLocalStorageSize: 10 * 1024 * 1024, // 10MB
    indexedDBSize: 50 * 1024 * 1024, // 50MB
    autoCleanup: true, // Auto cleanup old data
    cleanupThreshold: 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  // ============================================
  // PLAYLIST SOURCES - EDIT DI SINI UNTUK CUSTOMIZE
  // ============================================
  playlists: {
    // Indonesia
    'local-indonesia': {
      name: 'IPTV Indonesia',
      url: 'https://raw.githubusercontent.com/alfigusman1/IPTV-Indonesia/refs/heads/main/index.m3u',
      country: 'Indonesia',
      enabled: true,
      priority: 10, // Higher = load first
      timeout: 15000, // 15 seconds
      description: 'Repository lokal Indonesia',
      tags: ['Indonesia', 'Local', 'Regional'],
    },

    'iptv-org-global': {
      name: 'IPTV-Org Global (8000+ channels)',
      url: 'https://iptv-org.github.io/iptv/index.m3u',
      country: 'Global',
      enabled: false, // Disabled by default - too large
      priority: 1,
      timeout: 30000,
      description: 'Complete worldwide channels (ADVANCED)',
      tags: ['Global', 'Complete', 'Large', 'Advanced'],
      notice: 'Large file - may consume significant resources',
    },

    'free-tv': {
      name: 'Free-TV Playlist',
      url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
      country: 'Global',
      enabled: true,
      priority: 4,
      timeout: 25000,
      description: 'Free-TV international channels',
      tags: ['Global', 'International', 'Mixed'],
    },

    'iptv-org-usa': {
      name: 'IPTV-Org USA',
      url: 'https://iptv-org.github.io/iptv/countries/us.m3u',
      country: 'United States',
      enabled: true,
      priority: 5,
      timeout: 20000,
      description: 'USA channels from IPTV-Org',
      tags: ['USA', 'International', 'English'],
    },

    // ============================================
    // TAMBAH PLAYLIST CUSTOM DI BAWAH INI
    // ============================================
    // 'custom-playlist-1': {
    //     name: 'Custom Playlist Name',
    //     url: 'https://example.com/playlist.m3u8',
    //     country: 'Country Name',
    //     enabled: true,
    //     priority: 6,
    //     timeout: 15000,
    //     description: 'Your custom playlist',
    //     tags: ['Custom', 'Your Tag']
    // }
  },

  // ============================================
  // PLAYER CONFIGURATION
  // ============================================
  player: {
    autoplay: false,
    preload: 'auto',
    controls: true,
    responsive: true,
    fullscreenEnabled: true,

    // HLS.js specific
    hls: {
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90,
      maxBufferLength: 30,
      maxMaxBufferLength: 600,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 3,
      manifestLoadingRetryDelay: 1000,
      levelLoadingTimeOut: 10000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 1000,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 1000,
    },

    // Retry mechanism
    retry: {
      maxRetries: 3,
      retryDelay: 2000, // milliseconds
    },
  },

  // ============================================
  // CHANNEL FILTERING & CATEGORIZATION
  // ============================================
  categories: {
    news: { name: 'Berita', icon: 'bi-newspaper', color: '#FF6B6B' },
    entertainment: { name: 'Hiburan', icon: 'bi-film', color: '#4ECDC4' },
    sports: { name: 'Olahraga', icon: 'bi-trophy', color: '#FFE66D' },
    music: { name: 'Musik', icon: 'bi-music-note', color: '#95E1D3' },
    kids: { name: 'Anak-anak', icon: 'bi-balloon', color: '#F38181' },
    movies: { name: 'Film', icon: 'bi-camera-reels', color: '#AA96DA' },
    general: { name: 'Umum', icon: 'bi-tv', color: '#FCBAD3' },
  },

  // ============================================
  // COUNTRY MAPPING
  // ============================================
  countries: {
    Global: 'GL',
    International: 'INT',
    Undefined: 'XX',

    Afghanistan: 'AF',
    Albania: 'AL',
    Algeria: 'DZ',
    Andorra: 'AD',
    Argentina: 'AR',
    Armenia: 'AM',
    Aruba: 'AW',
    Australia: 'AU',
    Austria: 'AT',
    Azerbaijan: 'AZ',
    Bahamas: 'BS',
    Bahrain: 'BH',
    Bangladesh: 'BD',
    Barbados: 'BB',
    Belarus: 'BY',
    Belgium: 'BE',
    Belize: 'BZ',
    Benin: 'BJ',
    Bolivia: 'BO',
    'Bosnia and Herzegovina': 'BA',
    Brazil: 'BR',
    Bulgaria: 'BG',
    Cambodia: 'KH',
    Canada: 'CA',
    'Cape Verde': 'CV',
    'Cayman Islands': 'KY',
    Chile: 'CL',
    China: 'CN',
    Colombia: 'CO',
    'Costa Rica': 'CR',
    Croatia: 'HR',
    Cuba: 'CU',
    Curaçao: 'CW',
    Cyprus: 'CY',
    'Czech Republic': 'CZ',
    Denmark: 'DK',
    'Dominican Republic': 'DO',
    Ecuador: 'EC',
    Egypt: 'EG',
    'El Salvador': 'SV',
    Estonia: 'EE',
    Ethiopia: 'ET',
    Finland: 'FI',
    France: 'FR',
    Georgia: 'GE',
    Germany: 'DE',
    Ghana: 'GH',
    Greece: 'GR',
    Guatemala: 'GT',
    Haiti: 'HT',
    Honduras: 'HN',
    'Hong Kong': 'HK',
    Hungary: 'HU',
    Iceland: 'IS',
    India: 'IN',
    Indonesia: 'ID',
    Iran: 'IR',
    Iraq: 'IQ',
    Ireland: 'IE',
    Israel: 'IL',
    Italy: 'IT',
    Jamaica: 'JM',
    Japan: 'JP',
    Jordan: 'JO',
    Kazakhstan: 'KZ',
    Kenya: 'KE',
    Kuwait: 'KW',
    Latvia: 'LV',
    Lebanon: 'LB',
    Libya: 'LY',
    Lithuania: 'LT',
    Luxembourg: 'LU',
    'North Macedonia': 'MK',
    Malaysia: 'MY',
    Malta: 'MT',
    Mexico: 'MX',
    Moldova: 'MD',
    Mongolia: 'MN',
    Montenegro: 'ME',
    Morocco: 'MA',
    Nepal: 'NP',
    Netherlands: 'NL',
    'New Zealand': 'NZ',
    Nicaragua: 'NI',
    Nigeria: 'NG',
    'North Korea': 'KP',
    Norway: 'NO',
    Pakistan: 'PK',
    Palestine: 'PS',
    Panama: 'PA',
    Paraguay: 'PY',
    Peru: 'PE',
    Philippines: 'PH',
    Poland: 'PL',
    Portugal: 'PT',
    Qatar: 'QA',
    Romania: 'RO',
    Russia: 'RU',
    'Saudi Arabia': 'SA',
    Senegal: 'SN',
    Serbia: 'RS',
    Singapore: 'SG',
    Slovakia: 'SK',
    Slovenia: 'SI',
    'South Africa': 'ZA',
    'South Korea': 'KR',
    Spain: 'ES',
    'Sri Lanka': 'LK',
    Sudan: 'SD',
    Sweden: 'SE',
    Switzerland: 'CH',
    Syria: 'SY',
    Taiwan: 'TW',
    Tanzania: 'TZ',
    Thailand: 'TH',
    'Trinidad and Tobago': 'TT',
    Tunisia: 'TN',
    Turkey: 'TR',
    Uganda: 'UG',
    Ukraine: 'UA',
    'United Arab Emirates': 'AE',
    'United Kingdom': 'GB',
    UK: 'GB',
    'United States': 'US',
    USA: 'US',
    Uruguay: 'UY',
    Venezuela: 'VE',
    Vietnam: 'VN',
    Yemen: 'YE',
    Zimbabwe: 'ZW',
  },

  // ============================================
  // UI CONFIGURATION
  // ============================================
  ui: {
    theme: {
      primary: '#e50914',
      secondary: '#221f1f',
      darkBg: '#141414',
      cardBg: '#1f1f1f',
      textLight: '#ffffff',
      textMuted: '#808080',
    },

    grid: {
      columnsXs: 6, // 2 columns on extra small screens
      columnsSm: 6, // 2 columns on small screens
      columnsMd: 4, // 3 columns on medium screens
      columnsLg: 3, // 4 columns on large screens
      columnsXl: 2, // 6 columns on extra large screens
    },

    itemsPerPage: 24,
    enableInfiniteScroll: true,
  },

  // ============================================
  // EXPORT CONFIGURATION
  // ============================================
  export: {
    enableM3UExport: true,
    enableJSONExport: true,
    enableCSVExport: false,
    filenamePattern: 'iptv-{date}.m3u8',
    includeInactive: false,
  },

  // ============================================
  // FEATURE FLAGS
  // ============================================
  features: {
    enableFavorites: true,
    enablePlaylistManagement: true,
    enableChannelSearch: true,
    enableChannelFiltering: true,
    enableChannelQualityDisplay: true,
    enableChannelCountryDisplay: true,
    enableChannelCategoryDisplay: true,
    enableOfflineDetection: true,
    enableAutoRetry: true,
    enablePlaylistImport: true,
    enablePlaylistExport: true,
  },

  // ============================================
  // DEVELOPER CONFIGURATION
  // ============================================
  developer: {
    enableDebugLogging: true,
    enablePerformanceMonitoring: true,
    enableNetworkLogging: true,
    logLevel: 'info', // 'debug', 'info', 'warn', 'error'
    showConsoleStats: true,
  },
};

// Export untuk digunakan di file lain
window.IPTV_CONFIG = IPTV_CONFIG;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get playlist configuration
 */
function getPlaylistConfig(playlistId) {
  return IPTV_CONFIG.playlists[playlistId];
}

/**
 * Get all enabled playlists
 */
function getEnabledPlaylists() {
  return Object.entries(IPTV_CONFIG.playlists)
    .filter(([_, config]) => config.enabled)
    .sort((a, b) => (b[1].priority || 0) - (a[1].priority || 0))
    .map(([id, config]) => ({ id, ...config }));
}

/**
 * Update playlist config
 */
function updatePlaylistConfig(playlistId, updates) {
  if (IPTV_CONFIG.playlists[playlistId]) {
    Object.assign(IPTV_CONFIG.playlists[playlistId], updates);
    // Simpan ke localStorage
    localStorage.setItem('IPTV_CONFIG', JSON.stringify(IPTV_CONFIG));
  }
}

/**
 * Get theme color
 */
function getThemeColor(key) {
  return IPTV_CONFIG.ui.theme[key] || '#ffffff';
}

/**
 * Get category info
 */
function getCategoryInfo(categoryId) {
  return IPTV_CONFIG.categories[categoryId] || IPTV_CONFIG.categories['general'];
}

/**
 * Log dengan prefix
 */
function log(message, level = 'info') {
  if (!IPTV_CONFIG.developer.enableDebugLogging) return;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  switch (level) {
    case 'debug':
      console.debug(prefix, message);
      break;
    case 'warn':
      console.warn(prefix, message);
      break;
    case 'error':
      console.error(prefix, message);
      break;
    default:
      console.log(prefix, message);
  }
}

// Export helpers
window.getPlaylistConfig = getPlaylistConfig;
window.getEnabledPlaylists = getEnabledPlaylists;
window.updatePlaylistConfig = updatePlaylistConfig;
window.getThemeColor = getThemeColor;
window.getCategoryInfo = getCategoryInfo;
window.log = log;
