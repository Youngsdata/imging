import atexit
import ipaddress
import secrets
import time

from flask import Flask, g, jsonify, make_response, redirect, render_template, request, url_for

from .collector import LogCollector
from .config import RUNTIME_SETTING_LIMITS, Settings
from .geo import GeoResolver
from .security import (
    DUMMY_PASSWORD_HASH,
    client_ip,
    constant_time_username,
    load_recovery_hashes,
    minimum_response_time,
    read_text_secret,
    request_is_secure,
    require_auth,
    token_hash,
    user_agent_hash,
    validate_auth_material,
    validate_origin,
    verify_password,
    verify_totp,
)
from .store import Store


def create_app(settings=None, start_collector=True, validate_secrets=True):
    settings = settings or Settings.from_env()
    if validate_secrets:
        settings.validate_runtime_secrets()
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.update(MAX_CONTENT_LENGTH=4096, SEND_FILE_MAX_AGE_DEFAULT=0)
    store = Store(settings.db_path)
    password_hash = read_text_secret(settings.password_hash_path, required=validate_secrets) if validate_secrets else DUMMY_PASSWORD_HASH
    totp_secret = read_text_secret(settings.totp_secret_path, required=validate_secrets and not settings.allow_password_only)
    if validate_secrets:
        validate_auth_material(password_hash, totp_secret, require_totp=not settings.allow_password_only)
    # 容器重启或认证材料轮换后撤销旧会话，避免密码/TOTP 已更换但会话继续有效。
    store.clear_sessions()
    if settings.recovery_codes_path.is_file():
        store.load_recovery_codes(load_recovery_hashes(settings.recovery_codes_path))
    collector = None
    if start_collector:
        resolver = GeoResolver(settings.ipv4_db_path, settings.ipv6_db_path)
        collector = LogCollector(settings, store, resolver)
        collector.start()
        atexit.register(collector.stop)

    app.extensions["imging_settings"] = settings
    app.extensions["imging_store"] = store
    app.extensions["imging_collector"] = collector

    runtime_defaults = {
        "retention_days": settings.retention_days,
        "collector_interval_seconds": settings.collector_interval_seconds,
        "collector_batch_lines": settings.collector_batch_lines,
    }

    def runtime_payload():
        values = store.runtime_settings(runtime_defaults, RUNTIME_SETTING_LIMITS)
        return {
            "settings": {
                key: {"value": values[key], "default": runtime_defaults[key], "min": limits[0], "max": limits[1]}
                for key, limits in RUNTIME_SETTING_LIMITS.items()
            }
        }

    def login_response(error="", username="", status=200, csrf=None):
        csrf = csrf or secrets.token_urlsafe(32)
        response = make_response(render_template("login.html", csrf=csrf, error=error, username=username), status)
        response.set_cookie(
            settings.login_csrf_cookie_name, csrf, secure=settings.secure_cookies, httponly=True,
            samesite="Strict", path="/", max_age=600,
        )
        return response

    @app.before_request
    def load_session():
        g.session = None
        g.session_token_hash = None
        if request.path not in {"/healthz"}:
            if request.host != settings.origin_host and not (not settings.secure_cookies and request.host.startswith(("127.0.0.1:", "localhost:"))):
                return "invalid host", 400
            if settings.secure_cookies and not request_is_secure(settings):
                return "https required", 400
        token = request.cookies.get(settings.cookie_name, "")
        if token:
            digest = token_hash(token)
            session = store.get_session(digest, user_agent_hash(request.headers.get("User-Agent", "")), int(time.time()), settings.session_idle_seconds)
            if session:
                g.session = session
                g.session_token_hash = digest

    @app.after_request
    def secure_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
        response.headers["Referrer-Policy"] = "same-origin" if request.path == "/login" else "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        if settings.secure_cookies:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.path == "/" or request.path.startswith("/api/") or request.path in {"/login", "/logout"}:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    @app.get("/login")
    def login():
        if g.session:
            return redirect(url_for("dashboard"), code=303)
        return login_response()

    @app.post("/login")
    def login_post():
        started = time.monotonic()
        supplied_csrf = request.form.get("csrf", "")
        cookie_csrf = request.cookies.get(settings.login_csrf_cookie_name, "")
        if not validate_origin(settings) or not supplied_csrf or not secrets.compare_digest(supplied_csrf, cookie_csrf):
            minimum_response_time(started)
            return login_response("登录请求已失效，请刷新页面后重试。", status=400)
        source_ip = client_ip(settings)
        now = int(time.time())
        if not store.allow_login_attempt(source_ip, now):
            minimum_response_time(started)
            response = login_response("尝试次数过多，请稍后再试。", request.form.get("username", "")[:64], 429, supplied_csrf)
            response.headers["Retry-After"] = "60"
            return response
        username = request.form.get("username", "")[:128]
        password = request.form.get("password", "")[:1024]
        otp = request.form.get("otp", "")[:64]
        username_ok = constant_time_username(settings.username, username)
        password_ok = verify_password(password_hash if username_ok else DUMMY_PASSWORD_HASH, password)
        if password_ok is None:
            minimum_response_time(started)
            response = login_response("登录服务繁忙，请稍后再试。", username[:64], 429, supplied_csrf)
            response.headers["Retry-After"] = "5"
            return response
        second_factor_ok = settings.allow_password_only and not totp_secret
        recovery_candidate = "".join(character for character in otp.upper() if character.isalnum())
        if totp_secret and verify_totp(totp_secret, otp):
            second_factor_ok = True
        elif password_ok and recovery_candidate and store.consume_recovery_code(recovery_candidate, now):
            second_factor_ok = True
        if not (username_ok and password_ok and second_factor_ok):
            delay = store.record_login_failure(source_ip, settings.username, now)
            minimum_response_time(started, max(0.3, delay))
            return login_response("账号、密码或验证码不正确。", username[:64], 200, supplied_csrf)
        store.record_login_success(source_ip, settings.username, now)
        raw_token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        store.create_session(
            token_hash(raw_token), settings.username, csrf, user_agent_hash(request.headers.get("User-Agent", "")),
            now, now + settings.session_absolute_seconds,
        )
        minimum_response_time(started)
        response = redirect(url_for("dashboard"), code=303)
        response.set_cookie(
            settings.cookie_name, raw_token, secure=settings.secure_cookies, httponly=True,
            samesite="Strict", path="/", max_age=settings.session_absolute_seconds,
        )
        response.delete_cookie(settings.login_csrf_cookie_name, path="/", secure=settings.secure_cookies, httponly=True, samesite="Strict")
        return response

    @app.post("/logout")
    @require_auth
    def logout():
        if not validate_origin(settings) or not secrets.compare_digest(request.form.get("csrf", ""), g.session["csrf_token"]):
            return "invalid csrf", 403
        store.delete_session(g.session_token_hash)
        response = redirect(url_for("login"), code=303)
        response.delete_cookie(settings.cookie_name, path="/", secure=settings.secure_cookies, httponly=True, samesite="Strict")
        response.headers["Clear-Site-Data"] = '"cache", "cookies", "storage"'
        return response

    @app.get("/")
    @require_auth
    def dashboard():
        return render_template("dashboard.html", csrf=g.session["csrf_token"], username=g.session["username"])

    @app.get("/api/stats")
    @require_auth
    def stats():
        try:
            days = int(request.args.get("days", "7"))
        except ValueError:
            days = 7
        retention_days = store.runtime_settings(runtime_defaults, RUNTIME_SETTING_LIMITS)["retention_days"]
        days = max(1, min(days, retention_days))
        excludes = []
        for item in request.args.get("excludes", "").split(",")[:32]:
            try:
                excludes.append(str(ipaddress.ip_address(item.strip())))
            except ValueError:
                continue
        caller = client_ip(settings)
        if caller and caller not in excludes:
            excludes.append(caller)
        result = store.stats(days, excludes)
        result["caller_ip"] = caller
        result["retention_days"] = retention_days
        return jsonify(result)

    @app.get("/api/settings")
    @require_auth
    def get_settings():
        return jsonify(runtime_payload())

    @app.post("/api/settings")
    @require_auth
    def update_settings():
        supplied_csrf = request.headers.get("X-CSRF-Token", "")
        if not validate_origin(settings) or not supplied_csrf or not secrets.compare_digest(supplied_csrf, g.session["csrf_token"]):
            return jsonify({"error": "invalid csrf"}), 403
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "请求必须是 JSON 对象"}), 400
        unknown = sorted(set(payload) - set(RUNTIME_SETTING_LIMITS))
        if unknown:
            return jsonify({"error": "未知参数：{}".format("、".join(unknown))}), 400
        updates = {}
        for key, value in payload.items():
            minimum, maximum = RUNTIME_SETTING_LIMITS[key]
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
                return jsonify({"error": "{} 必须是 {} 到 {} 之间的整数".format(key, minimum, maximum)}), 400
            updates[key] = value
        if not updates:
            return jsonify({"error": "没有可保存的参数"}), 400
        store.update_runtime_settings(updates)
        return jsonify(runtime_payload())

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=8899)
