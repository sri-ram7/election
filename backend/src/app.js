import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import { requireAdmin } from "./middleware/adminAuth.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createVoterRouter } from "./routes/voterRoutes.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(currentDirectory, "../../frontend/dist");

// Origins that may call this API. In production the FRONTEND_ORIGIN env var
// must be set to the deployed frontend URL, e.g. https://election-iaj4.onrender.com
function getAllowedOrigins() {
  const origins = ["http://127.0.0.1:5173", "http://localhost:5173"];
  if (process.env.FRONTEND_ORIGIN) {
    origins.push(process.env.FRONTEND_ORIGIN.trim());
  }
  return origins;
}

export function createApp({
  Voter,
  ImportRun,
  adminConfig,
  sessionStore,
  production = false,
}) {
  const app = express();
  if (production) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // CORS must come before helmet and routing so preflight OPTIONS requests
  // receive Access-Control-Allow-* headers.
  app.use(
    cors({
      origin: getAllowedOrigins(),
      credentials: true,          // allow cookies (session, CSRF)
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token"],
    }),
  );

  app.use(helmet({
    // helmet's crossOriginResourcePolicy blocks fetch from a different origin;
    // set to cross-origin so the frontend can reach the API.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));
  app.use(express.json({ limit: "16kb" }));
  app.use(
    session({
      name: "voter.sid",
      secret: adminConfig.sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: production,
        // Cross-origin deployments (frontend on a different domain) require
        // sameSite "none" with secure:true so the browser sends the cookie.
        // On localhost (dev) "lax" is used so cookies work without HTTPS.
        sameSite: production ? "none" : "lax",
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", createAuthRouter(adminConfig));
  app.use(
    "/api/voters",
    requireAdmin,
    createVoterRouter({ Voter, ImportRun }),
  );

  if (existsSync(path.join(frontendDirectory, "index.html"))) {
    app.use(express.static(frontendDirectory, { index: false }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(frontendDirectory, "index.html"));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (process.env.NODE_ENV !== "test") {
      console.error(error);
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({
      error:
        status < 500
          ? error.message
          : "The request could not be completed",
    });
  });
  return app;
}
