import { Router } from "express";
import {
  createCsrfToken,
  loginLimiter,
  requireAdmin,
  requireCsrf,
  verifyAdminCredentials,
} from "../middleware/adminAuth.js";

export function createAuthRouter(adminConfig) {
  const router = Router();

  router.get("/session", (req, res) => {
    req.session.csrfToken ??= createCsrfToken();
    res.set("Cache-Control", "no-store");
    res.json({
      authenticated: Boolean(req.session.admin?.username),
      csrfToken: req.session.csrfToken,
    });
  });

  router.post("/login", loginLimiter, requireCsrf, (req, res, next) => {
    const { username, password } = req.body ?? {};
    if (!verifyAdminCredentials(username, password, adminConfig)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.admin = { username: adminConfig.username };
      req.session.csrfToken = createCsrfToken();
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.json({
          authenticated: true,
          csrfToken: req.session.csrfToken,
        });
      });
    });
  });

  router.post("/logout", requireAdmin, requireCsrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("voter.sid");
      res.status(204).end();
    });
  });

  return router;
}
