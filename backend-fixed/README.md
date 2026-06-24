# DairyVerse Backend

Production-ready Node.js + Express + MongoDB backend for DairyVerse.

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret

# 3. Seed the database with demo data
npm run seed

# 4. Start the development server
npm run dev
```

The API will be running at `http://localhost:5000`

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment | `production` |
| `MONGO_URI` | MongoDB connection string | `mongodb+srv://...` |
| `JWT_SECRET` | JWT signing secret (keep secret!) | `64-char-random-string` |
| `JWT_EXPIRES_IN` | JWT expiry | `7d` |
| `CLIENT_URL` | Frontend URL (CORS) | `https://yourdomain.com` |

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create new account |
| POST | `/api/auth/login` | Login → returns JWT token |
| GET | `/api/auth/me` | Get current user (requires JWT) |
| PUT | `/api/auth/profile` | Update profile |

### Products
| Method | Path | Description |
|---|---|---|
| GET | `/api/products` | List products |
| GET | `/api/products/:id` | Get product |
| POST | `/api/products` | Create product (vendor/admin) |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Deactivate product (admin) |
| POST | `/api/products/:id/reviews` | Add review (customer) |

### Orders
| Method | Path | Description |
|---|---|---|
| GET | `/api/orders` | List orders (role-filtered) |
| POST | `/api/orders` | Place order (customer) |
| PATCH | `/api/orders/:id/status` | Update status (vendor/admin) |

### Wallet
| Method | Path | Description |
|---|---|---|
| GET | `/api/wallet` | Get wallet & transactions |
| POST | `/api/wallet/add` | Add money |
| POST | `/api/wallet/redeem-points` | Redeem loyalty points |

### Users (Admin)
| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | List all users |
| GET | `/api/users/:id` | Get user |
| PUT | `/api/users/:id` | Update user (verify vendor, etc.) |
| GET | `/api/users/referrals/mine` | My referrals |
| GET | `/api/users/subscriptions/mine` | My subscriptions |

### Chat
| Method | Path | Description |
|---|---|---|
| GET | `/api/chat/:partnerId` | Get conversation |
| POST | `/api/chat/:partnerId` | Send message (REST fallback) |

---

## Deployment

### Option 1: Railway (Recommended)

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add a MongoDB service (or use MongoDB Atlas)
4. Set environment variables in Railway dashboard
5. Deploy!

### Option 2: Render

1. Go to [render.com](https://render.com) → New Web Service
2. Connect GitHub repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables

### Option 3: VPS (Ubuntu)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone <your-repo>
cd dairyverse-backend
npm install
cp .env.example .env
nano .env  # fill in your values

# Install PM2 process manager
npm install -g pm2
pm2 start src/server.js --name dairyverse
pm2 startup
pm2 save

# Use Nginx as reverse proxy
# sudo apt install nginx
# Configure /etc/nginx/sites-available/dairyverse
```

### MongoDB Atlas (Cloud Database)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Create a free cluster
3. Create a database user
4. Get your connection string
5. Set it as `MONGO_URI` in `.env`

---

## Connecting the Frontend

In `dairyverse-production.html`, add before the `<script>` tag:

```html
<!-- For a separate frontend domain -->
<script>
  window.DAIRYVERSE_API_URL = 'https://your-backend.railway.app/api';
</script>

<!-- OR for same-origin (backend serves frontend) -->
<!-- No configuration needed, uses /api automatically -->
```

---

## Demo Credentials (after seeding)

| Role | Email | Password |
|---|---|---|
| Customer | customer@demo.com | demo123456 |
| Vendor | vendor@demo.com | demo123456 |
| Admin | admin@demo.com | demo123456 |

---

## Architecture

```
Frontend (HTML/JS) ──→ API (Express) ──→ MongoDB
                   ←── JWT Token   ←──
                   
WebSocket (Socket.io) for real-time chat
```
