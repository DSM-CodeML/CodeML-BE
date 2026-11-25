// 통합 테스트 공통 준비: 실제 MySQL(테스트 DB) + 실제 Express 서버 + 구글 검증 경계만 모킹.
import { randomBytes } from "node:crypto";
import { mock } from "node:test";
import { OAuth2Client, gaxios } from "google-auth-library";

export const ORIGIN = "http://localhost:5173";
export const GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

process.env.FRONTEND_URL ??= ORIGIN;
process.env.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
process.env.JWT_SECRET ??= randomBytes(48).toString("base64url");
process.env.JWT_ISSUER ??= "codeml-api";
process.env.JWT_AUDIENCE ??= "codeml-web";
process.env.DB_HOST ??= "127.0.0.1";
process.env.DB_PORT ??= "3307";
process.env.DB_USER ??= "codeml";
process.env.DB_PASSWORD ??= "codeml";
process.env.DB_NAME ??= "codeml_test";

if (!process.env.DB_NAME.endsWith("_test")) {
  throw new Error("테스트는 테이블을 지우므로 DB_NAME이 _test 로 끝나는 DB에서만 실행합니다.");
}

// 구글 경계 모킹: 테스트용 idToken "google|<sub>|<email>|<name>" 을 검증된 payload로 바꿔 준다.
// 운영 코드에는 어떤 우회 경로도 없다. 라이브러리 메서드를 테스트 프로세스 안에서만 바꿔치기한다.
export const googleCalls = [];
mock.method(OAuth2Client.prototype, "verifyIdToken", async ({ idToken, audience }) => {
  googleCalls.push({ audience });
  if (audience !== GOOGLE_CLIENT_ID) throw new Error("Wrong recipient, payload audience != requiredAudience");
  if (idToken === "network-failure") {
    // 실제 라이브러리가 던지는 것과 같은 타입(name 은 "Error" 그대로)으로 재현한다.
    throw new gaxios.GaxiosError("request to https://www.googleapis.com/oauth2/v1/certs failed", {});
  }
  const [prefix, sub, email, name] = idToken.split("|");
  if (prefix !== "google" || !sub) throw new Error(`Invalid token signature: ${idToken}`);
  return {
    getPayload: () => ({
      iss: "https://accounts.google.com",
      aud: audience,
      sub,
      email,
      email_verified: true,
      name,
    }),
  };
});

const { runMigrations } = await import("../scripts/migrate.js");
const { sequelize } = await import("../src/config/db.js");
const { app } = await import("../src/app.js");
export const models = {
  ...(await import("../src/models/user.model.js")),
  ...(await import("../src/models/auth-session.model.js")),
  ...(await import("../src/models/refresh-token.model.js")),
  ...(await import("../src/models/user-activity.model.js")),
  ...(await import("../src/models/week.model.js")),
  ...(await import("../src/models/problem.model.js")),
  ...(await import("../src/models/problem-case.model.js")),
  ...(await import("../src/models/submission.model.js")),
};
export { sequelize, app };

export async function resetDatabase() {
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of ["submissions", "problem_cases", "problems", "weeks", "user_activities", "refresh_tokens", "auth_sessions", "users", "schema_migrations"]) {
    await sequelize.query(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
  await runMigrations({ log: () => {} });
}

export async function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, base });
    });
  });
}

// ---- HTTP 도우미 ----

export function cookieFrom(res, name = "refresh_token") {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!raw) return null;
  const value = decodeURIComponent(raw.split(";")[0].slice(name.length + 1));
  return { raw, value };
}

export async function login(base, sub, { email = `${sub}@example.com`, name = `user-${sub}` } = {}) {
  const res = await fetch(`${base}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ idToken: `google|${sub}|${email}|${name}` }),
  });
  const body = await res.json();
  return { res, body, refreshToken: cookieFrom(res)?.value, accessToken: body.accessToken };
}

export function refresh(base, refreshToken, origin = ORIGIN) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (refreshToken) headers.Cookie = `refresh_token=${refreshToken}`;
  return fetch(`${base}/api/auth/refresh`, { method: "POST", headers });
}

export function logout(base, refreshToken, origin = ORIGIN) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (refreshToken) headers.Cookie = `refresh_token=${refreshToken}`;
  return fetch(`${base}/api/auth/logout`, { method: "POST", headers });
}

export function getMe(base, accessToken) {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  return fetch(`${base}/api/auth/me`, { headers });
}
