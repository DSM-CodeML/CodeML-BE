import { Router } from "express";
import { getMyGrass } from "../controllers/grass.controller.js";
import { requireAuth } from "../middlewares/require-auth.js";

export const grassRouter = Router();

// 개인 활동 정보 응답은 캐시 금지
grassRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

grassRouter.get("/me", requireAuth, getMyGrass);
