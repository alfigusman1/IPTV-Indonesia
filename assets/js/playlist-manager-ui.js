// playlist-manager-ui.js - UI logic untuk playlist management

class PlaylistManagerUI {
    constructor(channelManager) {
        this.channelManager = channelManager;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Status tab
        document.getElementById('playlistModal').addEventListener('show.bs.modal', () => {
            this.updatePlaylistStatus();
            this.renderPlaylistSources();
            this.updateExportStats();
        });

        // Import buttons
        document.getElementById('importUrlBtn').addEventListener('click', () => this.importFromUrl());
        document.getElementById('importFileBtn').addEventListener('click', () => this.importFromFile());

        // Export buttons
        document.getElementById('exportM3uBtn').addEventListener('click', () => this.exportAsM3U());
        document.getElementById('exportJsonBtn').addEventListener('click', () => this.exportAsJSON());

        // Refresh button
        document.getElementById('refreshPlaylistBtn').addEventListener('click', () => this.refreshAll());
    }

    // Update playlist status
    async updatePlaylistStatus() {
        const statusDiv = document.getElementById('playlistStatus');
        const info = this.channelManager.getPlaylistInfo();

        let html = `
            <div class="row mb-3">
                <div class="col-md-6">
                    <div class="card bg-darker border-secondary">
                        <div class="card-body text-center">
                            <h3 class="text-primary">${info.totalChannels}</h3>
                            <small class="text-muted">Total Channels</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card bg-darker border-secondary">
                        <div class="card-body text-center">
                            <h3 class="text-success">${info.enabledPlaylists}/${info.totalPlaylists}</h3>
                            <small class="text-muted">Playlist Diaktifkan</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row mb-3">
                <div class="col-md-6">
                    <div class="card bg-darker border-secondary">
                        <div class="card-body text-center">
                            <h3 class="text-info">${info.countries}</h3>
                            <small class="text-muted">Negara</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card bg-darker border-secondary">
                        <div class="card-body text-center">
                            <h3 class="text-warning">${this.formatSize(this.channelManager.channels.length * 100)}</h3>
                            <small class="text-muted">Approx. Size</small>
                        </div>
                    </div>
                </div>
            </div>

            <hr>

            <h6>Detail Playlist:</h6>
            <div id="playlistDetails"></div>
        `;

        statusDiv.innerHTML = html;

        // Render details
        const detailsDiv = document.getElementById('playlistDetails');
        info.playlists.forEach(playlist => {
            const template = document.getElementById('statusItemTemplate').content.cloneNode(true);
            template.querySelector('.playlist-name').textContent = playlist.name;
            template.querySelector('.playlist-description').textContent = playlist.description;
            template.querySelector('.playlist-channels').textContent = playlist.channels;
            template.querySelector('.playlist-country').textContent = playlist.country;
            template.querySelector('.status-badge').textContent = playlist.channels > 0 ? '●' : '○';
            template.querySelector('.status-badge').className = 
                'status-badge badge ' + (playlist.channels > 0 ? 'loaded' : 'pending');
            
            detailsDiv.appendChild(template);
        });
    }

    // Render playlist sources untuk toggle
    renderPlaylistSources() {
        const sourcesDiv = document.getElementById('playlistSources');
        sourcesDiv.innerHTML = '';

        this.channelManager.playlistSources.forEach(source => {
            const template = document.getElementById('sourceItemTemplate').content.cloneNode(true);
            template.querySelector('.source-name').textContent = source.name;
            template.querySelector('.source-description').textContent = source.description;
            template.querySelector('.source-channels').textContent = `${source.channels} channels`;
            
            const toggle = template.querySelector('.source-toggle');
            toggle.checked = source.enabled;
            toggle.dataset.sourceId = source.id;
            
            toggle.addEventListener('change', (e) => {
                this.channelManager.togglePlaylist(source.id);
                this.updatePlaylistStatus();
                // Optional: trigger reload
                console.log(`Playlist ${source.name} toggled: ${e.target.checked}`);
            });

            sourcesDiv.appendChild(template);
        });
    }

    // Import dari URL
    async importFromUrl() {
        const url = document.getElementById('playlistUrl').value;
        
        if (!url) {
            this.showImportStatus('error', 'Silakan masukkan URL playlist');
            return;
        }

        this.showImportStatus('loading', 'Mengimport playlist...');

        const result = await this.channelManager.importCustomPlaylist(url);
        
        if (result.success) {
            this.showImportStatus('success', result.message);
            document.getElementById('playlistUrl').value = '';
            
            // Update UI
            setTimeout(() => {
                this.updatePlaylistStatus();
                this.renderPlaylistSources();
            }, 500);
        } else {
            this.showImportStatus('error', result.message);
        }
    }

    // Import dari File
    async importFromFile() {
        const fileInput = document.getElementById('playlistFile');
        
        if (!fileInput.files.length) {
            this.showImportStatus('error', 'Silakan pilih file playlist');
            return;
        }

        this.showImportStatus('loading', 'Mengimport file...');

        const result = await this.channelManager.importM3UFile(fileInput.files[0]);
        
        if (result.success) {
            this.showImportStatus('success', result.message);
            fileInput.value = '';
            
            // Update UI
            setTimeout(() => {
                this.updatePlaylistStatus();
                this.renderPlaylistSources();
            }, 500);
        } else {
            this.showImportStatus('error', result.message);
        }
    }

    // Show import status message
    showImportStatus(type, message) {
        const statusDiv = document.getElementById('importStatus');
        const alertClass = {
            'loading': 'alert-info',
            'success': 'alert-success',
            'error': 'alert-danger'
        }[type];

        statusDiv.innerHTML = `
            <div class="alert ${alertClass}" role="alert">
                ${type === 'loading' ? '<div class="spinner-border spinner-border-sm me-2"></div>' : ''}
                ${type === 'success' ? '<i class="bi bi-check-circle"></i> ' : ''}
                ${type === 'error' ? '<i class="bi bi-exclamation-circle"></i> ' : ''}
                ${message}
            </div>
        `;

        if (type !== 'loading') {
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 3000);
        }
    }

    // Export as M3U
    exportAsM3U() {
        this.channelManager.downloadM3U(`iptv-playlist-${new Date().getTime()}.m3u8`);
    }

    // Export as JSON
    exportAsJSON() {
        const jsonData = JSON.stringify(this.channelManager.channels, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `iptv-channels-${new Date().getTime()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Update export statistics
    updateExportStats() {
        const statsDiv = document.getElementById('exportStats');
        const info = this.channelManager.getPlaylistInfo();

        statsDiv.innerHTML = `
            <table class="table table-sm table-dark border-secondary">
                <tr>
                    <td>Total Channels:</td>
                    <td><strong>${info.totalChannels}</strong></td>
                </tr>
                <tr>
                    <td>Total Negara:</td>
                    <td><strong>${info.countries}</strong></td>
                </tr>
                <tr>
                    <td>Playlist Aktif:</td>
                    <td><strong>${info.enabledPlaylists}/${info.totalPlaylists}</strong></td>
                </tr>
                <tr>
                    <td>Format M3U:</td>
                    <td><small>Kompatibel dengan VLC, Kodi, dan IPTV players</small></td>
                </tr>
                <tr>
                    <td>Format JSON:</td>
                    <td><small>Untuk import kembali atau backup</small></td>
                </tr>
            </table>
        `;
    }

    // Refresh all playlists
    async refreshAll() {
        const btn = document.getElementById('refreshPlaylistBtn');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner-border spinner-border-sm me-2"></div>Loading...';

        try {
            await this.channelManager.refreshAllPlaylists();
            
            this.updatePlaylistStatus();
            this.renderPlaylistSources();
            
            alert('✓ Semua playlist berhasil di-refresh!');
        } catch (error) {
            alert('✗ Gagal me-refresh playlist: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh Semua';
        }
    }

    // Format file size
    formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

// Export
window.PlaylistManagerUI = PlaylistManagerUI;