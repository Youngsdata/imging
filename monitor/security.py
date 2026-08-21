import binascii
import hashlib
import hmac
import ipaddress
import json
import secrets
import threading
import time
from functools import wraps
from urllib.parse import urlparse

import pyotp
from argon2 import PasswordHasher, Type, extract_parameters
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from flask import abort, g, jsonify, redirect, request, url_for


PASSWORD_HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)
ARGON2_SLOTS = threading.BoundedSemaphore(2)
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash(secrets.token_urlsafe(32))


def read_text_secret(path, required=True):
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        if required:
            raise RuntimeError("无法读取认证密钥 {}".format(path))
        return ""
    if required and not value:
        raise RuntimeError("认证密钥 {} 不能为空".format(path))
    return value


def validate_auth_material(password_hash, totp_secret, require_totp=True):
    try:
        parameters = extract_parameters(password_hash)
    except InvalidHashError as exc:
        raise RuntimeError("管理密码哈希不是有效的 Argon2 编码") from exc
    if parameters.type != Type.ID or parameters.memory_cost < 19456 or parameters.time_cost < 2 or parameters.parallelism < 1:
        raise RuntimeError("管理密码哈希必须使用 Argon2id，且参数不得低于 m=19456、t=2、p=1")
    if require_totp:
        try:
            secret_bytes = pyotp.TOTP(totp_secret).byte_secret()
        except (TypeError, ValueError, binascii.Error) as exc:
            raise RuntimeError("TOTP 密钥格式无效") from exc
        if len(secret_bytes) < 20:
            raise RuntimeError("TOTP 密钥熵不足，至少需要 160 bit")


def load_recovery_hashes(path):
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        return []
    except (TypeError, ValueError) as exc:
        raise RuntimeError("恢复码文件格式错误: {}".format(exc))
    if not isinstance(payload, list) or any(not isinstance(item, str) or len(item) != 64 for item in payload):
        raise RuntimeError("恢复码文件必须是 SHA-256 字符串数组")
    return payload


def verify_password(stored_hash, password):
    if not ARGON2_SLOTS.acquire(blocking=False):
        return None
    try:
        try:
            return PASSWORD_HASHER.verify(stored_hash, password)
        except (InvalidHashError, VerificationError, VerifyMismatchError):
            return False
    finally:
        ARGON2_SLOTS.release()


def verify_totp(secret, value):
    digits = "".join(character for character in value if character.isdigit())
    if len(digits) != 6:
        return False
    return bool(pyotp.TOTP(secret).verify(digits, valid_window=1))


def token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def user_agent_hash(value):
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()


def address_in_networks(value, networks):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return any(address in network for network in networks)


def client_ip(settings):
    remote = request.remote_addr or ""
    if not address_in_networks(remote, settings.trusted_proxies):
        return remote
    forwarded = [item.strip() for item in request.headers.get("X-Forwarded-For", "").split(",") if item.strip()]
    for value in reversed(forwarded):
        if not address_in_networks(value, settings.trusted_proxies):
            try:
                return str(ipaddress.ip_address(value))
            except ValueError:
                break
    real_ip = request.headers.get("X-Real-IP", "").strip()
    try:
        return str(ipaddress.ip_address(real_ip)) if real_ip else remote
    except ValueError:
        return remote


def request_is_secure(settings):
    if request.is_secure:
        return True
    remote = request.remote_addr or ""
    return address_in_networks(remote, settings.trusted_proxies) and request.headers.get("X-Forwarded-Proto", "").lower() == "https"


def validate_origin(settings):
    origin = request.headers.get("Origin", "").rstrip("/")
    if origin:
        return hmac.compare_digest(origin, settings.public_origin)
    referer = urlparse(request.headers.get("Referer", ""))
    if not referer.scheme or not referer.netloc:
        return False
    referer_origin = "{}://{}".format(referer.scheme, referer.netloc)
    return hmac.compare_digest(referer_origin, settings.public_origin)


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not getattr(g, "session", None):
            if request.path.startswith("/api/"):
                return jsonify({"error": "authentication required"}), 401
            return redirect(url_for("login"), code=303)
        return view(*args, **kwargs)
    return wrapped


def minimum_response_time(started, seconds=0.3):
    remaining = seconds - (time.monotonic() - started)
    if remaining > 0:
        time.sleep(remaining)


def constant_time_username(expected, supplied):
    normalized_expected = expected.strip().casefold()
    normalized_supplied = supplied.strip().casefold()
    return hmac.compare_digest(normalized_expected.encode("utf-8"), normalized_supplied.encode("utf-8"))
