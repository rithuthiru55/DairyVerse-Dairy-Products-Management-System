const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  from:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:    { type: String, required: true },
  read:    { type: Boolean, default: false },
  time:    { type: Date, default: Date.now },
});

const chatSchema = new mongoose.Schema({
  // Sorted participant IDs joined with '_' for stable key
  key:          { type: String, required: true, unique: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messages:     [messageSchema],
  lastMessage:  { type: String },
  lastTime:     { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);
