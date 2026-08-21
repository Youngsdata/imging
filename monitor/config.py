import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


RUNTIME_SETTING_LIMITS = {
    "session_duration_days": (1, 90),
    "auto_refresh_seconds": (0, 3600),
    "exclude_current_ip": (0, 1),
    "default_view_days": (1, 366),
    "retention_days": (7, 366),
    "collector_interval_seconds": (1, 60),
    "collector_batch_lines": (100, 50000),
}


def _boolean(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _integer(name, default, minimum, maximum):
    value = int(os.getenv(name, str(default)))
    if value < minimum or value > maximum:
        raise ValueError("{} 必须在 {} 到 {} 之间".format(name, minimum, maximum))
    return value


def _networks(value):
    result = []
    for item in value.split(","):
        item = item.strip()
        if item:
            result.append(ipaddress.ip_network(item, strict=False))
    return tuple(result)


@dataclass(frozen=True)
class Settings:
    log_path: Path
    db_path: Path
    ipv4_db_path: Path
    ipv6_db_path: Path
    password_hash_path: Path
    totp_secret_path: Path
    recovery_codes_path: Path
    username: str
    public_origin: str
    trusted_proxies: tuple
    secure_cookies: bool
    allow_password_only: bool
    session_duration_days: int
    auto_refresh_seconds: int
    exclude_current_ip: bool
    default_view_days: int
    retention_days: int
    collector_interval_seconds: int
    collector_batch_lines: int

    @classmethod
    def from_env(cls):
        public_origin = os.getenv("IMGING_MONITOR_PUBLIC_ORIGIN", "").strip().rstrip("/")
        allow_insecure = _boolean("IMGING_MONITOR_ALLOW_INSECURE_HTTP", False)
        parsed = urlparse(public_origin) if public_origin else None
        if parsed and (parsed.scheme not in ({"http", "https"} if allow_insecure else {"https"}) or not parsed.netloc or parsed.path):
            raise ValueError("IMGING_MONITOR_PUBLIC_ORIGIN 必须是无路径的 HTTPS 地址")
        username = os.getenv("IMGING_MONITOR_USERNAME", "admin").strip()
        if not username or len(username) > 64:
            raise ValueError("IMGING_MONITOR_USERNAME 长度必须为 1 到 64")
        return cls(
            log_path=Path(os.getenv("IMGING_MONITOR_LOG", "/logs/access.json")),
            db_path=Path(os.getenv("IMGING_MONITOR_DB", "/var/lib/imging-monitor/monitor.db")),
            ipv4_db_path=Path(os.getenv("IMGING_MONITOR_IPV4_DB", "/app/data/ip2region_v4.xdb")),
            ipv6_db_path=Path(os.getenv("IMGING_MONITOR_IPV6_DB", "/app/data/ip2region_v6.xdb")),
            password_hash_path=Path(os.getenv("IMGING_MONITOR_PASSWORD_HASH_FILE", "/run/secrets/admin_password_hash")),
            totp_secret_path=Path(os.getenv("IMGING_MONITOR_TOTP_SECRET_FILE", "/run/secrets/totp_secret")),
            recovery_codes_path=Path(os.getenv("IMGING_MONITOR_RECOVERY_CODES_FILE", "/run/secrets/recovery_codes")),
            username=username,
            public_origin=public_origin,
            trusted_proxies=_networks(os.getenv(
                "IMGING_MONITOR_TRUSTED_PROXIES", "127.0.0.1/32,::1/128"
            )),
            secure_cookies=not allow_insecure if parsed is None else parsed.scheme == "https",
            allow_password_only=_boolean("IMGING_MONITOR_ALLOW_PASSWORD_ONLY", True),
            session_duration_days=_integer("IMGING_MONITOR_SESSION_DURATION_DAYS", 30, 1, 90),
            auto_refresh_seconds=_integer("IMGING_MONITOR_AUTO_REFRESH_SECONDS", 60, 0, 3600),
            exclude_current_ip=_boolean("IMGING_MONITOR_EXCLUDE_CURRENT_IP", True),
            default_view_days=_integer("IMGING_MONITOR_DEFAULT_VIEW_DAYS", 7, 1, 366),
            retention_days=_integer("IMGING_MONITOR_RETENTION_DAYS", 90, 7, 366),
            collector_interval_seconds=_integer("IMGING_MONITOR_COLLECTOR_INTERVAL_SECONDS", 1, 1, 60),
            collector_batch_lines=_integer("IMGING_MONITOR_COLLECTOR_BATCH_LINES", 2000, 100, 50000),
        )

    @property
    def cookie_name(self):
        return "__Host-imging_session" if self.secure_cookies else "imging_dev_session"

    @property
    def login_csrf_cookie_name(self):
        return "__Host-imging_login_csrf" if self.secure_cookies else "imging_dev_login_csrf"

    @property
    def origin_host(self):
        return urlparse(self.public_origin).netloc if self.public_origin else ""

    def validate_runtime_secrets(self):
        missing = []
        for label, path in (("密码哈希", self.password_hash_path), ("TOTP 密钥", self.totp_secret_path)):
            if label == "TOTP 密钥" and self.allow_password_only:
                continue
            if not path.is_file():
                missing.append("{} {}".format(label, path))
        if missing:
            raise RuntimeError("缺少认证密钥：{}；请先执行初始化命令".format("、".join(missing)))
