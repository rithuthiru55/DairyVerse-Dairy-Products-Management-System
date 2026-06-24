const path = require('path');
const dotenv = require('dotenv');
// Try multiple .env locations so it works regardless of where you run node from
const envPaths = [
  path.join(__dirname, '..', '.env'),   // running: node src/server.js
  path.join(process.cwd(), '.env'),     // running from project root
  path.join(__dirname, '.env'),         // .env placed next to server.js
];
let envLoaded = false;
for (const p of envPaths) {
  const result = dotenv.config({ path: p });
  if (!result.error) { console.log('✅ Loaded .env from: ' + p); envLoaded = true; break; }
}
if (!envLoaded) console.warn('⚠️  .env not found. Checked:', envPaths);
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const connectDB  = require('./config/db');
const chatHandler = require('./socket/chatHandler');

// Routes
const authRoutes     = require('./routes/auth');
const productRoutes  = require('./routes/products');
const orderRoutes    = require('./routes/orders');
const walletRoutes   = require('./routes/wallet');
const chatRoutes     = require('./routes/chat');
const userRoutes     = require('./routes/users');

// Connect DB
connectDB();

const app    = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Register socket handlers
chatHandler(io);

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend (always, in both dev and production)
const fs = require('fs');
// Look for public/ folder next to package.json (one level up from src/)
const frontendPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(frontendPath, 'index.html'))) {
  console.log('🌐 Serving frontend from: ' + frontendPath);
  app.use(express.static(frontendPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  console.warn('⚠️  No public/index.html found at: ' + frontendPath);
}

// API Routes
app.use('/api/auth',     authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders',   orderRoutes);
app.use('/api/wallet',   walletRoutes);
app.use('/api/chat',     chatRoutes);
app.use('/api/users',    userRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('💥 Error:', err.stack);
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 DairyVerse API running at http://localhost:${PORT}`);
  console.log(`🔌 Socket.io enabled`);
  console.log(`📄 Health: http://localhost:${PORT}/api/health`);
});
