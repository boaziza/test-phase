const { db, Query } = require('../appwrite');

const DB          = process.env.APPWRITE_DATABASE_ID;
const DEVICES_COL = process.env.APPWRITE_DEVICES_ID;

// Cache valid tokens for 5 minutes to avoid hitting Appwrite on every request
const _deviceCache = new Map();
const DEVICE_TTL   = 5 * 60 * 1000;

function _cacheGet(token) {
  const entry = _deviceCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _deviceCache.delete(token); return null; }
  return entry.stationId;
}

function _cacheSet(token, stationId) {
  _deviceCache.set(token, { stationId, expiresAt: Date.now() + DEVICE_TTL });
}

function _cacheDelete(token) {
  _deviceCache.delete(token);
}

async function requireDevice(req, res, next) {
  // owners and managers can use any device
  if (req.user.role !== 'pompiste') return next();

  if (!DEVICES_COL) {
    // devices collection not configured — skip check
    return next();
  }

  const token = req.headers['x-device-token'];
  if (!token) {
    return res.status(403).json({ error: 'device_not_registered' });
  }

  // fast path from cache
  const cached = _cacheGet(token);
  if (cached) {
    if (cached !== req.user.stationId) {
      return res.status(403).json({ error: 'device_wrong_station' });
    }
    return next();
  }

  try {
    const result = await db.listDocuments(DB, DEVICES_COL, [
      Query.equal('token', token),
      Query.equal('stationId', req.user.stationId),
      Query.limit(1),
    ]);

    if (!result.documents.length) {
      return res.status(403).json({ error: 'device_not_registered' });
    }

    _cacheSet(token, req.user.stationId);
    return next();
  } catch {
    // if Appwrite is unreachable, fail open so pompistes aren't locked out
    return next();
  }
}

module.exports = { requireDevice, _cacheDelete };
