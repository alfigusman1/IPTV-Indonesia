const router = require('express').Router();
const { importAll } = require('../services/importer');
const { checkAll } = require('../services/healthChecker');
const channelRepo = require('../repositories/channelRepository');
const sourceRepo = require('../repositories/sourceRepository');

// Proteksi ringan: header x-admin-token harus cocok ADMIN_TOKEN (bila diset).
router.use((req, res, next) => {
  const token = process.env.ADMIN_TOKEN;
  if (token && req.headers['x-admin-token'] !== token) {
    return res.status(401).json({ success: false, message: 'Token admin tidak valid.' });
  }
  next();
});

// GET /api/admin/sources
router.get('/sources', async (_req, res) => {
  try { res.json({ success: true, data: await sourceRepo.getAll() }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/admin/import — trigger import semua sumber sekarang.
router.post('/import', async (_req, res) => {
  try {
    const r = await importAll();
    const stat = await channelRepo.countByStatus();
    res.json({ success: true, data: { import: r, stats: stat } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/admin/check — trigger health-check sekarang.
router.post('/check', async (req, res) => {
  try {
    const limit = parseInt(req.body?.limit, 10) || 5000;
    const r = await checkAll({ limit });
    const stat = await channelRepo.countByStatus();
    res.json({ success: true, data: { check: r, stats: stat } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/admin/sources — tambah sumber baru.
router.post('/sources', async (req, res) => {
  try {
    const { name, url, type, countryCode, priority, enabled } = req.body || {};
    if (!name || !url) return res.status(400).json({ success: false, message: 'name dan url wajib.' });
    const row = await sourceRepo.upsert({ name, url, type, countryCode, priority, enabled: enabled === false ? 0 : 1 });
    res.status(201).json({ success: true, data: row });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
