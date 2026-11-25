# 채점 컨테이너 안에서 실행되는 러너. (judge.service.js 가 `python -I -c <이 파일 내용>` 으로 띄운다)
# stdin 으로 {"code", "inputs", "timeLimitMs", "maxOutputBytes"} JSON 을 받아
# 케이스마다 제출 코드를 새 프로세스로 실행하고, 결과를 한 줄짜리 JSON 으로 stdout 에 바로바로 쓴다.
# Node 쪽은 줄을 받는 대로 비교하고, 틀리면 컨테이너를 통째로 종료한다.
import codecs
import json
import os
import signal
import subprocess
import sys
import threading
import time

CHUNK = 65536


def drain(stream, cap, box, on_over):
    """stream 을 끝까지 읽되 cap 바이트까지만 보관한다. 넘으면 on_over 를 한 번 부르고 나머지는 버린다."""
    data = bytearray()
    over = False
    while True:
        chunk = stream.read1(CHUNK)
        if not chunk:
            break
        if over:
            continue
        room = cap - len(data)
        if len(chunk) > room:
            data += chunk[:room]
            over = True
            on_over()
        else:
            data += chunk
    box["data"] = bytes(data)
    box["over"] = over


def decode(data, truncated):
    # 잘린 출력이면 끝에 걸친 불완전한 멀티바이트 문자는 버린다.
    return codecs.getincrementaldecoder("utf-8")("replace").decode(data, final=not truncated)


def run_case(code, input_text, time_limit, max_output):
    proc = subprocess.Popen(
        [sys.executable, "-I", "-c", code],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,  # 제출 코드가 만든 하위 프로세스까지 그룹째 종료하기 위해
        env={"PATH": os.environ.get("PATH", ""), "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"},
        cwd="/tmp",
    )
    state = {"status": "ok"}

    def kill_group():
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def on_stdout_over():
        if state["status"] == "ok":
            state["status"] = "too_much_output"
        kill_group()

    out_box, err_box = {}, {}
    readers = [
        threading.Thread(target=drain, args=(proc.stdout, max_output, out_box, on_stdout_over), daemon=True),
        threading.Thread(target=drain, args=(proc.stderr, max_output, err_box, lambda: None), daemon=True),
    ]
    for t in readers:
        t.start()

    def feed():
        try:
            proc.stdin.write(input_text.encode("utf-8"))
            proc.stdin.close()
        except (BrokenPipeError, OSError):
            pass  # 프로그램이 입력을 다 읽기 전에 끝남. 결과는 종료 코드로 판단한다.

    threading.Thread(target=feed, daemon=True).start()

    started = time.monotonic()
    try:
        exit_code = proc.wait(timeout=time_limit)
    except subprocess.TimeoutExpired:
        if state["status"] == "ok":
            state["status"] = "timeout"
        kill_group()
        exit_code = proc.wait()
    elapsed_ms = int((time.monotonic() - started) * 1000)
    kill_group()  # 부모가 끝난 뒤 남은 하위 프로세스 정리
    for t in readers:
        t.join(timeout=1)

    if state["status"] == "ok" and exit_code != 0:
        state["status"] = "error"
    return {
        "status": state["status"],
        "stdout": decode(out_box.get("data", b""), out_box.get("over", False)),
        "stderr": decode(err_box.get("data", b""), err_box.get("over", False)),
        "timeMs": elapsed_ms,
    }


def main():
    job = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    time_limit = job["timeLimitMs"] / 1000
    for input_text in job["inputs"]:
        result = run_case(job["code"], input_text, time_limit, job["maxOutputBytes"])
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()


main()
