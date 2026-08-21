import hashlib
import ipaddress
import json
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

from .traffic import AutomatedTrafficClassifier, is_automated_user_agent


def _parse_before(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("--before 必须包含时区，例如 2026-08-21T10:30:00+08:00")
    return parsed


def _canonical_host(value):
    host = str(value or "").strip().lower().rstrip(".")
    name, separator, port = host.rpartition(":")
    return name if separator and port.isdigit() else host


def import_legacy_log(source, store, resolver, before, hosts, retention_days):
    source = Path(source).resolve()
    if not source.is_file():
        raise FileNotFoundError("旧日志不存在: {}".format(source))
    before_time = _parse_before(before) if isinstance(before, str) else before
    if before_time.tzinfo is None:
        raise ValueError("切换时间必须包含时区")
    allowed_hosts = sorted({_canonical_host(item) for item in hosts if item.strip()})
    if not allowed_hosts:
        raise ValueError("至少需要一个主站 Host")
    if retention_days < 7 or retention_days > 366:
        raise ValueError("retention_days 必须在 7 到 366 之间")

    cutoff_day = date.today() - timedelta(days=retention_days - 1)
    counts = Counter()
    crawlers = Counter()
    behavioral = Counter()
    classifier = AutomatedTrafficClassifier(include_declared=False)
    declared_behavioral = Counter()
    declared_classifier = AutomatedTrafficClassifier(include_declared=False)
    content_hash = hashlib.sha256()
    total_lines = 0
    accepted_hits = 0
    invalid_lines = 0
    initial_stat = source.stat()

    with source.open("rb") as handle:
        for raw in handle:
            total_lines += 1
            content_hash.update(raw)
            try:
                payload = json.loads(raw.decode("utf-8", "replace"))
                status = int(payload.get("status", 0))
                if status < 200 or status >= 400:
                    continue
                host = _canonical_host(payload.get("http_host") or payload.get("host"))
                if host not in allowed_hosts:
                    continue
                timestamp = datetime.fromisoformat(str(payload.get("@timestamp") or payload.get("time") or ""))
                if timestamp.tzinfo is None or timestamp >= before_time or timestamp.date() < cutoff_day:
                    continue
                ip = str(payload.get("clientip") or payload.get("remote_addr") or "").strip()
                ipaddress.ip_address(ip)
            except (ValueError, TypeError, json.JSONDecodeError):
                invalid_lines += 1
                continue
            counts[(timestamp.date().isoformat(), ip)] += 1
            agent = payload.get("user_agent") or payload.get("agent") or ""
            declared = is_automated_user_agent(agent)
            if declared:
                crawlers[(timestamp.date().isoformat(), ip)] += 1
            request_parts = str(payload.get("request") or "").split()
            uri = str(payload.get("request_uri") or (request_parts[1] if len(request_parts) > 1 else ""))
            second = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
            referer = str(payload.get("referer") or "").strip()
            behavioral.update(classifier.feed((
                timestamp.date().isoformat(), ip, declared, second, uri.split("?", 1)[0][:1024],
                not referer or referer == "-", hash(str(agent)[:512]),
            )))
            if declared:
                declared_behavioral.update(declared_classifier.feed((
                    timestamp.date().isoformat(), ip, True, second, uri.split("?", 1)[0][:1024],
                    not referer or referer == "-", hash(str(agent)[:512]),
                )))
            accepted_hits += 1

    final_stat = source.stat()
    if (initial_stat.st_ino, initial_stat.st_size, initial_stat.st_mtime_ns) != (final_stat.st_ino, final_stat.st_size, final_stat.st_mtime_ns):
        raise RuntimeError("旧日志在导入期间发生变化，请先创建只读快照后重试")

    content_sha256 = content_hash.hexdigest()
    filters = {
        "before": before_time.isoformat(),
        "hosts": allowed_hosts,
        "retention_days": retention_days,
    }
    identity = hashlib.sha256()
    identity.update(content_sha256.encode("ascii"))
    identity.update(b"\0")
    identity.update(json.dumps(filters, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    source_id = identity.hexdigest()
    imported = store.import_legacy(source_id, source, content_sha256, filters, total_lines, counts, {}, resolver)
    crawler_updated = store.import_legacy_crawlers(source_id, crawlers, declared_behavioral)
    behavior_updated = store.import_legacy_behavior(source_id, behavioral)
    return {
        "source_id": source_id,
        "content_sha256": content_sha256,
        "imported": imported,
        "lines": total_lines,
        "accepted_hits": accepted_hits,
        "automated_hits": sum(behavioral.values()),
        "crawler_hits": sum(crawlers.values()),
        "crawler_updated": crawler_updated,
        "behavior_updated": behavior_updated,
        "invalid_lines": invalid_lines,
        "day_ip_pairs": len(counts),
    }
