"""在独立进程中顺序读取主镜像 access log。"""
import os

from .collector import LogCollector
from .config import Settings
from .geo import GeoResolver
from .store import Store


def main():
    os.umask(0o077)
    settings = Settings.from_env()
    store = Store(settings.db_path)
    resolver = GeoResolver(settings.ipv4_db_path, settings.ipv6_db_path)
    # 直接在当前进程执行循环，避免旧 Docker seccomp 对 clone3/thread 的兼容问题。
    LogCollector(settings, store, resolver).run()


if __name__ == "__main__":
    main()
