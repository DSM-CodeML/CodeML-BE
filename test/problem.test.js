import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORIGIN, getMe, login, models, resetDatabase, sequelize, startServer } from "./helpers.js";

const { Submission, UserActivity } = models;

let server;
let base;

before(async () => {
  await resetDatabase();
  ({ server, base } = await startServer());
});

after(async () => {
  await new Promise((r) => server.close(r));
  await sequelize.close();
});

async function newMember(sub) {
  const { body, accessToken } = await login(base, sub);
  return { userId: body.user.id, accessToken };
}

function api(accessToken, path, { method = "GET", body } = {}) {
  const headers = { Origin: ORIGIN };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const ADD = "a, b = map(int, input().split())\nprint(a + b)"; // 문제 3(두 수 더하기) 정답

describe("인증", () => {
  it("토큰 없이는 전부 401", async () => {
    for (const [path, method] of [["/curriculum"], ["/problems/1"], ["/problems/1/run", "POST"], ["/problems/1/submit", "POST"], ["/problems/1/submissions"], ["/submissions/me"]]) {
      assert.equal((await api(null, path, { method })).status, 401, path);
    }
  });
});

describe("GET /api/curriculum", () => {
  it("신규 회원: 주차 5개, 1주차 문제 5개, 진행 0", async () => {
    const { accessToken } = await newMember("cur-new");
    const res = await api(accessToken, "/curriculum");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body.weeks.map((w) => w.n), ["1", "2", "3", "4", "5-6"]);
    assert.equal(body.weeks[0].problems.length, 5);
    assert.ok(body.weeks.every((w) => w.solved === 0));
    assert.equal(body.weeks[4].optional, true);
    assert.equal(body.last, null);
    assert.equal(body.streak, 0);
  });
});

describe("GET /api/problems/:id", () => {
  it("해설/개념/시작 코드와 공개 케이스만 준다", async () => {
    const { accessToken } = await newMember("prob-get");
    const body = await (await api(accessToken, "/problems/3")).json();
    assert.equal(body.title, "Add two numbers");
    assert.equal(body.level, "Easy");
    assert.equal(body.xp, 10);
    assert.match(body.solution, /<pre>/);
    assert.equal(body.cases.length, 1); // 숨김 케이스 2개는 보이지 않는다
    assert.deepEqual(body.cases[0].fields, [
      { label: "Input", value: "1 2" },
      { label: "Expected", value: "3" },
    ]);
  });

  it("없는 문제 404, 잘못된 id 400", async () => {
    const { accessToken } = await newMember("prob-404");
    assert.equal((await api(accessToken, "/problems/9999")).status, 404);
    assert.equal((await api(accessToken, "/problems/abc")).status, 400);
  });
});

describe("POST /api/problems/:id/run", () => {
  it("공개 케이스만 채점하고 저장하지 않는다", async () => {
    const { userId, accessToken } = await newMember("run-user");
    const body = await (await api(accessToken, "/problems/3/run", { method: "POST", body: { code: ADD } })).json();
    assert.equal(body.result, "Accepted");
    assert.equal(body.total, 1);
    assert.equal(await Submission.count({ where: { userId } }), 0);
  });

  it("code 가 없거나 너무 길면 400", async () => {
    const { accessToken } = await newMember("run-bad");
    for (const code of [undefined, "", "   ", 123, "x".repeat(8001)]) {
      assert.equal((await api(accessToken, "/problems/3/run", { method: "POST", body: { code } })).status, 400);
    }
  });
});

describe("POST /api/problems/:id/submit", () => {
  it("처음 정답: XP +10, 잔디 1건, 제출 저장. 같은 문제 재정답은 XP 없음", async () => {
    const { userId, accessToken } = await newMember("submit-ok");
    const first = await (await api(accessToken, "/problems/3/submit", { method: "POST", body: { code: ADD } })).json();
    assert.equal(first.result, "Accepted");
    assert.equal(first.passed, 3);
    assert.equal(first.xpGained, 10);

    const again = await (await api(accessToken, "/problems/3/submit", { method: "POST", body: { code: ADD } })).json();
    assert.equal(again.result, "Accepted");
    assert.equal(again.xpGained, 0);

    assert.equal((await (await getMe(base, accessToken)).json()).user.xp, 10);
    assert.equal(await Submission.count({ where: { userId } }), 2);
    assert.equal(await UserActivity.count({ where: { userId } }), 1);

    const cur = await (await api(accessToken, "/curriculum")).json();
    assert.equal(cur.weeks[0].solved, 1);
    assert.equal(cur.weeks[0].problems.find((p) => p.id === 3).done, true);
    assert.equal(cur.last.id, 3);
    assert.equal(cur.last.week, "1");
    assert.equal(cur.streak, 1);
  });

  it("같은 문제를 동시에 두 번 정답 제출해도 XP 는 한 번만", async () => {
    const { accessToken } = await newMember("submit-race");
    const post = () => api(accessToken, "/problems/3/submit", { method: "POST", body: { code: ADD } }).then((r) => r.json());
    const gained = (await Promise.all([post(), post()])).map((b) => b.xpGained).sort();
    assert.deepEqual(gained, [0, 10]);
    assert.equal((await (await getMe(base, accessToken)).json()).user.xp, 10);
  });

  it("오답/컴파일 오류는 저장하되 XP 는 없다", async () => {
    const { userId, accessToken } = await newMember("submit-wrong");
    const wrong = await (await api(accessToken, "/problems/3/submit", { method: "POST", body: { code: "print(0)" } })).json();
    assert.equal(wrong.result, "Wrong Answer");
    assert.equal(wrong.xpGained, 0);
    assert.equal(wrong.failed.caseNumber, 1);

    const compile = await (await api(accessToken, "/problems/3/submit", { method: "POST", body: { code: "print(" } })).json();
    assert.equal(compile.result, "Compile Error");

    assert.equal(await Submission.count({ where: { userId } }), 2);
    assert.equal(await UserActivity.count({ where: { userId } }), 0);
    assert.equal((await (await getMe(base, accessToken)).json()).user.xp, 0);
  });
});

describe("제출 목록", () => {
  it("문제별 목록은 모든 회원의 제출을 최신순으로 8개씩 주고 코드는 없다", async () => {
    const a = await newMember("list-a");
    const b = await newMember("list-b");
    for (let i = 0; i < 5; i += 1) {
      await api(a.accessToken, "/problems/1/submit", { method: "POST", body: { code: 'print("Hello, World!")' } });
      await api(b.accessToken, "/problems/1/submit", { method: "POST", body: { code: "print(0)" } });
    }
    const p1 = await (await api(a.accessToken, "/problems/1/submissions")).json();
    assert.equal(p1.perPage, 8);
    assert.equal(p1.total, 10);
    assert.equal(p1.items.length, 8);
    assert.deepEqual(new Set(p1.items.map((s) => s.nickname)), new Set(["user-list-a", "user-list-b"]));
    assert.ok(p1.items.every((s) => s.code === undefined));
    assert.equal((await (await api(a.accessToken, "/problems/1/submissions?page=2")).json()).items.length, 2);
    assert.equal((await api(a.accessToken, "/problems/1/submissions?page=0")).status, 400);
  });

  it("내 제출은 내 것만, 문제 제목과 함께", async () => {
    const { accessToken } = await newMember("list-me");
    await api(accessToken, "/problems/2/submit", { method: "POST", body: { code: "print(input())" } });
    const body = await (await api(accessToken, "/submissions/me")).json();
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].problemTitle, "Echo a line");
    assert.equal(body.items[0].result, "Accepted");
  });
});

describe("PATCH /api/auth/me", () => {
  it("닉네임을 바꾸고, 규칙에 맞지 않으면 400", async () => {
    const { accessToken } = await newMember("nick");
    const ok = await api(accessToken, "/auth/me", { method: "PATCH", body: { nickname: "  코드_ml1 " } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user.nickname, "코드_ml1");
    assert.equal((await (await getMe(base, accessToken)).json()).user.nickname, "코드_ml1");

    for (const nickname of ["a", "x".repeat(31), "bad name", "<b>", undefined, 5]) {
      assert.equal((await api(accessToken, "/auth/me", { method: "PATCH", body: { nickname } })).status, 400);
    }
    assert.equal((await api(null, "/auth/me", { method: "PATCH", body: { nickname: "abc" } })).status, 401);
  });
});
