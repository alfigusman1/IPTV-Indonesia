const router = require('express').Router();
const channelRepo = require('../repositories/channelRepository');

// GET /api/channels — hanya channel status='active' (yang jalan). Filter opsional.
router.get('/channels', async (req, res) => {
  try {
    const { category, country, search, limit, offset } = req.query;
    const channels = await channelRepo.listActive({
      category: category || null,
      country: country || null,
      search: search || null,
      limit: Math.min(parseInt(limit, 10) || 1000, 5000),
      offset: parseInt(offset, 10) || 0,
    });
    res.json({ success: true, count: channels.length, data: channels });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/channels/:id
router.get('/channels/:id', async (req, res) => {
  try {
    const ch = await channelRepo.getById(parseInt(req.params.id, 10));
    if (!ch || ch.status !== 'active') return res.status(404).json({ success: false, message: 'Channel tidak ditemukan atau tidak aktif.' });
    res.json({ success: true, data: ch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/categories — kategori yang punya channel aktif.
router.get('/categories', async (_req, res) => {
  try {
    res.json({ success: true, data: await channelRepo.distinctCategories() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/countries — negara yang punya channel aktif.
router.get('/countries', async (_req, res) => {
  try {
    res.json({ success: true, data: await channelRepo.distinctCountries() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/stats — ringkasan status katalog.
router.get('/stats', async (_req, res) => {
  try {
    res.json({ success: true, data: await channelRepo.countByStatus() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
