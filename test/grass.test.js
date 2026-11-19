import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { login, models, resetDatabase, sequelize, startServer } from "./helpers.js";
import { toKstDateString, addDaysToDateString } from "../src/utils/time.js";
import { ACTIVITY_TYPES, getGrass, recordActivity } from "../src/services/grass.service.js";

const { UserActivity } = models;
const TYPE = ACTIVITY_TYPES.PROBLEM_SOLVED;
const NOW = new Date("2026-11-19T03:00:00Z"); // KST 2026-11-19 12:00 (테스트에서 "오늘"을 고정)
const TODAY = "2026-11-19";

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

// 회원을 만들고 { userId, accessToken } 을 돌려준다.
async function newMember(sub) {
  const { body, accessToken } = await login(base, sub);
  return { userId: body.user.id, accessToken };
}

// KST 정오에 해당하는 시각 (날짜 경계 영향이 없다)
const atDay = (dateStr) => new Date(`${dateStr}T03:00:00Z`);

function getGrassApi(accessToken, query = "") {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  return fetch(`${base}/api/grass/me${query}`, { headers });
}

describe("GET /api/grass/me", () => {
  it("토큰 없이 호출하면 401", async () => {
    const res = await getGrassApi(null);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.status, "error");
  });

  it("활동이 없는 신규 회원: 최근 365일이 전부 count 0", async () => {
    const { accessToken } = await newMember("grass-empty");
    const res = await getGrassApi(accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.equal(body.timezone, "Asia/Seoul");
    assert.equal(body.days.length, 365);
    assert.ok(body.days.every((d) => d.count === 0 && d.level === 0));
    assert.deepEqual(body.summary, { totalCount: 0, activeDays: 0, currentStreak: 0, longestStreak: 0 });
    assert.equal(body.range.to, toKstDateString(new Date()));
    assert.equal(body.range.from, addDaysToDateString(body.range.to, -364));
  });

  it("기록한 활동이 응답에 반영된다", async () => {
    const { userId, accessToken } = await newMember("grass-api");
    await recordActivity({ userId, type: TYPE, refId: "p1" }); // 지금(KST 오늘)
    const body = await (await getGrassApi(accessToken)).json();
    const today = body.days.at(-1);
    assert.equal(today.date, toKstDateString(new Date()));
    assert.deepEqual([today.count, today.level], [1, 1]);
    assert.equal(body.summary.totalCount, 1);
    assert.equal(body.summary.currentStreak, 1);
  });

  it("year 검증: 잘못된 값은 400, 2026은 200이고 1월 1일부터", async () => {
    const { accessToken } = await newMember("grass-year");
    const nextYear = Number(toKstDateString(new Date()).slice(0, 4)) + 1;
    for (const bad of ["abc", "2025", String(nextYear), "2026.5", "", "02026"]) {
      const res = await getGrassApi(accessToken, `?year=${bad}`);
      assert.equal(res.status, 400, `year=${bad}`);
      const body = await res.json();
      assert.equal(body.status, "error");
    }
    const res = await getGrassApi(accessToken, "?year=2026");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.range.from, "2026-01-01");
    assert.equal(body.days[0].date, "2026-01-01");
  });
});

describe("recordActivity", () => {
  it("같은 날 같은 문제를 두 번 기록하면 1건, 두 번째는 created:false", async () => {
    const { userId } = await newMember("grass-dup");
    const first = await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay("2026-11-10") });
    const second = await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay("2026-11-10") });
    assert.deepEqual(first, { created: true });
    assert.deepEqual(second, { created: false });
    const grass = await getGrass(userId, { now: NOW });
    assert.equal(grass.days.find((d) => d.date === "2026-11-10").count, 1);
  });

  it("다른 날 같은 문제는 각각 1건씩 기록", async () => {
    const { userId } = await newMember("grass-days");
    assert.deepEqual(await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay("2026-11-10") }), { created: true });
    assert.deepEqual(await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay("2026-11-11") }), { created: true });
    const grass = await getGrass(userId, { now: NOW });
    assert.equal(grass.days.find((d) => d.date === "2026-11-10").count, 1);
    assert.equal(grass.days.find((d) => d.date === "2026-11-11").count, 1);
    assert.equal(grass.summary.totalCount, 2);
  });

  it("KST 날짜 경계: 14:59:59Z는 그날, 15:00:00Z는 다음 날", async () => {
    assert.equal(toKstDateString(new Date("2026-11-18T14:59:59Z")), "2026-11-18");
    assert.equal(toKstDateString(new Date("2026-11-18T15:00:00Z")), "2026-11-19");

    const { userId } = await newMember("grass-kst");
    await recordActivity({ userId, type: TYPE, refId: "a", at: new Date("2026-11-18T14:59:59Z") });
    await recordActivity({ userId, type: TYPE, refId: "b", at: new Date("2026-11-18T15:00:00Z") });
    const rows = await UserActivity.findAll({ where: { userId }, order: [["refId", "ASC"]] });
    assert.deepEqual(rows.map((r) => r.activityDate), ["2026-11-18", "2026-11-19"]);
    // 시각 컬럼은 UTC 그대로 저장된다
    assert.equal(rows[1].createdAt.toISOString(), "2026-11-18T15:00:00.000Z");
  });

  it("잘못된 type / 빈 refId / 너무 긴 refId는 예외", async () => {
    const { userId } = await newMember("grass-invalid");
    await assert.rejects(recordActivity({ userId, type: "NOPE", refId: "p1" }));
    await assert.rejects(recordActivity({ userId, type: TYPE, refId: "" }));
    await assert.rejects(recordActivity({ userId, type: TYPE, refId: "x".repeat(65) }));
    await assert.rejects(recordActivity({ userId, type: TYPE, refId: 123 }));
    assert.equal(await UserActivity.count({ where: { userId } }), 0);
  });

  it("존재하지 않는 회원(FK 위반)은 created:false로 묻히지 않고 예외", async () => {
    await assert.rejects(recordActivity({ userId: 4_000_000_000, type: TYPE, refId: "p1" }));
  });
});

describe("getGrass", () => {
  it("level 경계값: 1,2,3,5,6,9,10개 → 1,1,2,2,3,3,4", async () => {
    const { userId } = await newMember("grass-level");
    const cases = [
      [1, 1],
      [2, 1],
      [3, 2],
      [5, 2],
      [6, 3],
      [9, 3],
      [10, 4],
    ];
    for (const [i, [n]] of cases.entries()) {
      const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
      for (let j = 0; j < n; j += 1) await recordActivity({ userId, type: TYPE, refId: `p${j}`, at: atDay(date) });
    }
    const grass = await getGrass(userId, { now: NOW });
    for (const [i, [n, level]] of cases.entries()) {
      const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
      const day = grass.days.find((d) => d.date === date);
      assert.deepEqual([day.count, day.level], [n, level], date);
    }
  });

  it("다른 회원의 활동은 섞이지 않는다", async () => {
    const a = await newMember("grass-iso-a");
    const b = await newMember("grass-iso-b");
    await recordActivity({ userId: a.userId, type: TYPE, refId: "p1", at: atDay("2026-11-10") });
    await recordActivity({ userId: a.userId, type: TYPE, refId: "p2", at: atDay("2026-11-10") });
    await recordActivity({ userId: b.userId, type: TYPE, refId: "p1", at: atDay("2026-11-10") });
    const ga = await getGrass(a.userId, { now: NOW });
    const gb = await getGrass(b.userId, { now: NOW });
    assert.equal(ga.summary.totalCount, 2);
    assert.equal(gb.summary.totalCount, 1);
  });

  it("오늘 활동이 0이어도 어제부터 이어진 연속 기록은 유지된다 (currentStreak)", async () => {
    const { userId } = await newMember("grass-streak-today");
    await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay("2026-11-18") }); // 어제
    await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay("2026-11-17") }); // 그제
    const grass = await getGrass(userId, { now: NOW });
    assert.equal(grass.days.at(-1).date, TODAY);
    assert.equal(grass.days.at(-1).count, 0);
    assert.equal(grass.summary.currentStreak, 2);
    assert.equal(grass.summary.longestStreak, 2);
  });

  it("오늘 활동이 있으면 오늘부터 센다, 어제가 비면 끊긴다", async () => {
    const { userId } = await newMember("grass-streak-gap");
    await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay(TODAY) });
    await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay("2026-11-17") }); // 어제(18일)는 비어 있음
    const grass = await getGrass(userId, { now: NOW });
    assert.equal(grass.summary.currentStreak, 1);
  });

  it("중간에 빈 날이 있을 때 longestStreak 계산", async () => {
    const { userId } = await newMember("grass-longest");
    const dates = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07", "2026-11-18"];
    for (const date of dates) await recordActivity({ userId, type: TYPE, refId: "p1", at: atDay(date) });
    const grass = await getGrass(userId, { now: NOW });
    assert.equal(grass.summary.longestStreak, 4);
    assert.equal(grass.summary.activeDays, 7);
    assert.equal(grass.summary.totalCount, 7);
    assert.equal(grass.summary.currentStreak, 1); // 18일만 이어짐 (오늘 0개 → 어제부터)
  });

  it("지난 해를 조회하면 12월 31일까지, 올해는 오늘까지", async () => {
    const { userId } = await newMember("grass-year-range");
    const past = await getGrass(userId, { year: 2026, now: new Date("2027-03-05T03:00:00Z") });
    assert.deepEqual(past.range, { from: "2026-01-01", to: "2026-12-31" });
    assert.equal(past.days.length, 365);
    const current = await getGrass(userId, { year: 2026, now: NOW });
    assert.deepEqual(current.range, { from: "2026-01-01", to: TODAY });
  });
});
