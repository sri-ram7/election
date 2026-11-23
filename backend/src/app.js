import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { requireAdmin } from "./middleware/adminAuth.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createVoterRouter } from "./routes/voterRoutes.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(currentDirectory, "../../frontend/dist");

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
  app.use(helmet());
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
        sameSite: "lax",
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
