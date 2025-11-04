// channels.js - Manajemen data channel IPTV

class ChannelManager {
    constructor() {
        this.channels = [];
        this.favorites = this.loadFavorites();
        this.defaultChannels = this.getDefaultChannels();
    }

    // Load channels dari localStorage atau gunakan default
    async loadChannels() {
        const stored = localStorage.getItem('iptvChannels');
        if (stored) {
            this.channels = JSON.parse(stored);
        } else {
            await this.loadDefaultChannels();
        }
        return this.channels;
    }

    // Load default channels dari IPTV-Org dan Free-TV
    async loadDefaultChannels() {
        try {
            // Daftar default channels dari berbagai negara
            this.channels = this.defaultChannels;
            this.saveChannels();
        } catch (error) {
            console.error('Error loading default channels:', error);
        }
    }

    // Default channels (bisa diperluas)
    getDefaultChannels() {
        return [
            // Indonesia
            {
                id: 'id-001',
                name: 'Metro TV',
                country: 'Indonesia',
                countryCode: 'ID',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Metro_TV_%282019%29.svg/200px-Metro_TV_%282019%29.svg.png',
                url: 'https://edge.medcom.id/live-edge/smil:metro.smil/playlist.m3u8',
                status: 'unknown'
            },
            {
                id: 'id-002',
                name: 'Kompas TV',
                country: 'Indonesia',
                countryCode: 'ID',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/KompasTV_2017.svg/200px-KompasTV_2017.svg.png',
                url: 'https://ythls.armelin.one/channel/UC5BMIWZe9isJXLZwIq0WvwA.m3u8',
                status: 'unknown'
            },
            {
                id: 'id-003',
                name: 'TV One',
                country: 'Indonesia',
                countryCode: 'ID',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/TvOne_2023.svg/200px-TvOne_2023.svg.png',
                url: 'https://ythls.armelin.one/channel/UCy5PTfSa26f1QWR4cRx8Wnw.m3u8',
                status: 'unknown'
            },
            // USA
            {
                id: 'us-001',
                name: 'ABC News',
                country: 'United States',
                countryCode: 'US',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/ABC_News.svg/200px-ABC_News.svg.png',
                url: 'https://content.uplynk.com/channel/3324f2467c414329b3b0cc5cd987b6be.m3u8',
                status: 'unknown'
            },
            {
                id: 'us-002',
                name: 'Bloomberg TV',
                country: 'United States',
                countryCode: 'US',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Bloomberg_Television_logo.svg/200px-Bloomberg_Television_logo.svg.png',
                url: 'https://bloomberg.com/media-manifest/streams/us.m3u8',
                status: 'unknown'
            },
            // UK
            {
                id: 'uk-001',
                name: 'BBC News',
                country: 'United Kingdom',
                countryCode: 'GB',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/BBC_News_2019.svg/200px-BBC_News_2019.svg.png',
                url: 'https://vs-hls-push-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_news_channel_hd/t=3840/v=pv14/b=5070016/main.m3u8',
                status: 'unknown'
            },
            // France
            {
                id: 'fr-001',
                name: 'France 24',
                country: 'France',
                countryCode: 'FR',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/France24.svg/200px-France24.svg.png',
                url: 'https://cdn.klowdtv.net/803B48A/n1.klowdtv.net/live1/france24_720p/playlist.m3u8',
                status: 'unknown'
            },
            // Germany
            {
                id: 'de-001',
                name: 'Deutsche Welle',
                country: 'Germany',
                countryCode: 'DE',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_symbol_2012.svg/200px-Deutsche_Welle_symbol_2012.svg.png',
                url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
                status: 'unknown'
            },
            // International
            {
                id: 'int-001',
                name: 'Al Jazeera English',
                country: 'Qatar',
                countryCode: 'QA',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/7/71/Aljazeera.svg/200px-Aljazeera.svg.png',
                url: 'https://live-hls-web-aje.getaj.net/AJE/index.m3u8',
                status: 'unknown'
            },
            {
                id: 'int-002',
                name: 'CGTN',
                country: 'China',
                countryCode: 'CN',
                category: 'news',
                logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/CGTN.svg/200px-CGTN.svg.png',
                url: 'https://english-livews.cgtn.com/hls/LSveOGBaBw41Ea7ukkVAUdKQ220802LSTexu6xAuFH8VZNBLE1ZNEa220802cd/playlist.m3u8',
                status: 'unknown'
            }
        ];
    }

    // Save channels ke localStorage
    saveChannels() {
        localStorage.setItem('iptvChannels', JSON.stringify(this.channels));
    }

    // Import M3U playlist
    async importM3U(content) {
        const channels = this.parseM3U(content);
        this.channels = [...this.channels, ...channels];
        this.saveChannels();
        return channels.length;
    }

    // Parse M3U format
    parseM3U(content) {
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
                
                currentChannel = {
                    id: 'custom-' + Date.now() + '-' + Math.random(),
                    name: nameMatch ? nameMatch[1] : 'Unknown Channel',
                    logo: logoMatch ? logoMatch[1] : null,
                    country: countryMatch ? countryMatch[1] : 'Unknown',
                    countryCode: 'XX',
                    category: categoryMatch ? this.mapCategory(categoryMatch[1]) : 'general',
                    status: 'unknown'
                };
            } else if (line && !line.startsWith('#') && currentChannel.name) {
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = {};
            }
        }

        return channels;
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
            'movies': 'movies',
            'film': 'movies'
        };

        const lowerCategory = category.toLowerCase();
        for (const [key, value] of Object.entries(categoryMap)) {
            if (lowerCategory.includes(key)) {
                return value;
            }
        }
        return 'general';
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

    // Check channel status
    async checkChannelStatus(channel) {
        // Implementasi sederhana - bisa diperluas dengan HEAD request
        return 'unknown';
    }
}

// Export untuk digunakan di file lain
window.ChannelManager = ChannelManager;