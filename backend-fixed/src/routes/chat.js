const express = require('express');
const router  = express.Router();
const Chat    = require('../models/Chat');
const { protect } = require('../middleware/auth');

// Build a stable chat key from two user IDs
const chatKey = (a, b) => [String(a), String(b)].sort().join('_');

// GET /api/chat – list all chats for current user
router.get('/', protect, async (req, res) => {
  try {
    const chats = await Chat.find({ participants: req.user._id })
      .populate('participants', 'name role storeName')
      .sort({ lastTime: -1 });
    res.json({ success: true, chats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/chat/:partnerId – get or create conversation
router.get('/:partnerId', protect, async (req, res) => {
  try {
    const key = chatKey(req.user._id, req.params.partnerId);
    let chat = await Chat.findOne({ key })
      .populate('participants', 'name role storeName');

    if (!chat) {
      chat = await Chat.create({
        key,
        participants: [req.user._id, req.params.partnerId],
        messages: [],
      });
      await chat.populate('participants', 'name role storeName');
    }

    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/chat/:partnerId – send a message (REST fallback)
router.post('/:partnerId', protect, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Message text required' });
    }

    const key = chatKey(req.user._id, req.params.partnerId);
    const chat = await Chat.findOneAndUpdate(
      { key },
      {
        $push: { messages: { from: req.user._id, text: text.trim() } },
        $set:  { lastMessage: text.trim(), lastTime: new Date() },
        $setOnInsert: { participants: [req.user._id, req.params.partnerId] },
      },
      { new: true, upsert: true }
    ).populate('participants', 'name role');

    const newMsg = chat.messages[chat.messages.length - 1];
    res.status(201).json({ success: true, message: newMsg, chat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/chat/:partnerId/read – mark messages as read
router.patch('/:partnerId/read', protect, async (req, res) => {
  try {
    const key = chatKey(req.user._id, req.params.partnerId);
    await Chat.updateOne(
      { key },
      { $set: { 'messages.$[elem].read': true } },
      { arrayFilters: [{ 'elem.from': { $ne: req.user._id }, 'elem.read': false }] }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
