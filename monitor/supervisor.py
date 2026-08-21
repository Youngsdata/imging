"""管理同步 Web worker 与独立日志采集进程，并转发退出信号。"""
import os
import signal
import subprocess
import sys
import time


def main():
    children = []

    def child_setup():
        # 禁用 subprocess 的 posix_spawn/clone3 快径，兼容旧 Docker 默认 seccomp。
        return None

    def forward(signum, _frame):
        for child in children:
            if child.poll() is None:
                child.send_signal(signum)

    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)
    collector = subprocess.Popen([sys.executable, "-m", "monitor.collector_worker"], preexec_fn=child_setup)
    web = subprocess.Popen([
        "gunicorn", "--bind=0.0.0.0:8899", "--workers=2", "--worker-class=sync",
        "--timeout=30", "--graceful-timeout=10", "--no-control-socket",
        "--access-logfile=-", "--error-logfile=-", "monitor.wsgi:app",
    ], preexec_fn=child_setup)
    children.extend((collector, web))
    try:
        while True:
            web_status = web.poll()
            collector_status = collector.poll()
            if web_status is not None or collector_status is not None:
                status = web_status if web_status is not None else collector_status
                break
            time.sleep(0.5)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 10
        for child in children:
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    raise SystemExit(status or 0)


if __name__ == "__main__":
    main()
