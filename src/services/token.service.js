import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15분
export const SESSION_TTL_SEC = 14 * 24 * 60 * 60; // 로그인 최대 14일

// ---------- 리프레시 토큰 (opaque 난수 문자열) ----------

// 32바이트 난수 → base64url 43글자
export function generateRefreshToken() {
  return randomBytes(32).toString("base64url");
}

// DB에는 원문 대신 SHA-256 32바이트 Buffer만 저장한다 (BINARY(32)).
export function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest();
}

const REFRESH_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
export function isWellFormedRefreshToken(token) {
  return typeof token === "string" && REFRESH_TOKEN_FORMAT.test(token);
}

// ---------- 액세스 JWT ----------

// 로그인(세션)이 이미 만료되어 액세스 토큰을 만들 수 없을 때 던진다. 그 밖의 서명 오류와 구분하기 위한 전용 예외.
export class SessionExpiredError extends Error {
  constructor() {
    super("이미 만료된 로그인에 대해 액세스 토큰을 발급할 수 없습니다.");
    this.name = "SessionExpiredError";
  }
}

/**
 * 액세스 JWT 발급. 만료는 min(지금+15분, 로그인 만료시각) 이다.
 * @returns {{ accessToken: string, expiresIn: number }} expiresIn은 초 단위
 */
export function signAccessToken({ userId, sessionId, sessionExpiresAt }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionExpSec = Math.floor(sessionExpiresAt.getTime() / 1000);
  const expiresIn = Math.min(ACCESS_TOKEN_TTL_SEC, sessionExpSec - nowSec);
  if (expiresIn <= 0) {
    // 호출 측에서 세션 만료를 먼저 확인하지만, 커밋 도중 만료될 수 있어 전용 예외로 알린다.
    throw new SessionExpiredError();
  }
  // iat 를 명시해 만료 계산과 서명이 같은 시각을 쓰게 한다(초가 바뀌어도 exp 가 세션 만료를 넘지 않음).
  const accessToken = jwt.sign({ sid: sessionId, iat: nowSec }, env.jwt.secret, {
    algorithm: "HS256",
    subject: String(userId),
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    expiresIn,
  });
  return { accessToken, expiresIn };
}

const USER_ID_FORMAT = /^[1-9][0-9]{0,9}$/; // INT UNSIGNED 범위의 양의 정수 문자열

/**
 * 액세스 JWT 서명/만료/iss/aud를 검증하고 sub/sid 형식을 확인한다.
 * 실패 시 null (어떤 이유로 실패했는지는 클라이언트에 구분해 알리지 않는다).
 * @returns {{ userId: number, sessionId: number } | null}
 */
export function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret, {
      algorithms: ["HS256"], // alg:none, RS256 혼동 공격 차단
      issuer: env.jwt.issuer,
      audience: env.jwt.audience,
    });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) return null; // TokenExpiredError/NotBeforeError 포함
    throw err;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { sub, sid } = payload;
  if (typeof sub !== "string" || !USER_ID_FORMAT.test(sub)) return null;
  const userId = Number(sub);
  if (userId > 0xffffffff) return null;
  if (!Number.isSafeInteger(sid) || sid <= 0 || sid > 0xffffffff) return null;
  return { userId, sessionId: sid };
}
