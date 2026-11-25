// 인증 업무 로직 (Spring @Service + @Transactional 역할). req/res는 받지 않는다.
//
// 잠금 순서 규칙(데드락/경쟁 방지): 항상 auth_sessions 행 → refresh_tokens 행 순서로 잠근다.
//   - 로그인:   세션 INSERT(새 행 X락) → 토큰 INSERT
//   - 재발급:   세션 SELECT ... FOR UPDATE → 토큰 SELECT ... FOR UPDATE → UPDATE/INSERT
//   - 로그아웃: 세션 SELECT ... FOR UPDATE → UPDATE
// 같은 로그인에 대한 재발급/로그아웃은 세션 행 잠금에서 줄을 서므로 동시에 둘 다 성공할 수 없다.
import { UniqueConstraintError } from "sequelize";
import { sequelize } from "../config/db.js";
import { User } from "../models/user.model.js";
import { AuthSession } from "../models/auth-session.model.js";
import { RefreshToken } from "../models/refresh-token.model.js";
import {
  SESSION_TTL_SEC,
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  signAccessToken,
  SessionExpiredError,
} from "./token.service.js";
import { addSeconds, nowSeconds } from "../utils/time.js";

// ---------------- 최초 로그인 / 자동 가입 ----------------

/**
 * 검증된 구글 payload로 회원을 찾거나 만든다. google_sub 기준이며 이메일로 연결하지 않는다.
 * 같은 구글 계정으로 동시에 첫 로그인해도 UNIQUE 제약 덕분에 한 행만 생긴다.
 */
export async function findOrCreateGoogleUser({ googleSub, email, name }) {
  const now = nowSeconds();
  let user = await User.findOne({ where: { googleSub } });

  if (!user) {
    try {
      user = await User.create({
        googleSub,
        email,
        nickname: makeNickname(name, email),
        createdAt: now,
        lastLoginAt: now,
      });
      return user;
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      // 동시에 다른 요청이 먼저 가입시켰다 → 그 행을 사용한다.
      user = await User.findOne({ where: { googleSub } });
      if (!user) throw err;
    }
  }

  user.lastLoginAt = now;
  if (email !== null) user.email = email; // 구글 쪽 이메일이 바뀌었을 수 있으므로 갱신(확인된 이메일만)
  await user.save({ fields: ["lastLoginAt", "email"] });
  return user;
}

function makeNickname(name, email) {
  const base = (name && name.trim()) || (email && email.split("@")[0]) || "사용자";
  return Array.from(base).slice(0, 50).join(""); // VARCHAR(50)은 문자 수 기준. 이모지(서로게이트 쌍)도 안전하게 자름
}

/**
 * 새 로그인 기록 + 첫 리프레시 토큰 해시를 한 트랜잭션으로 저장하고, 커밋 성공 후 액세스 JWT를 만든다.
 * 트랜잭션이 실패하면 아무 것도 저장되지 않고 예외가 그대로 올라간다(→ 500).
 */
export async function issueLoginTokens(userId) {
  const refreshToken = generateRefreshToken();

  // managed transaction: 콜백이 정상 종료하면 COMMIT, 예외가 나면 ROLLBACK (@Transactional과 동일)
  const session = await sequelize.transaction(async (t) => {
    const now = nowSeconds();
    const created = await AuthSession.create(
      { userId, createdAt: now, expiresAt: addSeconds(now, SESSION_TTL_SEC), revokedAt: null },
      { transaction: t },
    );
    await RefreshToken.create(
      {
        sessionId: created.id,
        tokenHash: hashRefreshToken(refreshToken),
        issuedAt: now,
        expiresAt: created.expiresAt,
        usedAt: null,
      },
      { transaction: t },
    );
    return created;
  });

  const { accessToken, expiresIn } = signAccessToken({
    userId,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt,
  });
  return { accessToken, expiresIn, refreshToken, refreshExpiresAt: session.expiresAt };
}

// ---------------- RTR 재발급 ----------------

/**
 * 리프레시 토큰 회전(RTR).
 * @returns {Promise<
 *   | { ok: true, accessToken: string, expiresIn: number, refreshToken: string, refreshExpiresAt: Date }
 *   | { ok: false, reason: "invalid" | "reuse_detected" | "session_expired" }
 * >}
 * reuse_detected 인 경우 세션 폐기는 이미 COMMIT 된 상태다. 컨트롤러가 401을 응답한다.
 */
export async function rotateRefreshToken(rawToken) {
  if (!isWellFormedRefreshToken(rawToken)) return { ok: false, reason: "invalid" };
  const tokenHash = hashRefreshToken(rawToken);

  // 1) 잠금 없이 어느 세션의 토큰인지만 찾는다. 이 결과는 "힌트"일 뿐이며 아래에서 잠근 뒤 다시 읽는다.
  const hint = await RefreshToken.findOne({ where: { tokenHash }, attributes: ["id", "sessionId"] });
  if (!hint) return { ok: false, reason: "invalid" };

  const newRefreshToken = generateRefreshToken();

  // 예외(DB 장애 등)가 아닌 "업무상 거절"은 throw하지 않고 값으로 반환한다.
  // 그래야 재사용 감지 시의 세션 폐기 UPDATE가 롤백되지 않고 COMMIT 된다.
  const outcome = await sequelize.transaction(async (t) => {
    // 2) 세션 행 먼저 잠금 (SELECT ... FOR UPDATE)
    const session = await AuthSession.findByPk(hint.sessionId, { transaction: t, lock: t.LOCK.UPDATE });
    // 3) 같은 순서로 토큰 행 잠금 재조회 — 처음 조회 결과를 믿지 않는다
    const token = await RefreshToken.findOne({
      where: { id: hint.id, tokenHash },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // 잠금 대기/조회에 시간이 걸렸을 수 있으므로 "잠금을 얻은 뒤의 현재 시각"으로 만료를 판단한다.
    const now = nowSeconds();

    // 4) 세션 폐기/만료, 토큰 존재 확인
    if (!session || !token || token.sessionId !== session.id) return { ok: false, reason: "invalid" };
    if (session.revokedAt !== null) return { ok: false, reason: "invalid" };
    if (session.expiresAt <= now) return { ok: false, reason: "session_expired" };

    // 5) 이미 사용된 토큰이 유효한 로그인에 다시 옴 = 탈취 의심 → 이 로그인 전체 폐기 (COMMIT됨)
    if (token.usedAt !== null) {
      session.revokedAt = now;
      await session.save({ transaction: t, fields: ["revokedAt"] });
      return { ok: false, reason: "reuse_detected" };
    }
    if (token.expiresAt <= now) return { ok: false, reason: "invalid" };

    // 6) 기존 토큰 소비 + 새 토큰 저장을 한 트랜잭션으로
    token.usedAt = now;
    await token.save({ transaction: t, fields: ["usedAt"] });
    // 7) 새 토큰 만료 = 세션의 최초 만료 (연장하지 않음)
    await RefreshToken.create(
      {
        sessionId: session.id,
        tokenHash: hashRefreshToken(newRefreshToken),
        issuedAt: now,
        expiresAt: session.expiresAt,
        usedAt: null,
      },
      { transaction: t },
    );
    return { ok: true, userId: session.userId, sessionId: session.id, sessionExpiresAt: session.expiresAt };
  });

  if (!outcome.ok) return outcome;

  // 8) COMMIT 이후에만 새 액세스 JWT를 만든다 (만료는 세션 잔여 시간 이하)
  // 커밋 도중 세션이 만료됐다면 예외 대신 만료 결과로 바꿔 컨트롤러의 401 + 쿠키 삭제 경로로 보낸다.
  let signed;
  try {
    signed = signAccessToken(outcome);
  } catch (err) {
    if (err instanceof SessionExpiredError) return { ok: false, reason: "session_expired" };
    throw err; // 그 밖의 서명 오류는 삼키지 않는다
  }
  const { accessToken, expiresIn } = signed;
  return {
    ok: true,
    accessToken,
    expiresIn,
    refreshToken: newRefreshToken,
    refreshExpiresAt: outcome.sessionExpiresAt,
  };
}

// ---------------- 현재 로그인 로그아웃 ----------------

/**
 * 리프레시 토큰이 속한 "현재 로그인" 하나만 폐기한다. 다른 기기의 로그인은 그대로 둔다.
 * 토큰이 없거나/모르는 토큰이거나/이미 폐기된 경우도 조용히 성공(멱등). DB 오류는 예외로 올라간다.
 */
export async function logoutSession(rawToken) {
  if (!isWellFormedRefreshToken(rawToken)) return;
  const tokenHash = hashRefreshToken(rawToken);

  const hint = await RefreshToken.findOne({ where: { tokenHash }, attributes: ["sessionId"] });
  if (!hint) return;

  await sequelize.transaction(async (t) => {
    const session = await AuthSession.findByPk(hint.sessionId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!session || session.revokedAt !== null) return;
    session.revokedAt = nowSeconds();
    await session.save({ transaction: t, fields: ["revokedAt"] });
  });
}

// ---------------- 보호 API용 세션 확인 ----------------

/**
 * 액세스 JWT의 sid 세션이 살아 있고 sub 회원의 것인지 확인한다. (require-auth 미들웨어에서 사용)
 */
export async function isSessionActiveForUser(sessionId, userId) {
  const session = await AuthSession.findByPk(sessionId, { attributes: ["id", "userId", "expiresAt", "revokedAt"] });
  if (!session) return false;
  if (session.revokedAt !== null) return false;
  if (session.expiresAt <= new Date()) return false;
  return session.userId === userId;
}

export async function findUserById(userId) {
  return User.findByPk(userId, { attributes: ["id", "nickname", "email", "xp"] });
}

export async function updateNickname(userId, nickname) {
  await User.update({ nickname }, { where: { id: userId } });
  return findUserById(userId);
}
