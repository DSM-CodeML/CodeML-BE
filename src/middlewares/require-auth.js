// Bearer 액세스 JWT 인증 미들웨어 (Spring Security의 OncePerRequestFilter + JWT 검증 역할)
// 성공하면 req.auth = { userId, sessionId } 를 채우고 다음 핸들러로 넘긴다.
import { verifyAccessToken } from "../services/token.service.js";
import { isSessionActiveForUser } from "../services/auth.service.js";
import { unauthorized } from "../utils/http-error.js";

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

export async function requireAuth(req, res, next) {
  const header = req.get("authorization");
  const match = header ? BEARER.exec(header) : null;
  if (!match) return reject(res, next, header ? "invalid_token" : null);

  const claims = verifyAccessToken(match[1]);
  if (!claims) return reject(res, next, "invalid_token");

  // 폐기/만료/다른 회원의 세션이면 거절. (DB 오류는 예외로 올라가 500 — 401로 숨기지 않는다)
  const active = await isSessionActiveForUser(claims.sessionId, claims.userId);
  if (!active) return reject(res, next, "invalid_token");

  req.auth = { userId: claims.userId, sessionId: claims.sessionId };
  next();
}

function reject(res, next, error) {
  res.set("WWW-Authenticate", error ? `Bearer error="${error}"` : "Bearer");
  next(unauthorized("유효한 액세스 토큰이 필요합니다."));
}
