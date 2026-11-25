import { OAuth2Client } from "google-auth-library";
import { env } from "./env.js";

// 프론트(Google Identity Services)가 받은 ID 토큰을 서버가 검증하는 방식이다.
// 이 방식에는 Client Secret이나 redirect URI가 필요 없다. (인증 코드 콜백 방식이 아님)
export const GOOGLE_CLIENT_ID = env.googleClientId;

// 구글 공개키(certs)를 내부적으로 캐시하므로 인스턴스 하나를 재사용한다. (Spring의 싱글톤 Bean)
// 공개키 조회가 응답 없이 멈춰도 로그인 요청이 무한정 기다리지 않게 요청 기한과 재시도 한도를 둔다. (최악 약 6초 후 503)
export const googleClient = new OAuth2Client({
  transporterOptions: { timeout: 3000, retryConfig: { retry: 1, noResponseRetries: 1 } },
});
