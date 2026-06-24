const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  id:         { type: Number }, // legacy numeric id support
  name:       { type: String },
  price:      { type: Number },
  quantity:   { type: Number },
  icon:       { type: String },
});

const orderSchema = new mongoose.Schema({
  orderId:         { type: String, unique: true },
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items:           [orderItemSchema],
  subtotal:        { type: Number, required: true },
  delivery:        { type: Number, default: 50 },
  gstAmt:          { type: Number, default: 0 },
  total:           { type: Number, required: true },
  status:          { type: String, enum: ['pending','confirmed','processing','in-transit','delivered','cancelled'], default: 'pending' },
  date:            { type: Date, default: Date.now },
  address:         { type: String },
  deliveryName:    { type: String },
  deliveryPhone:   { type: String },
  payMethod:       { type: String, enum: ['upi','card','netbank','cod','wallet'], default: 'upi' },
  slot:            { type: String },
  instructions:    { type: String },
  cashbackAwarded: { type: Number, default: 0 },
  pointsAwarded:   { type: Number, default: 0 },
}, { timestamps: true });

// Auto-generate orderId
orderSchema.pre('save', function (next) {
  if (!this.orderId) {
    this.orderId = 'ORD' + Date.now().toString().slice(-6);
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
