// player.js - Video player management dengan HLS.js dan Video.js

class VideoPlayer {
    constructor() {
        this.videoElement = document.getElementById('videoPlayer');
        this.playerWrapper = document.getElementById('playerWrapper');
        this.playerPlaceholder = document.getElementById('playerPlaceholder');
        this.playerInfo = document.getElementById('playerInfo');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.currentChannelName = document.getElementById('currentChannelName');
        this.statusBadge = document.getElementById('statusBadge');
        
        this.hls = null;
        this.vjsPlayer = null;
        this.currentChannel = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 2000;
    }

    // Initialize player
    init() {
        // Initialize Video.js player
        if (!this.vjsPlayer) {
            this.vjsPlayer = videojs(this.videoElement, {
                controls: true,
                autoplay: false,
                preload: 'auto',
                fluid: true,
                aspectRatio: '16:9',
                html5: {
                    vhs: {
                        enableLowInitialPlaylist: false, // mulai kualitas tinggi
                        limitRenditionByPlayerDimensions: false, // jangan batasi ke ukuran player
                        smoothQualityChange: true,
                        overrideNative: true
                    }
                }
            });

            // Error handling
            this.vjsPlayer.on('error', () => {
                this.handleError();
            });

            // Playing event
            this.vjsPlayer.on('playing', () => {
                this.hideLoading();
                this.updateStatus('LIVE', 'success');
            });

            // Waiting event
            this.vjsPlayer.on('waiting', () => {
                this.showLoading();
            });

            // Loadstart event
            this.vjsPlayer.on('loadstart', () => {
                this.showLoading();
            });
        }
    }

    // Play channel
    async playChannel(channel) {
        this.currentChannel = channel;
        this.retryCount = 0;
        
        // Show player, hide placeholder
        this.playerPlaceholder.style.display = 'none';
        this.videoElement.style.display = 'block';
        this.playerInfo.style.display = 'block';
        
        // Update info
        this.currentChannelName.textContent = channel.name;
        this.updateStatus('LOADING', 'warning');
        this.showLoading();

        // Initialize player if not already
        this.init();

        // Try to play with HLS.js first (better compatibility)
        if (this.isHLS(channel.url) && Hls.isSupported()) {
            this.playWithHLS(channel.url);
        } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari)
            this.playNative(channel.url);
        } else {
            // Fallback to Video.js
            this.playWithVideoJS(channel.url);
        }
    }

    // Play with HLS.js
    playWithHLS(url) {
        // Destroy previous HLS instance
        if (this.hls) {
            this.hls.destroy();
        }

        this.hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,          // matikan LL agar buffer stabil & kualitas prioritas
            // ── Kualitas: pakai ABR tapi jangan dibatasi ukuran player; mulai dari
            //    kualitas tertinggi yang sanggup, estimasi bandwidth awal tinggi ──
            startLevel: -1,                 // -1 = auto (ABR pilih terbaik)
            capLevelToPlayerSize: false,    // JANGAN turunkan kualitas ke ukuran <video>
            capLevelOnFPSDrop: false,
            abrEwmaDefaultEstimate: 3000000, // asumsi ~3 Mbps → mulai kualitas lebih tinggi
            abrBandWidthFactor: 0.95,
            abrBandWidthUpFactor: 0.8,
            // ── Buffer lebih besar → playback mulus, minim buffering ──
            backBufferLength: 60,
            maxBufferLength: 60,
            maxMaxBufferLength: 900,
            maxBufferSize: 120 * 1000 * 1000,
            maxBufferHole: 0.5,
            // ── Timeout & retry loading ──
            manifestLoadingTimeOut: 12000,
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 1000,
            levelLoadingTimeOut: 12000,
            levelLoadingMaxRetry: 4,
            levelLoadingRetryDelay: 1000,
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.videoElement);

        // HLS.js events — setelah manifest ter-parse, pilih level tertinggi awal
        // lalu biarkan ABR menyesuaikan (kualitas bagus tapi tetap adaptif).
        this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            try {
                if (data && Array.isArray(data.levels) && data.levels.length > 1) {
                    // mulai dari kualitas tertinggi; ABR akan turun bila bandwidth kurang
                    const top = data.levels.reduce((hi, lv, i, arr) =>
                        (lv.height || lv.bitrate || 0) > (arr[hi].height || arr[hi].bitrate || 0) ? i : hi, 0);
                    this.hls.startLevel = top;
                    this.hls.nextLevel = top;
                }
            } catch (_) { /* ignore */ }
            this.videoElement.play().catch(error => {
                console.error('Autoplay failed:', error);
                this.updateStatus('READY', 'info');
                this.hideLoading();
            });
        });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.log('Network error, trying to recover...');
                        this.retryPlayback();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('Media error, trying to recover...');
                        this.hls.recoverMediaError();
                        break;
                    default:
                        this.handleError();
                        break;
                }
            }
        });

        this.hls.on(Hls.Events.FRAG_BUFFERED, () => {
            this.hideLoading();
            this.updateStatus('LIVE', 'success');
        });
    }

    // Play with native HLS (Safari)
    playNative(url) {
        this.videoElement.src = url;
        this.videoElement.play().catch(error => {
            console.error('Native playback failed:', error);
            this.handleError();
        });
    }

    // Play with Video.js
    playWithVideoJS(url) {
        if (this.vjsPlayer) {
            this.vjsPlayer.src({
                src: url,
                type: 'application/x-mpegURL'
            });
            this.vjsPlayer.play().catch(error => {
                console.error('Video.js playback failed:', error);
                this.handleError();
            });
        }
    }

    // Check if URL is HLS
    isHLS(url) {
        return url.includes('.m3u8') || url.includes('m3u');
    }

    // Retry playback
    retryPlayback() {
        if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            this.updateStatus(`RETRY ${this.retryCount}/${this.maxRetries}`, 'warning');
            
            setTimeout(() => {
                if (this.currentChannel) {
                    console.log(`Retrying playback (${this.retryCount}/${this.maxRetries})...`);
                    this.playChannel(this.currentChannel);
                }
            }, this.retryDelay * this.retryCount);
        } else {
            this.handleError();
        }
    }

    // Handle error
    handleError() {
        this.hideLoading();
        this.updateStatus('OFFLINE', 'danger');
        
        // Show error message
        if (this.vjsPlayer) {
            this.vjsPlayer.pause();
        }
        
        // Bisa ditambahkan notifikasi error ke user
        console.error('Channel tidak dapat diputar. Silakan coba channel lain.');
    }

    // Stop playback
    stop() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        
        if (this.vjsPlayer) {
            this.vjsPlayer.pause();
            this.vjsPlayer.currentTime(0);
        }
        
        this.videoElement.style.display = 'none';
        this.playerInfo.style.display = 'none';
        this.playerPlaceholder.style.display = 'flex';
        this.hideLoading();
        this.currentChannel = null;
    }

    // Show loading spinner
    showLoading() {
        this.loadingSpinner.style.display = 'block';
    }

    // Hide loading spinner
    hideLoading() {
        this.loadingSpinner.style.display = 'none';
    }

    // Update status badge
    updateStatus(text, type) {
        this.statusBadge.textContent = text;
        this.statusBadge.className = 'badge bg-' + type;
    }

    // Destroy player
    destroy() {
        if (this.hls) {
            this.hls.destroy();
        }
        if (this.vjsPlayer) {
            this.vjsPlayer.dispose();
        }
    }
}

// Export
window.VideoPlayer = VideoPlayer;