const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Referral= require('../models/Referral');
const Subscription = require('../models/Subscription');
const { protect, requireRole } = require('../middleware/auth');

// GET /api/users – admin gets all users
router.get('/', protect, requireRole('admin'), async (req, res) => {
  try {
    const { role, search } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/vendors – public list of verified vendors (for customers to chat with)
router.get('/vendors', protect, async (req, res) => {
  try {
    const vendors = await User.find({ role: 'vendor', verified: true }).select('name storeName bizType');
    res.json({ success: true, vendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/:id – admin or self
router.get('/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && String(req.user._id) !== req.params.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/users/:id – admin update any user (verify vendor, change tier, etc.)
router.put('/:id', protect, requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/users/referrals/invite – send referral invite email
router.post('/referrals/invite', protect, requireRole('customer'), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email address is required' });
    }

    const referrer = req.user;
    const code = referrer.referralCode;
    if (!code) {
      return res.status(400).json({ success: false, message: 'No referral code found for your account' });
    }

    // Check if already invited
    const existing = await Referral.findOne({ referrerId: referrer._id, refereeEmail: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already invited this email address' });
    }

    // Create pending referral record
    const referral = await Referral.create({
      referrerId: referrer._id,
      referralCode: code,
      refereeEmail: email.toLowerCase(),
      status: 'pending',
      reward: 100,
    });

    // Send invite email (non-fatal if fails)
    try {
      const { sendReferralInviteEmail } = require('../services/otpService');
      if (typeof sendReferralInviteEmail === 'function') {
        await sendReferralInviteEmail({ email, referrerName: referrer.name || referrer.firstName, code });
      }
    } catch (emailErr) {
      console.warn('[Referral] Email send failed (non-fatal):', emailErr.message);
    }

    res.status(201).json({ success: true, referral, message: `Invite sent to ${email}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/referrals/mine – get current user's referrals
router.get('/referrals/mine', protect, async (req, res) => {
  try {
    const referrals = await Referral.find({ referrerId: req.user._id }).sort({ date: -1 });
    res.json({ success: true, referrals, referralCode: req.user.referralCode });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/subscriptions/mine
router.get('/subscriptions/mine', protect, requireRole('customer'), async (req, res) => {
  try {
    const subs = await Subscription.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, subs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/users/subscriptions
router.post('/subscriptions', protect, requireRole('customer'), async (req, res) => {
  try {
    const sub = await Subscription.create({ userId: req.user._id, ...req.body });
    res.status(201).json({ success: true, sub });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH /api/users/subscriptions/:id
router.patch('/subscriptions/:id', protect, requireRole('customer'), async (req, res) => {
  try {
    const sub = await Subscription.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true }
    );
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    res.json({ success: true, sub });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
