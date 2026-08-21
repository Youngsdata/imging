import ipaddress
import io
import json
import hashlib
import os
import re
import tempfile
import time
import unittest
from collections import Counter
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import pyotp

from monitor.app import create_app
from monitor.collector import LogCollector
from monitor.config import Settings
from monitor.fetch_assets import ASSETS, fetch
from monitor.legacy import import_legacy_log
from monitor.security import PASSWORD_HASHER
from monitor.security import client_ip
from monitor.security import expected_origin
from monitor.store import Store
from monitor.traffic import AutomatedTrafficClassifier
from monitor import supervisor


class FakeResolver:
    def lookup(self, ip):
        return {
            "country": "中国", "province": "广东省", "city": "深圳市", "source": "电信",
            "country_code": "CN", "location": "中国 / 广东省 / 深圳市 · 电信",
        }


class MonitorTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.password = "correct horse battery staple"
        self.totp_secret = pyotp.random_base32()
        self.password_file = root / "password"
        self.totp_file = root / "totp"
        self.recovery_file = root / "recovery"
        self.password_file.write_text(PASSWORD_HASHER.hash(self.password), encoding="utf-8")
        self.totp_file.write_text(self.totp_secret, encoding="utf-8")
        self.recovery_file.write_text("[]", encoding="utf-8")
        self.settings = Settings(
            log_path=root / "access.json", db_path=root / "monitor.db",
            ipv4_db_path=root / "v4.xdb", ipv6_db_path=root / "v6.xdb",
            password_hash_path=self.password_file, totp_secret_path=self.totp_file,
            recovery_codes_path=self.recovery_file, username="admin", public_origin="https://status.test",
            trusted_proxies=(ipaddress.ip_network("127.0.0.1/32"),), secure_cookies=True,
            allow_password_only=True, session_duration_days=30, auto_refresh_seconds=60,
            default_view_days=7, retention_days=90, collector_interval_seconds=1, collector_batch_lines=2000,
        )
        self.app = create_app(self.settings, start_collector=False)
        self.app.testing = True
        self.client = self.app.test_client()

    def tearDown(self):
        self.temporary.cleanup()

    def get_login_csrf(self):
        response = self.client.get("/login", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        self.assertEqual(response.status_code, 200)
        match = re.search(rb'name="csrf" value="([^"]+)"', response.data)
        self.assertIsNotNone(match)
        return match.group(1).decode()

    def login(self, password=None, otp=None, username="admin", origin="https://status.test"):
        csrf = self.get_login_csrf()
        data = {"csrf": csrf, "username": username, "password": password or self.password}
        if otp is not None:
            data["otp"] = otp
        return self.client.post(
            "/login", base_url="https://status.test", headers={"Origin": origin, "User-Agent": "test-agent"},
            data=data,
        )

    def session_csrf(self):
        response = self.client.get("/", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        match = re.search(rb'name="csrf-token" content="([^"]+)"', response.data)
        self.assertIsNotNone(match)
        return match.group(1).decode()

    def test_private_routes_require_server_side_session(self):
        response = self.client.get("/api/stats", base_url="https://status.test")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "authentication required")
        self.assertEqual(self.client.get("/api/settings", base_url="https://status.test").status_code, 401)

    def test_login_cookie_and_security_headers(self):
        response = self.client.get("/login", base_url="https://status.test")
        cookie = response.headers["Set-Cookie"]
        self.assertIn("__Host-imging_login_csrf=", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertNotIn("Domain=", cookie)
        self.assertIn("default-src 'none'", response.headers["Content-Security-Policy"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["Referrer-Policy"], "same-origin")
        self.assertNotIn('name="otp"', response.get_data(as_text=True))
        self.assertIn("login-v2.css", response.get_data(as_text=True))

    def test_login_rejects_missing_origin_and_csrf(self):
        response = self.client.post(
            "/login", base_url="https://status.test", headers={"User-Agent": "test-agent"},
            data={"username": "admin", "password": self.password, "otp": pyotp.TOTP(self.totp_secret).now()},
        )
        self.assertEqual(response.status_code, 400)
        cookie = response.headers["Set-Cookie"]
        match = re.search(rb'name="csrf" value="([^"]+)"', response.data)
        self.assertIsNotNone(match)
        self.assertIn(match.group(1).decode(), cookie)

    def test_login_accepts_same_origin_referer_when_origin_is_missing(self):
        csrf = self.get_login_csrf()
        response = self.client.post(
            "/login", base_url="https://status.test",
            headers={"Referer": "https://status.test/login", "User-Agent": "test-agent"},
            data={"csrf": csrf, "username": "admin", "password": self.password,
                  "otp": pyotp.TOTP(self.totp_secret).now()},
        )
        self.assertEqual(response.status_code, 303)

    def test_automatic_origin_accepts_any_https_deployment_host(self):
        settings = replace(self.settings, public_origin="")
        app = create_app(settings, start_collector=False)
        app.testing = True
        client = app.test_client()
        login = client.get("/login", base_url="https://monitor.customer.example")
        csrf = re.search(rb'name="csrf" value="([^"]+)"', login.data).group(1).decode()
        response = client.post(
            "/login", base_url="https://monitor.customer.example",
            headers={"Origin": "https://monitor.customer.example", "User-Agent": "test-agent"},
            data={"csrf": csrf, "username": "admin", "password": self.password,
                  "otp": pyotp.TOTP(self.totp_secret).now()},
        )
        self.assertEqual(response.status_code, 303)

    def test_automatic_origin_still_rejects_cross_site_login(self):
        settings = replace(self.settings, public_origin="")
        app = create_app(settings, start_collector=False)
        app.testing = True
        client = app.test_client()
        login = client.get("/login", base_url="https://monitor.customer.example")
        csrf = re.search(rb'name="csrf" value="([^"]+)"', login.data).group(1).decode()
        response = client.post(
            "/login", base_url="https://monitor.customer.example",
            headers={"Origin": "https://attacker.example", "User-Agent": "test-agent"},
            data={"csrf": csrf, "username": "admin", "password": self.password,
                  "otp": pyotp.TOTP(self.totp_secret).now()},
        )
        self.assertEqual(response.status_code, 400)

    def test_automatic_origin_uses_https_from_trusted_proxy(self):
        settings = replace(
            self.settings, public_origin="",
            trusted_proxies=(ipaddress.ip_network("172.17.0.11/32"),),
        )
        with self.app.test_request_context(
            "/login", base_url="http://status2.imging.cn", environ_base={"REMOTE_ADDR": "172.17.0.11"},
            headers={"X-Forwarded-Proto": "https"},
        ):
            self.assertEqual(expected_origin(settings), "https://status2.imging.cn")

    def test_default_origin_is_portable_and_trusts_only_loopback(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings.from_env()
        self.assertEqual(settings.public_origin, "")
        self.assertTrue(settings.secure_cookies)
        self.assertTrue(settings.allow_password_only)
        self.assertEqual(settings.session_duration_days, 30)
        self.assertEqual(settings.auto_refresh_seconds, 60)
        self.assertEqual(settings.default_view_days, 7)
        self.assertEqual(settings.trusted_proxies, (
            ipaddress.ip_network("127.0.0.1/32"), ipaddress.ip_network("::1/128"),
        ))

    def test_successful_login_sets_host_only_session(self):
        response = self.login()
        self.assertEqual(response.status_code, 303)
        cookie = response.headers.getlist("Set-Cookie")[0]
        self.assertIn("__Host-imging_session=", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertIn("Max-Age=2592000", cookie)
        self.assertNotIn("Domain=", cookie)
        dashboard = self.client.get("/", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        self.assertEqual(dashboard.status_code, 200)
        self.assertIn("访问地域分布", dashboard.get_data(as_text=True))
        self.assertIn("统计设置", dashboard.get_data(as_text=True))
        self.assertIn("dashboard-v2.css", dashboard.get_data(as_text=True))
        self.assertIn("筛选访问 IP", dashboard.get_data(as_text=True))
        self.assertIn("imging-monitor-brand", dashboard.get_data(as_text=True))
        self.assertIn('id="auto-refresh"', dashboard.get_data(as_text=True))
        self.assertIn('<option value="60" selected>1 分钟</option>', dashboard.get_data(as_text=True))

    def test_dashboard_uses_persisted_default_view_days(self):
        self.assertEqual(self.login().status_code, 303)
        self.app.extensions["imging_store"].update_runtime_settings({"default_view_days": 12})
        response = self.client.get("/", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        self.assertEqual(response.status_code, 200)
        self.assertIn('<option value="12" data-custom-days selected>最近 12 天</option>', response.get_data(as_text=True))

    def test_trend_chart_draws_single_day_markers_and_supports_tooltips(self):
        script = (Path(__file__).parent.parent / "static" / "dashboard.js").read_text(encoding="utf-8")
        template = (Path(__file__).parent.parent / "templates" / "dashboard.html").read_text(encoding="utf-8")
        self.assertIn("data.length===1", script)
        self.assertIn("context.arc(p.x,p.y,5", script)
        self.assertIn('id="trend-tooltip"', template)
        self.assertIn('role="tooltip"', template)
        self.assertIn('addEventListener("pointermove"', script)
        self.assertIn('addEventListener("mousemove"', script)
        self.assertIn('item.full_date||item.date', script)
        self.assertIn('addEventListener("keydown",chartKeydown)', script)
        self.assertIn('event.key==="ArrowLeft"', script)

    def test_wrong_user_and_wrong_password_have_same_public_error(self):
        wrong_user = self.login(username="someone")
        wrong_password = self.login(password="this password is definitely wrong")
        self.assertEqual(wrong_user.status_code, 200)
        self.assertEqual(wrong_password.status_code, 200)
        message = "账号或密码不正确。"
        self.assertIn(message, wrong_user.get_data(as_text=True))
        self.assertIn(message, wrong_password.get_data(as_text=True))

    def test_session_is_bound_to_user_agent(self):
        self.assertEqual(self.login().status_code, 303)
        response = self.client.get("/", base_url="https://status.test", headers={"User-Agent": "changed-agent"})
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["Location"], "/login")

    def test_logout_accepts_same_origin_referer_and_does_not_restore_cookie(self):
        self.assertEqual(self.login().status_code, 303)
        csrf = self.session_csrf()
        response = self.client.post(
            "/logout", base_url="https://status.test",
            headers={"Referer": "https://status.test/", "User-Agent": "test-agent"}, data={"csrf": csrf},
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["Location"], "/login")
        cookies = [value for value in response.headers.getlist("Set-Cookie") if "__Host-imging_session=" in value]
        self.assertEqual(len(cookies), 1)
        self.assertIn("Max-Age=0", cookies[0])

    def test_restart_preserves_existing_sessions_when_password_is_unchanged(self):
        self.assertEqual(self.login().status_code, 303)
        create_app(self.settings, start_collector=False)
        response = self.client.get("/", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        self.assertEqual(response.status_code, 200)

    def test_password_change_revokes_existing_sessions(self):
        self.assertEqual(self.login().status_code, 303)
        self.password_file.write_text(PASSWORD_HASHER.hash("a newly rotated password"), encoding="utf-8")
        create_app(self.settings, start_collector=False)
        response = self.client.get("/", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["Location"], "/login")

    def test_password_only_login_is_the_default(self):
        response = self.login()
        self.assertEqual(response.status_code, 303)

    def test_totp_can_be_explicitly_required(self):
        settings = replace(self.settings, allow_password_only=False)
        app = create_app(settings, start_collector=False)
        app.testing = True
        self.client = app.test_client()
        missing = self.login(otp="")
        self.assertEqual(missing.status_code, 200)
        self.assertIn("验证码", missing.get_data(as_text=True))
        verified = self.login(otp=pyotp.TOTP(self.totp_secret).now())
        self.assertEqual(verified.status_code, 303)

    def test_invalid_totp_secret_fails_closed_at_startup(self):
        self.totp_file.write_text("invalid", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "TOTP"):
            create_app(replace(self.settings, allow_password_only=False), start_collector=False)

    def test_recovery_code_is_one_time(self):
        code = "ABCD1234EFGH5678"
        settings = replace(self.settings, allow_password_only=False)
        app = create_app(settings, start_collector=False)
        app.testing = True
        self.client = app.test_client()
        store = app.extensions["imging_store"]
        store.load_recovery_codes([hashlib.sha256(code.encode("ascii")).hexdigest()])
        first = self.login(otp=code)
        self.assertEqual(first.status_code, 303)
        # 新客户端确保第二次是一次全新的登录，而不是沿用已有会话。
        self.client = app.test_client()
        second = self.login(otp=code)
        self.assertEqual(second.status_code, 200)

    def test_recovery_code_rotation_revokes_old_codes(self):
        old_code = "AAAABBBBCCCCDDDD"
        new_code = "1111222233334444"
        store = self.app.extensions["imging_store"]
        store.load_recovery_codes([hashlib.sha256(old_code.encode("ascii")).hexdigest()])
        store.load_recovery_codes([hashlib.sha256(new_code.encode("ascii")).hexdigest()])
        self.assertFalse(store.consume_recovery_code(old_code, int(time.time())))
        self.assertTrue(store.consume_recovery_code(new_code, int(time.time())))

    def test_ip_and_global_rate_limit_is_checked_before_hash(self):
        store = self.app.extensions["imging_store"]
        now = int(time.time())
        for _ in range(10):
            self.assertTrue(store.allow_login_attempt("198.51.100.8", now))
        self.assertFalse(store.allow_login_attempt("198.51.100.8", now))

    def test_forwarded_ip_is_only_used_from_trusted_proxy(self):
        with self.app.test_request_context(
            "/", base_url="https://status.test", environ_base={"REMOTE_ADDR": "203.0.113.9"},
            headers={"X-Forwarded-For": "198.51.100.2"},
        ):
            self.assertEqual(client_ip(self.settings), "203.0.113.9")
        with self.app.test_request_context(
            "/", base_url="https://status.test", environ_base={"REMOTE_ADDR": "127.0.0.1"},
            headers={"X-Forwarded-For": "198.51.100.2, 127.0.0.1"},
        ):
            self.assertEqual(client_ip(self.settings), "198.51.100.2")

    def test_dashboard_has_no_third_party_script_or_style(self):
        self.assertEqual(self.login().status_code, 303)
        response = self.client.get("/", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        body = response.get_data(as_text=True)
        self.assertNotIn("https://", body)
        self.assertNotIn("http://", body)

    def test_pinned_asset_hashes_are_valid_sha256(self):
        for name, (_, _, digest) in ASSETS.items():
            with self.subTest(asset=name):
                self.assertRegex(digest, r"^[0-9a-f]{64}$")

    def test_downloaded_assets_are_readable_by_runtime_user(self):
        payload = b"pinned public asset"
        destination = self.settings.db_path.parent / "asset.bin"
        with patch("monitor.fetch_assets.urlopen", return_value=io.BytesIO(payload)):
            fetch("https://assets.test/example", destination, hashlib.sha256(payload).hexdigest())
        self.assertEqual(destination.read_bytes(), payload)
        self.assertEqual(destination.stat().st_mode & 0o777, 0o644)

    def test_supervisor_disables_unneeded_gunicorn_control_socket(self):
        with patch("monitor.supervisor.signal.signal"), patch("monitor.supervisor.subprocess.Popen") as popen:
            popen.return_value.poll.return_value = 0
            with self.assertRaises(SystemExit) as stopped:
                supervisor.main()
        self.assertEqual(stopped.exception.code, 0)
        self.assertIn("--no-control-socket", popen.call_args_list[1].args[0])

    def test_collector_counts_only_success_and_redirect(self):
        collector = LogCollector(self.settings, Store(self.settings.db_path), FakeResolver())
        today = date.today().isoformat()
        valid = json.dumps({"@timestamp": today + "T10:00:00+08:00", "clientip": "1.2.3.4", "status": "200"}).encode()
        redirect = json.dumps({"@timestamp": today + "T10:00:01+08:00", "clientip": "1.2.3.4", "status": "302"}).encode()
        blocked = json.dumps({"@timestamp": today + "T10:00:02+08:00", "clientip": "5.6.7.8", "status": "493"}).encode()
        missing = json.dumps({"@timestamp": today + "T10:00:03+08:00", "clientip": "5.6.7.8", "status": "404"}).encode()
        self.assertEqual(collector._parse(valid)[:6], (today, "1.2.3.4", False, 36000, "", True))
        self.assertEqual(collector._parse(redirect)[:6], (today, "1.2.3.4", False, 36001, "", True))
        self.assertIsNone(collector._parse(blocked))
        self.assertIsNone(collector._parse(missing))

    def test_collector_classifies_declared_crawlers_without_blocking_them(self):
        collector = LogCollector(self.settings, Store(self.settings.db_path), FakeResolver())
        today = date.today().isoformat()
        for agent in (
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
            "Mozilla/5.0 (compatible; GCombinator/1.0; +https://news.gcombinator.com)",
            "Mozilla/5.0 (ThreatIntelAgent/1.0)",
        ):
            raw = json.dumps({
                "@timestamp": today + "T10:00:00+08:00", "clientip": "1.2.3.4",
                "status": "200", "user_agent": agent,
            }).encode()
            self.assertEqual(collector._parse(raw)[:6], (today, "1.2.3.4", True, 36000, "", True))

    def test_collector_classifies_repeated_same_path_burst_as_automated(self):
        classifier = AutomatedTrafficClassifier()
        automated = Counter()
        for second in range(21):
            parsed = (date.today().isoformat(), "1.2.3.4", False, 36000 + second, "/en/", False, 1)
            automated.update(classifier.feed(parsed))
        for index in range(12):
            parsed = (date.today().isoformat(), "5.6.7.8", False, index * 61, "/", True, 2)
            automated.update(classifier.feed(parsed))
        self.assertEqual(automated[(date.today().isoformat(), "1.2.3.4")], 21)
        self.assertNotIn((date.today().isoformat(), "5.6.7.8"), automated)

    def test_behavior_classifier_excludes_page_sweeps_and_duplicate_bootstrap_but_keeps_humans(self):
        today = date.today().isoformat()
        classifier = AutomatedTrafficClassifier()
        automated = Counter()
        sweep_paths = ["/llms.txt", "/video", "/pdf", "/img", "/ai/video-matting.js",
                       "/ai/background-removal.js", "/video/editor.js", "/pdf/workspace.js"]
        for index, path in enumerate(sweep_paths):
            automated.update(classifier.feed((today, "66.93.99.50", False, 36000 + index // 3, path, True, 1)))
        bootstrap = ["/", "/ai/background-removal.js", "/ai/video-matting.js", "/video/editor.js", "/pdf/workspace.js"]
        for agent, start in ((2, 36100), (3, 36106)):
            for index, path in enumerate(bootstrap):
                automated.update(classifier.feed((today, "205.169.39.80", False, start + index, path, index == 0, agent)))
        self.assertEqual(automated[(today, "66.93.99.50")], 8)
        self.assertEqual(automated[(today, "205.169.39.80")], 10)

        human = AutomatedTrafficClassifier()
        human_hits = Counter()
        for agent, start in ((4, 40000), (5, 40400)):
            for index, path in enumerate(bootstrap):
                human_hits.update(human.feed((today, "104.12.225.3", False, start + index, path, index == 0, agent)))
        self.assertNotIn((today, "104.12.225.3"), human_hits)

    def test_legacy_import_can_add_new_behavior_classification_once(self):
        today = date.today().isoformat()
        source = self.settings.db_path.parent / "legacy-behavior.json"
        rows = []
        bootstrap = ["/", "/ai/background-removal.js", "/ai/video-matting.js", "/video/editor.js", "/pdf/workspace.js"]
        for agent, start in (("Chrome/83", 0), ("Chrome/79", 6)):
            for index, path in enumerate(bootstrap):
                rows.append({
                    "@timestamp": "{}T10:00:{:02d}+08:00".format(today, start + index),
                    "http_host": "imging.cn", "clientip": "205.169.39.80", "status": "200",
                    "request": "GET {} HTTP/1.1".format(path), "referer": "-" if index == 0 else "https://imging.cn/",
                    "agent": agent,
                })
        source.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
        store = Store(self.settings.db_path)
        first = import_legacy_log(source, store, FakeResolver(), today + "T11:00:00+08:00", ["imging.cn"], 90)
        second = import_legacy_log(source, store, FakeResolver(), today + "T11:00:00+08:00", ["imging.cn"], 90)
        self.assertTrue(first["behavior_updated"])
        self.assertEqual(first["automated_hits"], 10)
        self.assertFalse(second["behavior_updated"])
        self.assertEqual(store.stats(1, [])["data"][-1], {"date": today[5:], "full_date": today, "pv": 0, "uv": 0})

    def test_legacy_import_filters_host_status_and_cutover_and_is_idempotent(self):
        today = date.today().isoformat()
        source = self.settings.db_path.parent / "legacy.json"
        rows = [
            {"@timestamp": today + "T10:00:00+08:00", "http_host": "imging.cn", "clientip": "1.2.3.4", "status": "200"},
            {"@timestamp": today + "T10:01:00+08:00", "http_host": "www.imging.cn:443", "clientip": "5.6.7.8", "status": "302"},
            {"@timestamp": today + "T10:02:00+08:00", "http_host": "status.imging.cn", "clientip": "9.9.9.9", "status": "200"},
            {"@timestamp": today + "T10:03:00+08:00", "http_host": "imging.cn", "clientip": "9.9.9.9", "status": "404"},
            {"@timestamp": today + "T10:04:00+08:00", "http_host": "imging.cn", "clientip": "8.8.8.8", "status": "200",
             "agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"},
            {"@timestamp": today + "T12:00:00+08:00", "http_host": "imging.cn", "clientip": "9.9.9.9", "status": "200"},
        ]
        source.write_text("\n".join(json.dumps(row) for row in rows) + "\nnot-json\n", encoding="utf-8")
        store = Store(self.settings.db_path)
        first = import_legacy_log(
            source, store, FakeResolver(), today + "T12:00:00+08:00", ["imging.cn", "www.imging.cn"], 90,
        )
        # 模拟旧版已导入总量、但尚未记录自动化请求分类的数据库。
        with store.connection() as connection:
            connection.execute("DELETE FROM legacy_automation_imports")
            connection.execute("DELETE FROM daily_automated_ip")
        second = import_legacy_log(
            source, store, FakeResolver(), today + "T12:00:00+08:00", ["www.imging.cn", "imging.cn"], 90,
        )
        third = import_legacy_log(
            source, store, FakeResolver(), today + "T12:00:00+08:00", ["imging.cn", "www.imging.cn"], 90,
        )
        self.assertTrue(first["imported"])
        self.assertFalse(second["imported"])
        self.assertFalse(third["imported"])
        self.assertEqual(first["accepted_hits"], 3)
        self.assertEqual(first["automated_hits"], 1)
        self.assertEqual(first["invalid_lines"], 1)
        result = store.stats(7, [])
        self.assertEqual(result["data"][-1]["pv"], 2)
        self.assertEqual(result["data"][-1]["uv"], 2)
        with store.connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM legacy_imports").fetchone()[0], 1)

    def test_legacy_import_requires_timezone_and_valid_retention(self):
        source = self.settings.db_path.parent / "legacy.json"
        source.write_text("", encoding="utf-8")
        store = Store(self.settings.db_path)
        with self.assertRaisesRegex(ValueError, "时区"):
            import_legacy_log(source, store, FakeResolver(), "2026-08-21T10:00:00", ["imging.cn"], 90)
        with self.assertRaisesRegex(ValueError, "7 到 366"):
            import_legacy_log(source, store, FakeResolver(), "2026-08-21T10:00:00+08:00", ["imging.cn"], 3)

    def test_store_batches_hits_and_excludes_caller(self):
        store = Store(self.settings.db_path)
        today = date.today().isoformat()
        store.ingest(self.settings.log_path, 1, 100, {(today, "1.2.3.4"): 3, (today, "5.6.7.8"): 2}, {}, FakeResolver())
        result = store.stats(7, ["1.2.3.4"])
        self.assertEqual(result["data"][-1]["pv"], 2)
        self.assertEqual(result["data"][-1]["uv"], 1)
        self.assertEqual(result["top_ip"][0]["ip"], "5.6.7.8")
        self.assertEqual(result["regions"], [{"country_code": "CN", "province": "广东省", "count": 2}])

    def test_stats_subtracts_automated_hits_from_pv_uv_and_ranking(self):
        store = Store(self.settings.db_path)
        today = date.today().isoformat()
        counts = {(today, "1.2.3.4"): 8, (today, "5.6.7.8"): 2}
        automated = {(today, "1.2.3.4"): 8}
        store.ingest(self.settings.log_path, 1, 100, counts, automated, FakeResolver())
        result = store.stats(1, [])
        self.assertEqual(result["data"][0]["pv"], 2)
        self.assertEqual(result["data"][0]["uv"], 1)
        self.assertEqual([item["ip"] for item in result["top_ip"]], ["5.6.7.8"])

    def test_collector_reclassifies_already_read_active_log_prefix(self):
        store = Store(self.settings.db_path)
        today = date.today().isoformat()
        rows = [
            {"@timestamp": today + "T10:00:00+08:00", "clientip": "1.2.3.4", "status": "200",
             "user_agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"},
            {"@timestamp": today + "T10:00:01+08:00", "clientip": "5.6.7.8", "status": "200",
             "user_agent": "Mozilla/5.0 Chrome/151.0"},
        ]
        rows.extend({
            "@timestamp": today + "T10:01:{:02d}+08:00".format(second), "clientip": "9.9.9.9", "status": "301",
            "request_uri": "/en/", "user_agent": "Mozilla/5.0 Chrome/151.0",
        } for second in range(12))
        content = "\n".join(json.dumps(row) for row in rows) + "\n"
        self.settings.log_path.write_text(content, encoding="utf-8")
        inode = self.settings.log_path.stat().st_ino
        offset = self.settings.log_path.stat().st_size
        store.ingest(
            self.settings.log_path, inode, offset,
            {(today, "1.2.3.4"): 1, (today, "5.6.7.8"): 1, (today, "9.9.9.9"): 12}, {}, FakeResolver(),
        )
        with store.connection() as connection:
            connection.execute("DELETE FROM automation_scan_state")
        collector = LogCollector(self.settings, store, FakeResolver())
        collector._open()
        collector._close()
        result = store.stats(1, [])
        self.assertEqual(result["data"][0]["pv"], 1)
        self.assertEqual(result["data"][0]["uv"], 1)
        self.assertEqual([item["ip"] for item in result["top_ip"]], ["5.6.7.8"])

    def test_runtime_settings_are_authenticated_validated_and_persisted(self):
        self.assertEqual(self.login().status_code, 303)
        response = self.client.get("/api/settings", base_url="https://status.test", headers={"User-Agent": "test-agent"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["settings"]["session_duration_days"]["value"], 30)
        self.assertEqual(response.get_json()["settings"]["auto_refresh_seconds"]["value"], 60)
        self.assertEqual(response.get_json()["settings"]["default_view_days"]["value"], 7)
        self.assertEqual(response.get_json()["settings"]["retention_days"]["value"], 90)
        without_csrf = self.client.post(
            "/api/settings", base_url="https://status.test", headers={"Origin": "https://status.test", "User-Agent": "test-agent"},
            json={"retention_days": 30},
        )
        self.assertEqual(without_csrf.status_code, 403)
        csrf = self.session_csrf()
        invalid = self.client.post(
            "/api/settings", base_url="https://status.test",
            headers={"Origin": "https://status.test", "User-Agent": "test-agent", "X-CSRF-Token": csrf},
            json={"retention_days": 2},
        )
        self.assertEqual(invalid.status_code, 400)
        saved = self.client.post(
            "/api/settings", base_url="https://status.test",
            headers={"Origin": "https://status.test", "User-Agent": "test-agent", "X-CSRF-Token": csrf},
            json={"session_duration_days": 45, "auto_refresh_seconds": 300, "default_view_days": 14,
                  "retention_days": 30, "collector_interval_seconds": 2, "collector_batch_lines": 5000},
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.get_json()["settings"]["session_duration_days"]["value"], 45)
        self.assertEqual(saved.get_json()["settings"]["auto_refresh_seconds"]["value"], 300)
        self.assertEqual(saved.get_json()["settings"]["default_view_days"]["value"], 14)
        self.assertEqual(saved.get_json()["settings"]["collector_batch_lines"]["value"], 5000)
        values = Store(self.settings.db_path).runtime_settings({
            "session_duration_days": 30, "auto_refresh_seconds": 60, "default_view_days": 7,
            "retention_days": 90, "collector_interval_seconds": 1, "collector_batch_lines": 2000,
        })
        self.assertEqual(values, {
            "session_duration_days": 45, "auto_refresh_seconds": 300,
            "default_view_days": 14, "retention_days": 30,
            "collector_interval_seconds": 2, "collector_batch_lines": 5000,
        })
        inconsistent = self.client.post(
            "/api/settings", base_url="https://status.test",
            headers={"Origin": "https://status.test", "User-Agent": "test-agent", "X-CSRF-Token": csrf},
            json={"default_view_days": 31, "retention_days": 30},
        )
        self.assertEqual(inconsistent.status_code, 400)
        self.assertIn("不能超过", inconsistent.get_json()["error"])

    def test_session_duration_change_updates_current_session_immediately(self):
        self.assertEqual(self.login().status_code, 303)
        csrf = self.session_csrf()
        response = self.client.post(
            "/api/settings", base_url="https://status.test",
            headers={"Origin": "https://status.test", "User-Agent": "test-agent", "X-CSRF-Token": csrf},
            json={"session_duration_days": 1},
        )
        self.assertEqual(response.status_code, 200)
        session_cookie = next(value for value in response.headers.getlist("Set-Cookie") if "__Host-imging_session=" in value)
        max_age = int(re.search(r"Max-Age=(\d+)", session_cookie).group(1))
        self.assertGreater(max_age, 86390)
        self.assertLessEqual(max_age, 86400)
        self.assertEqual(self.client.get("/", base_url="https://status.test", headers={"User-Agent": "test-agent"}).status_code, 200)
        with self.app.extensions["imging_store"].connection() as connection:
            session = connection.execute("SELECT created_at,expires_at FROM sessions").fetchone()
        self.assertEqual(session["expires_at"] - session["created_at"], 86400)

    def test_out_of_range_database_setting_falls_back_to_environment_default(self):
        store = Store(self.settings.db_path)
        store.update_runtime_settings({"collector_interval_seconds": 0})
        values = store.runtime_settings(
            {"collector_interval_seconds": 1}, {"collector_interval_seconds": (1, 60)},
        )
        self.assertEqual(values["collector_interval_seconds"], 1)

    def test_retention_change_triggers_prune_without_restart(self):
        store = Store(self.settings.db_path)
        old_day = (date.today() - timedelta(days=10)).isoformat()
        store.ingest(self.settings.log_path, 1, 100, {(old_day, "1.2.3.4"): 3}, {}, FakeResolver())
        store.update_runtime_settings({"retention_days": 7})
        collector = LogCollector(self.settings, store, FakeResolver())
        collector.runtime = store.runtime_settings(collector.runtime_defaults)
        collector._prune_if_needed()
        result = store.stats(90, [])
        self.assertEqual(sum(item["pv"] for item in result["data"]), 0)

    def test_retention_keeps_exact_number_of_calendar_days(self):
        store = Store(self.settings.db_path)
        collector = LogCollector(self.settings, store, FakeResolver())
        collector.runtime["retention_days"] = 7
        oldest_kept = (date.today() - timedelta(days=6)).isoformat()
        first_removed = (date.today() - timedelta(days=7)).isoformat()
        kept = json.dumps({"@timestamp": oldest_kept + "T10:00:00+08:00", "clientip": "1.2.3.4", "status": "200"}).encode()
        removed = json.dumps({"@timestamp": first_removed + "T10:00:00+08:00", "clientip": "1.2.3.4", "status": "200"}).encode()
        self.assertEqual(collector._parse(kept)[:6], (oldest_kept, "1.2.3.4", False, 36000, "", True))
        self.assertIsNone(collector._parse(removed))
        store.ingest(self.settings.log_path, 1, 100, {(oldest_kept, "1.2.3.4"): 2, (first_removed, "5.6.7.8"): 3}, {}, FakeResolver())
        store.prune(7)
        result = store.stats(90, [])
        self.assertEqual(sum(item["pv"] for item in result["data"]), 2)

    def test_stats_ignores_invalid_and_excess_excludes(self):
        self.assertEqual(self.login().status_code, 303)
        values = ["bad-value"] + ["198.51.100.{}".format(index) for index in range(1, 40)]
        response = self.client.get(
            "/api/stats?excludes=" + ",".join(values), base_url="https://status.test",
            headers={"User-Agent": "test-agent"},
        )
        self.assertEqual(response.status_code, 200)
        excluded = response.get_json()["excluded"]
        self.assertNotIn("bad-value", excluded)
        self.assertLessEqual(len(excluded), 33)


if __name__ == "__main__":
    unittest.main()
