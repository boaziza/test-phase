// shared/auth.js

// ── JWT cache — reuse the same JWT for 9 minutes (Appwrite JWTs last 15 min)
// Saves one Appwrite roundtrip per request.
let _cachedJwt = null;
let _jwtExpiresAt = 0;

async function _getJwt() {
  if (_cachedJwt && Date.now() < _jwtExpiresAt) return _cachedJwt;
  try {
    const { jwt } = await window._AW.account.createJWT();
    _cachedJwt    = jwt;
    _jwtExpiresAt = Date.now() + 9 * 60 * 1000; // 9 minutes
    return jwt;
  } catch (err) {
    console.warn("Could not create JWT. User may not be logged in.", err);
    return null;
  }
}

// ── Response cache — cache GET responses for 60 seconds.
// Busted automatically when a mutating call targets the same base route.
const _respCache = new Map(); // key → { data, expiresAt }
const RESP_TTL   = 60_000;

function _cacheKey(endpoint) {
  return endpoint.split("?")[0]; // strip query string for bust matching
}

function _cacheBust(endpoint) {
  const base = _cacheKey(endpoint);
  for (const key of _respCache.keys()) {
    if (key === base || key.startsWith(base)) _respCache.delete(key);
  }
}

// ── API FETCH ───────────────────────────────────────────────────────────────
// Wraps fetch() to the server URL and automatically includes the Appwrite JWT.
window.apiFetch = async function apiFetch(endpoint, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isGet  = method === "GET";

  // Owner in station-view mode: scope all GET requests to the viewed station
  if (isGet && window._dash?.state?.viewingStation && window._dash?.state?.role === "owner") {
    const sid = window._dash.state.viewingStation.$id;
    if (!endpoint.includes("station=")) {
      endpoint += (endpoint.includes("?") ? "&" : "?") + `station=${sid}`;
    }
  }

  // Return cached response for GETs that haven't expired
  // if (isGet) {
  //   const cached = _respCache.get(endpoint);
  //   if (cached && Date.now() < cached.expiresAt) {
  //     // Return a fake Response so callers can still do .json()
  //     return new Response(JSON.stringify(cached.data), {
  //       status: 200, headers: { "Content-Type": "application/json" },
  //     });
  //   }
  // }

  const jwt = await _getJwt();

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  const deviceToken = localStorage.getItem("rp_device_token");
  if (deviceToken) headers["X-Device-Token"] = deviceToken;

  const url = `${window._AW.SERVER_URL}${endpoint}`;
  const res  = await fetch(url, { ...options, headers });

  // Cache successful GET responses
  // if (isGet && res.ok) {
  //   const clone = res.clone();
  //   clone.json().then(data => {
  //     _respCache.set(endpoint, { data, expiresAt: Date.now() + RESP_TTL });
  //   }).catch(() => {});
  // }

  // Bust cache for mutating calls so stale data isn't served after a write
  // if (!isGet) _cacheBust(endpoint);

  return res;
};

// ── REQUIRE AUTH ────────────────────────────────────────────────────────────
// Checks if the user is logged in, fetches their role, and ensures they
// have permission to view the current page. If not, redirects to Sign In.
window.requireAuth = async function requireAuth(options = {}) {
  const allowedRoles = options.roles || [];
  
  try {
    // 1. Verify Appwrite session exists
    const user = await window._AW.account.get();
    
    const res  = await apiFetch("/users/me");

    if (!res.ok) throw new Error("Could not load profile.");

    const { user: data } = await res.json();
    const doc = data?.documents?.[0];

    if (!doc) throw new Error("Account not set up.");

    const profile = {
      userId: doc.userId,
      role: doc.role,
      name: doc.name,
      email: doc.email,
      stationId: doc.stationId,
      companyId: doc.companyId,
      prefs: user.prefs || {}
    };

    if (allowedRoles.length && !allowedRoles.includes(profile.role)) {
      const dest = profile.role === 'pompiste' ? window._AW.POMPISTE_URL : window._AW.OWNER_DASHBOARD_URL;
      window.location.replace(dest);
      return null;
    }

    // Cache it globally for other scripts to use synchronously
    window._SESSION = { profile };

    return profile;

  } catch (err) {
    console.error("Auth verification failed:", err);
    // Redirect to login if unauthenticated or network error
    window.location.replace(window._AW.SIGNIN_URL);
    return null;
  }
};
