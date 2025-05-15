<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IPTV Player</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <style>
        body {
            background-color: #000;
            color: #fff;
        }
        .container {
            margin-top: 20px;
        }
        video {
            width: 100%;
            border: 2px solid #fff;
        }
        .list-group-item {
            cursor: pointer;
            display: flex;
            align-items: center;
        }
        .active-channel {
            background-color: #007bff !important;
            color: #fff !important;
        }
        .inactive-channel {
            background-color: #ff0000 !important;
            color: #fff !important;
        }
        .category-title {
            background-color: #333;
            color: #fff;
            padding: 10px;
            margin-top: 10px;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2 class="text-center">IPTV Player</h2>
        <div class="row">
            <div class="col-md-3">
                <h4>Channel List</h4>
                <input type="text" id="searchChannel" class="form-control mb-3" placeholder="Cari channel...">
                <ul class="list-group" id="channelList"></ul>
            </div>
            <div class="col-md-9">
                <video id="iptvPlayer" controls autoplay class="w-100"></video>
                <h4 class="text-center mt-2" id="channelName">No Channel Selected</h4>
                <div class="d-flex justify-content-between mt-2">
                    <button class="btn btn-secondary" id="prevChannel">Previous</button>
                    <button class="btn btn-warning" id="reportChannel">Report</button>
                    <button class="btn btn-secondary" id="nextChannel">Next</button>
                    <button class="btn btn-info" id="toggleCheck">Pengecekan: OFF</button>
                    <button class="btn btn-success" id="generateM3U">Generate M3U</button>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        const video = document.getElementById('iptvPlayer');
        const channelList = document.getElementById('channelList');
        const prevButton = document.getElementById('prevChannel');
        const nextButton = document.getElementById('nextChannel');
        const reportButton = document.getElementById('reportChannel');
        const toggleButton = document.getElementById('toggleCheck');
        const searchInput = document.getElementById('searchChannel');
        const channelNameDisplay = document.getElementById('channelName');
        const m3uUrls = [
            'https://raw.githubusercontent.com/emonnaja/indonesian-IPTV/main/index.m3u',
            'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/id.m3u'
        ];
        let channels = {};
        let channelKeys = [];
        let currentChannelIndex = 0;
        let failedChannels = new Set();
        let isVideoStuck = false;
        let checkInterval;
        let stuckTimeout;
        let isCheckingEnabled = false; // Default pengecekan OFF

        async function loadFailedChannels() {
            try {
                const response = await fetch('report.json');
                const data = await response.json();
                failedChannels = new Set(data);
            } catch (error) {
                console.error('Gagal memuat laporan:', error);
            }
        }

        function saveFailedChannel(channelName) {
            failedChannels.add(channelName);
            fetch('save_report.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: channelName })
            });
        }

        async function removeFromReport(channelName) {
            try {
                const response = await fetch('remove_report.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel: channelName })
                });
                if (response.ok) {
                    failedChannels.delete(channelName);
                    displayChannels();
                }
            } catch (error) {
                console.error('Gagal menghapus dari laporan:', error);
            }
        }

        function checkStreamHealth() {
            if (!isCheckingEnabled) return;

            if (!isVideoStuck) {
                const channelName = channelKeys[currentChannelIndex];
                if (failedChannels.has(channelName)) {
                    removeFromReport(channelName);
                }
            }
        }

        function toggleChecking() {
            isCheckingEnabled = !isCheckingEnabled;
            toggleButton.textContent = `Pengecekan: ${isCheckingEnabled ? 'ON' : 'OFF'}`;

            if (isCheckingEnabled) {
                startStuckDetection();
            } else {
                clearInterval(checkInterval);
                clearTimeout(stuckTimeout);
            }
        }

        toggleButton.onclick = toggleChecking;

        function playStream(url, channelName) {
            video.src = '';
            video.load();
            video.onerror = () => {
                if (isCheckingEnabled) {
                    saveFailedChannel(channelName);
                    nextChannel();
                }
            };
            if (Hls.isSupported() && url.endsWith('.m3u8')) {
                const hls = new Hls();
                hls.loadSource(url);
                hls.attachMedia(video);
            } else {
                video.src = url;
                video.play();
            }
            channelNameDisplay.textContent = channelName;
            displayChannels();
            startStuckDetection(); // Mulai pengecekan saat pindah channel
        }

        function startStuckDetection() {
            if (!isCheckingEnabled) return;

            // Hentikan interval dan timeout sebelumnya (jika ada)
            clearInterval(checkInterval);
            clearTimeout(stuckTimeout);

            // Set timeout untuk menandai stream sebagai "stuck" setelah 30 detik
            stuckTimeout = setTimeout(() => {
                if (video.paused || video.readyState < 3 || video.buffered.length === 0) {
                    // Jika video masih belum berjalan setelah 30 detik, tandai sebagai "stuck"
                    isVideoStuck = true;
                    const channelName = channelKeys[currentChannelIndex];
                    saveFailedChannel(channelName);
                    nextChannel(); // Hanya pindah ke channel berikutnya jika stream stuck
                }
            }, 30000); // 30 detik timeout
        }

        video.addEventListener('play', () => {
            if (isCheckingEnabled) {
                // Hentikan pengecekan jika stream sudah bisa diputar
                clearInterval(checkInterval);
                clearTimeout(stuckTimeout);
                console.log("Stream aktif, pengecekan dihentikan.");
                // Tidak ada nextChannel() di sini, biarkan stream tetap diputar
            }
        });

        video.addEventListener('progress', () => {
            if (isVideoStuck) {
                isVideoStuck = false;
                startStuckDetection();
            }
        });

        video.addEventListener('waiting', () => {
            isVideoStuck = true;
            startStuckDetection();
        });

        video.addEventListener('stalled', () => {
            isVideoStuck = true;
            startStuckDetection();
        });

        function nextChannel() {
            if (currentChannelIndex < channelKeys.length - 1) {
                currentChannelIndex++;
            } else {
                currentChannelIndex = 0;
            }
            playStream(channels[channelKeys[currentChannelIndex]][0].url, channelKeys[currentChannelIndex]);
        }

        function prevChannel() {
            if (currentChannelIndex > 0) {
                currentChannelIndex--;
            } else {
                currentChannelIndex = channelKeys.length - 1;
            }
            playStream(channels[channelKeys[currentChannelIndex]][0].url, channelKeys[currentChannelIndex]);
        }

        prevButton.onclick = prevChannel;
        nextButton.onclick = nextChannel;

        reportButton.onclick = () => {
            const channelName = channelKeys[currentChannelIndex];
            saveFailedChannel(channelName);
            displayChannels();
            nextChannel();
        };

        function generateM3U() {
            let m3uContent = "#EXTM3U\n"; // Header file M3U

            channelKeys.forEach((channelName) => {
                if (!failedChannels.has(channelName)) {
                    const channel = channels[channelName][0];
                    const group = channel.group || 'Uncategorized';
                    const logo = channel.logo || ''; // Jika ada link logo
                    const url = channel.url;

                    // Format #EXTINF dengan logo dan kategori
                    m3uContent += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${channelName}\n`;
                    m3uContent += `${url}\n`;
                }
            });

            // Buat file dan unduh
            const blob = new Blob([m3uContent], { type: 'application/x-mpegURL' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'index.m3u';
            a.click();
            URL.revokeObjectURL(url);
        }

        document.getElementById('generateM3U').onclick = generateM3U;

        searchInput.addEventListener('input', () => {
            displayChannels();
        });

        async function loadAllM3Us() {
            await loadFailedChannels();
            await Promise.all(m3uUrls.map(fetchM3U));
            displayChannels();
            if (channelKeys.length > 0) {
                playStream(channels[channelKeys[0]][0].url, channelKeys[0]);
            }
        }

        async function fetchM3U(url) {
            try {
                const response = await fetch(url);
                const text = await response.text();
                parseM3U(text);
            } catch (error) {
                console.error('Gagal mengambil daftar IPTV:', error);
            }
        }

        function parseM3U(m3uText) {
            const lines = m3uText.split('\n');
            let currentChannel = {};
            
            for (let line of lines) {
                line = line.trim();
                if (line.startsWith('#EXTINF')) {
                    const nameMatch = line.match(/,(.+)$/);
                    const groupMatch = line.match(/group-title="(.+?)"/);
                    const logoMatch = line.match(/tvg-logo="(.+?)"/);
                    if (nameMatch) {
                        currentChannel.name = nameMatch[1];
                    }
                    if (groupMatch) {
                        currentChannel.group = groupMatch[1];
                    }
                    if (logoMatch) {
                        currentChannel.logo = logoMatch[1];
                    }
                } else if (line.startsWith('http')) {
                    currentChannel.url = line;
                    if (currentChannel.name && currentChannel.url) {
                        if (!channels[currentChannel.name]) {
                            channels[currentChannel.name] = [];
                        }
                        channels[currentChannel.name].push({ 
                            url: currentChannel.url, 
                            group: currentChannel.group, 
                            logo: currentChannel.logo 
                        });
                    }
                    currentChannel = {};
                }
            }
        }

        function displayChannels() {
            channelList.innerHTML = '';
            const searchQuery = searchInput.value.toLowerCase();
            const groupedChannels = {};

            // Kelompokkan channel berdasarkan kategori
            channelKeys = Object.keys(channels);
            channelKeys.forEach((channelName) => {
                const channel = channels[channelName][0];
                const group = channel.group || 'Uncategorized';
                if (!groupedChannels[group]) {
                    groupedChannels[group] = [];
                }
                groupedChannels[group].push({ name: channelName, url: channel.url });
            });

            // Tampilkan channel berdasarkan kategori
            Object.keys(groupedChannels).forEach((group) => {
                const categoryTitle = document.createElement('div');
                categoryTitle.classList.add('category-title');
                categoryTitle.textContent = group;
                channelList.appendChild(categoryTitle);

                groupedChannels[group].forEach((channel) => {
                    if (channel.name.toLowerCase().includes(searchQuery)) {
                        const listItem = document.createElement('li');
                        listItem.classList.add('list-group-item', 'list-group-item-action', 'bg-dark', 'text-white');
                        if (failedChannels.has(channel.name)) {
                            listItem.classList.add('inactive-channel');
                        }
                        if (channel.name === channelKeys[currentChannelIndex]) {
                            listItem.classList.add('active-channel');
                        }
                        listItem.textContent = channel.name;
                        listItem.onclick = () => {
                            currentChannelIndex = channelKeys.indexOf(channel.name);
                            playStream(channel.url, channel.name);
                        };
                        channelList.appendChild(listItem);
                    }
                });
            });

            // Matikan pengecekan jika semua channel sudah diperiksa
            if (failedChannels.size === channelKeys.length) {
                toggleChecking();
            }
        }

        loadAllM3Us();
    </script>
</body>
