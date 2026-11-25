// HTTP 요청/응답 담당 (Spring @RestController 역할). 업무 로직은 서비스에 위임한다.
// Express 5는 async 핸들러에서 throw/reject된 오류를 자동으로 error.middleware로 넘긴다.
import { env } from "../config/env.js";
import { verifyGoogleToken } from "../services/google-auth.service.js";
import {
  findOrCreateGoogleUser,
  findUserById,
  issueLoginTokens,
  logoutSession,
  rotateRefreshToken,
  updateNickname,
} from "../services/auth.service.js";
import { badRequest, unauthorized } from "../utils/http-error.js";

export const REFRESH_COOKIE = "refresh_token";

// 쿠키 설정/삭제에 같은 path/domain 조건을 써야 브라우저가 같은 쿠키로 인식한다.
const baseCookieOptions = {
  httpOnly: true, // JS에서 읽을 수 없음 (XSS로 탈취 방지)
  secure: env.cookieSecure, // 운영(HTTPS)에서 true
  sameSite: "lax",
  path: "/api/auth", // 인증 API에만 전송
};

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, { ...baseCookieOptions, expires: expiresAt });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, baseCookieOptions);
}

// POST /api/auth/google  { idToken }
export async function googleLogin(req, res) {
  const idToken = req.body?.idToken;
  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > 4096) {
    throw badRequest("idToken(문자열)이 필요합니다.");
  }

  // 구글 검증이 먼저. 검증 전에는 사용자 입력으로 회원을 만들지 않는다.
  const googleProfile = await verifyGoogleToken(idToken);
  const user = await findOrCreateGoogleUser(googleProfile);
  const tokens = await issueLoginTokens(user.id); // 여기서 COMMIT까지 끝난다

  // DB 커밋 성공 후에만 쿠키/응답을 보낸다.
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  res.status(200).json({
    message: "로그인 성공",
    accessToken: tokens.accessToken,
    tokenType: "Bearer",
    expiresIn: tokens.expiresIn,
    user: { id: user.id, nickname: user.nickname },
  });
}

// GET /api/auth/me  (requireAuth 뒤에서 실행 — req.auth는 미들웨어가 채움)
export async function me(req, res) {
  // 클라이언트가 보낸 userId가 아니라 검증된 토큰의 회원만 조회한다.
  const user = await findUserById(req.auth.userId);
  if (!user) throw unauthorized("회원 정보를 찾을 수 없습니다.");
  res.json({ user: { id: user.id, nickname: user.nickname, email: user.email, xp: user.xp } });
}

// PATCH /api/auth/me  { nickname }  (requireAuth 뒤에서 실행 — 토큰의 회원 본인만 수정한다)
// 닉네임은 중복을 허용한다(DB에 UNIQUE 없음). 같은 이름이 필요해지면 UNIQUE 와 409 를 추가한다.
export async function updateMe(req, res) {
  const nickname = typeof req.body?.nickname === "string" ? req.body.nickname.trim() : "";
  const length = Array.from(nickname).length; // 이모지도 1글자로 센다
  if (length < 2 || length > 30 || !/^[\p{L}\p{N}_]+$/u.test(nickname)) {
    throw badRequest("닉네임은 2~30자의 글자, 숫자, 밑줄(_)만 쓸 수 있습니다.");
  }
  const user = await updateNickname(req.auth.userId, nickname);
  res.json({ user: { id: user.id, nickname: user.nickname, email: user.email, xp: user.xp } });
}

// POST /api/auth/refresh  (refresh_token 쿠키)
export async function refresh(req, res) {
  const result = await rotateRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  if (!result.ok) {
    // invalid / reuse_detected 모두 401. reuse_detected의 세션 폐기는 이미 COMMIT 되었다.
    clearRefreshCookie(res);
    throw unauthorized("다시 로그인해 주세요.");
  }
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
  res.status(200).json({ accessToken: result.accessToken, tokenType: "Bearer", expiresIn: result.expiresIn });
}

// POST /api/auth/logout  (refresh_token 쿠키)
export async function logout(req, res) {
  await logoutSession(req.cookies?.[REFRESH_COOKIE]); // DB 오류면 예외 → 500 (성공으로 위장하지 않음)
  clearRefreshCookie(res);
  res.status(204).end();
}
