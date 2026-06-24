const jwt  = require('jsonwebtoken');
const Chat = require('../models/Chat');

const chatKey = (a, b) => [String(a), String(b)].sort().join('_');

module.exports = (io) => {
  // Authenticate socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication error – no token'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = String(decoded.id);
      next();
    } catch {
      next(new Error('Authentication error – invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.userId}`);

    // Join personal room so we can target this user
    socket.join(socket.userId);

    // ── Join a conversation room ──
    socket.on('join_chat', ({ partnerId }) => {
      const room = chatKey(socket.userId, partnerId);
      socket.join(room);
    });

    // ── Send a message ──
    socket.on('send_message', async ({ partnerId, text }) => {
      if (!text || !text.trim()) return;
      try {
        const key  = chatKey(socket.userId, partnerId);
        const chat = await Chat.findOneAndUpdate(
          { key },
          {
            $push: { messages: { from: socket.userId, text: text.trim() } },
            $set:  { lastMessage: text.trim(), lastTime: new Date() },
            $setOnInsert: { participants: [socket.userId, partnerId] },
          },
          { new: true, upsert: true }
        );

        const newMsg = chat.messages[chat.messages.length - 1];

        // Emit to BOTH participants in the room
        io.to(key).emit('new_message', {
          chatKey: key,
          message: {
            _id:  newMsg._id,
            from: socket.userId,
            text: newMsg.text,
            time: newMsg.time,
            read: false,
          },
        });

        // Also notify partner's personal room (for unread badge)
        io.to(partnerId).emit('chat_notification', {
          from: socket.userId,
          text: newMsg.text,
          chatKey: key,
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // ── Typing indicator ──
    socket.on('typing', ({ partnerId, isTyping }) => {
      const key = chatKey(socket.userId, partnerId);
      socket.to(key).emit('partner_typing', { userId: socket.userId, isTyping });
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.userId}`);
    });
  });
};
