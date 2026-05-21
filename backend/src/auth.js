import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { findUser, verifyPassword } from "./db.js";

// DB-backed auth: look the user up in the `users` table and verify the
// scrypt-hashed password. Returns a JWT carrying the username as `sub`.
export async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  try {
    const user = await findUser(username);
    if (!user || !verifyPassword(password, user.pass_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ sub: user.username }, config.jwtSecret, {
      expiresIn: "12h",
    });
    return res.json({ token, username: user.username });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
