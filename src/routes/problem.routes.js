import { Router } from "express";
import { curriculum, mySubmissions, problem, problemSubmissions, run, submit } from "../controllers/problem.controller.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { requireJson } from "../middlewares/csrf.middleware.js";

export const problemRouter = Router();

// 개인 진행 정보 응답은 캐시 금지
problemRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

problemRouter.get("/curriculum", requireAuth, curriculum);
problemRouter.get("/problems/:id", requireAuth, problem);
problemRouter.get("/problems/:id/submissions", requireAuth, problemSubmissions);
problemRouter.post("/problems/:id/run", requireAuth, requireJson, run);
problemRouter.post("/problems/:id/submit", requireAuth, requireJson, submit);
problemRouter.get("/submissions/me", requireAuth, mySubmissions);
