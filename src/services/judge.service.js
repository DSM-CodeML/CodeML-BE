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

const IS_WINDOWS = process.platform === "win32";

// 문자열을 UTF-8 바이트 상한 이내로 자른다. 문자 중간에서 자르지 않는다.
function truncateUtf8(text, maxBytes) {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > maxBytes) break;
    out += ch;
    bytes += b;
  }
  return out;
}

/** 코드 한 번 실행. status: "ok" | "error"(예외로 종료) | "timeout" | "too_much_output" */
export function runPython(code, input) {
  return new Promise((resolve) => {
    const started = Date.now();
    // -I: 사용자 site 패키지/환경변수(PYTHON*)를 무시하는 격리 모드
    // POSIX 에서는 새 프로세스 그룹으로 띄워, 제출 코드가 만든 하위 프로세스까지 한 번에 종료한다.
    const child = spawn(env.pythonBin, ["-I", "-c", code], { env: childEnv(), windowsHide: true, detached: !IS_WINDOWS });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let status = "ok";
    const killTree = () => {
      if (IS_WINDOWS) return void child.kill("SIGKILL");
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // 그룹이 이미 모두 종료됨(ESRCH)
      }
    };
    const stop = (why) => {
      if (status === "ok") status = why;
      killTree();
      // 그룹을 벗어난 프로세스가 파이프를 쥐고 있어도 요청이 끝나도록 잠시 뒤 파이프를 직접 닫는다.
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, 500).unref();
    };
    const timer = setTimeout(() => stop("timeout"), TIME_LIMIT_MS);
    // 부모가 먼저 끝나도 남은 하위 프로세스가 공유 파이프를 열어 두지 않도록 그룹을 정리한다.
    child.on("exit", killTree);

    // 청크 경계에서 멀티바이트 문자가 깨지지 않도록 스트림 단위로 디코딩한다.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes + bytes > MAX_OUTPUT_BYTES) return stop("too_much_output");
      stdout += chunk;
      stdoutBytes += bytes;
    });
    child.stderr.on("data", (chunk) => {
      const kept = truncateUtf8(chunk, MAX_OUTPUT_BYTES - stderrBytes);
      stderr += kept;
      stderrBytes += Buffer.byteLength(kept, "utf8");
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
