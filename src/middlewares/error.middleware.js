// 공통 오류 처리 (Spring @RestControllerAdvice 역할)
// 모든 오류 본문을 {"status":"error","message":"..."} 로 통일하고, SQL/토큰/스택은 응답에 넣지 않는다.
import { HttpError } from "../utils/http-error.js";

export function notFoundHandler(req, res) {
  // 예: POST 전용 API를 브라우저 주소창(GET)으로 열면 여기로 온다. (과거 "Cannot GET ..." 증상)
  res.status(404).json({ status: "error", message: `${req.method} ${req.path} 에 해당하는 API가 없습니다.` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ status: "error", message: err.message });
  }

  // express.json()(body-parser)이 만든 오류들
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ status: "error", message: "요청 본문이 올바른 JSON이 아닙니다." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ status: "error", message: "요청 본문이 너무 큽니다." });
  }
  if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ status: "error", message: "잘못된 요청입니다." });
  }

  // 그 외(DB 장애, 설정 오류, 버그)는 500. 서버 로그에는 이름/메시지/스택만 남긴다(err.sql 등은 출력하지 않음).
  console.error(`[error] ${req.method} ${req.path}:`, err?.stack ?? err);
  res.status(500).json({ status: "error", message: "서버 오류가 발생했습니다." });
}
