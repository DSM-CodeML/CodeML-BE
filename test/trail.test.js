import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORIGIN, login, models, resetDatabase, sequelize, startServer } from "./helpers.js";
import { addDaysToDateString, toKstDateString } from "../src/utils/time.js";

const { Submission, UserActivity, TrailLesson, TrailLessonProblem } = models;

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

async function newMember(sub) {
  const { body, accessToken } = await login(base, sub);
  return { userId: body.user.id, accessToken };
}

function getTrail(accessToken) {
  const headers = { Origin: ORIGIN };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${base}/api/trail`, { headers });
}

async function trailOf(accessToken) {
  const res = await getTrail(accessToken);
  assert.equal(res.status, 200);
  return res.json();
}

// 채점을 거치지 않고 정답 기록만 만든다(레슨 상태 계산만 볼 때).
async function markSolved(userId, ...problemIds) {
  for (const problemId of problemIds) {
    await Submission.create({ userId, problemId, result: "Accepted", language: "Python 3", code: "#", createdAt: new Date() });
  }
}

const lessonsOf = (body, chapterN = 1) => body.chapters.find((c) => c.n === chapterN).lessons;
const statuses = (body) => lessonsOf(body).map((l) => l.status);

describe("GET /api/trail", () => {
  it("토큰 없이는 401", async () => {
    const res = await getTrail(null);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).status, "error");
  });

  it("신규 회원: 첫 레슨이 current, 같은 챕터는 todo, 진행 0", async () => {
    const { accessToken } = await newMember("trail-new");
    const res = await getTrail(accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();

    assert.deepEqual(body.trail, { id: 1, eyebrow: "Trail 1 · Core path", title: "AI Engineer Curriculum" });
    assert.deepEqual(
      body.chapters.map((c) => `${c.n}. ${c.title} (${c.lessons.length})`),
      ["1. Python Basics (7)", "2. AI Fundamentals (0)", "3. Algorithms (0)", "4. Machine Learning (0)"],
    );
    assert.deepEqual(
      lessonsOf(body).map((l) => `${l.n}. ${l.title}`),
      ["1. Hello, World", "2. Variables & types", "3. Printing & formatting", "4. Input & output", "5. Conditionals", "6. Loops", "7. Functions"],
    );
    assert.deepEqual(statuses(body), ["current", "todo", "todo", "todo", "todo", "todo", "todo"]);
    assert.equal(body.currentLessonId, lessonsOf(body)[0].id);
    assert.equal(body.streak, 0);
    assert.deepEqual(body.xp, { today: 0, goal: 50 });

    const printing = lessonsOf(body)[2];
    assert.equal(printing.tag, "Foundation");
    assert.deepEqual(
      printing.steps.map((s) => [s.type, s.problems.map((p) => p.title)]),
      [
        ["basic", ["Print a word", "Print a sentence", "Print with quotes", "Print two lines"]],
        ["practice", ["Print a name", "Print a greeting"]],
        ["test", ["Print it your way"]],
      ],
    );
    assert.ok(printing.steps.every((s) => s.problems.every((p) => p.done === false)));
  });

  it("레슨을 다 풀면 done 이 되고 다음 레슨이 current", async () => {
    const { userId, accessToken } = await newMember("trail-next");
    await markSolved(userId, 1); // Hello, World 레슨의 유일한 문제
    const body = await trailOf(accessToken);
    assert.deepEqual(statuses(body).slice(0, 3), ["done", "current", "todo"]);
    assert.equal(body.currentLessonId, lessonsOf(body)[1].id);
    assert.equal(lessonsOf(body)[0].steps[0].problems[0].done, true);
  });

  it("current 보다 뒤의 레슨도 다 풀었으면 done", async () => {
    const { userId, accessToken } = await newMember("trail-skip");
    await markSolved(userId, 5); // Conditionals 만 풀었다
    const body = await trailOf(accessToken);
    assert.deepEqual(statuses(body), ["current", "todo", "todo", "todo", "done", "todo", "todo"]);
  });

  it("문제가 없는 레슨은 done 이 되지 않고, startProblemId 는 null", async () => {
    const { userId, accessToken } = await newMember("trail-empty");
    await markSolved(userId, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); // 문제가 있는 레슨 전부
    const body = await trailOf(accessToken);
    assert.deepEqual(statuses(body), ["done", "done", "done", "done", "done", "current", "todo"]);
    const loops = lessonsOf(body)[5];
    assert.equal(loops.startProblemId, null);
    assert.ok(loops.steps.every((s) => s.problems.length === 0));
  });

  it("startProblemId: 안 푼 첫 문제, 다 풀었으면 첫 문제", async () => {
    const { userId, accessToken } = await newMember("trail-start");
    let printing = lessonsOf(await trailOf(accessToken))[2];
    assert.equal(printing.startProblemId, 6);

    await markSolved(userId, 6, 7);
    printing = lessonsOf(await trailOf(accessToken))[2];
    assert.equal(printing.startProblemId, 8);

    await markSolved(userId, 8, 9, 10, 11); // test 단계만 남김
    printing = lessonsOf(await trailOf(accessToken))[2];
    assert.equal(printing.startProblemId, 12);

    await markSolved(userId, 12);
    printing = lessonsOf(await trailOf(accessToken))[2];
    assert.equal(printing.status, "done");
    assert.equal(printing.startProblemId, 6);
  });

  it("current 가 속한 챕터의 다음 챕터부터는 locked", async () => {
    const { accessToken } = await newMember("trail-locked");
    const lesson = await TrailLesson.create({ chapterId: 2, ord: 1, title: "What is AI", tag: "Concept" });
    await TrailLessonProblem.create({ lessonId: lesson.id, problemId: 1, step: "basic", ord: 1 });
    try {
      const body = await trailOf(accessToken);
      assert.deepEqual(lessonsOf(body, 2).map((l) => l.status), ["locked"]);
    } finally {
      await lesson.destroy(); // 다른 테스트의 챕터 구성에 영향을 주지 않도록 되돌린다
    }
  });

  it("xp.today: 오늘(KST) 처음 맞힌 문제들의 XP 합, 다른 날은 제외", async () => {
    const { userId, accessToken } = await newMember("trail-xp");
    const res = await fetch(`${base}/api/problems/6/submit`, {
      method: "POST",
      headers: { Origin: ORIGIN, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code: 'print("Python")' }),
    });
    assert.equal((await res.json()).result, "Accepted");

    // 어제 푼 문제는 오늘 XP 에 들어가지 않는다
    const yesterday = addDaysToDateString(toKstDateString(new Date()), -1);
    await UserActivity.create({
      userId,
      activityType: "PROBLEM_SOLVED",
      refId: "7",
      activityDate: yesterday,
      createdAt: new Date(Date.now() - 86_400_000),
    });

    const body = await trailOf(accessToken);
    assert.deepEqual(body.xp, { today: 10, goal: 50 });
    assert.equal(body.streak, 2); // 어제 + 오늘
    assert.equal(lessonsOf(body)[2].steps[0].problems[0].done, true);
  });
});
