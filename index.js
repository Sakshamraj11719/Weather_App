const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 24 * 7);
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/auth.html');
});

app.use(express.static(path.join(__dirname, '../frontend')));

// ─────────────────────────────────────────────────────────
//  EMAIL TRANSPORTER (Nodemailer)
// ─────────────────────────────────────────────────────────
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || `"Weather Dashboard" <${EMAIL_USER}>`;
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = Number(process.env.EMAIL_PORT || 587);

let emailTransporter = null;

async function createTransporter() {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn('[Email] EMAIL_USER / EMAIL_PASS not set — running in CONSOLE-OTP mode');
    return null;
  }
  const t = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
  try {
    await t.verify();
    console.log('[Email] SMTP connection verified ✓');
    return t;
  } catch (err) {
    console.error('[Email] SMTP verify failed — falling back to CONSOLE-OTP mode:', err.message);
    return null;
  }
}

async function sendVerificationEmail(toEmail, otp) {
  const subject = '🌤️ Verify your Weather Dashboard email';
  const html = `
    <div style="font-family:ui-sans-serif,sans-serif;max-width:480px;margin:0 auto;background:#0b1220;color:#e5e7eb;border-radius:16px;overflow:hidden;border:1px solid #1f2937">
      <div style="background:linear-gradient(135deg,#22d3ee,#60a5fa);padding:32px;text-align:center">
        <div style="font-size:48px">⛅</div>
        <h1 style="margin:12px 0 4px;color:#fff;font-size:22px">Weather Dashboard</h1>
        <p style="margin:0;color:rgba(255,255,255,0.8);font-size:14px">Email Verification</p>
      </div>
      <div style="padding:32px">
        <p style="margin:0 0 20px;font-size:15px">Hi there! Use the code below to verify your email address. It expires in <strong>10 minutes</strong>.</p>
        <div style="background:#0f172a;border:1px solid #1f2937;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
          <div style="letter-spacing:10px;font-size:36px;font-weight:700;color:#22d3ee;font-family:monospace">${otp}</div>
        </div>
        <p style="margin:0;font-size:13px;color:#9ca3af">If you did not create a Weather Dashboard account, you can safely ignore this email.</p>
      </div>
    </div>`;

  if (emailTransporter) {
    await emailTransporter.sendMail({ from: EMAIL_FROM, to: toEmail, subject, html });
    console.log('[Email] OTP sent to ' + toEmail);
  } else {
    console.log('\n+----------------------------------+');
    console.log('| OTP for: ' + toEmail);
    console.log('| Code: ' + otp);
    console.log('+----------------------------------+\n');
  }
}


const API_KEY = process.env.OPENWEATHER_API_KEY;
if (!API_KEY) {
  console.error('ERROR: OPENWEATHER_API_KEY missing in .env');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────
//  DATABASE SETUP (sql.js — pure JavaScript, no compiler needed)
// ─────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'weather_app.db');

let sqljs, db;

// sql.js wrapper that mimics better-sqlite3's synchronous API
// so all the route code below works without any changes
function createDbWrapper(sqlDb) {
  // Save DB to disk after every write
  function persist() {
    try {
      const data = sqlDb.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('[DB] Failed to persist:', e.message);
    }
  }

  function queryAll(sql, params = []) {
    const stmt = sqlDb.prepare(sql);
    const rows = [];
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  function queryGet(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  function queryRun(sql, params = []) {
    sqlDb.run(sql, params);
    const changes = sqlDb.getRowsModified();
    persist();
    return { changes };
  }

  function exec(sql) {
    sqlDb.run(sql);
    persist();
  }

  // Returns an object with .get(), .all(), .run() — same as better-sqlite3
  function prepare(sql) {
    return {
      get: (...args) => {
        const params = args.flat();
        return queryGet(sql, params);
      },
      all: (...args) => {
        const params = args.flat();
        return queryAll(sql, params);
      },
      run: (...args) => {
        const params = args.flat();
        return queryRun(sql, params);
      },
    };
  }

  return { prepare, exec, close: () => {} };
}

async function initDatabase() {
  // Load sql.js
  const initSqlJs = require('sql.js');
  sqljs = await initSqlJs();

  // Load existing DB file if it exists, otherwise create new
  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    sqlDb = new sqljs.Database(fileBuffer);
    console.log(`[DB] Loaded existing database: ${DB_PATH}`);
  } else {
    sqlDb = new sqljs.Database();
    console.log(`[DB] Created new database: ${DB_PATH}`);
  }

  db = createDbWrapper(sqlDb);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email       TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'user',
      banned      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      email       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      city_name   TEXT NOT NULL,
      country     TEXT NOT NULL,
      lat         REAL NOT NULL,
      lon         REAL NOT NULL,
      added_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(email, lat, lon)
    );

    CREATE TABLE IF NOT EXISTS weather_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      city_name   TEXT NOT NULL,
      country     TEXT NOT NULL,
      lat         REAL NOT NULL,
      lon         REAL NOT NULL,
      temp        REAL NOT NULL,
      feels_like  REAL NOT NULL,
      humidity    INTEGER NOT NULL,
      wind_speed  REAL NOT NULL,
      weather_id  INTEGER NOT NULL,
      description TEXT NOT NULL,
      units       TEXT NOT NULL DEFAULT 'metric',
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_usage (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      endpoint    TEXT NOT NULL,
      method      TEXT NOT NULL DEFAULT 'GET',
      status_code INTEGER NOT NULL DEFAULT 200,
      used_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      email       TEXT PRIMARY KEY,
      otp         TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      verified    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      email       TEXT PRIMARY KEY,
      avatar_color TEXT NOT NULL DEFAULT '#22d3ee',
      bio         TEXT NOT NULL DEFAULT '',
      units       TEXT NOT NULL DEFAULT 'metric',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_email     ON sessions(email);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_favorites_email    ON favorites(email);
    CREATE INDEX IF NOT EXISTS idx_history_email_city ON weather_history(email, city_name);
    CREATE INDEX IF NOT EXISTS idx_api_usage_email    ON api_usage(email);
    CREATE INDEX IF NOT EXISTS idx_api_usage_date     ON api_usage(used_at);

  `);

  // Safe migration: add verified column if missing
  try { db.exec(`ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`); } catch (_) {}


  // ─────────────────────────────────────────────────────────
  //  PREPARED STATEMENTS
  // ─────────────────────────────────────────────────────────
  const stmts = {
    // Users
    getUserByEmail:   db.prepare('SELECT * FROM users WHERE email = ?'),
    getAllUsers:      db.prepare('SELECT email, name, role, banned, created_at FROM users'),
    insertUser:       db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)'),
    updateUser:       db.prepare('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), password = COALESCE(?, password) WHERE email = ?'),
    setBanned:        db.prepare('UPDATE users SET banned = ? WHERE email = ?'),
    deleteUser:       db.prepare('DELETE FROM users WHERE email = ?'),

    // Sessions
    getSession:         db.prepare('SELECT * FROM sessions WHERE token = ?'),
    insertSession:      db.prepare('INSERT INTO sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    deleteSession:      db.prepare('DELETE FROM sessions WHERE token = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE email = ?'),
    getAllSessions:     db.prepare('SELECT * FROM sessions'),
    deleteExpired:      db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    deleteAllExcept:    db.prepare('DELETE FROM sessions WHERE token != ?'),

    // Favorites
    getFavorites:  db.prepare('SELECT * FROM favorites WHERE email = ? ORDER BY added_at DESC'),
    addFavorite:   db.prepare('INSERT OR IGNORE INTO favorites (email, city_name, country, lat, lon) VALUES (?, ?, ?, ?, ?)'),
    removeFavorite:db.prepare('DELETE FROM favorites WHERE email = ? AND id = ?'),
    isFavorite:    db.prepare('SELECT id FROM favorites WHERE email = ? AND lat = ? AND lon = ?'),

    // Weather history
    insertHistory:    db.prepare('INSERT INTO weather_history (email, city_name, country, lat, lon, temp, feels_like, humidity, wind_speed, weather_id, description, units) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    getHistory:       db.prepare('SELECT * FROM weather_history WHERE email = ? AND city_name = ? ORDER BY recorded_at DESC LIMIT ?'),
    getRecentHistory: db.prepare('SELECT * FROM weather_history WHERE email = ? ORDER BY recorded_at DESC LIMIT 50'),

    // API usage
    logUsage:      db.prepare('INSERT INTO api_usage (email, endpoint, method, status_code) VALUES (?, ?, ?, ?)'),
    getUsageSummary: db.prepare(`SELECT endpoint, COUNT(*) as count, DATE(used_at) as date FROM api_usage WHERE email = ? GROUP BY endpoint, DATE(used_at) ORDER BY used_at DESC LIMIT 100`),
    getUsageToday:   db.prepare(`SELECT COUNT(*) as count FROM api_usage WHERE email = ? AND DATE(used_at) = DATE('now')`),
    getUsageTotal:   db.prepare('SELECT COUNT(*) as count FROM api_usage WHERE email = ?'),
    getAllUsage:      db.prepare(`SELECT email, endpoint, COUNT(*) as count FROM api_usage WHERE DATE(used_at) >= DATE('now','-7 days') GROUP BY email, endpoint ORDER BY count DESC`),

    // Email verification
    upsertOTP:        db.prepare('INSERT OR REPLACE INTO email_verifications (email, otp, expires_at, verified) VALUES (?, ?, ?, 0)'),
    getOTP:           db.prepare('SELECT * FROM email_verifications WHERE email = ?'),
    markUserVerified: db.prepare('UPDATE users SET verified = 1 WHERE email = ?'),

    // Profile / preferences
    getPrefs:         db.prepare('SELECT * FROM user_preferences WHERE email = ?'),
    upsertPrefs:      db.prepare('INSERT OR REPLACE INTO user_preferences (email, avatar_color, bio, units, updated_at) VALUES (?, ?, ?, ?, datetime("now"))'),
    updateProfile:    db.prepare('UPDATE users SET name = ? WHERE email = ?'),

    // Export helpers
    getAllHistory:     db.prepare('SELECT * FROM weather_history WHERE email = ? ORDER BY recorded_at DESC'),
    getAllFavorites:   db.prepare('SELECT * FROM favorites WHERE email = ? ORDER BY added_at DESC'),

    // Admin extras
    getAllUsersWithVerified: db.prepare('SELECT email, name, role, banned, verified, created_at FROM users'),
  };

  // ─────────────────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────────────────
  // Validates email: must have local part, @, domain with dot, and valid TLD (2-6 chars)
  function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim().toLowerCase();
    // Must match pattern: something@something.tld (tld = 2-6 letters)
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}$/;
    if (!emailRegex.test(trimmed)) return false;
    // Domain part must have at least one dot and real characters
    const [local, domain] = trimmed.split('@');
    if (!local || local.length < 1) return false;
    if (!domain || !domain.includes('.')) return false;
    const domainParts = domain.split('.');
    // TLD must be at least 2 chars, domain label before TLD must exist
    if (domainParts[domainParts.length - 1].length < 2) return false;
    if (domainParts[0].length < 1) return false;
    return true;
  }

  function generateSessionToken() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getSessionExpiry() {
    return Date.now() + SESSION_TTL_MS;
  }

  function isSessionExpired(expiresAt) {
    return !expiresAt || Number(expiresAt) <= Date.now();
  }

  // Purge expired sessions periodically (every 30 minutes)
  setInterval(() => {
    const deleted = stmts.deleteExpired.run(Date.now());
    if (deleted.changes > 0) {
      console.log(`[DB] Purged ${deleted.changes} expired session(s)`);
    }
  }, 30 * 60 * 1000);

  // Initialize email transporter
  emailTransporter = await createTransporter();


  // ─────────────────────────────────────────────────────────
  //  SEED DEFAULT ADMIN
  // ─────────────────────────────────────────────────────────
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@weather.local';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
  const ADMIN_NAME     = process.env.ADMIN_USERNAME || 'Admin';

  const existing = stmts.getUserByEmail.get(ADMIN_EMAIL);
  if (!existing) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
    stmts.insertUser.run(ADMIN_EMAIL, ADMIN_NAME, hash, 'admin');
    stmts.markUserVerified.run(ADMIN_EMAIL);
    console.log(`[Admin] Default admin created: ${ADMIN_EMAIL}`);
    console.log('[Admin] Change the password immediately after first login!');
  } else {
    console.log(`[Admin] Admin account already exists: ${ADMIN_EMAIL}`);
  }

  // ─────────────────────────────────────────────────────────
  //  AUTH ROUTES
  // ─────────────────────────────────────────────────────────
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name)
        return res.status(400).json({ success: false, message: 'All fields are required' });
      if (!isValidEmail(email))
        return res.status(400).json({ success: false, message: 'Please enter a valid email address (e.g. you@gmail.com)' });
      if (password.length < 6)
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

      const existing = stmts.getUserByEmail.get(email);
      if (existing && existing.verified)
        return res.status(400).json({ success: false, message: 'Email already registered' });

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      if (existing && !existing.verified) {
        // Re-register: update credentials in case they changed
        stmts.updateUser.run(name, null, passwordHash, email);
      } else {
        stmts.insertUser.run(email, name, passwordHash, 'user');
      }

      // Send OTP — do NOT create session yet
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + 10 * 60 * 1000;
      stmts.upsertOTP.run(email, otp, expiresAt);
      await sendVerificationEmail(email, otp);

      return res.json({
        success: true,
        requiresVerification: true,
        message: 'Account created! Please check your email for a 6-digit verification code.',
        email
      });
    } catch (error) {
      console.error('Signup error:', error);
      return res.status(500).json({ success: false, message: 'Server error during signup' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ success: false, message: 'Email and password are required' });
      if (!isValidEmail(email))
        return res.status(400).json({ success: false, message: 'Please enter a valid email address (e.g. you@gmail.com)' });

      const user = stmts.getUserByEmail.get(email);
      if (!user)
        return res.status(401).json({ success: false, message: 'Invalid email or password' });

      const valid = await bcrypt.compare(password, user.password);
      if (!valid)
        return res.status(401).json({ success: false, message: 'Invalid email or password' });

      if (user.banned)
        return res.status(403).json({ success: false, message: 'Your account has been suspended. Please contact support.' });

      if (!user.verified) {
        // Resend OTP so they can verify
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = Date.now() + 10 * 60 * 1000;
        stmts.upsertOTP.run(email, otp, expiresAt);
        await sendVerificationEmail(email, otp);
        return res.status(403).json({
          success: false,
          requiresVerification: true,
          message: 'Please verify your email first. A new code has been sent.',
          email
        });
      }

      const sessionToken = generateSessionToken();
      stmts.insertSession.run(sessionToken, email, Date.now(), getSessionExpiry());

      return res.json({
        success: true,
        message: 'Login successful',
        sessionToken,
        user: { email, name: user.name }
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ success: false, message: 'Server error during login' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    try {
      const { sessionToken } = req.body;
      if (sessionToken) stmts.deleteSession.run(sessionToken);
      return res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(500).json({ success: false, message: 'Server error during logout' });
    }
  });

  app.post('/api/auth/check', (req, res) => {
    try {
      const { sessionToken } = req.body;
      if (!sessionToken)
        return res.json({ success: false, authenticated: false });

      const session = stmts.getSession.get(sessionToken);
      if (!session)
        return res.json({ success: false, authenticated: false });

      if (isSessionExpired(session.expires_at)) {
        stmts.deleteSession.run(sessionToken);
        return res.json({ success: false, authenticated: false });
      }

      const user = stmts.getUserByEmail.get(session.email);
      if (!user)
        return res.json({ success: false, authenticated: false });

      return res.json({
        success: true,
        authenticated: true,
        user: { email: user.email, name: user.name, role: user.role, verified: !!user.verified }
      });
    } catch (error) {
      console.error('Auth check error:', error);
      return res.status(500).json({ success: false, authenticated: false });
    }
  });

  // ─────────────────────────────────────────────────────────
  //  AUTH MIDDLEWARE
  // ─────────────────────────────────────────────────────────
  function requireAuth(req, res, next) {
    try {
      const sessionToken = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionToken)
        return res.status(401).json({ error: 'Authentication required' });

      const session = stmts.getSession.get(sessionToken);
      if (!session)
        return res.status(401).json({ error: 'Invalid session' });

      if (isSessionExpired(session.expires_at)) {
        stmts.deleteSession.run(sessionToken);
        return res.status(401).json({ error: 'Session expired' });
      }

      const user = stmts.getUserByEmail.get(session.email);
      if (!user)
        return res.status(401).json({ error: 'Invalid user' });

      if (user.banned) {
        stmts.deleteSession.run(sessionToken);
        return res.status(403).json({ error: 'Your account has been suspended.' });
      }

      req.user = user;
      return next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({ error: 'Authentication check failed' });
    }
  }

  function requireAdmin(req, res, next) {
    try {
      const sessionToken = req.headers.authorization?.replace('Bearer ', '');
      if (!sessionToken)
        return res.status(401).json({ error: 'Authentication required' });

      const session = stmts.getSession.get(sessionToken);
      if (!session || isSessionExpired(session.expires_at)) {
        if (session) stmts.deleteSession.run(sessionToken);
        return res.status(401).json({ error: 'Session expired' });
      }

      const user = stmts.getUserByEmail.get(session.email);
      if (!user)
        return res.status(401).json({ error: 'User not found' });
      if (user.role !== 'admin')
        return res.status(403).json({ error: 'Admin access required' });

      req.user = user;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'Admin auth failed' });
    }
  }

  // ─────────────────────────────────────────────────────────
  //  WEATHER API PROXY ROUTES (protected)
  // ─────────────────────────────────────────────────────────
  async function fetchWeatherAPI(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
  }

  app.use('/api/weather',         requireAuth);
  app.use('/api/forecast',        requireAuth);
  app.use('/api/air-pollution',   requireAuth);
  app.use('/api/geocode',         requireAuth);
  app.use('/api/reverse-geocode', requireAuth);
  app.use('/api/tiles',           requireAuth);
  app.use('/api/ai',              requireAuth);

  app.get('/api/weather', async (req, res) => {
    try {
      const { lat, lon, units = 'metric' } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: 'Missing lat or lon' });
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${API_KEY}`;
      return res.json(await fetchWeatherAPI(url));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/forecast', async (req, res) => {
    try {
      const { lat, lon, units = 'metric' } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: 'Missing lat or lon' });
      const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${API_KEY}`;
      return res.json(await fetchWeatherAPI(url));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/air-pollution', async (req, res) => {
    try {
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: 'Missing lat or lon' });
      const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`;
      return res.json(await fetchWeatherAPI(url));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/geocode', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: 'Missing query' });
      const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`;
      return res.json(await fetchWeatherAPI(url));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/reverse-geocode', async (req, res) => {
    try {
      const { lat, lon } = req.query;
      if (!lat || !lon) return res.status(400).json({ error: 'Missing lat or lon' });
      const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${API_KEY}`;
      return res.json(await fetchWeatherAPI(url));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/tiles/:layer/:z/:x/:y', async (req, res) => {
    try {
      const { layer, z, x, y } = req.params;
      const url = `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) return res.status(response.status).send('Tile not found');
      const buffer = await response.arrayBuffer();
      res.set('Content-Type', 'image/png');
      return res.send(Buffer.from(buffer));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/ai/message', async (req, res) => {
    try {
      const { messages, system, max_tokens = 1000 } = req.body;
      if (!messages || !Array.isArray(messages))
        return res.status(400).json({ error: 'messages array is required' });

      const GROQ_KEY = process.env.GROQ_API_KEY;
      if (!GROQ_KEY)
        return res.status(500).json({ error: 'GROQ_API_KEY not configured in .env' });

      // Build messages array — prepend system as a system role message for Groq
      const groqMessages = [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages
      ];

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          max_tokens,
          messages: groqMessages
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      const groqData = await response.json();

      // Convert Groq's OpenAI-style response to Anthropic-style
      // so the frontend code doesn't need any changes
      const text = groqData.choices?.[0]?.message?.content || '';
      return res.json({
        content: [{ type: 'text', text }]
      });

    } catch (error) {
      console.error('AI proxy error:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────
  //  ADMIN ROUTES
  // ─────────────────────────────────────────────────────────
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const list = stmts.getAllUsers.all().map(u => ({
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.created_at,
      banned: !!u.banned
    }));
    return res.json({ users: list });
  });

  app.post('/api/admin/users/create', requireAdmin, async (req, res) => {
    const { email, name, password, role } = req.body;
    if (!email || !name || !password)
      return res.status(400).json({ error: 'email, name and password required' });
    if (stmts.getUserByEmail.get(email))
      return res.status(400).json({ error: 'Email already exists' });
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    stmts.insertUser.run(email, name, hash, role || 'user');
    return res.json({ success: true });
  });

  app.post('/api/admin/users/update', requireAdmin, async (req, res) => {
    const { email, name, role, password } = req.body;
    if (!stmts.getUserByEmail.get(email))
      return res.status(404).json({ error: 'User not found' });
    const newHash = (password && password.length >= 6)
      ? await bcrypt.hash(password, BCRYPT_ROUNDS)
      : null;
    stmts.updateUser.run(name || null, role || null, newHash, email);
    return res.json({ success: true });
  });

  app.post('/api/admin/users/ban', requireAdmin, (req, res) => {
    const { email, banned } = req.body;
    if (!stmts.getUserByEmail.get(email))
      return res.status(404).json({ error: 'User not found' });
    if (email === req.user.email)
      return res.status(400).json({ error: 'Cannot ban yourself' });
    stmts.setBanned.run(banned ? 1 : 0, email);
    if (banned) stmts.deleteUserSessions.run(email);
    return res.json({ success: true });
  });

  app.post('/api/admin/users/delete', requireAdmin, (req, res) => {
    const { email } = req.body;
    if (!stmts.getUserByEmail.get(email))
      return res.status(404).json({ error: 'User not found' });
    if (email === req.user.email)
      return res.status(400).json({ error: 'Cannot delete yourself' });
    stmts.deleteUser.run(email);
    return res.json({ success: true });
  });

  app.get('/api/admin/sessions', requireAdmin, (req, res) => {
    const list = stmts.getAllSessions.all().map(s => ({
      token: s.token,
      email: s.email,
      createdAt: s.created_at,
      expiresAt: s.expires_at
    }));
    return res.json({ sessions: list });
  });

  app.post('/api/admin/sessions/revoke', requireAdmin, (req, res) => {
    const { token } = req.body;
    const result = stmts.deleteSession.run(token);
    if (result.changes === 0)
      return res.status(404).json({ error: 'Session not found' });
    return res.json({ success: true });
  });

  app.post('/api/admin/sessions/revoke-all', requireAdmin, (req, res) => {
    const adminToken = req.headers.authorization?.replace('Bearer ', '');
    stmts.deleteAllExcept.run(adminToken);
    return res.json({ success: true });
  });

  app.post('/api/admin/reset', requireAdmin, (req, res) => {
    const nonAdmins = stmts.getAllUsers.all().filter(u => u.role !== 'admin');
    for (const u of nonAdmins) stmts.deleteUser.run(u.email);
    return res.json({ success: true });
  });

  // ─────────────────────────────────────────────────────────
  //  ROOT
  // ─────────────────────────────────────────────────────────
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'auth.html'));
  });

  // ─────────────────────────────────────────────────────────
  //  API USAGE TRACKING MIDDLEWARE
  // ─────────────────────────────────────────────────────────
  function trackUsage(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      try {
        const email = req.user?.email || 'anonymous';
        const endpoint = req.path;
        const method = req.method;
        const status = res.statusCode || 200;
        stmts.logUsage.run(email, endpoint, method, status);
      } catch (_) {}
      return originalJson(body);
    };
    next();
  }

  app.use('/api/weather',       trackUsage);
  app.use('/api/forecast',      trackUsage);
  app.use('/api/air-pollution', trackUsage);
  app.use('/api/geocode',       trackUsage);

  // ─────────────────────────────────────────────────────────
  //  FAVORITES ROUTES
  // ─────────────────────────────────────────────────────────
  app.get('/api/favorites', requireAuth, (req, res) => {
    const favs = stmts.getFavorites.all(req.user.email);
    return res.json({ favorites: favs });
  });

  app.post('/api/favorites/add', requireAuth, (req, res) => {
    const { city_name, country, lat, lon } = req.body;
    if (!city_name || lat == null || lon == null)
      return res.status(400).json({ error: 'city_name, lat, lon required' });
    stmts.addFavorite.run(req.user.email, city_name, country || '', parseFloat(lat), parseFloat(lon));
    return res.json({ success: true });
  });

  app.post('/api/favorites/remove', requireAuth, (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    stmts.removeFavorite.run(req.user.email, id);
    return res.json({ success: true });
  });

  app.get('/api/favorites/check', requireAuth, (req, res) => {
    const { lat, lon } = req.query;
    if (lat == null || lon == null) return res.status(400).json({ error: 'lat, lon required' });
    const row = stmts.isFavorite.get(req.user.email, parseFloat(lat), parseFloat(lon));
    return res.json({ isFavorite: !!row, id: row?.id || null });
  });

  // ─────────────────────────────────────────────────────────
  //  WEATHER HISTORY ROUTES
  // ─────────────────────────────────────────────────────────
  app.post('/api/history/save', requireAuth, (req, res) => {
    const { city_name, country, lat, lon, temp, feels_like, humidity, wind_speed, weather_id, description, units } = req.body;
    if (!city_name || lat == null || lon == null)
      return res.status(400).json({ error: 'Missing required fields' });
    stmts.insertHistory.run(
      req.user.email, city_name, country || '',
      parseFloat(lat), parseFloat(lon),
      parseFloat(temp), parseFloat(feels_like),
      parseInt(humidity), parseFloat(wind_speed),
      parseInt(weather_id), description || '', units || 'metric'
    );
    return res.json({ success: true });
  });

  app.get('/api/history', requireAuth, (req, res) => {
    const { city, limit = 7 } = req.query;
    if (!city) {
      const rows = stmts.getRecentHistory.all(req.user.email);
      return res.json({ history: rows });
    }
    const rows = stmts.getHistory.all(req.user.email, city, parseInt(limit));
    return res.json({ history: rows });
  });

  // ─────────────────────────────────────────────────────────
  //  API USAGE STATS ROUTES
  // ─────────────────────────────────────────────────────────
  app.get('/api/usage/stats', requireAuth, (req, res) => {
    const today = stmts.getUsageToday.get(req.user.email);
    const total = stmts.getUsageTotal.get(req.user.email);
    const summary = stmts.getUsageSummary.all(req.user.email);
    return res.json({
      today: today.count,
      total: total.count,
      summary
    });
  });

  app.get('/api/admin/usage', requireAdmin, (req, res) => {
    const rows = stmts.getAllUsage.all();
    return res.json({ usage: rows });
  });

  // ─────────────────────────────────────────────────────────
  //  EMAIL VERIFICATION ROUTES
  // ─────────────────────────────────────────────────────────
  // Generate a 6-digit OTP and store it (in-memory simulation — no real email in demo)
  function generateOTP() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  // Request OTP: POST /api/auth/send-otp  { email }
  app.post('/api/auth/send-otp', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !isValidEmail(email))
        return res.status(400).json({ success: false, message: 'Valid email required' });

      const otp = generateOTP();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
      stmts.upsertOTP.run(email, otp, expiresAt);

      await sendVerificationEmail(email, otp);
      return res.json({ success: true, message: 'Verification code sent to your email.' });
    } catch (err) {
      console.error('Send OTP error:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Verify OTP: POST /api/auth/verify-otp  { email, otp }
  app.post('/api/auth/verify-otp', (req, res) => {
    try {
      const { email, otp } = req.body;
      if (!email || !otp)
        return res.status(400).json({ success: false, message: 'email and otp required' });

      const row = stmts.getOTP.get(email);
      if (!row)
        return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
      if (Number(row.expires_at) < Date.now())
        return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
      if (String(row.otp) !== String(otp))
        return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });

      stmts.markUserVerified.run(email);

      // Create session now that email is verified
      const user = stmts.getUserByEmail.get(email);
      const sessionToken = generateSessionToken();
      stmts.insertSession.run(sessionToken, email, Date.now(), getSessionExpiry());

      return res.json({
        success: true,
        message: 'Email verified successfully! Welcome aboard.',
        sessionToken,
        user: { email: user.email, name: user.name, role: user.role }
      });
    } catch (err) {
      console.error('Verify OTP error:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Resend OTP: POST /api/auth/resend-otp  { email }
  app.post('/api/auth/resend-otp', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !isValidEmail(email))
        return res.status(400).json({ success: false, message: 'Valid email required' });

      const user = stmts.getUserByEmail.get(email);
      if (!user)
        return res.status(400).json({ success: false, message: 'No account found for this email.' });
      if (user.verified)
        return res.status(400).json({ success: false, message: 'This email is already verified.' });

      // Rate-limit: check last OTP timestamp
      const existing = stmts.getOTP.get(email);
      const cooldown = 60 * 1000; // 1 minute
      if (existing && (Number(existing.expires_at) - 9 * 60 * 1000) > Date.now() - cooldown) {
        return res.status(429).json({ success: false, message: 'Please wait a moment before requesting a new code.' });
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + 10 * 60 * 1000;
      stmts.upsertOTP.run(email, otp, expiresAt);
      await sendVerificationEmail(email, otp);

      return res.json({ success: true, message: 'A new verification code has been sent.' });
    } catch (err) {
      console.error('Resend OTP error:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Check verification status
  app.get('/api/auth/verification-status', requireAuth, (req, res) => {
    const user = stmts.getUserByEmail.get(req.user.email);
    return res.json({ verified: !!user?.verified });
  });

  // ─────────────────────────────────────────────────────────
  //  USER PROFILE ROUTES
  // ─────────────────────────────────────────────────────────
  app.get('/api/profile', requireAuth, (req, res) => {
    const user = stmts.getUserByEmail.get(req.user.email);
    const prefs = stmts.getPrefs.get(req.user.email) || { avatar_color: '#22d3ee', bio: '', units: 'metric' };
    const histCount = stmts.getRecentHistory.all(req.user.email).length;
    const favCount = stmts.getFavorites.all(req.user.email).length;
    const usageToday = stmts.getUsageToday.get(req.user.email);
    const usageTotal = stmts.getUsageTotal.get(req.user.email);
    return res.json({
      email: user.email,
      name: user.name,
      role: user.role,
      verified: !!user.verified,
      created_at: user.created_at,
      avatar_color: prefs.avatar_color,
      bio: prefs.bio,
      units: prefs.units,
      stats: {
        historyCount: histCount,
        favoritesCount: favCount,
        apiCallsToday: usageToday.count,
        apiCallsTotal: usageTotal.count,
      }
    });
  });

  app.post('/api/profile/update', requireAuth, async (req, res) => {
    try {
      const { name, bio, avatar_color, units, currentPassword, newPassword } = req.body;
      const user = stmts.getUserByEmail.get(req.user.email);

      // If changing password, verify current password first
      if (newPassword) {
        if (!currentPassword)
          return res.status(400).json({ success: false, message: 'Current password required to set a new one' });
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid)
          return res.status(400).json({ success: false, message: 'Current password is incorrect' });
        if (newPassword.length < 6)
          return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        stmts.updateUser.run(name || null, null, hash, req.user.email);
      } else if (name) {
        stmts.updateProfile.run(name, req.user.email);
      }

      // Update preferences
      const existing = stmts.getPrefs.get(req.user.email) || { avatar_color: '#22d3ee', bio: '', units: 'metric' };
      stmts.upsertPrefs.run(
        req.user.email,
        avatar_color || existing.avatar_color,
        bio !== undefined ? bio : existing.bio,
        units || existing.units
      );

      return res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
      console.error('Profile update error:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ─────────────────────────────────────────────────────────
  //  EXPORT ROUTES
  // ─────────────────────────────────────────────────────────
  function toCSV(headers, rows) {
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
  }

  // Export weather history as CSV
  app.get('/api/export/history.csv', requireAuth, (req, res) => {
    const rows = stmts.getAllHistory.all(req.user.email);
    const headers = ['id','city_name','country','temp','feels_like','humidity','wind_speed','description','units','recorded_at'];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="weather_history.csv"');
    return res.send(toCSV(headers, rows));
  });

  // Export favorites as CSV
  app.get('/api/export/favorites.csv', requireAuth, (req, res) => {
    const rows = stmts.getAllFavorites.all(req.user.email);
    const headers = ['id','city_name','country','lat','lon','added_at'];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="favorites.csv"');
    return res.send(toCSV(headers, rows));
  });

  // Export weather history as JSON
  app.get('/api/export/history.json', requireAuth, (req, res) => {
    const rows = stmts.getAllHistory.all(req.user.email);
    res.setHeader('Content-Disposition', 'attachment; filename="weather_history.json"');
    return res.json({ exported_at: new Date().toISOString(), email: req.user.email, history: rows });
  });

  // Admin: export all users as CSV
  app.get('/api/admin/export/users.csv', requireAdmin, (req, res) => {
    const rows = stmts.getAllUsersWithVerified.all();
    const headers = ['email','name','role','banned','verified','created_at'];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    return res.send(toCSV(headers, rows));
  });

  // ─────────────────────────────────────────────────────────
  //  START SERVER
  // ─────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`Weather app running on http://localhost:${PORT}`);
    console.log(`SQLite database: ${DB_PATH}`);
  });

  process.on('SIGINT',  () => { db.close(); process.exit(0); });
  process.on('SIGTERM', () => { db.close(); process.exit(0); });
}

// Boot
initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
