 import jwt from "jsonwebtoken";
import { config } from "./config.js";

// Demo auth: a single configured user. Swap for a real user store later.
export function login(req, res) {
  const { username, password } = req.body || {};
  if (username === config.login.user && password === config.login.password) {
    const token = jwt.sign({ sub: username }, config.jwtSecret, {
      expiresIn: "12h",
    });
    return res.json({ token, username });
  }
  return res.status(401).json({ error: "Invalid credentials" });
}

// Express middleware — verifies the Bearer token.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Used by the WS server to authenticate the ?token= query param.
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}
