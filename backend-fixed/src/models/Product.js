const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String },
  orderId:  { type: String },
  rating:   { type: Number, min: 1, max: 5, required: true },
  text:     { type: String },
  date:     { type: Date, default: Date.now },
});

const productSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  icon:          { type: String, default: '🥛' },
  category:      { type: String, required: true },
  price:         { type: Number, required: true },
  vendorPrice:   { type: Number }, // price vendor charges admin
  unit:          { type: String },
  description:   { type: String },
  stock:         { type: Number, default: 100 },
  lowStockAlert: { type: Number, default: 30 },
  rating:        { type: Number, default: 4.5 },
  tags:          [{ type: String }],
  organic:       { type: Boolean, default: false },
  fat:           { type: String },
  protein:       { type: String },
  calories:      { type: String },
  vendorId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive:      { type: Boolean, default: true },
  reviews:       [reviewSchema],
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
