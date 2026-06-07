require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const { requireDevice } = require('./middleware/deviceAuth');

const app = express();

// ── Security headers (helmet) ─────────────────────────────────
app.use(helmet());

// ── CORS — only allow the real frontend ──────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://boaziza.github.io')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '50kb' }));

// ── Rate limiting ─────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max:      200,             // 200 requests per IP per minute
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests.' },
});
app.use(globalLimiter);

const accountsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,              // max 20 requests per IP per window
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — please try again in 15 minutes.' },
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/companies',         require('./routes/companies'));
app.use('/api/stations',          require('./routes/stations'));
app.use('/api/users',             require('./routes/users'));
app.use('/api/situation',         require('./routes/situation'));
app.use('/api/daily-reports',     require('./routes/dailyReports'));
app.use('/api/payments',          require('./routes/payments'));
app.use('/api/fiche',             require('./routes/fiche'));
app.use('/api/loans',             require('./routes/loans'));
app.use('/api/stock',             require('./routes/stock'));
app.use('/api/stock-daily',       require('./routes/stockDaily'));
app.use('/api/gain-pompiste',     require('./routes/gainPompiste'));
app.use('/api/customers',         require('./routes/customers'));
app.use('/api/station-managers',  require('./routes/stationManagers'));
app.use('/api/fuel-prices',       require('./routes/fuelPriceHistory'));
app.use('/api/pumps',             require('./routes/pumps'));
app.use('/api/nozzles',           require('./routes/nozzles'));
app.use('/api/nozzle-readings',   require('./routes/nozzleReadings'));
app.use('/api/teams',             require('./routes/authAppwrite/teams'));
app.use('/api/accounts',          accountsLimiter, require('./routes/authAppwrite/accounts'));
app.use('/api/shift-submit',       require('./routes/shiftSubmit'));
app.use('/api/bonuses',           require('./routes/bonuses'));
app.use('/api/devices',           require('./routes/devices'));

app.get('/health', (_, res) => res.json({ ok: true }));

// ── Central error handler — catches anything passed to next(err) ─────
// (Routes mostly catch their own errors and respond directly; this is the
// backstop for anything that slips through, e.g. malformed JSON bodies,
// CORS rejections, or a route that forgets its try/catch.)
app.use((err, req, res, _next) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
