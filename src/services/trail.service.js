// 트레일(학습 경로) 화면 데이터. req/res는 받지 않는다.
// 진행 상황은 따로 저장하지 않고 submissions(정답 여부)와 user_activities(오늘 푼 문제)에서 계산한다.
import { Trail } from "../models/trail.model.js";
import { TrailChapter } from "../models/trail-chapter.model.js";
import { TrailLesson } from "../models/trail-lesson.model.js";
import { TRAIL_STEPS, TrailLessonProblem } from "../models/trail-lesson-problem.model.js";
import { Problem } from "../models/problem.model.js";
import { Submission } from "../models/submission.model.js";
import { UserActivity } from "../models/user-activity.model.js";
import { ACTIVITY_TYPES, getGrass } from "./grass.service.js";
import { RESULTS } from "./judge.service.js";
import { toKstDateString } from "../utils/time.js";
import { notFound } from "../utils/http-error.js";

export const DAILY_XP_GOAL = 50;
export const LESSON_STATUS = Object.freeze({ DONE: "done", CURRENT: "current", TODO: "todo", LOCKED: "locked" });
// current 뒤로 미리 열어 두는(todo) 레슨 수. 그보다 뒤는 locked. (프론트 trail.html 목업: current 3 → 4·5·6 todo, 7 locked)
export const TODO_WINDOW = 3;

/**
 * 트레일 하나(현재는 ord 가 가장 앞선 대표 트레일)와 내 진행 상황.
 * 레슨 상태:
 *   - done    : 문제가 있고 전부 정답을 냈다
 *   - current : 트레일 전체에서 done 이 아닌 첫 레슨(최대 1개)
 *   - todo    : current 뒤로 같은 챕터 안의 TODO_WINDOW 개
 *   - locked  : 그보다 뒤의 레슨, 그리고 current 가 속한 챕터의 다음 챕터부터
 *   (done 이 가장 우선한다: current 보다 뒤라도 다 풀었으면 done)
 * now 는 테스트에서 "오늘"(KST)을 고정하려는 값이다. 컨트롤러는 넘기지 않는다.
 */
export async function getTrail(userId, { now = new Date() } = {}) {
  const trail = await Trail.findOne({ order: [["ord", "ASC"]], raw: true });
  if (!trail) throw notFound("트레일을 찾을 수 없습니다.");

  const chapters = await TrailChapter.findAll({ where: { trailId: trail.id }, order: [["ord", "ASC"]], raw: true });
  const lessons = chapters.length
    ? await TrailLesson.findAll({ where: { chapterId: chapters.map((c) => c.id) }, order: [["ord", "ASC"]], raw: true })
    : [];
  const links = lessons.length
    ? await TrailLessonProblem.findAll({ where: { lessonId: lessons.map((l) => l.id) }, order: [["ord", "ASC"]], raw: true })
    : [];
  const problemIds = [...new Set(links.map((l) => l.problemId))];

  const [problems, solved, grass, xpToday] = await Promise.all([
    problemIds.length ? Problem.findAll({ attributes: ["id", "title"], where: { id: problemIds }, raw: true }) : [],
    Submission.findAll({
      attributes: ["problemId"],
      where: { userId, result: RESULTS.ACCEPTED },
      group: ["problem_id"],
      raw: true,
    }),
    getGrass(userId, { now }),
    sumXpSolvedOn(userId, toKstDateString(now)),
  ]);
  const titleOf = new Map(problems.map((p) => [p.id, p.title]));
  const solvedIds = new Set(solved.map((r) => r.problemId));

  // 레슨별 단계 → 문제 목록 (단계는 basic → practice → test, 단계 안은 ord 순)
  const stepsOf = new Map(lessons.map((l) => [l.id, TRAIL_STEPS.map((type) => ({ type, problems: [] }))]));
  for (const link of links) {
    stepsOf.get(link.lessonId)[TRAIL_STEPS.indexOf(link.step)].problems.push({
      id: link.problemId,
      title: titleOf.get(link.problemId),
      done: solvedIds.has(link.problemId),
    });
  }

  // 트레일 순서(챕터 ord → 레슨 ord)대로 펼쳐서 상태를 매긴다.
  const ordered = chapters.flatMap((ch) =>
    lessons
      .filter((l) => l.chapterId === ch.id)
      .map((l) => {
        const steps = stepsOf.get(l.id);
        const all = steps.flatMap((s) => s.problems);
        return { chapterOrd: ch.ord, lesson: l, steps, all, done: all.length > 0 && all.every((p) => p.done) };
      }),
  );
  const currentIdx = ordered.findIndex((x) => !x.done);
  const current = currentIdx === -1 ? null : ordered[currentIdx];

  const statusOf = (x, i) => {
    if (x.done) return LESSON_STATUS.DONE;
    if (i === currentIdx) return LESSON_STATUS.CURRENT;
    const open = x.chapterOrd === current.chapterOrd && i - currentIdx <= TODO_WINDOW;
    return open ? LESSON_STATUS.TODO : LESSON_STATUS.LOCKED;
  };
  const byLesson = new Map(
    ordered.map((x, i) => [
      x.lesson.id,
      {
        id: x.lesson.id,
        n: x.lesson.ord,
        title: x.lesson.title,
        tag: x.lesson.tag,
        status: statusOf(x, i),
        steps: x.steps,
        // 안 푼 첫 문제, 다 풀었으면 첫 문제, 문제가 없으면 null
        startProblemId: (x.all.find((p) => !p.done) ?? x.all[0])?.id ?? null,
      },
    ]),
  );

  return {
    trail: { id: trail.id, eyebrow: trail.eyebrow, title: trail.title },
    chapters: chapters.map((ch) => ({
      id: ch.id,
      n: ch.ord,
      title: ch.title,
      lessons: lessons.filter((l) => l.chapterId === ch.id).map((l) => byLesson.get(l.id)),
    })),
    currentLessonId: current ? current.lesson.id : null,
    streak: grass.summary.currentStreak,
    xp: { today: xpToday, goal: DAILY_XP_GOAL },
  };
}

// 그날(KST) 처음 정답을 낸 문제들의 XP 합. 정답 처리 때 XP 와 PROBLEM_SOLVED 활동이 같은 트랜잭션에서 기록된다.
async function sumXpSolvedOn(userId, dateStr) {
  const rows = await UserActivity.findAll({
    attributes: ["refId"],
    where: { userId, activityType: ACTIVITY_TYPES.PROBLEM_SOLVED, activityDate: dateStr },
    raw: true,
  });
  const ids = rows.map((r) => r.refId).filter((id) => /^[1-9][0-9]{0,9}$/.test(id));
  if (ids.length === 0) return 0;
  const problems = await Problem.findAll({ attributes: ["xp"], where: { id: ids }, raw: true });
  return problems.reduce((sum, p) => sum + p.xp, 0);
}
