// 파이썬 코드 채점. req/res는 받지 않는다. 테스트케이스마다 프로세스를 하나 띄워 stdin 으로 입력을 주고 stdout 을 비교한다.
//
// 실행 방식(JUDGE_RUNNER):
//   - docker(기본): 채점 1회마다 격리된 컨테이너 하나를 띄운다. 네트워크 없음, 읽기 전용 파일시스템, nobody 사용자,
//                   메모리/CPU/프로세스 수 제한. 서버 파일(.env, 소스)과 환경변수에 접근할 수 없다.
//                   컨테이너 안의 judge-runner.py 가 케이스를 차례로 실행하고 결과를 한 줄씩 돌려준다.
//   - local: 서버에서 python 을 바로 실행한다. 격리가 없어 개발용이며, 운영(NODE_ENV=production)에서는 env.js 가 막는다.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

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

/** (local 방식) 코드 한 번 실행. status: "ok" | "error"(예외로 종료) | "timeout" | "too_much_output" */
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

async function* withIndex(iterable) {
  let i = 0;
  for await (const item of iterable) yield [i++, item];
}

async function* runLocally(code, inputs) {
  for (const input of inputs) yield await runPython(code, input);
}

// ---------- docker 실행 ----------

const RUNNER_SOURCE = readFileSync(new URL("./judge-runner.py", import.meta.url), "utf8");
const DOCKER_START_GRACE_MS = 10_000; // 컨테이너 시작에 허용하는 시간
const PER_CASE_GRACE_MS = 1_000;

function dockerArgs(name) {
  return [
    "run", "--rm", "-i",
    "--pull", "never", // 요청 중에 이미지를 내려받지 않는다. 없으면 바로 실패시키고 안내한다.
    "--name", name,
    "--label", "codeml-judge=1",
    "--network", "none",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m",
    "--memory", "256m", "--memory-swap", "256m",
    "--cpus", "1",
    "--pids-limit", "64",
    "--ulimit", "nofile=64:64",
    "--user", "65534:65534",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--workdir", "/tmp",
    "--env", "PYTHONIOENCODING=utf-8",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    env.judge.dockerImage,
    "python", "-I", "-c", RUNNER_SOURCE,
  ];
}

const judgeUnavailable = () =>
  new HttpError(503, "채점 환경을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");

/** 컨테이너 하나에서 모든 케이스를 실행하고, 결과를 케이스 순서대로 하나씩 내보낸다. */
async function* runInDocker(code, inputs) {
  if (inputs.length === 0) return;
  const name = `codeml-judge-${randomUUID()}`;
  // 컨테이너 안의 python 은 서버 환경변수를 받지 않는다. docker CLI 에는 PATH 등 최소한만 넘긴다.
  const child = spawn("docker", dockerArgs(name), {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SYSTEMROOT: process.env.SYSTEMROOT, DOCKER_HOST: process.env.DOCKER_HOST },
    windowsHide: true,
  });
  let spawnError = null;
  let dockerStderr = "";
  child.on("error", (err) => (spawnError = err));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (dockerStderr.length < 4096) dockerStderr += chunk;
  });
  child.stdin.on("error", () => {});
  child.stdin.end(
    JSON.stringify({ code, inputs, timeLimitMs: TIME_LIMIT_MS, maxOutputBytes: MAX_OUTPUT_BYTES }),
  );

  let finished = false;
  const stopContainer = () => {
    if (finished) return;
    finished = true;
    // docker CLI 를 죽여도 컨테이너는 계속 돌기 때문에 이름으로 직접 종료한다(--rm 이라 종료되면 삭제됨).
    spawn("docker", ["kill", name], { stdio: "ignore", windowsHide: true }).on("error", () => {});
    child.kill("SIGKILL");
  };
  // 컨테이너가 응답 없이 멈춰도 요청이 끝나도록 전체 기한을 둔다.
  const watchdog = setTimeout(() => {
    stopContainer();
    child.stdout.destroy();
  }, DOCKER_START_GRACE_MS + inputs.length * (TIME_LIMIT_MS + PER_CASE_GRACE_MS));

  const closed = new Promise((resolve) => child.on("close", resolve));
  let received = 0;
  try {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      received += 1;
      yield JSON.parse(line); // 호출 측이 여기서 멈추면(틀린 케이스) 아래로 오지 않고 finally 만 실행된다.
      if (received === inputs.length) return;
    }
    // 결과를 다 받기 전에 출력이 끝났다 = 채점 환경 문제(Docker 미실행, 이미지 없음, 기한 초과 등). 제출자의 잘못이 아니다.
    await Promise.race([closed, new Promise((r) => setTimeout(r, 1000).unref())]);
    const reason = spawnError?.code || dockerStderr.trim().split("\n")[0] || "unknown"; // 첫 줄에 원인이 있다
    console.error(`[judge] docker 실행 실패 (${received}/${inputs.length}):`, reason);
    throw judgeUnavailable();
  } finally {
    clearTimeout(watchdog);
    stopContainer();
  }
}

// ---------- 비교 ----------

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
  const inputs = cases.map((c) => c.inputText);
  const runs = env.judge.runner === "docker" ? runInDocker(code, inputs) : runLocally(code, inputs);
  let timeMs = 0;
  // 틀린 케이스에서 return 하면 for await 가 runs.return() 을 불러 컨테이너를 정리한다.
  for await (const [i, run] of withIndex(runs)) {
    const c = cases[i];
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
