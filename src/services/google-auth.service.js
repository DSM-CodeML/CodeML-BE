import { gaxios } from "google-auth-library";
import { GOOGLE_CLIENT_ID, googleClient } from "../config/google.js";
import { HttpError, unauthorized } from "../utils/http-error.js";

/**
 * 프론트가 보낸 구글 ID 토큰을 검증하고 신뢰할 수 있는 payload를 돌려준다.
 * verifyIdToken이 구글 공개키 서명, iss(accounts.google.com), aud(=우리 Client ID), exp를 확인한다.
 *
 * 주의: google-auth-library의 검증 실패 메시지에는 토큰 원문이 들어 있으므로 절대 로그로 남기지 않는다.
 */
export async function verifyGoogleToken(idToken) {
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  } catch (err) {
    if (isGoogleConnectivityError(err)) {
      // 구글 공개키를 못 받아온 경우: 사용자의 토큰 문제가 아니므로 401로 숨기지 않는다.
      console.error("[google-auth] 구글 인증서 조회 실패:", err.code ?? err.name);
      throw new HttpError(503, "구글 인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw unauthorized("유효하지 않은 구글 토큰입니다.");
  }

  const payload = ticket.getPayload();
  if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 255) {
    throw unauthorized("유효하지 않은 구글 토큰입니다.");
  }

  return {
    googleSub: payload.sub,
    // 확인되지 않은 이메일은 저장하지 않는다. 이메일로 계정을 연결하지도 않는다.
    email: payload.email_verified === true && typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

// 토큰 검증 실패는 일반 Error로 던져지고, 공개키 조회(네트워크/HTTP/시간 초과) 실패는 GaxiosError로 던져진다.
// GaxiosError 는 name 을 바꾸지 않으므로 이름이 아니라 실제 타입으로 구분한다.
function isGoogleConnectivityError(err) {
  return (
    err instanceof gaxios.GaxiosError ||
    err?.response !== undefined ||
    (typeof err?.code === "string" && /^E[A-Z]+/.test(err.code))
  );
}
