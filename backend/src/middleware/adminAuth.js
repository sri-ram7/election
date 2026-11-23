import { randomBytes, timingSafeEqual } from "node:crypto";
import { rateLimit } from "express-rate-limit";

function constantTimeEqual(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

export function createCsrfToken() {
  return randomBytes(32).toString("hex");
}

export function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const actual = req.get("x-csrf-token");
  if (!expected || !actual || !constantTimeEqual(actual, expected)) {
    return res.status(403).json({ error: "Invalid or missing CSRF token" });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session?.admin?.username) {
    return res.status(401).json({ error: "Administrator login required" });
  }
  next();
}

export function verifyAdminCredentials(username, password, config) {
  return (
    typeof username === "string" &&
    typeof password === "string" &&
    constantTimeEqual(username, config.username) &&
    constantTimeEqual(password, config.password)
  );
}
