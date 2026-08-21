import argparse
import getpass
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import quote

import pyotp

from .security import PASSWORD_HASHER
from .geo import GeoResolver
from .legacy import import_legacy_log
from .store import Store


def _write_secret(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(".{}.tmp-{}".format(path.name, secrets.token_hex(4)))
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(value)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(path))
    finally:
        if temporary.exists():
            temporary.unlink()


def initialize(output, username, issuer):
    password = getpass.getpass("管理密码（至少 16 个字符）: ")
    if len(password) < 16:
        raise SystemExit("管理密码至少需要 16 个字符")
    if password != getpass.getpass("再次输入管理密码: "):
        raise SystemExit("两次输入的密码不一致")
    directory = Path(output).resolve()
    totp_secret = pyotp.random_base32(length=32)
    recovery_codes = ["{}-{}".format(secrets.token_hex(4), secrets.token_hex(4)).upper() for _ in range(8)]
    recovery_hashes = [hashlib.sha256(code.replace("-", "").encode("ascii")).hexdigest() for code in recovery_codes]
    _write_secret(directory / "admin_password_hash", PASSWORD_HASHER.hash(password))
    _write_secret(directory / "totp_secret", totp_secret)
    _write_secret(directory / "recovery_codes", json.dumps(recovery_hashes, separators=(",", ":")))
    uri = "otpauth://totp/{}:{}?secret={}&issuer={}".format(
        quote(issuer, safe=""), quote(username, safe=""), quote(totp_secret, safe=""), quote(issuer, safe="")
    )
    print("\n密码登录文件已写入 {}（权限 600）。".format(directory))
    print("默认只需用户名和密码。若以后设置 IMGING_MONITOR_ALLOW_PASSWORD_ONLY=false，再导入下面的 TOTP URI：\n{}".format(uri))
    print("\n以下恢复码也仅在启用 TOTP 后使用，只显示这一次：")
    for code in recovery_codes:
        print("  {}".format(code))


def main(argv=None):
    arguments_list = list(sys.argv[1:] if argv is None else argv)
    if not arguments_list or arguments_list[0] not in {"init", "import-legacy"}:
        arguments_list.insert(0, "init")
    parser = argparse.ArgumentParser(description="管理 imging-monitor 初始化与历史数据")
    commands = parser.add_subparsers(dest="command", required=True)
    initializer = commands.add_parser("init", help="初始化登录密钥")
    initializer.add_argument("--output", default="./monitor-secrets")
    initializer.add_argument("--username", default="admin")
    initializer.add_argument("--issuer", default="imging-monitor")
    importer = commands.add_parser("import-legacy", help="导入旧前置 Nginx JSON 日志")
    importer.add_argument("--source", required=True)
    importer.add_argument("--database", default="/var/lib/imging-monitor/monitor.db")
    importer.add_argument("--before", required=True, help="不含该时刻；必须携带时区")
    importer.add_argument("--host", action="append", default=[])
    importer.add_argument("--retention-days", type=int, default=90)
    importer.add_argument("--ipv4-db", default="/app/data/ip2region_v4.xdb")
    importer.add_argument("--ipv6-db", default="/app/data/ip2region_v6.xdb")
    arguments = parser.parse_args(arguments_list)
    if arguments.command == "init":
        initialize(arguments.output, arguments.username, arguments.issuer)
        return
    hosts = arguments.host or ["imging.cn", "www.imging.cn"]
    summary = import_legacy_log(
        arguments.source,
        Store(Path(arguments.database).resolve()),
        GeoResolver(Path(arguments.ipv4_db), Path(arguments.ipv6_db)),
        arguments.before,
        hosts,
        arguments.retention_days,
    )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
