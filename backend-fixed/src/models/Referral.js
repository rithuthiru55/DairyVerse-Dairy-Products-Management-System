const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referralCode: { type: String, required: true },
  refereeEmail: { type: String, required: true },
  refereeName:  { type: String },
  status:       { type: String, enum: ['pending', 'completed'], default: 'pending' },
  reward:       { type: Number, default: 100 },
  date:         { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Referral', referralSchema);
