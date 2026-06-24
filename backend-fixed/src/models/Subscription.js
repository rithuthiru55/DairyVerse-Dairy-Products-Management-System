const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name:      { type: String },
  icon:      { type: String },
  price:     { type: Number },
  quantity:  { type: Number, default: 1 },
  frequency: { type: String, enum: ['daily','alternate','weekly'], default: 'daily' },
  slot:      { type: String },
  startDate: { type: String },
  status:    { type: String, enum: ['active','paused','cancelled'], default: 'active' },
  pausedFrom:{ type: String },
  pausedTo:  { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
