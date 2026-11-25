import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  ORIGIN,
  GOOGLE_CLIENT_ID,
  cookieFrom,
  getMe,
  googleCalls,
  login,
  logout,
  models,
  refresh,
  resetDatabase,
  sequelize,
  startServer,
} from "./helpers.js";
import { hashRefreshToken } from "../src/services/token.service.js";

const { User, AuthSession, RefreshToken } = models;
let server;
let base;

before(async () => {
  await resetDatabase();
  ({ server, base } = await startServer());
});

after(async () => {
  try {
    if (server) await new Promise((r) => server.close(r));
  } finally {
    await sequelize.close();
  }
});

async function sessionOf(refreshToken) {
  const row = await RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(refreshToken) } });
  return AuthSession.findByPk(row.sessionId);
}

function signWith(payload, opts = {}) {
  return jwt.sign(payload, opts.secret ?? process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: opts.issuer ?? process.env.JWT_ISSUER,
    audience: opts.audience ?? process.env.JWT_AUDIENCE,
    expiresIn: opts.expiresIn ?? 900,
    ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
  });
}

async function expectErrorBody(res, status) {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.equal(body.status, "error");
  assert.equal(typeof body.message, "string");
  return body;
}

describe("스키마: 마이그레이션과 모델 일치", () => {
  it("실제 MySQL 컬럼 타입/제약이 설계와 같다", async () => {
    const [cols] = await sequelize.query(
      `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLLATION_NAME co
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('users','auth_sessions','refresh_tokens')`,
    );
    const m = Object.fromEntries(cols.map((r) => [`${r.t}.${r.c}`, r]));
    assert.equal(m["users.id"].ty, "int unsigned");
    assert.equal(m["users.google_sub"].ty, "varchar(255)");
    assert.equal(m["users.google_sub"].co, "utf8mb4_bin");
    assert.equal(m["users.email"].n, "YES");
    assert.equal(m["auth_sessions.revoked_at"].ty, "datetime");
    assert.equal(m["refresh_tokens.id"].ty, "bigint unsigned");
    assert.equal(m["refresh_tokens.token_hash"].ty, "binary(32)");
    assert.equal(m["refresh_tokens.session_id"].ty, "int unsigned");
    assert.equal(m["refresh_tokens.used_at"].n, "YES");

    // 모델 속성 → 컬럼 매핑이 실제 테이블에 모두 존재
    for (const model of [User, AuthSession, RefreshToken]) {
      for (const attr of Object.values(model.getAttributes())) {
        assert.ok(m[`${model.getTableName()}.${attr.field}`], `${model.name}.${attr.field} 컬럼 없음`);
      }
    }

    const [fks] = await sequelize.query(
      `SELECT TABLE_NAME t, REFERENCED_TABLE_NAME r FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
          AND TABLE_NAME IN ('auth_sessions','refresh_tokens') ORDER BY t`, // 인증 테이블의 FK만 본다(다른 기능 테이블 제외)
    );
    assert.deepEqual(fks.map((f) => `${f.t}->${f.r}`), ["auth_sessions->users", "refresh_tokens->auth_sessions"]);
  });

  it("google_sub는 대소문자를 구분한다", async () => {
    const now = new Date();
    await User.create({ googleSub: "CaseSub", nickname: "a", createdAt: now, lastLoginAt: now });
    await User.create({ googleSub: "casesub", nickname: "b", createdAt: now, lastLoginAt: now });
    assert.equal(await User.count({ where: { googleSub: "CaseSub" } }), 1);
  });
});

describe("POST /api/auth/google 최초 로그인", () => {
  it("검증된 구글 토큰으로 가입+로그인, 쿠키/응답 형식", async () => {
    const { res, body, refreshToken } = await login(base, "sub-1");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(body.message, "로그인 성공");
    assert.equal(body.user.nickname, "user-sub-1");
    assert.equal(typeof body.user.id, "number");
    assert.equal(googleCalls.at(-1).audience, GOOGLE_CLIENT_ID);

    const cookie = cookieFrom(res).raw;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Path=\/api\/auth/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Expires=/);
    assert.match(refreshToken, /^[A-Za-z0-9_-]{43}$/);

    // 액세스 JWT 클레임
    const claims = jwt.decode(body.accessToken, { complete: true });
    assert.equal(claims.header.alg, "HS256");
    assert.equal(claims.payload.sub, String(body.user.id));
    assert.equal(claims.payload.iss, process.env.JWT_ISSUER);
    assert.equal(claims.payload.aud, process.env.JWT_AUDIENCE);
    assert.equal(claims.payload.exp - claims.payload.iat, 900);

    // DB: 해시만 저장, 세션 14일
    const row = await RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    assert.ok(Buffer.isBuffer(row.tokenHash) && row.tokenHash.length === 32);
    assert.equal(typeof row.id, "string", "BIGINT id는 문자열");
    const session = await AuthSession.findByPk(row.sessionId);
    assert.equal(session.id, claims.payload.sid);
    const days = (session.expiresAt - session.createdAt) / 86_400_000;
    assert.equal(days, 14);
    assert.equal(row.expiresAt.getTime(), session.expiresAt.getTime());
  });

  it("같은 구글 계정 재로그인: users 1행, 세션/토큰은 새로 생성", async () => {
    const before = { s: await AuthSession.count(), t: await RefreshToken.count() };
    const { res } = await login(base, "sub-1");
    assert.equal(res.status, 200);
    assert.equal(await User.count({ where: { googleSub: "sub-1" } }), 1);
    assert.equal(await AuthSession.count(), before.s + 1);
    assert.equal(await RefreshToken.count(), before.t + 1);
  });

  it("같은 계정 동시 최초 로그인도 users 1행", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => login(base, "sub-concurrent")));
    for (const r of results) assert.equal(r.res.status, 200);
    assert.equal(await User.count({ where: { googleSub: "sub-concurrent" } }), 1);
  });

  it("잘못된 구글 토큰은 401이고 회원이 생기지 않는다", async () => {
    const count = await User.count();
    const res = await fetch(`${base}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ idToken: "forged.token.value" }),
    });
    const body = await expectErrorBody(res, 401);
    assert.ok(!body.message.includes("forged"), "토큰 원문을 응답에 노출하지 않음");
    assert.equal(await User.count(), count);
  });

  it("구글 인증서 서버 장애는 401이 아니라 503", async () => {
    const res = await fetch(`${base}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ idToken: "network-failure" }),
    });
    await expectErrorBody(res, 503);
  });

  it("입력/Origin/Content-Type/JSON 오류", async () => {
    const post = (headers, body) => fetch(`${base}/api/auth/google`, { method: "POST", headers, body });
    const json = { "Content-Type": "application/json" };

    await expectErrorBody(await post({ ...json, Origin: "https://evil.example" }, '{"idToken":"google|x"}'), 403);
    await expectErrorBody(await post({ ...json }, '{"idToken":"google|x"}'), 403); // Origin 없음
    await expectErrorBody(await post({ ...json, Origin: `${ORIGIN}/` }, '{"idToken":"google|x"}'), 403); // 정확히 일치해야 함
    await expectErrorBody(await post({ "Content-Type": "text/plain", Origin: ORIGIN }, '{"idToken":"google|x"}'), 415);
    await expectErrorBody(
      await post({ "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN }, "idToken=google|x"),
      415,
    );
    const bad = await expectErrorBody(await post({ ...json, Origin: ORIGIN }, '{"idToken": '), 400);
    assert.match(bad.message, /JSON/);
    await expectErrorBody(await post({ ...json, Origin: ORIGIN }, "{}"), 400);
    await expectErrorBody(await post({ ...json, Origin: ORIGIN }, '{"idToken":123}'), 400);
    assert.equal(await User.count({ where: { googleSub: "x" } }), 0);
  });

  it("허용 Origin에는 CORS 헤더, 다른 Origin에는 없음", async () => {
    const ok = await fetch(`${base}/api/auth/google`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
    const evil = await fetch(`${base}/api/auth/google`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  });

  it("DB 오류 시 세션만 남는 부분 저장이 없고 500(내부 정보 비노출)", async () => {
    const sessions = await AuthSession.count();
    const users = await User.count();
    const spy = mock.method(RefreshToken, "create", async () => {
      throw new Error("simulated DB failure: INSERT INTO refresh_tokens ...");
    });
    const errLog = mock.method(console, "error", () => {});
    try {
      const { res, body } = await login(base, "sub-dbfail");
      assert.equal(res.status, 500);
      assert.deepEqual(body, { status: "error", message: "서버 오류가 발생했습니다." });
      assert.equal(cookieFrom(res), null, "실패 시 쿠키를 보내지 않음");
    } finally {
      spy.mock.restore();
      errLog.mock.restore();
    }
    assert.equal(await AuthSession.count(), sessions, "롤백되어 세션 행이 남지 않음");
    assert.equal(await User.count(), users + 1); // 회원 행 자체는 별도 단계라 남는다(다음 로그인에 재사용)
  });
});

describe("GET /api/auth/me 와 Bearer 인증", () => {
  let user;
  before(async () => {
    user = await login(base, "me-user");
  });

  it("정상 토큰이면 토큰의 회원 정보", async () => {
    const res = await getMe(base, user.accessToken);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      user: { id: user.body.user.id, nickname: "user-me-user", email: "me-user@example.com", xp: 0 },
    });
  });

  it("토큰 없음/형식 오류/위조/만료/다른 iss·aud/alg 공격은 401", async () => {
    const { sid } = jwt.decode(user.accessToken);
    const sub = String(user.body.user.id);
    const cases = {
      없음: null,
      위조서명: signWith({ sid }, { subject: sub, secret: "x".repeat(48) }),
      만료: signWith({ sid }, { subject: sub, expiresIn: -10 }),
      다른issuer: signWith({ sid }, { subject: sub, issuer: "other" }),
      다른audience: signWith({ sid }, { subject: sub, audience: "other" }),
      algNone: jwt.sign({ sid, sub, iss: process.env.JWT_ISSUER, aud: process.env.JWT_AUDIENCE }, null, {
        algorithm: "none",
      }),
      sub없음: signWith({ sid }),
      sid문자열: signWith({ sid: String(sid) }, { subject: sub }),
      없는세션: signWith({ sid: 999999 }, { subject: sub }),
    };
    for (const [name, token] of Object.entries(cases)) {
      const res = await getMe(base, token);
      assert.equal(res.status, 401, name);
      assert.match(res.headers.get("www-authenticate"), /^Bearer/, name);
    }
    for (const header of ["Basic abc", "Bearer", `Bearer ${user.accessToken} extra`, user.accessToken]) {
      const res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: header } });
      await expectErrorBody(res, 401);
    }
  });

  it("sub와 sid 세션의 회원이 다르면 401", async () => {
    const other = await login(base, "me-other");
    const { sid } = jwt.decode(user.accessToken);
    const forged = signWith({ sid }, { subject: String(other.body.user.id) });
    assert.equal((await getMe(base, forged)).status, 401);
  });

  it("세션이 만료되면 남은 JWT도 401", async () => {
    const u = await login(base, "me-expired");
    const s = await sessionOf(u.refreshToken);
    await s.update({ expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await getMe(base, u.accessToken)).status, 401);
    assert.equal((await refresh(base, u.refreshToken)).status, 401);
  });
});

describe("POST /api/auth/refresh (RTR)", () => {
  it("정상 재발급: 옛 토큰 usedAt, 새 행/쿠키, 새 액세스 토큰 동작", async () => {
    const u = await login(base, "rtr-1");
    const res = await refresh(base, u.refreshToken);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.tokenType, "Bearer");
    assert.equal(body.expiresIn, 900);
    const next = cookieFrom(res).value;
    assert.notEqual(next, u.refreshToken);

    const oldRow = await RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(u.refreshToken) } });
    const newRow = await RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(next) } });
    assert.ok(oldRow.usedAt instanceof Date);
    assert.equal(newRow.usedAt, null);
    assert.equal(newRow.sessionId, oldRow.sessionId);
    assert.equal(newRow.expiresAt.getTime(), oldRow.expiresAt.getTime(), "로그인 만료를 연장하지 않음");
    assert.equal(jwt.decode(body.accessToken).sid, oldRow.sessionId);
    assert.equal((await getMe(base, body.accessToken)).status, 200);
  });

  it("옛 토큰 재사용 → 세션 폐기가 DB에 커밋, 새 토큰/액세스 토큰도 거절", async () => {
    const u = await login(base, "rtr-reuse");
    const r1 = await refresh(base, u.refreshToken);
    const newToken = cookieFrom(r1).value;
    const { accessToken } = await r1.json();

    const reuse = await refresh(base, u.refreshToken);
    await expectErrorBody(reuse, 401);
    assert.match(cookieFrom(reuse).raw, /Expires=Thu, 01 Jan 1970/, "쿠키 삭제");

    // 별도 연결에서 다시 읽어도 폐기됨 = COMMIT 되었음
    const [[row]] = await sequelize.query(
      "SELECT s.revoked_at FROM auth_sessions s JOIN refresh_tokens r ON r.session_id = s.id WHERE r.token_hash = ?",
      { replacements: [hashRefreshToken(newToken)] },
    );
    assert.ok(row.revoked_at !== null);
    assert.equal((await refresh(base, newToken)).status, 401);
    assert.equal((await getMe(base, accessToken)).status, 401);
  });

  it("쿠키 없음/형식 오류/모르는 토큰/Origin 불일치", async () => {
    await expectErrorBody(await refresh(base, null), 401);
    await expectErrorBody(await refresh(base, "short"), 401);
    await expectErrorBody(await refresh(base, "A".repeat(43)), 401);
    const u = await login(base, "rtr-origin");
    await expectErrorBody(await refresh(base, u.refreshToken, "https://evil.example"), 403);
    await expectErrorBody(await refresh(base, u.refreshToken, null), 403);
    assert.equal((await refresh(base, u.refreshToken)).status, 200, "거절된 요청은 토큰을 소비하지 않음");
  });

  it("동시 재발급 2건: 둘 다 성공하지 않고, 재사용으로 로그인 폐기", async () => {
    const u = await login(base, "rtr-race");
    const results = await Promise.all([refresh(base, u.refreshToken), refresh(base, u.refreshToken)]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 401]);
    const winner = results.find((r) => r.status === 200);
    assert.equal((await refresh(base, cookieFrom(winner).value)).status, 401, "엄격 정책: 로그인 전체 폐기");
    assert.ok((await sessionOf(u.refreshToken)).revokedAt !== null);
  });

  it("동시 재발급 10건도 성공은 최대 1건", async () => {
    const u = await login(base, "rtr-race10");
    const results = await Promise.all(Array.from({ length: 10 }, () => refresh(base, u.refreshToken)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.ok((await sessionOf(u.refreshToken)).revokedAt !== null);
  });

  it("재발급과 로그아웃 경쟁: 로그인이 되살아나지 않음", async () => {
    for (let i = 0; i < 5; i++) {
      const u = await login(base, `rtr-vs-logout-${i}`);
      const [r, l] = await Promise.all([refresh(base, u.refreshToken), logout(base, u.refreshToken)]);
      assert.equal(l.status, 204);
      assert.ok((await sessionOf(u.refreshToken)).revokedAt !== null);
      if (r.status === 200) {
        const { accessToken } = await r.json();
        assert.equal((await refresh(base, cookieFrom(r).value)).status, 401);
        assert.equal((await getMe(base, accessToken)).status, 401);
      } else {
        assert.equal(r.status, 401);
      }
    }
  });

  it("세션 잔여시간이 15분보다 짧으면 액세스 JWT 만료도 그만큼으로 제한", async () => {
    const u = await login(base, "rtr-short");
    const s = await sessionOf(u.refreshToken);
    const soon = new Date(Math.floor(Date.now() / 1000) * 1000 + 120_000);
    await s.update({ expiresAt: soon });
    await RefreshToken.update({ expiresAt: soon }, { where: { sessionId: s.id } });
    const res = await refresh(base, u.refreshToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.expiresIn <= 120 && body.expiresIn > 100, `expiresIn=${body.expiresIn}`);
    assert.ok(jwt.decode(body.accessToken).exp <= soon.getTime() / 1000);
    const cookieExpires = new Date(/Expires=([^;]+)/.exec(cookieFrom(res).raw)[1]);
    assert.equal(cookieExpires.getTime(), soon.getTime());
  });

  // 처리 도중 시간이 흘러 세션이 만료되는 경우를 Date.now 를 앞당겨 재현한다.
  // 시계는 고정해 두고(요청 처리가 느려도 저절로 만료되지 않게), when(args) 가 참인 호출에서만 앞당긴다.
  async function expireDuring(target, method, sub, { before: advanceBefore = false, when = () => true } = {}) {
    const u = await login(base, sub);
    const s = await sessionOf(u.refreshToken);
    const soon = new Date(Math.floor(Date.now() / 1000) * 1000 + 3_000); // 3초 뒤 만료
    await s.update({ expiresAt: soon });
    await RefreshToken.update({ expiresAt: soon }, { where: { sessionId: s.id } });

    const frozen = Date.now();
    let offset = 0;
    const clock = mock.method(Date, "now", () => frozen + offset);
    const original = target[method].bind(target);
    const spy = mock.method(target, method, async (...args) => {
      const advance = when(args);
      if (advance && advanceBefore) offset = 10_000;
      const result = await original(...args);
      if (advance && !advanceBefore) offset = 10_000;
      return result;
    });
    const errLog = mock.method(console, "error", () => {});
    try {
      return { u, res: await refresh(base, u.refreshToken), errLog };
    } finally {
      spy.mock.restore();
      clock.mock.restore();
      errLog.mock.restore();
    }
  }

  it("잠금을 얻은 시점에 이미 세션이 만료됐으면 500이 아니라 401 + 쿠키 삭제", async () => {
    // 잠금 대기 중에 시간이 흐른 상황: 토큰 행 잠금 조회 직전에 시계를 앞당긴다.
    const { u, res, errLog } = await expireDuring(RefreshToken, "findOne", "rtr-expire-lock", {
      before: false,
      when: ([opts]) => Boolean(opts?.lock), // 힌트 조회가 아니라 잠금 조회 직후에만 시계를 앞당긴다
    });
    // 잠금을 얻은 뒤의 시각으로 만료를 판단해야 한다. 잠금 전에 시각을 읽으면 토큰이 소비돼 아래 단언에서 실패한다.
    assert.equal(res.status, 401);
    assert.match(cookieFrom(res).raw, /refresh_token=;/);
    assert.equal(errLog.mock.callCount(), 0, "500 오류 로그가 없어야 함");
    const row = await RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(u.refreshToken) } });
    assert.equal(row.usedAt, null, "만료로 거절되었으므로 토큰은 소비되지 않음");
  });

  it("커밋 도중 세션이 만료돼 JWT 발급이 실패해도 500이 아니라 401 + 쿠키 삭제", async () => {
    // 새 토큰 INSERT(트랜잭션 안) 직후 시계를 앞당겨 커밋 후 signAccessToken 에서 만료되게 한다.
    const { u, res, errLog } = await expireDuring(RefreshToken, "create", "rtr-expire-commit");
    assert.equal(res.status, 401);
    assert.match(cookieFrom(res).raw, /refresh_token=;/);
    assert.equal(errLog.mock.callCount(), 0, "500 오류 로그가 없어야 함");
    // 잠금 단계 만료가 아니라 커밋 이후 만료임을 확인: 이전 토큰은 소비됐고 교체 토큰 행이 커밋돼 있어야 한다.
    const old = await RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(u.refreshToken) } });
    assert.notEqual(old.usedAt, null, "이전 토큰이 소비돼야 함");
    assert.equal(await RefreshToken.count({ where: { sessionId: old.sessionId } }), 2, "교체 토큰이 커밋돼야 함");
  });
});

describe("POST /api/auth/logout", () => {
  it("노트북 로그아웃 시 휴대폰 로그인은 유지", async () => {
    const laptop = await login(base, "two-devices");
    const phone = await login(base, "two-devices");
    const res = await logout(base, laptop.refreshToken);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.match(cookieFrom(res).raw, /Path=\/api\/auth/);
    assert.match(cookieFrom(res).raw, /Expires=Thu, 01 Jan 1970/);

    assert.equal((await getMe(base, laptop.accessToken)).status, 401, "로그아웃한 액세스 토큰 거절");
    assert.equal((await refresh(base, laptop.refreshToken)).status, 401);
    assert.equal((await getMe(base, phone.accessToken)).status, 200);
    assert.equal((await refresh(base, phone.refreshToken)).status, 200);
  });

  it("멱등: 이미 로그아웃/쿠키 없음/모르는 토큰도 204", async () => {
    const u = await login(base, "logout-idem");
    assert.equal((await logout(base, u.refreshToken)).status, 204);
    assert.equal((await logout(base, u.refreshToken)).status, 204);
    assert.equal((await logout(base, null)).status, 204);
    assert.equal((await logout(base, "B".repeat(43))).status, 204);
  });

  it("허용되지 않은 Origin은 403이고 로그인 유지", async () => {
    const u = await login(base, "logout-origin");
    await expectErrorBody(await logout(base, u.refreshToken, "https://evil.example"), 403);
    assert.equal((await getMe(base, u.accessToken)).status, 200);
  });

  it("DB 오류는 성공으로 위장하지 않음(500)", async () => {
    const u = await login(base, "logout-dbfail");
    const spy = mock.method(RefreshToken, "findOne", async () => {
      throw new Error("simulated DB down");
    });
    const errLog = mock.method(console, "error", () => {});
    try {
      await expectErrorBody(await logout(base, u.refreshToken), 500);
    } finally {
      spy.mock.restore();
      errLog.mock.restore();
    }
    assert.equal((await getMe(base, u.accessToken)).status, 200);
  });
});

describe("공통", () => {
  it("없는 API / POST 전용 API를 GET으로 열면 404 JSON", async () => {
    await expectErrorBody(await fetch(`${base}/api/nope`), 404);
    const body = await expectErrorBody(await fetch(`${base}/api/auth/google`), 404);
    assert.match(body.message, /GET \/api\/auth\/google/);
  });
});
