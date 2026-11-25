import { Router } from "express";
import { trail } from "../controllers/trail.controller.js";
import { requireAuth } from "../middlewares/require-auth.js";

export const trailRouter = Router();

// 개인 진행 정보 응답은 캐시 금지
trailRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

trailRouter.get("/", requireAuth, trail);
