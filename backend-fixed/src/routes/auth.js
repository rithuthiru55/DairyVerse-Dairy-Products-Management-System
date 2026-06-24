'use strict';

/**
 * Auth Routes – Production Ready
 * ──────────────────────────────
 * POST /api/auth/register          – Register new user
 * POST /api/auth/login             – Login (step 1: credentials)
 * POST /api/auth/send-otp          – Send/resend OTP (SMS + Email) for login
 * POST /api/auth/verify-otp        – Verify login OTP → issue JWT
 * POST /api/auth/verify-email      – Verify email address OTP
 * POST /api/auth/resend-otp        – Resend any OTP type
 * POST /api/auth/forgot-password   – Send password-reset OTP
 * POST /api/auth/reset-password    – Verify reset OTP + set new password
 * GET  /api/auth/me                – Get current user (protected)
 * PUT  /api/auth/profile           – Update profile (protected)
 */

const express     = require('express');
const router      = express.Router();
const jwt         = require('jsonwebtoken');
const rateLimit   = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const User        = require('../models/User');
const Wallet      = require('../models/Wallet');
const Referral    = require('../models/Referral');
const { protect } = require('../middleware/auth');
const { createAndSendOTP, verifyOTP, normalisePhone } = require('../services/otpService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function handleValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors:  errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  return null;
}

const catchAsync = fn => (req, res, next) => fn(req, res, next).catch(next);

// ─── Rate Limiters ────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message:  { success: false, message: 'Too many requests. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max:      5,
  message:  { success: false, message: 'Too many OTP requests. Please wait before requesting again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── Reusable validators ──────────────────────────────────────────────────────

const phoneVal    = body('phone').notEmpty().withMessage('Phone number is required').matches(/^[+]?[0-9]{10,15}$/).withMessage('Invalid phone number format');
const emailVal    = body('email').notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email address').normalizeEmail();
const passwordVal = body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters').matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter').matches(/[0-9]/).withMessage('Password must contain at least one number');

// ─── POST /api/auth/register ──────────────────────────────────────────────────

router.post('/register', authLimiter, [
  body('firstName').notEmpty().trim().withMessage('First name is required'),
  body('lastName').notEmpty().trim().withMessage('Last name is required'),
  emailVal, phoneVal, passwordVal,
  body('role').optional().isIn(['customer', 'vendor', 'admin']).withMessage('Invalid role'),
], catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const {
    firstName, lastName, email, phone, password,
    role = 'customer', address, city, state, pin, landmark,
    gender, dob, storeName, bizType, gst, fssai,
    dept, empId, referralCode: usedCode, adminCode,
  } = req.body;

  if (role === 'admin' && (!adminCode || adminCode !== process.env.ADMIN_REGISTRATION_CODE)) {
    return res.status(403).json({ success: false, message: 'Invalid admin authorisation code.' });
  }

  const normPhone = normalisePhone(phone);
  const existing  = await User.findOne({ $or: [{ email }, { phone: normPhone }] });
  if (existing) {
    const field = existing.email === email ? 'Email' : 'Phone number';
    return res.status(409).json({ success: false, message: `${field} is already registered.` });
  }

  const refCode = firstName.toUpperCase().slice(0, 3) + Math.floor(Math.random() * 9000 + 1000);

  const user = await User.create({
    firstName, lastName, email, phone: normPhone, password, role,
    address, city, state, pin, landmark, gender, dob,
    storeName, bizType, gst, fssai, dept, empId,
    referralCode: refCode, usedReferralCode: usedCode || '',
    points: 0, tier: 'Basic', emailVerified: false,
  });

  const wallet = await Wallet.create({
    userId: user._id, balance: 500,
    transactions: [{ type: 'credit', amount: 500, desc: 'Welcome bonus', date: new Date() }],
  });

  if (usedCode) {
    const referrer = await User.findOne({ referralCode: usedCode.toUpperCase() });
    if (referrer) {
      wallet.balance += 50;
      wallet.transactions.push({ type: 'credit', amount: 50, desc: 'Referral welcome bonus' });
      user.points = 50;
      await Promise.all([wallet.save(), user.save()]);
      await Promise.all([
        Wallet.findOneAndUpdate({ userId: referrer._id }, {
          $inc:  { balance: 100 },
          $push: { transactions: { type: 'credit', amount: 100, desc: `Referral bonus – ${user.name} joined` } },
        }, { new: true, upsert: true }),
        User.findByIdAndUpdate(referrer._id, { $inc: { points: 200, referralCount: 1 } }),
        Referral.create({ referrerId: referrer._id, referralCode: usedCode, refereeEmail: email, refereeName: user.name, status: 'completed', reward: 100 }),
      ]);
    }
  }

  // Send verification OTP (non-fatal if fails)
  try {
    await createAndSendOTP({ type: 'verify_email', identifier: email, email, phone: normPhone, userName: firstName, channel: 'both' });
  } catch (otpErr) {
    console.error('[Register] OTP send error:', otpErr.message);
  }

  res.status(201).json({
    success: true,
    message: 'Registration successful. An OTP has been sent to your phone and email for verification.',
    token:   signToken(user._id),
    user:    user.toJSON(),
  });
}));

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', authLimiter, [emailVal, body('password').notEmpty().withMessage('Password is required')],
catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  await createAndSendOTP({
    type: 'login', identifier: String(user._id),
    phone: user.phone, email: user.email, userName: user.firstName, channel: 'both',
  });

  res.json({
    success: true,
    message: 'OTP sent to your registered phone number and email address.',
    userId:  user._id,
  });
}));

// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────

router.post('/send-otp', otpLimiter, [body('userId').notEmpty().withMessage('userId is required')],
catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const { userId, channel } = req.body;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

  const result = await createAndSendOTP({
    type: 'login', identifier: String(user._id),
    phone: user.phone, email: user.email, userName: user.firstName, channel: channel || 'both',
  });

  res.json({ success: true, message: `OTP sent via: ${result.channels.join(', ')}.`, channels: result.channels });
}));

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────

router.post('/verify-otp', otpLimiter, [
  body('userId').notEmpty().withMessage('userId is required'),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
], catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const { userId, otp } = req.body;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

  await verifyOTP('login', String(userId), otp);

  res.json({ success: true, message: 'Login successful.', token: signToken(user._id), user: user.toJSON() });
}));

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────

router.post('/verify-email', otpLimiter, [
  emailVal,
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
], catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const { email, otp } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ success: false, message: 'No account found with this email.' });

  await verifyOTP('verify_email', email, otp);
  await User.findByIdAndUpdate(user._id, { emailVerified: true });

  res.json({ success: true, message: 'Email verified successfully.' });
}));

// ─── POST /api/auth/resend-otp ───────────────────────────────────────────────

router.post('/resend-otp', otpLimiter, [
  body('type').isIn(['login', 'forgot', 'verify_email']).withMessage('Invalid OTP type'),
  body('identifier').notEmpty().withMessage('identifier is required'),
], catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const { type, identifier, channel } = req.body;
  const user = type === 'login'
    ? await User.findById(identifier)
    : await User.findOne({ email: identifier.toLowerCase() });

  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

  const actualId = type === 'login' ? String(user._id) : user.email;
  const result   = await createAndSendOTP({
    type, identifier: actualId,
    phone: user.phone, email: user.email, userName: user.firstName, channel: channel || 'both',
  });

  res.json({ success: true, message: `OTP resent via: ${result.channels.join(', ')}.`, channels: result.channels });
}));

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

router.post('/forgot-password', otpLimiter, [emailVal],
catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const { email, channel } = req.body;
  const GENERIC_MSG = 'If an account exists for this email, an OTP has been sent to the registered phone and email.';

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return res.json({ success: true, message: GENERIC_MSG }); // prevent enumeration

  await createAndSendOTP({
    type: 'forgot', identifier: user.email,
    phone: user.phone, email: user.email, userName: user.firstName, channel: channel || 'both',
  });

  res.json({ success: true, message: GENERIC_MSG });
}));

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post('/reset-password', otpLimiter, [
  emailVal,
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters').matches(/[A-Z]/).withMessage('Needs one uppercase letter').matches(/[0-9]/).withMessage('Needs one number'),
], catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const { email, otp, newPassword } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) return res.status(404).json({ success: false, message: 'No account found with this email.' });

  await verifyOTP('forgot', user.email, otp);

  const isSame = await user.comparePassword(newPassword);
  if (isSame) return res.status(400).json({ success: false, message: 'New password must be different from current password.' });

  user.password = newPassword;
  await user.save();

  res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
}));

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', protect, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────

router.put('/profile', protect, [
  body('phone').optional().matches(/^[+]?[0-9]{10,15}$/).withMessage('Invalid phone number'),
  body('email').optional().isEmail().withMessage('Invalid email').normalizeEmail(),
], catchAsync(async (req, res) => {
  const validErr = handleValidationErrors(req, res);
  if (validErr) return;

  const ALLOWED = ['firstName', 'lastName', 'phone', 'address', 'city', 'state', 'pin', 'landmark', 'gender', 'dob', 'storeName', 'bizType'];
  const updates = {};
  ALLOWED.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (updates.phone) updates.phone = normalisePhone(updates.phone);
  if (updates.firstName || updates.lastName) {
    const u  = await User.findById(req.user._id);
    updates.name = `${updates.firstName || u.firstName} ${updates.lastName || u.lastName}`;
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  res.json({ success: true, user: user.toJSON() });
}));

module.exports = router;
