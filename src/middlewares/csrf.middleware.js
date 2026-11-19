// 쿠키를 쓰거나 로그인을 만드는 POST에 대한 CSRF 방어.
// - Origin 헤더가 허용 목록과 "정확히" 일치해야 한다. (브라우저는 POST에 항상 Origin을 붙인다)
// - /google 은 Content-Type: application/json 만 받는다. 다른 사이트의 <form> POST(text/plain, form-urlencoded)는
//   JSON을 보낼 수 없고, 교차 출처 fetch로 JSON을 보내려면 CORS preflight를 통과해야 하므로 차단된다.
// 구글 토큰 검증은 "토큰이 진짜인지"만 보장하고 "이 브라우저 사용자가 로그인하려 했는지"는 보장하지 않으므로 둘 다 필요하다.
import { env } from "../config/env.js";
import { HttpError, forbidden } from "../utils/http-error.js";

const allowed = new Set(env.allowedOrigins);

export function requireAllowedOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin || !allowed.has(origin)) {
    return next(forbidden("허용되지 않은 출처의 요청입니다."));
  }
  next();
}

export function requireJson(req, res, next) {
  if (!req.is("application/json")) {
    return next(new HttpError(415, "Content-Type은 application/json이어야 합니다."));
  }
  next();
}
