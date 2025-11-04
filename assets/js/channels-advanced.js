// channels-advanced.js - Advanced channel management dengan multiple playlist sources

class AdvancedChannelManager {
    constructor() {
        this.channels = [];
        this.favorites = this.loadFavorites();
        this.playlistSources = this.getDefaultPlaylistSources();
        this.loadedPlaylists = this.loadLoadedPlaylists();
    }

    // Define playlist sources yang bisa digunakan
    getDefaultPlaylistSources() {
        return [
            {
                id: 'local-indonesia',
                name: 'IPTV Indonesia (Local)',
                url: 'https://raw.githubusercontent.com/alfigusman1/IPTV-Indonesia/refs/heads/main/index.m3u',
                country: 'Indonesia',
                channels: 0,
                enabled: true,
                description: 'Playlist lokal Indonesia dengan berbagai channel'
            },
            {
                id: 'iptv-org-indonesia',
                name: 'IPTV-Org Indonesia',
                url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/id.m3u',
                country: 'Indonesia',
                channels: 0,
                enabled: true,
                description: 'Official IPTV-Org playlist untuk Indonesia'
            },
            {
                id: 'mgi24-tvdigital',
                name: 'TV Digital Indonesia',
                url: 'https://raw.githubusercontent.com/mgi24/tvdigital/refs/heads/main/idwork.m3u',
                country: 'Indonesia',
                channels: 0,
                enabled: true,
                description: 'TV Digital Indonesia working channels'
            },
            {
                id: 'emonnaja-indonesia',
                name: 'Indonesian IPTV',
                url: 'https://raw.githubusercontent.com/emonnaja/Indonesian-IPTV/refs/heads/main/playlist/indonesia.m3u',
                country: 'Indonesia',
                channels: 0,
                enabled: true,
                description: 'Indonesian IPTV curated playlist'
            },
            {
                id: 'iptv-org-usa',
                name: 'IPTV-Org USA',
                url: 'https://iptv-org.github.io/iptv/countries/us.m3u',
                country: 'United States',
                channels: 0,
                enabled: true,
                description: 'Official IPTV-Org playlist untuk USA'
            },
            {
                id: 'iptv-org-global',
                name: 'IPTV-Org Global (8000+ channels)',
                url: 'https://iptv-org.github.io/iptv/index.m3u',
                country: 'Global',
                channels: 0,
                enabled: false,
                description: 'Complete IPTV-Org worldwide channels (besar, hanya untuk advanced users)'
            },
            {
                id: 'free-tv',
                name: 'Free-TV Playlist',
                url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
                country: 'Global',
                channels: 0,
                enabled: true,
                description: 'Free-TV channels dari berbagai negara'
            }
        ];
    }

    // Load channels dari localStorage atau default
    async loadChannels() {
        const stored = localStorage.getItem('iptvChannels');
        if (stored) {
            this.channels = JSON.parse(stored);
            console.log(`Loaded ${this.channels.length} channels from localStorage`);
            return this.channels;
        }

        // Jika belum ada, load dari playlist yang enabled
        await this.loadFromEnabledPlaylists();
        return this.channels;
    }

    // Load channels dari semua playlist yang enabled
    async loadFromEnabledPlaylists() {
        const enabledPlaylists = this.playlistSources.filter(p => p.enabled);
        const importedChannels = [];

        for (const playlist of enabledPlaylists) {
            try {
                console.log(`Loading playlist: ${playlist.name}...`);
                const response = await fetch(playlist.url);
                
                if (!response.ok) {
                    console.warn(`Failed to load ${playlist.name}: ${response.status}`);
                    continue;
                }

                const content = await response.text();
                const channels = this.parseM3U(content, playlist.id);
                
                playlist.channels = channels.length;
                importedChannels.push(...channels);
                
                console.log(`✓ Loaded ${channels.length} channels from ${playlist.name}`);
            } catch (error) {
                console.error(`Error loading ${playlist.name}:`, error);
                playlist.channels = 0;
            }
        }

        // Remove duplicate channels (same name dan country)
        this.channels = this.removeDuplicates(importedChannels);
        this.saveChannels();
        
        console.log(`Total channels loaded: ${this.channels.length}`);
        return this.channels;
    }

    // Remove duplicate channels
    removeDuplicates(channels) {
        const seen = new Set();
        const unique = [];

        for (const channel of channels) {
            const key = `${channel.name}|${channel.country}`;
            
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(channel);
            }
        }

        return unique;
    }

    // Parse M3U format
    parseM3U(content, playlistId) {
        const channels = [];
        const lines = content.split('\n');
        let currentChannel = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXTINF:')) {
                // Extract channel info
                const nameMatch = line.match(/,(.+)$/);
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                const countryMatch = line.match(/tvg-country="([^"]+)"/);
                const categoryMatch = line.match(/group-title="([^"]+)"/);
                const idMatch = line.match(/tvg-id="([^"]+)"/);
                
                currentChannel = {
                    id: idMatch ? idMatch[1] : `${playlistId}-${Date.now()}-${Math.random()}`,
                    name: nameMatch ? nameMatch[1].trim() : 'Unknown Channel',
                    logo: logoMatch ? logoMatch[1] : null,
                    country: countryMatch ? countryMatch[1] : 'Unknown',
                    countryCode: this.getCountryCode(countryMatch ? countryMatch[1] : 'Unknown'),
                    category: categoryMatch ? this.mapCategory(categoryMatch[1]) : 'general',
                    status: 'unknown',
                    playlistId: playlistId,
                    quality: this.extractQuality(line)
                };
            } else if (line && !line.startsWith('#') && currentChannel.name) {
                currentChannel.url = line;
                // Jangan tambah jika URL kosong
                if (currentChannel.url) {
                    channels.push(currentChannel);
                }
                currentChannel = {};
            }
        }

        return channels;
    }

    // Extract quality info dari EXTINF line
    extractQuality(line) {
        if (line.includes('1080p') || line.includes('Full HD')) return '1080p';
        if (line.includes('720p') || line.includes('HD')) return '720p';
        if (line.includes('480p')) return '480p';
        if (line.includes('360p')) return '360p';
        if (line.includes('576p')) return '576p';
        return 'unknown';
    }

    // Map category dari M3U ke kategori standar
    mapCategory(category) {
        const categoryMap = {
            'news': 'news',
            'berita': 'news',
            'entertainment': 'entertainment',
            'hiburan': 'entertainment',
            'sports': 'sports',
            'olahraga': 'sports',
            'music': 'music',
            'musik': 'music',
            'kids': 'kids',
            'anak': 'kids',
            'children': 'kids',
            'movies': 'movies',
            'film': 'movies',
            'cinema': 'movies',
            'drama': 'entertainment',
            'documentary': 'entertainment',
            'documentary': 'entertainment',
            'religion': 'entertainment',
            'fashion': 'entertainment',
            'lifestyle': 'entertainment',
            'cooking': 'entertainment',
            'nature': 'entertainment',
            'animals': 'entertainment',
            'education': 'entertainment',
            'learning': 'entertainment'
        };

        const lowerCategory = category.toLowerCase().trim();
        for (const [key, value] of Object.entries(categoryMap)) {
            if (lowerCategory.includes(key)) {
                return value;
            }
        }
        return 'general';
    }

    // Get country code dari country name
    getCountryCode(countryName) {
        const countryCodes = {
            'Indonesia': 'ID',
            'United States': 'US',
            'USA': 'US',
            'United Kingdom': 'GB',
            'UK': 'GB',
            'France': 'FR',
            'Germany': 'DE',
            'Spain': 'ES',
            'Italy': 'IT',
            'Japan': 'JP',
            'China': 'CN',
            'India': 'IN',
            'Brazil': 'BR',
            'Canada': 'CA',
            'Australia': 'AU',
            'Global': 'GL',
            'International': 'INT'
        };

        return countryCodes[countryName] || 'XX';
    }

    // Save channels ke localStorage
    saveChannels() {
        try {
            localStorage.setItem('iptvChannels', JSON.stringify(this.channels));
            console.log('Channels saved to localStorage');
        } catch (error) {
            console.error('Failed to save channels to localStorage:', error);
            // Fallback: simpan ke IndexedDB atau simpan sebagian saja
            this.saveToIndexedDB();
        }
    }

    // Save to IndexedDB untuk kapasitas lebih besar
    async saveToIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('IPTV_DB', 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('channels')) {
                    db.createObjectStore('channels', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['channels'], 'readwrite');
                const store = transaction.objectStore('channels');

                // Clear existing data
                store.clear();

                // Add new channels
                this.channels.forEach(channel => {
                    store.add(channel);
                });

                console.log('Channels saved to IndexedDB');
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    // Load from IndexedDB
    async loadFromIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('IPTV_DB', 1);

            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['channels'], 'readonly');
                const store = transaction.objectStore('channels');
                const allRequest = store.getAll();

                allRequest.onsuccess = () => {
                    this.channels = allRequest.result;
                    console.log(`Loaded ${this.channels.length} channels from IndexedDB`);
                    resolve(this.channels);
                };
            };

            request.onerror = () => reject(request.error);
        });
    }

    // Manual import custom playlist
    async importCustomPlaylist(url) {
        try {
            const response = await fetch(url);
            const content = await response.text();
            
            const playlistId = `custom-${Date.now()}`;
            const channels = this.parseM3U(content, playlistId);
            
            this.channels.push(...channels);
            this.channels = this.removeDuplicates(this.channels);
            this.saveChannels();
            
            return {
                success: true,
                count: channels.length,
                message: `Successfully imported ${channels.length} channels`
            };
        } catch (error) {
            return {
                success: false,
                count: 0,
                message: `Failed to import playlist: ${error.message}`
            };
        }
    }

    // Manual import file M3U
    async importM3UFile(file) {
        try {
            const content = await file.text();
            const playlistId = `file-${Date.now()}`;
            const channels = this.parseM3U(content, playlistId);
            
            this.channels.push(...channels);
            this.channels = this.removeDuplicates(this.channels);
            this.saveChannels();
            
            return {
                success: true,
                count: channels.length,
                message: `Successfully imported ${channels.length} channels from file`
            };
        } catch (error) {
            return {
                success: false,
                count: 0,
                message: `Failed to import file: ${error.message}`
            };
        }
    }

    // Get playlist status
    getPlaylistStatus() {
        return this.playlistSources.map(p => ({
            id: p.id,
            name: p.name,
            enabled: p.enabled,
            channels: p.channels,
            status: p.channels > 0 ? 'loaded' : 'pending'
        }));
    }

    // Toggle playlist enabled status
    togglePlaylist(playlistId) {
        const playlist = this.playlistSources.find(p => p.id === playlistId);
        if (playlist) {
            playlist.enabled = !playlist.enabled;
            localStorage.setItem('playlistSources', JSON.stringify(this.playlistSources));
            return playlist.enabled;
        }
        return false;
    }

    // Save playlist settings
    savePlaylistSettings() {
        localStorage.setItem('playlistSources', JSON.stringify(this.playlistSources));
    }

    // Load playlist settings
    loadLoadedPlaylists() {
        const stored = localStorage.getItem('playlistSources');
        if (stored) {
            const loaded = JSON.parse(stored);
            // Merge dengan default sources
            this.playlistSources.forEach(defaultSource => {
                const loadedSource = loaded.find(p => p.id === defaultSource.id);
                if (loadedSource) {
                    defaultSource.enabled = loadedSource.enabled;
                    defaultSource.channels = loadedSource.channels;
                }
            });
            return loaded;
        }
        return this.playlistSources;
    }

    // Filter channels
    filterChannels(search = '', country = '', category = '') {
        return this.channels.filter(channel => {
            const matchSearch = !search || 
                channel.name.toLowerCase().includes(search.toLowerCase());
            const matchCountry = !country || 
                channel.country === country;
            const matchCategory = !category || 
                channel.category === category;
            
            return matchSearch && matchCountry && matchCategory;
        });
    }

    // Get unique countries
    getCountries() {
        const countries = [...new Set(this.channels.map(ch => ch.country))];
        return countries.sort();
    }

    // Get playlist info
    getPlaylistInfo() {
        return {
            totalChannels: this.channels.length,
            totalPlaylists: this.playlistSources.length,
            enabledPlaylists: this.playlistSources.filter(p => p.enabled).length,
            countries: this.getCountries().length,
            playlists: this.playlistSources
        };
    }

    // Refresh all playlists
    async refreshAllPlaylists() {
        console.log('Refreshing all playlists...');
        this.channels = [];
        await this.loadFromEnabledPlaylists();
        return this.channels;
    }

    // Favorites management
    loadFavorites() {
        const stored = localStorage.getItem('iptvFavorites');
        return stored ? JSON.parse(stored) : [];
    }

    saveFavorites() {
        localStorage.setItem('iptvFavorites', JSON.stringify(this.favorites));
    }

    toggleFavorite(channelId) {
        const index = this.favorites.indexOf(channelId);
        if (index > -1) {
            this.favorites.splice(index, 1);
        } else {
            this.favorites.push(channelId);
        }
        this.saveFavorites();
        return this.isFavorite(channelId);
    }

    isFavorite(channelId) {
        return this.favorites.includes(channelId);
    }

    // Export channels as M3U
    exportAsM3U() {
        let m3u = '#EXTM3U x-tvg-url="https://example.com/epg"\n\n';
        
        this.channels.forEach(channel => {
            const extinf = `#EXTINF:-1 tvg-id="${channel.id}" tvg-logo="${channel.logo || ''}" group-title="${channel.category}",${channel.name}`;
            m3u += `${extinf}\n${channel.url}\n\n`;
        });

        return m3u;
    }

    // Download M3U file
    downloadM3U(filename = 'playlist.m3u8') {
        const m3u = this.exportAsM3U();
        const blob = new Blob([m3u], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Export
window.AdvancedChannelManager = AdvancedChannelManager;