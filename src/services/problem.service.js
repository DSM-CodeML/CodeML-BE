// 커리큘럼/문제/제출 업무 로직. req/res는 받지 않는다.
//
// 잠금 순서 규칙: 정답 처리는 항상 users 행 FOR UPDATE → submissions 조회/INSERT → users.xp UPDATE.
// 같은 회원이 같은 문제를 동시에 두 번 제출해도 users 행 잠금에서 줄을 서므로 XP 가 두 번 올라가지 않는다.
import { Op } from "sequelize";
import { sequelize } from "../config/db.js";
import { User } from "../models/user.model.js";
import { Week } from "../models/week.model.js";
import { Problem } from "../models/problem.model.js";
import { ProblemCase } from "../models/problem-case.model.js";
import { Submission } from "../models/submission.model.js";
import { ACTIVITY_TYPES, getGrass, recordActivity } from "./grass.service.js";
import { judge, RESULTS } from "./judge.service.js";
import { nowSeconds } from "../utils/time.js";
import { notFound } from "../utils/http-error.js";

export const LANGUAGE = "Python 3";
export const SUBMISSIONS_PER_PAGE = 8;
export const MY_SUBMISSIONS_LIMIT = 10;

/** 커리큘럼 + 내 진행 상황. 한 주차 = 코스 정보 + 문제 목록(done 은 내가 정답을 낸 적이 있는지). */
export async function getCurriculum(userId) {
  const [weeks, problems, solved, last, grass] = await Promise.all([
    Week.findAll({ order: [["ord", "ASC"]], raw: true }),
    Problem.findAll({ attributes: ["id", "weekN", "title", "level"], order: [["id", "ASC"]], raw: true }),
    Submission.findAll({
      attributes: ["problemId"],
      where: { userId, result: RESULTS.ACCEPTED },
      group: ["problem_id"],
      raw: true,
    }),
    Submission.findOne({ where: { userId }, order: [["id", "DESC"]], raw: true }),
    getGrass(userId),
  ]);
  const solvedIds = new Set(solved.map((r) => r.problemId));
  const weekOf = new Map(problems.map((p) => [p.id, p.weekN]));

  return {
    weeks: weeks.map((w) => {
      const list = problems
        .filter((p) => p.weekN === w.n)
        .map((p) => ({ id: p.id, title: p.title, level: p.level, done: solvedIds.has(p.id) }));
      return {
        n: w.n,
        course: w.course,
        libs: w.libs,
        project: w.project,
        optional: Boolean(w.optional),
        total: w.total,
        solved: list.filter((p) => p.done).length,
        problems: list,
      };
    }),
    last: last ? { week: weekOf.get(last.problemId), id: last.problemId, result: last.result, at: last.createdAt } : null,
    streak: grass.summary.currentStreak,
  };
}

/** 문제 한 개(해설/개념 포함)와 공개 샘플 케이스. 숨김 케이스는 내보내지 않는다. */
export async function getProblem(problemId) {
  const p = await Problem.findByPk(problemId, {
    include: [{ model: ProblemCase, where: { isSample: true }, required: false }],
  });
  if (!p) throw notFound("문제를 찾을 수 없습니다.");
  return {
    id: p.id,
    title: p.title,
    level: p.level,
    xp: p.xp,
    chapter: p.chapter,
    statement: p.statementHtml,
    solution: p.solutionHtml,
    concept: p.conceptHtml,
    starter: p.starterCode,
    cases: [...p.ProblemCases]
      .sort((a, b) => a.ord - b.ord)
      .map((c) => ({
        fields: [
          { label: "Input", value: c.inputText || "(no input)" },
          { label: "Expected", value: c.expectedOutput },
        ],
      })),
  };
}

async function loadCases(problemId, { samplesOnly }) {
  const where = { problemId, ...(samplesOnly ? { isSample: true } : {}) };
  const cases = await ProblemCase.findAll({ where, order: [["ord", "ASC"]], raw: true });
  if (cases.length === 0) throw notFound("문제를 찾을 수 없습니다."); // 문제가 없거나 케이스가 없다
  return cases;
}

/** 코드 실행: 공개 샘플 케이스만 채점하고 아무 것도 저장하지 않는다. */
export async function runCode(problemId, code) {
  return judge(code, await loadCases(problemId, { samplesOnly: true }));
}

/**
 * 제출: 모든 케이스로 채점하고 결과를 저장한다. 처음 정답이면 XP 와 잔디 활동을 같은 트랜잭션에서 올린다.
 * 채점(느림)은 트랜잭션 밖에서 끝내서 DB 잠금을 오래 잡지 않는다.
 */
export async function submitCode(userId, problemId, code) {
  const problem = await Problem.findByPk(problemId, { attributes: ["id", "xp"] });
  if (!problem) throw notFound("문제를 찾을 수 없습니다.");
  const verdict = await judge(code, await loadCases(problemId, { samplesOnly: false }));

  const { submission, xpGained } = await sequelize.transaction(async (t) => {
    await User.findByPk(userId, { attributes: ["id"], lock: t.LOCK.UPDATE, transaction: t });
    const now = nowSeconds();
    const created = await Submission.create(
      { userId, problemId, result: verdict.result, language: LANGUAGE, code, createdAt: now },
      { transaction: t },
    );
    let gained = 0;
    if (verdict.result === RESULTS.ACCEPTED) {
      const before = await Submission.count({
        where: { userId, problemId, result: RESULTS.ACCEPTED, id: { [Op.ne]: created.id } },
        transaction: t,
      });
      if (before === 0) {
        gained = problem.xp;
        await User.increment({ xp: gained }, { where: { id: userId }, transaction: t });
        await recordActivity({
          userId,
          type: ACTIVITY_TYPES.PROBLEM_SOLVED,
          refId: String(problemId),
          at: now,
          transaction: t,
        });
      }
    }
    return { submission: created, xpGained: gained };
  });

  return { ...verdict, submissionId: submission.id, xpGained };
}

/** 이 문제의 제출 목록(모든 회원, 최신순). 코드는 내보내지 않는다. */
export async function listProblemSubmissions(problemId, page) {
  if (!(await Problem.findByPk(problemId, { attributes: ["id"] }))) throw notFound("문제를 찾을 수 없습니다.");
  const { count, rows } = await Submission.findAndCountAll({
    where: { problemId },
    attributes: ["id", "result", "language", "createdAt"],
    include: [{ model: User, as: "user", attributes: ["nickname"] }],
    order: [["id", "DESC"]],
    limit: SUBMISSIONS_PER_PAGE,
    offset: (page - 1) * SUBMISSIONS_PER_PAGE,
  });
  return {
    total: count,
    page,
    perPage: SUBMISSIONS_PER_PAGE,
    items: rows.map((s) => ({
      id: s.id,
      nickname: s.user.nickname,
      result: s.result,
      language: s.language,
      createdAt: s.createdAt,
    })),
  };
}

/** 내 최근 제출(마이페이지용). */
export async function listMySubmissions(userId) {
  const rows = await Submission.findAll({
    where: { userId },
    attributes: ["id", "problemId", "result", "language", "createdAt"],
    include: [{ model: Problem, as: "problem", attributes: ["title"] }],
    order: [["id", "DESC"]],
    limit: MY_SUBMISSIONS_LIMIT,
  });
  return {
    items: rows.map((s) => ({
      id: s.id,
      problemId: s.problemId,
      problemTitle: s.problem.title,
      result: s.result,
      language: s.language,
      createdAt: s.createdAt,
    })),
  };
}
