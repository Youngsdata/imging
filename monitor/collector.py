import ipaddress
import json
import os
import threading
import time
from collections import Counter
from datetime import date, timedelta

from .config import RUNTIME_SETTING_LIMITS
from .traffic import AutomatedTrafficClassifier, is_automated_user_agent


class LogCollector(threading.Thread):
    def __init__(self, settings, store, resolver):
        super().__init__(name="imging-log-collector", daemon=True)
        self.settings = settings
        self.store = store
        self.resolver = resolver
        self.stop_event = threading.Event()
        self.handle = None
        self.inode = 0
        self.offset = 0
        self.last_prune_key = None
        self.traffic_classifier = AutomatedTrafficClassifier(include_declared=False)
        self.runtime_defaults = {
            "retention_days": settings.retention_days,
            "collector_interval_seconds": settings.collector_interval_seconds,
            "collector_batch_lines": settings.collector_batch_lines,
        }
        self.runtime = dict(self.runtime_defaults)

    def stop(self):
        self.stop_event.set()

    def run(self):
        while not self.stop_event.is_set():
            try:
                self.runtime = self.store.runtime_settings(self.runtime_defaults, RUNTIME_SETTING_LIMITS)
                self._prune_if_needed()
                saturated = self._collect_once()
            except Exception as exc:
                self.store.mark_ingest_error(self.settings.log_path, "{}: {}".format(type(exc).__name__, exc))
                self._close()
                saturated = False
            if saturated:
                # 积压时连续批处理，避免把吞吐硬限制为 batch_lines/秒。
                continue
            self.stop_event.wait(self.runtime["collector_interval_seconds"])
        self._close()

    def _open(self):
        stat = os.stat(str(self.settings.log_path))
        saved_inode, saved_offset = self.store.get_ingest_state(self.settings.log_path)
        self.handle = open(str(self.settings.log_path), "rb")
        self.inode = int(stat.st_ino)
        self.offset = saved_offset if saved_inode == self.inode and saved_offset <= stat.st_size else 0
        self._classify_existing_prefix(self.offset)
        self._classify_existing_crawler_prefix(self.offset)
        self.handle.seek(self.offset)

    def _classify_existing_prefix(self, limit):
        scan_inode, scan_offset = self.store.get_automation_scan_state(self.settings.log_path)
        start = scan_offset if scan_inode == self.inode and scan_offset <= limit else 0
        if start >= limit:
            return
        automated = Counter()
        with open(str(self.settings.log_path), "rb") as handle:
            handle.seek(start)
            while handle.tell() < limit:
                raw = handle.readline(limit - handle.tell())
                if not raw:
                    break
                parsed = self._parse(raw)
                if parsed and not parsed[2]:
                    # 声明爬虫由独立迁移扫描处理，避免升级数据库时先重算行为、再迁移爬虫造成重复扣减。
                    automated.update(self.traffic_classifier.feed(parsed))
        self.store.record_automated_hits(self.settings.log_path, self.inode, limit, automated)

    def _classify_existing_crawler_prefix(self, limit):
        scan_inode, scan_offset = self.store.get_crawler_scan_state(self.settings.log_path)
        start = scan_offset if scan_inode == self.inode and scan_offset <= limit else 0
        if start >= limit:
            return
        crawlers = Counter()
        retained_automated = Counter()
        classifier = AutomatedTrafficClassifier(include_declared=False)
        with open(str(self.settings.log_path), "rb") as handle:
            handle.seek(start)
            while handle.tell() < limit:
                raw = handle.readline(limit - handle.tell())
                if not raw:
                    break
                parsed = self._parse(raw)
                if parsed and parsed[2]:
                    crawlers[(parsed[0], parsed[1])] += 1
                    retained_automated.update(classifier.feed(parsed))
        self.store.record_crawler_hits(
            self.settings.log_path, self.inode, limit, crawlers, migrate_automated=True,
            retained_automated=retained_automated,
        )

    def _collect_once(self):
        if self.handle is None:
            self._open()
        counts = Counter()
        automated = Counter()
        crawlers = Counter()
        lines = 0
        while lines < self.runtime["collector_batch_lines"]:
            raw = self.handle.readline()
            if not raw:
                break
            lines += 1
            parsed = self._parse(raw)
            if parsed:
                counts[(parsed[0], parsed[1])] += 1
                if parsed[2]:
                    crawlers[(parsed[0], parsed[1])] += 1
                automated.update(self.traffic_classifier.feed(parsed))
        self.offset = self.handle.tell()
        if counts or lines:
            self.store.ingest(self.settings.log_path, self.inode, self.offset, counts, automated, self.resolver, crawlers)
        else:
            stat = os.stat(str(self.settings.log_path))
            if int(stat.st_ino) == self.inode and stat.st_size < self.offset:
                # copytruncate 会保留 inode，但文件长度会回到零。
                self.offset = 0
                self.handle.seek(0)
                with self.store.connection() as connection:
                    self.store.set_ingest_state(connection, self.settings.log_path, self.inode, 0)
            elif int(stat.st_ino) != self.inode:
                # 先读完旧文件，再切换到日志轮转后的新 inode。
                tail = self.handle.read()
                if tail:
                    for raw in tail.splitlines():
                        parsed = self._parse(raw)
                        if parsed:
                            counts[(parsed[0], parsed[1])] += 1
                            if parsed[2]:
                                crawlers[(parsed[0], parsed[1])] += 1
                            automated.update(self.traffic_classifier.feed(parsed))
                self._close()
                if counts:
                    self.store.ingest(self.settings.log_path, self.inode, self.offset, counts, automated, self.resolver, crawlers)
        return lines >= self.runtime["collector_batch_lines"]

    def _parse(self, raw):
        try:
            payload = json.loads(raw.decode("utf-8", "replace"))
            status = int(payload.get("status", 0))
            if status < 200 or status >= 400:
                return None
            timestamp = str(payload.get("@timestamp") or payload.get("time") or "")
            day = timestamp[:10]
            if len(day) != 10 or len(timestamp) < 19:
                return None
            parsed_day = date.fromisoformat(day)
            if parsed_day < date.today() - timedelta(days=self.runtime["retention_days"] - 1):
                return None
            ip = str(payload.get("clientip") or payload.get("remote_addr") or "").strip()
            ipaddress.ip_address(ip)
            agent = payload.get("user_agent") or payload.get("agent") or ""
            referer = str(payload.get("referer") or "").strip()
            second = int(timestamp[11:13]) * 3600 + int(timestamp[14:16]) * 60 + int(timestamp[17:19])
            uri = str(payload.get("request_uri") or "")
            if not uri:
                request_parts = str(payload.get("request") or "").split()
                uri = request_parts[1] if len(request_parts) > 1 else ""
            return (
                day, ip, is_automated_user_agent(agent), second, uri.split("?", 1)[0][:1024],
                not referer or referer == "-", hash(str(agent)[:512]),
            )
        except (ValueError, TypeError, json.JSONDecodeError):
            return None

    def _prune_if_needed(self):
        today = date.today()
        prune_key = (today, self.runtime["retention_days"])
        if self.last_prune_key != prune_key:
            self.store.prune(self.runtime["retention_days"])
            self.last_prune_key = prune_key

    def _close(self):
        if self.handle is not None:
            self.handle.close()
        self.handle = None
