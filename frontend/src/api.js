// Same-origin calls (Vite proxies /api and /ws to the backend container).
const TOKEN_KEY = "sp_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Called when the backend rejects our token (expired/invalid). Drop the dead
// token and reload so the app falls back to the login screen — instead of
// getting stuck showing "Invalid token" with the dialer frozen on "Connecting…".
function handleAuthFailure() {
  if (!getToken()) return; // already logged out; avoid reload loop on the login call
  clearToken();
  localStorage.removeItem("sp_user");
  window.location.reload();
}

async function req(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    // 401 on a request that carried a token = the session expired (JWT is 12h).
    // The /api/login call has no token, so a 401 there is just bad credentials.
    if (res.status === 401 && t) handleAuthFailure();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export const api = {
  login: (username, password) =>
    req("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  sipConfig: () => req("/api/sip-config"),
  calls: (page = 1, pageSize = 15) =>
    req(`/api/calls?page=${page}&pageSize=${pageSize}`),
  // Claim the next outbound call so the backend tags it to this user.
  claim: (number) =>
    req("/api/calls/claim", {
      method: "POST",
      body: JSON.stringify({ number }),
    }),
  // Start a "call two numbers at once" conference. Returns { room }.
  startConference: (phone_1, phone_2) =>
    req("/api/conference/start", {
      method: "POST",
      body: JSON.stringify({ phone_1, phone_2 }),
    }),
  endConference: (room) =>
    req(`/api/conference/${room}/end`, { method: "POST" }),
  // Fetch a recording with auth and return an object URL for <audio>.
  async recordingUrl(uniqueid) {
    const res = await fetch(`/api/recordings/${uniqueid}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error("recording unavailable");
    return URL.createObjectURL(await res.blob());
  },
};

// Live call-state events pushed by the backend (AMI-derived).
export function connectEvents(onEvent) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${getToken()}`);
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {}
  };
  return ws;
}
