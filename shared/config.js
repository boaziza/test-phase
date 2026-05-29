// ── SHARED APPWRITE CLIENT ────────────────────────────────────
(function () {
  const client = new Appwrite.Client()
    .setEndpoint("https://fra.cloud.appwrite.io/v1")
    .setProject("68a9b3e90029e6a10ff5");

  const BASE = "/test-phase";

  window._AW = {
    client,
    account:    new Appwrite.Account(client),
    SERVER_URL: "https://test-phase-9v3j.onrender.com/api",

    SIGNIN_URL:            `${BASE}/auth/sign-in`,
    SIGNUP_URL:            `${BASE}/auth/sign-up`,
    FIRST_LOGIN_URL:       `${BASE}/auth/first-login`,
    OWNER_DASHBOARD_URL:   `${BASE}/portal/dashboard`,
    MANAGER_DASHBOARD_URL: `${BASE}/portal/dashboard`,
    POMPISTE_URL:          `${BASE}/pompiste/index`,
  };
})();
