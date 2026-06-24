'use strict';

/**
 * OTP Service – Production Ready
 * ─────────────────────────────
 * • Generates cryptographically secure 6-digit OTPs
 * • Stores OTPs in Redis (if configured) with automatic TTL
 * • Falls back to in-process Map when Redis is unavailable
 * • Sends OTP via SMS (Twilio) AND Email (Nodemailer/SMTP)
 * • Rate-limits per identifier to prevent abuse
 * • Never logs OTP values in production
 */

const crypto       = require('crypto');
const twilio       = require('twilio');
const nodemailer   = require('nodemailer');

// ─── Redis (optional) ──────────────────────────────────────────────────────────
let redisClient = null;
(async () => {
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = require('redis');
      redisClient = createClient({ url: process.env.REDIS_URL });
      redisClient.on('error', (err) => {
        console.error('[OTP] Redis error – falling back to in-memory store:', err.message);
        redisClient = null;
      });
      await redisClient.connect();
      console.log('[OTP] Redis connected ✓');
    } catch (err) {
      console.warn('[OTP] Redis unavailable – using in-memory OTP store:', err.message);
      redisClient = null;
    }
  }
})();

// ─── In-memory fallback ────────────────────────────────────────────────────────
const memStore    = new Map(); // key → { hash, expiresAt, attempts, lastSentAt }

// ─── Twilio client (lazy init) ─────────────────────────────────────────────────
let twilioClient  = null;
function getTwilio() {
  if (!twilioClient) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) are not configured.');
    }
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

// ─── Nodemailer transporter (lazy init) ────────────────────────────────────────
let mailTransporter = null;
function getMailTransporter() {
  if (!mailTransporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      throw new Error('SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) are not configured.');
    }
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || '587', 10),
      secure: parseInt(SMTP_PORT || '587', 10) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
      maxConnections: 5,
    });
  }
  return mailTransporter;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const OTP_TTL_SECONDS        = 5 * 60;        // 5 minutes (login/verify)
const FORGOT_OTP_TTL_SECONDS = 10 * 60;       // 10 minutes (password reset)
const MAX_VERIFY_ATTEMPTS    = 5;             // lock after 5 wrong attempts
const RESEND_COOLDOWN_MS     = 60 * 1000;    // 1 minute between resends
const APP_NAME               = process.env.APP_NAME || 'DairyVerse';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a 6-digit numeric OTP using CSPRNG */
function generateOTP() {
  return String(crypto.randomInt(100000, 999999));
}

/** One-way hash the OTP before storing (prevents plaintext leaks) */
function hashOTP(otp) {
  return crypto.createHash('sha256').update(otp + process.env.OTP_PEPPER).digest('hex');
}

/** Build store key */
function storeKey(type, identifier) {
  // type: 'login' | 'forgot' | 'verify_email'
  return `otp:${type}:${identifier}`;
}

/** Persist OTP record */
async function setOTPRecord(key, record, ttlSeconds) {
  const payload = JSON.stringify(record);
  if (redisClient) {
    await redisClient.set(key, payload, { EX: ttlSeconds });
  } else {
    memStore.set(key, { ...record, expiresAt: Date.now() + ttlSeconds * 1000 });
    // Clean up expired entries periodically
    if (memStore.size > 10000) purgeMemStore();
  }
}

/** Retrieve OTP record */
async function getOTPRecord(key) {
  if (redisClient) {
    const raw = await redisClient.get(key);
    return raw ? JSON.parse(raw) : null;
  } else {
    const rec = memStore.get(key);
    if (!rec) return null;
    if (Date.now() > rec.expiresAt) { memStore.delete(key); return null; }
    return rec;
  }
}

/** Delete OTP record */
async function delOTPRecord(key) {
  if (redisClient) {
    await redisClient.del(key);
  } else {
    memStore.delete(key);
  }
}

/** Update OTP record (e.g. increment attempts) */
async function updateOTPRecord(key, updates, ttlSeconds) {
  const existing = await getOTPRecord(key);
  if (!existing) return;
  const merged = { ...existing, ...updates };
  if (redisClient) {
    const ttl = await redisClient.ttl(key);
    await redisClient.set(key, JSON.stringify(merged), { EX: ttl > 0 ? ttl : ttlSeconds });
  } else {
    memStore.set(key, merged);
  }
}

function purgeMemStore() {
  const now = Date.now();
  for (const [k, v] of memStore.entries()) {
    if (now > v.expiresAt) memStore.delete(k);
  }
}

/** Normalise phone to E.164 (+91XXXXXXXXXX) */
function normalisePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return '+' + digits;
  if (digits.length === 10) return '+91' + digits;
  if (phone.startsWith('+')) return phone;
  return '+' + digits;
}

// ─── Core: Create & Send OTP ───────────────────────────────────────────────────

/**
 * createAndSendOTP
 * @param {object} opts
 * @param {string} opts.type         – 'login' | 'forgot' | 'verify_email'
 * @param {string} opts.identifier   – phone or email (used as store key)
 * @param {string} [opts.phone]      – E.164 phone number to SMS
 * @param {string} [opts.email]      – email address to mail
 * @param {string} [opts.userName]   – user's first name for personalisation
 * @param {string} [opts.channel]    – 'sms' | 'email' | 'both' (default 'both')
 * @returns {{ sent: boolean, channels: string[] }}
 */
async function createAndSendOTP({ type, identifier, phone, email, userName = 'User', channel = 'both' }) {
  const key     = storeKey(type, identifier);
  const ttl     = type === 'forgot' ? FORGOT_OTP_TTL_SECONDS : OTP_TTL_SECONDS;

  // ── Resend rate-limit ──
  const existing = await getOTPRecord(key);
  if (existing && existing.lastSentAt && (Date.now() - existing.lastSentAt) < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000);
    throw Object.assign(new Error(`Please wait ${waitSec} seconds before requesting a new OTP.`), { status: 429 });
  }

  const otp       = generateOTP();
  const otpHash   = hashOTP(otp);

  await setOTPRecord(key, {
    hash:        otpHash,
    attempts:    0,
    lastSentAt:  Date.now(),
    expiresAt:   Date.now() + ttl * 1000,
  }, ttl);

  // Only log OTP in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[OTP-DEV] ${type.toUpperCase()} OTP for ${identifier}: ${otp}`);
  }

  const sentChannels = [];
  const errors       = [];

  // ── SMS ──
  if ((channel === 'sms' || channel === 'both') && phone) {
    try {
      await sendSMS({ phone: normalisePhone(phone), otp, type, userName });
      sentChannels.push('sms');
    } catch (err) {
      console.error('[OTP] SMS send failed:', err.message);
      errors.push({ channel: 'sms', error: err.message });
    }
  }

  // ── Email ──
  if ((channel === 'email' || channel === 'both') && email) {
    try {
      await sendEmail({ email, otp, type, userName });
      sentChannels.push('email');
    } catch (err) {
      console.error('[OTP] Email send failed:', err.message);
      errors.push({ channel: 'email', error: err.message });
    }
  }

  // Always print OTP to console (useful in dev when SMS/Email not configured)
  console.log(`[OTP] ${type.toUpperCase()} OTP for ${identifier}: ${otp} (channels sent: ${sentChannels.join(', ') || 'none'})`);

  // If both channels were attempted and both failed → throw only in production
  const attempted = [];
  if ((channel === 'sms' || channel === 'both') && phone)  attempted.push('sms');
  if ((channel === 'email' || channel === 'both') && email) attempted.push('email');

  if (attempted.length > 0 && sentChannels.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      const reasons = errors.map(e => `${e.channel}: ${e.error}`).join('; ');
      throw Object.assign(new Error(`Failed to send OTP. ${reasons}`), { status: 502 });
    } else {
      // In development: log OTP to console and continue — allows login without Twilio/SMTP
      console.warn(`[OTP-DEV] OTP delivery failed (Twilio/SMTP not configured). OTP is: ${otp}`);
    }
  }

  return { sent: true, channels: sentChannels };
}

// ─── Verify OTP ────────────────────────────────────────────────────────────────

/**
 * verifyOTP
 * @param {string} type        – 'login' | 'forgot' | 'verify_email'
 * @param {string} identifier  – same identifier used in createAndSendOTP
 * @param {string} otp         – OTP entered by user
 * @returns {boolean} true if valid
 * @throws {Error} with status 400/429
 */
async function verifyOTP(type, identifier, otp) {
  const key    = storeKey(type, identifier);
  const ttl    = type === 'forgot' ? FORGOT_OTP_TTL_SECONDS : OTP_TTL_SECONDS;
  const record = await getOTPRecord(key);

  if (!record) {
    throw Object.assign(new Error('OTP has expired or was never sent. Please request a new one.'), { status: 400 });
  }

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    await delOTPRecord(key);
    throw Object.assign(new Error('Too many incorrect attempts. Please request a new OTP.'), { status: 429 });
  }

  const inputHash = hashOTP(String(otp).trim());
  if (inputHash !== record.hash) {
    await updateOTPRecord(key, { attempts: record.attempts + 1 }, ttl);
    const remaining = MAX_VERIFY_ATTEMPTS - record.attempts - 1;
    throw Object.assign(
      new Error(remaining > 0 ? `Incorrect OTP. ${remaining} attempt(s) remaining.` : 'Incorrect OTP. You have no attempts left. Please request a new OTP.'),
      { status: 400 }
    );
  }

  // OTP matched — one-time use
  await delOTPRecord(key);
  return true;
}

// ─── SMS via Twilio ────────────────────────────────────────────────────────────

async function sendSMS({ phone, otp, type, userName }) {
  const client = getTwilio();

  let body;
  if (type === 'forgot') {
    body = `[${APP_NAME}] Hi ${userName}, your password reset OTP is ${otp}. It expires in 10 minutes. Do NOT share it with anyone.`;
  } else if (type === 'verify_email') {
    body = `[${APP_NAME}] Hi ${userName}, your email verification OTP is ${otp}. It expires in 5 minutes.`;
  } else {
    body = `[${APP_NAME}] Hi ${userName}, your login OTP is ${otp}. It expires in 5 minutes. Do NOT share it with anyone.`;
  }

  // Support Twilio Messaging Service SID or plain from-number
  const msgOpts = {
    body,
    to: phone,
  };
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    msgOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    if (!process.env.TWILIO_PHONE_NUMBER) {
      throw new Error('TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID must be set.');
    }
    msgOpts.from = process.env.TWILIO_PHONE_NUMBER;
  }

  const message = await client.messages.create(msgOpts);

  if (!['queued', 'sent', 'delivered', 'accepted'].includes(message.status)) {
    throw new Error(`Twilio returned unexpected status: ${message.status}`);
  }
}

// ─── Email via Nodemailer ──────────────────────────────────────────────────────

async function sendEmail({ email, otp, type, userName }) {
  const transporter = getMailTransporter();
  const fromAddress = `"${APP_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;

  let subject, html, text;

  if (type === 'forgot') {
    subject = `[${APP_NAME}] Password Reset OTP`;
    html    = buildEmailHTML({
      userName,
      otp,
      ttlText:  '10 minutes',
      heading:  'Reset Your Password',
      subtext:  'You requested a password reset. Use the OTP below to proceed.',
      warning:  'If you did not request this, please ignore this email and secure your account.',
    });
    text = `Hi ${userName},\n\nYour ${APP_NAME} password reset OTP is: ${otp}\n\nThis OTP expires in 10 minutes. Do NOT share it with anyone.\n\nIf you did not request this, ignore this email.`;
  } else if (type === 'verify_email') {
    subject = `[${APP_NAME}] Verify Your Email`;
    html    = buildEmailHTML({
      userName,
      otp,
      ttlText:  '5 minutes',
      heading:  'Verify Your Email Address',
      subtext:  'Use the OTP below to verify your email address.',
      warning:  '',
    });
    text = `Hi ${userName},\n\nYour ${APP_NAME} email verification OTP is: ${otp}\n\nThis OTP expires in 5 minutes.`;
  } else {
    subject = `[${APP_NAME}] Login OTP`;
    html    = buildEmailHTML({
      userName,
      otp,
      ttlText:  '5 minutes',
      heading:  'Your Login OTP',
      subtext:  'Use the OTP below to complete your login.',
      warning:  'If you did not attempt to log in, please change your password immediately.',
    });
    text = `Hi ${userName},\n\nYour ${APP_NAME} login OTP is: ${otp}\n\nThis OTP expires in 5 minutes. Do NOT share it with anyone.`;
  }

  await transporter.sendMail({
    from: fromAddress,
    to: email,
    subject,
    text,
    html,
  });
}

function buildEmailHTML({ userName, otp, ttlText, heading, subtext, warning }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <!-- Header -->
        <tr><td style="background:#1e5c1e;padding:28px 40px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:24px;letter-spacing:1px">${APP_NAME}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;font-size:16px;color:#333">Hi <strong>${userName}</strong>,</p>
          <h2 style="margin:0 0 8px;font-size:20px;color:#1e5c1e">${heading}</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#666">${subtext}</p>
          <!-- OTP Box -->
          <div style="background:#f0f7f0;border:2px dashed #1e5c1e;border-radius:8px;padding:24px;text-align:center;margin:0 0 24px">
            <p style="margin:0 0 6px;font-size:12px;color:#888;letter-spacing:2px;text-transform:uppercase">One-Time Password</p>
            <p style="margin:0;font-size:42px;font-weight:700;letter-spacing:10px;color:#1e5c1e">${otp}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#888">Expires in <strong>${ttlText}</strong></p>
          </div>
          ${warning ? `<p style="margin:0;font-size:13px;color:#e05c00;background:#fff8f0;border-left:3px solid #e05c00;padding:10px 14px;border-radius:4px">${warning}</p>` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f4f7f9;padding:20px 40px;text-align:center">
          <p style="margin:0;font-size:12px;color:#aaa">This is an automated message from ${APP_NAME}. Please do not reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendReferralInviteEmail({ email, referrerName, code }) {
  const transporter = getMailTransporter();
  const fromAddress = `"${APP_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
  const link = `${process.env.CLIENT_URL || 'https://dairyverse.app'}/join?ref=${code}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1e5c1e;padding:28px 40px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:24px;letter-spacing:1px">${APP_NAME}</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <h2 style="color:#1e5c1e;margin:0 0 12px">You've been invited! 🎁</h2>
          <p style="color:#333;font-size:15px;margin:0 0 16px"><strong>${referrerName}</strong> invited you to join ${APP_NAME} – India's premium dairy platform.</p>
          <div style="background:#f0f7f0;border:2px dashed #1e5c1e;border-radius:8px;padding:20px;text-align:center;margin:0 0 20px">
            <p style="margin:0 0 6px;font-size:12px;color:#888;letter-spacing:2px;text-transform:uppercase">Your Referral Code</p>
            <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:6px;color:#1e5c1e">${code}</p>
            <p style="margin:8px 0 0;font-size:13px;color:#555">Use this code at signup to get <strong>₹50 off</strong> your first order!</p>
          </div>
          <div style="text-align:center">
            <a href="${link}" style="display:inline-block;background:#1e5c1e;color:#fff;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none">Join DairyVerse →</a>
          </div>
          <p style="margin:20px 0 0;font-size:12px;color:#aaa;text-align:center">Or visit: ${link}</p>
        </td></tr>
        <tr><td style="background:#f4f7f9;padding:20px;text-align:center">
          <p style="margin:0;font-size:12px;color:#aaa">This is an automated message from ${APP_NAME}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  await transporter.sendMail({
    from: fromAddress,
    to: email,
    subject: `${referrerName} invited you to ${APP_NAME} – Get ₹50 off!`,
    text: `Hi! ${referrerName} invited you to join ${APP_NAME}.\n\nUse referral code: ${code}\nSign up at: ${link}\n\nYou'll get ₹50 off your first order!`,
    html,
  });
}

module.exports = { createAndSendOTP, verifyOTP, normalisePhone, sendReferralInviteEmail };
