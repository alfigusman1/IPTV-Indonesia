// player.js — pemutar video native (<video controls>) + HLS.js.
// Kontrol native memberi play/pause, VOLUME (audio), FULLSCREEN, dan PiP yang andal
// (tanpa konflik Video.js). Kualitas HLS dituning tinggi.

class VideoPlayer {
    constructor() {
        this.video = document.getElementById('videoPlayer');
        this.playerPlaceholder = document.getElementById('playerPlaceholder');
        this.playerInfo = document.getElementById('playerInfo');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.currentChannelName = document.getElementById('currentChannelName');
        this.statusBadge = document.getElementById('statusBadge');

        this.hls = null;
        this.currentChannel = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 2000;

        // Pastikan atribut native aktif (controls + volume + fullscreen + PiP).
        if (this.video) {
            this.video.controls = true;
            this.video.setAttribute('playsinline', '');
            this.video.setAttribute('controlsList', 'nodownload');
            this.video.addEventListener('playing', () => { this.hideLoading(); this.updateStatus('LIVE', 'success'); });
            this.video.addEventListener('waiting', () => this.showLoading());
            this.video.addEventListener('loadstart', () => this.showLoading());
            this.video.addEventListener('canplay', () => this.hideLoading());
            this.video.addEventListener('error', () => this.handleError());
        }
    }

    isHLS(url) { return /\.m3u8(\?|$)/i.test(url) || /m3u8/i.test(url); }

    playChannel(channel) {
        this.currentChannel = channel;
        this.retryCount = 0;

        this.playerPlaceholder.style.display = 'none';
        this.video.style.display = 'block';
        this.playerInfo.style.display = 'block';
        this.currentChannelName.textContent = channel.name;
        this.updateStatus('LOADING', 'warning');
        this.showLoading();

        const url = channel.url;
        // Safari/iOS: HLS native. Lainnya: HLS.js. Fallback: src langsung.
        if (this.video.canPlayType('application/vnd.apple.mpegurl') && this.isHLS(url)) {
            this.destroyHls();
            this.video.src = url;
            this.video.play().catch(() => { this.updateStatus('READY', 'info'); this.hideLoading(); });
        } else if (window.Hls && Hls.isSupported()) {
            this.playWithHLS(url);
        } else {
            this.destroyHls();
            this.video.src = url;
            this.video.play().catch(() => this.handleError());
        }
    }

    playWithHLS(url) {
        this.destroyHls();
        this.hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            // Kualitas tinggi: mulai level terbaik, jangan batasi ke ukuran player.
            startLevel: -1,
            capLevelToPlayerSize: false,
            capLevelOnFPSDrop: false,
            abrEwmaDefaultEstimate: 3000000,
            abrBandWidthFactor: 0.95,
            abrBandWidthUpFactor: 0.8,
            // Buffer besar → mulus.
            backBufferLength: 60,
            maxBufferLength: 60,
            maxMaxBufferLength: 900,
            maxBufferSize: 120 * 1000 * 1000,
            maxBufferHole: 0.5,
            manifestLoadingTimeOut: 12000,
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 1000,
            levelLoadingTimeOut: 12000,
            levelLoadingMaxRetry: 4,
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 6,
        });

        this.hls.loadSource(url);
        this.hls.attachMedia(this.video);

        this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            try {
                if (data && Array.isArray(data.levels) && data.levels.length > 1) {
                    const top = data.levels.reduce((hi, lv, i, arr) =>
                        (lv.height || lv.bitrate || 0) > (arr[hi].height || arr[hi].bitrate || 0) ? i : hi, 0);
                    this.hls.startLevel = top;
                    this.hls.nextLevel = top;
                }
            } catch (_) { /* ignore */ }
            this.video.play().catch(() => { this.updateStatus('READY', 'info'); this.hideLoading(); });
        });

        this.hls.on(Hls.Events.FRAG_BUFFERED, () => { this.hideLoading(); this.updateStatus('LIVE', 'success'); });

        this.hls.on(Hls.Events.ERROR, (event, data) => {
            if (!data.fatal) return;
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR: this.retryPlayback(); break;
                case Hls.ErrorTypes.MEDIA_ERROR: try { this.hls.recoverMediaError(); } catch (_) { this.handleError(); } break;
                default: this.handleError(); break;
            }
        });
    }

    retryPlayback() {
        if (this.retryCount < this.maxRetries) {
            this.retryCount++;
            this.updateStatus(`RETRY ${this.retryCount}/${this.maxRetries}`, 'warning');
            setTimeout(() => { if (this.currentChannel) this.playWithHLS(this.currentChannel.url); }, this.retryDelay * this.retryCount);
        } else {
            this.handleError();
        }
    }

    handleError() {
        this.hideLoading();
        this.updateStatus('OFFLINE', 'danger');
    }

    destroyHls() { if (this.hls) { try { this.hls.destroy(); } catch (_) {} this.hls = null; } }

    stop() {
        this.destroyHls();
        try { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); } catch (_) {}
        this.video.style.display = 'none';
        this.playerInfo.style.display = 'none';
        this.playerPlaceholder.style.display = 'flex';
        this.hideLoading();
        this.currentChannel = null;
    }

    showLoading() { if (this.loadingSpinner) this.loadingSpinner.style.display = 'block'; }
    hideLoading() { if (this.loadingSpinner) this.loadingSpinner.style.display = 'none'; }
    updateStatus(text, type) { if (this.statusBadge) { this.statusBadge.textContent = text; this.statusBadge.className = 'badge bg-' + type; } }
    destroy() { this.destroyHls(); }
}

window.VideoPlayer = VideoPlayer;
