// 채점기 단위 테스트: DB 없이 파이썬만 있으면 돈다. (helpers.js 는 환경변수 준비용으로만 import)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import "./helpers.js";
import { judge, normalize, RESULTS } from "../src/services/judge.service.js";

const sample = (inputText, expectedOutput) => ({ inputText, expectedOutput, isSample: true });
const hidden = (inputText, expectedOutput) => ({ inputText, expectedOutput, isSample: false });

describe("judge", () => {
  it("줄 끝 공백과 마지막 빈 줄은 무시하고 비교한다", () => {
    assert.equal(normalize("a  \r\nb\n\n"), "a\nb");
  });

  it("모든 케이스를 통과하면 Accepted", async () => {
    const r = await judge("a, b = map(int, input().split())\nprint(a + b)", [sample("1 2", "3"), hidden("-5 5", "0")]);
    assert.equal(r.result, RESULTS.ACCEPTED);
    assert.equal(r.passed, 2);
    assert.equal(r.failed, null);
  });

  it("출력이 다르면 Wrong Answer 이고, 공개 케이스는 출력/기대값을 알려 준다", async () => {
    const r = await judge("print(1)", [sample("", "2")]);
    assert.equal(r.result, RESULTS.WRONG_ANSWER);
    assert.deepEqual(r.failed, { caseNumber: 1, sample: true, output: "1", expected: "2" });
  });

  it("숨김 케이스에서 틀리면 출력/기대값을 가린다", async () => {
    const r = await judge("print(1)", [sample("", "1"), hidden("", "2")]);
    assert.equal(r.result, RESULTS.WRONG_ANSWER);
    assert.equal(r.passed, 1);
    assert.deepEqual(r.failed, { caseNumber: 2, sample: false, output: null, expected: null });
  });

  it("문법 오류는 Compile Error", async () => {
    const r = await judge("print(", [sample("", "1")]);
    assert.equal(r.result, RESULTS.COMPILE_ERROR);
  });

  it("실행 중 예외는 Wrong Answer", async () => {
    const r = await judge("1 / 0", [sample("", "1")]);
    assert.equal(r.result, RESULTS.WRONG_ANSWER);
    assert.match(r.failed.output, /ZeroDivisionError/);
  });

  it("무한 루프는 시간 제한으로 끊고 Wrong Answer", async () => {
    const r = await judge("while True: pass", [sample("", "1")]);
    assert.equal(r.result, RESULTS.WRONG_ANSWER);
    assert.equal(r.failed.output, "timeout");
  });

  it("서버 환경변수(JWT_SECRET)는 제출 코드에서 보이지 않는다", async () => {
    const r = await judge("import os\nprint(os.environ.get('JWT_SECRET'))", [sample("", "None")]);
    assert.equal(r.result, RESULTS.ACCEPTED);
  });

  it("한글 출력이 청크 경계에서 깨지지 않는다", async () => {
    const r = await judge("print('가' * 20000)", [sample("", "가".repeat(20000))]);
    assert.equal(r.result, RESULTS.ACCEPTED);
  });

  it("출력 제한(바이트 기준)을 넘으면 Wrong Answer", async () => {
    const r = await judge("print('가' * 30000)", [sample("", "x")]);
    assert.equal(r.result, RESULTS.WRONG_ANSWER);
    assert.equal(r.failed.output, "too_much_output");
  });

  it("제출 코드가 만든 하위 프로세스가 있어도 채점이 바로 끝난다", async () => {
    const started = Date.now();
    const code = 'import subprocess, sys\nsubprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])\nprint("bye")';
    const r = await judge(code, [sample("", "bye")]);
    assert.equal(r.result, RESULTS.ACCEPTED);
    assert.ok(Date.now() - started < 10_000, `${Date.now() - started}ms`);
  });
});

describe("judge (docker 격리)", { skip: process.env.JUDGE_RUNNER !== "docker" && "JUDGE_RUNNER=docker 일 때만" }, () => {
  it("서버 파일(.env, 소스 코드)에 접근할 수 없다", async () => {
    const serverFile = fileURLToPath(new URL("../package.json", import.meta.url));
    const r = await judge(`import os\nprint(os.path.exists(${JSON.stringify(serverFile)}))`, [sample("", "False")]);
    assert.equal(r.result, RESULTS.ACCEPTED);
  });

  it("네트워크를 쓸 수 없다", async () => {
    const code = 'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 80), timeout=1)\n    print("connected")\nexcept OSError:\n    print("blocked")';
    const r = await judge(code, [sample("", "blocked")]);
    assert.equal(r.result, RESULTS.ACCEPTED);
  });

  it("파일시스템에 쓸 수 없다(/tmp 제외)", async () => {
    const code = 'try:\n    open("/etc/hacked", "w")\n    print("written")\nexcept OSError:\n    print("blocked")';
    const r = await judge(code, [sample("", "blocked")]);
    assert.equal(r.result, RESULTS.ACCEPTED);
  });

  it("여러 케이스를 컨테이너 하나에서 순서대로 채점한다", async () => {
    const code = "print(int(input()) * 2)";
    const r = await judge(code, [sample("1", "2"), hidden("5", "10"), hidden("-3", "-6")]);
    assert.equal(r.result, RESULTS.ACCEPTED);
    assert.equal(r.passed, 3);
  });
});
