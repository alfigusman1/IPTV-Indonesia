// Parser M3U → array channel. Dipakai importer untuk semua sumber.

// Peta group-title/kategori bebas → kategori baku aplikasi.
const CATEGORY_MAP = {
  news: 'news', berita: 'news',
  entertainment: 'entertainment', hiburan: 'entertainment', general: 'general', umum: 'general',
  sports: 'sports', sport: 'sports', olahraga: 'sports',
  music: 'music', musik: 'music',
  kids: 'kids', 'anak-anak': 'kids', children: 'kids',
  movies: 'movies', movie: 'movies', film: 'movies', cinema: 'movies',
  religious: 'religious', religion: 'religious', islam: 'religious',
  documentary: 'documentary', education: 'education', lifestyle: 'lifestyle',
  business: 'business', local: 'local',
};

const COUNTRY_NAMES = {
  ID: 'Indonesia', MY: 'Malaysia', SG: 'Singapore', US: 'United States',
  GB: 'United Kingdom', UK: 'United Kingdom', AU: 'Australia', IN: 'India',
  JP: 'Japan', KR: 'South Korea', CN: 'China', SA: 'Saudi Arabia', AE: 'UAE',
};

function mapCategory(group) {
  if (!group) return 'general';
  const key = String(group).trim().toLowerCase();
  if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];
  // cocokkan sebagian (mis. "ID News" → news)
  for (const k of Object.keys(CATEGORY_MAP)) {
    if (key.includes(k)) return CATEGORY_MAP[k];
  }
  return 'general';
}

function attr(line, name) {
  const m = line.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

/**
 * @param {string} content isi file M3U
 * @param {object} opts { defaultCountryCode }
 * @returns {Array<{name,stream_url,tvg_id,logo,category,country,country_code,group_title}>}
 */
function parseM3U(content, opts = {}) {
  const fallbackCode = (opts.defaultCountryCode || '').toUpperCase() || null;
  const lines = String(content).split(/\r?\n/);
  const out = [];
  let cur = null;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXTM3U')) continue;

    if (line.startsWith('#EXTINF')) {
      const rawCountry = (attr(line, 'tvg-country') || '').split(';')[0].trim().toUpperCase() || fallbackCode;
      const countryCode = rawCountry || null;
      const name = (line.split(',').slice(1).join(',') || '').trim();
      cur = {
        name: name || 'Unknown',
        tvg_id: attr(line, 'tvg-id'),
        logo: attr(line, 'tvg-logo'),
        group_title: attr(line, 'group-title'),
        category: mapCategory(attr(line, 'group-title')),
        country_code: countryCode,
        country: countryCode ? (COUNTRY_NAMES[countryCode] || countryCode) : null,
        stream_url: '',
      };
    } else if (!line.startsWith('#')) {
      // baris URL
      if (cur && /^https?:\/\//i.test(line)) {
        cur.stream_url = line;
        out.push(cur);
      }
      cur = null;
    }
  }
  return out;
}

module.exports = { parseM3U, mapCategory, COUNTRY_NAMES };
