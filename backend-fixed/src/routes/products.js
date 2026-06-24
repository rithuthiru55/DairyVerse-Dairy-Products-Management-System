const express  = require('express');
const router   = express.Router();
const Product  = require('../models/Product');
const { protect, requireRole } = require('../middleware/auth');

// GET /api/products – public listing
router.get('/', async (req, res) => {
  try {
    const { category, search, sort = 'name' } = req.query;
    const filter = { isActive: true };
    if (category && category !== 'All') filter.category = category;
    if (search) filter.name = { $regex: search, $options: 'i' };

    const sortMap = {
      name:       { name: 1 },
      price_asc:  { price: 1 },
      price_desc: { price: -1 },
      rating:     { rating: -1 },
    };

    const products = await Product.find(filter).sort(sortMap[sort] || { name: 1 });
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/products – vendor submits, admin creates
router.post('/', protect, requireRole('vendor', 'admin'), async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, vendorId: req.user._id });
    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/products/:id – admin or owning vendor
router.put('/:id', protect, requireRole('vendor', 'admin'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    // Vendors can only edit their own products
    if (req.user.role === 'vendor' && String(product.vendorId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not your product' });
    }

    const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/products/:id – admin only
router.delete('/:id', protect, requireRole('admin'), async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Product deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/products/:id/reviews – authenticated customer
router.post('/:id/reviews', protect, requireRole('customer'), async (req, res) => {
  try {
    const { rating, text, orderId } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

    product.reviews.push({
      userId: req.user._id,
      userName: req.user.name,
      orderId,
      rating,
      text,
    });
    // Recalculate average rating
    const avg = product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length;
    product.rating = Math.round(avg * 10) / 10;
    await product.save();

    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
