const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName:     { type: String, required: true, trim: true },
  lastName:      { type: String, required: true, trim: true },
  name:          { type: String },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:      { type: String, required: true, minlength: 8 },
  phone:         { type: String, required: true },
  role:          { type: String, enum: ['customer', 'vendor', 'admin'], default: 'customer' },

  // Address
  address:       { type: String },
  city:          { type: String },
  state:         { type: String },
  pin:           { type: String },
  landmark:      { type: String },
  gender:        { type: String },
  dob:           { type: String },

  // Customer fields
  points:        { type: Number, default: 0 },
  tier:          { type: String, enum: ['Basic', 'Silver', 'Gold', 'Premium'], default: 'Basic' },
  referralCode:  { type: String, unique: true, sparse: true },
  referralCount: { type: Number, default: 0 },
  usedReferralCode: { type: String, default: '' },

  // Vendor fields
  storeName:     { type: String },
  bizType:       { type: String },
  gst:           { type: String },
  fssai:         { type: String },
  verified:      { type: Boolean, default: false },
  organicCert:   { type: Boolean, default: false },

  // Admin fields
  dept:          { type: String },
  empId:         { type: String },

  emailVerified: { type: Boolean, default: false },
  joined:        { type: Date, default: Date.now },
}, { timestamps: true });

// Auto-set name before save
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  this.name = `${this.firstName} ${this.lastName}`;
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
