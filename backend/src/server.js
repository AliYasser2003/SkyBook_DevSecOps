
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pool = require('./config/db');
const { expirePendingBookings } = require('./services/booking-expiration');

const app = express();

// Security middleware
app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Health check
app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'ok',
      database: 'connected'
    });
  } catch (error) {
    next(error);
  }
});

// Application routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/flights', require('./routes/flights.routes'));
app.use('/api/bookings', require('./routes/bookings.routes'));
app.use('/api', require('./routes/catalog.routes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'API endpoint not found.'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error(error);

  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      message: 'A record with this value already exists.'
    });
  }

  res.status(500).json({
    message: 'Server error. Check backend logs.'
  });
});

// Start the server only when executed directly
async function startServer() {
  const requiredEnv = [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'JWT_SECRET'
  ];

  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  if (process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }

  const port = Number(process.env.PORT || 5000);

  await pool.query('SELECT 1');

  app.listen(port, () => {
    console.log(`SkyBook API listening on ${port}`);

    // Run once at startup, then every 30 seconds.
    expirePendingBookings().catch(error => {
      console.error('Initial booking expiration sweep failed:', error);
    });

    const expirationInterval = setInterval(() => {
      expirePendingBookings().catch(error => {
        console.error('Booking expiration sweep failed:', error);
      });
    }, 30 * 1000);

    expirationInterval.unref();
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Application startup failed:', error.message);
    process.exit(1);
  });
}

module.exports = app;
