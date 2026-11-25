// HTTP 요청/응답 담당. 업무 로직은 problem.service.js 에 위임한다. (requireAuth 뒤에서 실행)
import {
  getCurriculum,
  getProblem,
  listMySubmissions,
  listProblemSubmissions,
  runCode,
  submitCode,
} from "../services/problem.service.js";
import { badRequest } from "../utils/http-error.js";

export const MAX_CODE_LENGTH = 8000;

// GET /api/curriculum
export async function curriculum(req, res) {
  res.json(await getCurriculum(req.auth.userId));
}

// GET /api/problems/:id
export async function problem(req, res) {
  res.json(await getProblem(parseId(req.params.id)));
}

// POST /api/problems/:id/run  { code }
export async function run(req, res) {
  res.json(await runCode(parseId(req.params.id), parseCode(req.body?.code)));
}

// POST /api/problems/:id/submit  { code }
export async function submit(req, res) {
  res.json(await submitCode(req.auth.userId, parseId(req.params.id), parseCode(req.body?.code)));
}

// GET /api/problems/:id/submissions?page=N
export async function problemSubmissions(req, res) {
  res.json(await listProblemSubmissions(parseId(req.params.id), parsePage(req.query.page)));
}

// GET /api/submissions/me
export async function mySubmissions(req, res) {
  res.json(await listMySubmissions(req.auth.userId));
}

function parseId(raw) {
  if (!/^[1-9]\d{0,9}$/.test(raw)) throw badRequest("문제 id가 올바르지 않습니다.");
  return Number(raw);
}

function parseCode(raw) {
  if (typeof raw !== "string" || raw.trim() === "" || raw.length > MAX_CODE_LENGTH) {
    throw badRequest(`code(1~${MAX_CODE_LENGTH}자 문자열)가 필요합니다.`);
  }
  return raw;
}

function parsePage(raw) {
  if (raw === undefined) return 1;
  if (typeof raw !== "string" || !/^[1-9]\d{0,5}$/.test(raw)) throw badRequest("page는 1 이상의 정수여야 합니다.");
  return Number(raw);
}
