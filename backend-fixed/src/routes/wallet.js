const express = require('express');
const router  = express.Router();
const Wallet  = require('../models/Wallet');
const { protect, requireRole } = require('../middleware/auth');

// GET /api/wallet – get current user's wallet
router.get('/', protect, async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.user._id });
    if (!wallet) {
      wallet = await Wallet.create({
        userId: req.user._id,
        balance: 0,
        transactions: [],
      });
    }
    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/wallet/add – add money to wallet
router.post('/add', protect, async (req, res) => {
  try {
    const { amount, payMethod } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // In production, integrate a payment gateway (Razorpay/Stripe) here
    // For now, we trust the request (demo mode)
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.user._id },
      {
        $inc: { balance: amount },
        $push: {
          transactions: {
            type: 'credit',
            amount,
            desc: `Wallet top-up via ${payMethod || 'UPI'}`,
          },
        },
      },
      { new: true, upsert: true }
    );

    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/wallet/redeem-points – convert loyalty points to wallet cash
router.post('/redeem-points', protect, requireRole('customer'), async (req, res) => {
  try {
    const { points } = req.body;
    if (!points || points < 100) {
      return res.status(400).json({ success: false, message: 'Minimum 100 points to redeem' });
    }

    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    if (user.points < points) {
      return res.status(400).json({ success: false, message: 'Not enough points' });
    }

    const cashValue = Math.floor(points / 10); // 10 pts = ₹1

    await User.findByIdAndUpdate(req.user._id, { $inc: { points: -points } });
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.user._id },
      {
        $inc: { balance: cashValue },
        $push: { transactions: { type: 'credit', amount: cashValue, desc: `Redeemed ${points} loyalty points` } },
      },
      { new: true, upsert: true }
    );

    res.json({ success: true, wallet, cashValue, pointsUsed: points });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/wallet/admin/:userId – admin view any user's wallet
router.get('/admin/:userId', protect, requireRole('admin'), async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.params.userId }).populate('userId', 'name email');
    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });
    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
