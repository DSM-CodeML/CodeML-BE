// 파이썬 코드 채점. req/res는 받지 않는다. 테스트케이스마다 프로세스를 하나 띄워 stdin 으로 입력을 주고 stdout 을 비교한다.
//
// shortcut: 격리(샌드박스)가 아니다. 제출 코드가 서버 계정 권한으로 실행되어 서버 파일을 읽을 수 있다.
//           시간/출력 제한과 환경변수 비우기만 한다. 외부에 공개하기 전에 컨테이너(docker/nsjail)로 옮길 것.
import { spawn } from "node:child_process";
import { env } from "../config/env.js";

export const TIME_LIMIT_MS = 2000;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const RESULTS = Object.freeze({
  ACCEPTED: "Accepted",
  WRONG_ANSWER: "Wrong Answer",
  COMPILE_ERROR: "Compile Error",
});

// 서버 비밀(JWT_SECRET, DB 비밀번호 등)이 자식 프로세스 환경변수로 새지 않도록 최소한만 넘긴다.
const childEnv = () => ({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PYTHONIOENCODING: "utf-8" });

/** 코드 한 번 실행. status: "ok" | "error"(예외로 종료) | "timeout" | "too_much_output" */
export function runPython(code, input) {
  return new Promise((resolve) => {
    const started = Date.now();
    // -I: 사용자 site 패키지/환경변수(PYTHON*)를 무시하는 격리 모드
    const child = spawn(env.pythonBin, ["-I", "-c", code], { env: childEnv(), windowsHide: true });
    let stdout = "";
    let stderr = "";
    let status = "ok";
    const stop = (why) => {
      if (status === "ok") status = why;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("timeout"), TIME_LIMIT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) stop("too_much_output");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk;
    });
    child.stdin.on("error", () => {}); // 프로그램이 입력을 다 읽기 전에 끝나면 EPIPE 가 난다. 결과는 종료 코드로 판단한다.
    child.stdin.end(input);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: "error", stdout: "", stderr: `실행할 수 없습니다: ${err.code ?? err.message}`, timeMs: 0 });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (status === "ok" && exitCode !== 0) status = "error";
      resolve({ status, stdout, stderr, timeMs: Date.now() - started });
    });
  });
}

// 줄 끝 공백과 마지막 빈 줄은 무시하고 비교한다.
export const normalize = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();

const lastLine = (text) => text.trim().split("\n").at(-1) ?? "";
const isSyntaxError = (stderr) => /^(SyntaxError|IndentationError|TabError)/m.test(stderr);

/**
 * 모든 케이스를 순서대로 채점하고 처음 틀린 케이스에서 멈춘다.
 * cases: [{ inputText, expectedOutput, isSample }]
 * failed 는 틀린 케이스 정보이며, 숨김 케이스는 output/expected 를 null 로 가린다.
 */
export async function judge(code, cases) {
  let timeMs = 0;
  for (const [i, c] of cases.entries()) {
    const run = await runPython(code, c.inputText);
    timeMs = Math.max(timeMs, run.timeMs);
    if (run.status === "ok" && normalize(run.stdout) === normalize(c.expectedOutput)) continue;

    const output = run.status === "ok" ? normalize(run.stdout) : lastLine(run.stderr) || run.status;
    return {
      result: run.status === "error" && isSyntaxError(run.stderr) ? RESULTS.COMPILE_ERROR : RESULTS.WRONG_ANSWER,
      passed: i,
      total: cases.length,
      timeMs,
      failed: {
        caseNumber: i + 1,
        sample: Boolean(c.isSample),
        output: c.isSample ? output : null,
        expected: c.isSample ? c.expectedOutput : null,
      },
    };
  }
  return { result: RESULTS.ACCEPTED, passed: cases.length, total: cases.length, timeMs, failed: null };
}
