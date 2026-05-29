const { Client, Account } = require('node-appwrite');
const { db, Query } = require('../appwrite');

// Cache verified JWTs for 60 s to avoid hitting Appwrite on every request.
// Key: JWT string  Value: { user, expiresAt }
const _jwtCache = new Map();
const JWT_CACHE_TTL = 60_000;

function _cacheGet(jwt) {
  const entry = _jwtCache.get(jwt);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _jwtCache.delete(jwt); return null; }
  return entry.user;
}

function _cacheSet(jwt, user) {
  // Evict stale entries if cache grows large (shouldn't happen in normal use)
  if (_jwtCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _jwtCache) { if (now > v.expiresAt) _jwtCache.delete(k); }
  }
  _jwtCache.set(jwt, { user, expiresAt: Date.now() + JWT_CACHE_TTL });
}

async function verifyJWT(req, res, next) {
  const jwt = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  // Fast path: return cached user without any Appwrite roundtrip
  const cached = _cacheGet(jwt);
  if (cached) { req.user = cached; return next(); }

  try {
    const jwtClient = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setJWT(jwt);

    const account = await new Account(jwtClient).get();

    // prefs.role is the fast path (set by set-prefs.js); fall back to users collection
    let role      = account.prefs?.role      || null;
    let companyId = account.prefs?.companyId || null;
    let stationId = account.prefs?.stationId || null;

    if (!role && process.env.APPWRITE_USERS_ID) {
      try {
        const lookup = await db.listDocuments(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_USERS_ID,
          [Query.equal('userId', account.$id), Query.limit(1)]
        );
        if (lookup.documents.length > 0) {
          const u = lookup.documents[0];
          role      = u.role      || 'pompiste';
          companyId = u.companyId || companyId;
          stationId = u.stationId || stationId;
        }
      } catch {}
    }

    const user = {
      $id:      account.$id,
      email:    account.email,
      name:     account.name,
      role:     role || 'pompiste',
      companyId,
      stationId,
    };

    _cacheSet(jwt, user);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { verifyJWT, requireRole };
