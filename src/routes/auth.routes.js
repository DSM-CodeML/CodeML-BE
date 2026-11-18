// URL ↔ 컨트롤러 연결 (Spring의 @RequestMapping 역할). 미들웨어는 왼쪽부터 순서대로 실행된다.
import { Router } from "express";
import { googleLogin, logout, me, refresh } from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/require-auth.js";
import { requireAllowedOrigin, requireJson } from "../middlewares/csrf.middleware.js";

export const authRouter = Router();

// 토큰/개인정보 응답은 캐시 금지
authRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

authRouter.post("/google", requireAllowedOrigin, requireJson, googleLogin);
authRouter.get("/me", requireAuth, me);
authRouter.post("/refresh", requireAllowedOrigin, refresh);
authRouter.post("/logout", requireAllowedOrigin, logout);
