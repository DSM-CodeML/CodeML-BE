// 잔디(활동 히트맵) 업무 로직. req/res는 받지 않는다.
// 활동 1건 = 회원이 하루에 대상(refId) 하나를 처음 달성한 것. 날짜는 KST 기준으로 자르고 시각은 UTC로 저장한다.
import { fn, col, Op, UniqueConstraintError } from "sequelize";
import { UserActivity } from "../models/user-activity.model.js";
import { addDaysToDateString, nowSeconds, toKstDateString } from "../utils/time.js";

export const ACTIVITY_TYPES = Object.freeze({ PROBLEM_SOLVED: "PROBLEM_SOLVED" });

// level 기준값: count가 이 값 이상이면 해당 단계. 0개 → 0, 1~2 → 1, 3~5 → 2, 6~9 → 3, 10 이상 → 4
export const GRASS_LEVEL_THRESHOLDS = Object.freeze([1, 3, 6, 10]);
// year 를 지정하지 않을 때 조회하는 최근 일수 (오늘 포함)
export const GRASS_DEFAULT_DAYS = 365;

export function levelOf(count) {
  return GRASS_LEVEL_THRESHOLDS.filter((threshold) => count >= threshold).length;
}

/**
 * 활동 1건을 기록한다. 나중에 채점 기능이 정답 처리 트랜잭션 안에서 호출한다. (클라이언트가 직접 부르는 API는 없다)
 * 같은 날 같은 대상의 중복 기록은 UNIQUE 제약으로 막고 { created: false } 를 돌려준다.
 * INSERT IGNORE 는 FK 오류까지 경고로 묻어 버리므로 쓰지 않는다.
 * @returns {Promise<{ created: boolean }>}
 */
export async function recordActivity({ userId, type, refId, at = nowSeconds(), transaction }) {
  if (!Object.values(ACTIVITY_TYPES).includes(type)) {
    throw new Error(`알 수 없는 활동 종류입니다: ${type}`);
  }
  if (typeof refId !== "string" || refId.length < 1 || refId.length > 64) {
    throw new Error("refId는 1~64자 문자열이어야 합니다.");
  }

  try {
    await UserActivity.create(
      { userId, activityType: type, refId, activityDate: toKstDateString(at), createdAt: at },
      { transaction },
    );
    return { created: true };
  } catch (err) {
    if (err instanceof UniqueConstraintError) return { created: false };
    throw err;
  }
}

/**
 * 회원의 잔디 데이터를 돌려준다. 활동이 없는 날도 count 0으로 채워 from~to 모든 날짜를 오름차순으로 반환한다.
 * year 가 없으면 오늘(KST) 포함 최근 365일, 있으면 그 해 1/1~12/31 (올해면 오늘까지).
 * now 는 테스트에서 "오늘"을 고정하려는 값이다.
 */
export async function getGrass(userId, { year, now = new Date() } = {}) {
  const today = toKstDateString(now);
  let from;
  let to;
  if (year === undefined) {
    from = addDaysToDateString(today, -(GRASS_DEFAULT_DAYS - 1));
    to = today;
  } else {
    from = `${String(year).padStart(4, "0")}-01-01`;
    const yearEnd = `${String(year).padStart(4, "0")}-12-31`;
    to = yearEnd < today ? yearEnd : today; // 올해(또는 미래)면 오늘까지만. 문자열 비교가 날짜 순서와 같다.
  }

  const rows = await UserActivity.findAll({
    attributes: ["activityDate", [fn("COUNT", col("id")), "count"]],
    where: { userId, activityDate: { [Op.between]: [from, to] } },
    group: ["activity_date"],
    raw: true,
  });
  // COUNT 는 bigNumberStrings 설정 때문에 문자열로 올 수 있어 Number 로 바꾼다.
  const counts = new Map(rows.map((r) => [normalizeDate(r.activityDate), Number(r.count)]));

  const days = [];
  for (let date = from; date <= to; date = addDaysToDateString(date, 1)) {
    const count = counts.get(date) ?? 0;
    days.push({ date, count, level: levelOf(count) });
  }

  return {
    range: { from, to },
    timezone: "Asia/Seoul",
    summary: summarize(days, today),
    days,
  };
}

function normalizeDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function summarize(days, today) {
  let totalCount = 0;
  let activeDays = 0;
  let longestStreak = 0;
  let run = 0;
  for (const { count } of days) {
    totalCount += count;
    if (count > 0) {
      activeDays += 1;
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
  }

  // 마지막 날부터 거꾸로 센다. 마지막 날이 오늘이고 오늘 활동이 0이면 어제부터 센다(하루가 끝나기 전엔 연속 기록을 끊지 않음).
  let i = days.length - 1;
  if (i >= 0 && days[i].date === today && days[i].count === 0) i -= 1;
  let currentStreak = 0;
  for (; i >= 0 && days[i].count > 0; i -= 1) currentStreak += 1;

  return { totalCount, activeDays, currentStreak, longestStreak };
}
