const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const app = express();

// helmet dengan CSP dimatikan (frontend memuat CDN Bootstrap/Video.js/HLS.js).
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
const origins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : {}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('tiny'));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'iptv-server', uptime: process.uptime() }));

// API
app.use('/api', require('./routes/channels'));
app.use('/api/admin', require('./routes/admin'));

// Frontend statis (di-serve backend). Root repo iptv = server/../ ; simpan salinan
// frontend di server/public agar image Docker mandiri, fallback ke root repo saat dev.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

module.exports = app;
