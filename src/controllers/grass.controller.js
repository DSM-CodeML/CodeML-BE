// HTTP 요청/응답 담당. 업무 로직은 grass.service.js 에 위임한다.
import { getGrass } from "../services/grass.service.js";
import { badRequest } from "../utils/http-error.js";
import { toKstDateString } from "../utils/time.js";

export const GRASS_MIN_YEAR = 2026;

// GET /api/grass/me?year=YYYY  (requireAuth 뒤에서 실행 — 항상 토큰의 회원 본인 잔디만 조회한다)
export async function getMyGrass(req, res) {
  const year = parseYear(req.query.year);
  res.json(await getGrass(req.auth.userId, { year }));
}

function parseYear(raw) {
  if (raw === undefined) return undefined;
  const thisYear = Number(toKstDateString(new Date()).slice(0, 4));
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw) || Number(raw) < GRASS_MIN_YEAR || Number(raw) > thisYear) {
    throw badRequest(`year는 ${GRASS_MIN_YEAR}부터 올해까지의 연도여야 합니다.`);
  }
  return Number(raw);
}
