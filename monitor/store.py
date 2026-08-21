import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import date, timedelta


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ingest_state (
    path TEXT PRIMARY KEY,
    inode INTEGER NOT NULL DEFAULT 0,
    offset INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS runtime_settings (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ip_geo (
    ip TEXT PRIMARY KEY,
    country TEXT NOT NULL DEFAULT '',
    province TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    isp TEXT NOT NULL DEFAULT '',
    country_code TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '未知'
);
CREATE TABLE IF NOT EXISTS daily_ip (
    day TEXT NOT NULL,
    ip TEXT NOT NULL,
    hits INTEGER NOT NULL,
    PRIMARY KEY (day, ip),
    FOREIGN KEY (ip) REFERENCES ip_geo(ip)
);
CREATE INDEX IF NOT EXISTS idx_daily_ip_ip ON daily_ip(ip);
CREATE TABLE IF NOT EXISTS daily_automated_ip (
    day TEXT NOT NULL,
    ip TEXT NOT NULL,
    hits INTEGER NOT NULL,
    PRIMARY KEY (day, ip),
    FOREIGN KEY (ip) REFERENCES ip_geo(ip)
);
CREATE TABLE IF NOT EXISTS automation_scan_state (
    path TEXT PRIMARY KEY,
    inode INTEGER NOT NULL DEFAULT 0,
    offset INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS crawler_scan_state (
    path TEXT PRIMARY KEY,
    inode INTEGER NOT NULL DEFAULT 0,
    offset INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_crawler_ip (
    day TEXT NOT NULL,
    ip TEXT NOT NULL,
    hits INTEGER NOT NULL,
    PRIMARY KEY (day, ip),
    FOREIGN KEY (ip) REFERENCES ip_geo(ip)
);
CREATE TABLE IF NOT EXISTS legacy_imports (
    source_id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    lines INTEGER NOT NULL,
    hits INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS legacy_automation_imports (
    source_id TEXT PRIMARY KEY,
    FOREIGN KEY (source_id) REFERENCES legacy_imports(source_id)
);
CREATE TABLE IF NOT EXISTS legacy_behavior_imports (
    source_id TEXT PRIMARY KEY,
    FOREIGN KEY (source_id) REFERENCES legacy_imports(source_id)
);
CREATE TABLE IF NOT EXISTS legacy_crawler_imports (
    source_id TEXT PRIMARY KEY,
    FOREIGN KEY (source_id) REFERENCES legacy_imports(source_id)
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    user_agent_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_buckets (
    scope TEXT NOT NULL,
    bucket_key TEXT NOT NULL,
    window_started INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(scope, bucket_key)
);
CREATE TABLE IF NOT EXISTS recovery_codes (
    code_hash TEXT PRIMARY KEY,
    used_at INTEGER
);
CREATE TABLE IF NOT EXISTS auth_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    happened_at INTEGER NOT NULL,
    event TEXT NOT NULL,
    client_ip TEXT NOT NULL,
    username_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_events_time ON auth_events(happened_at);
"""


class Store:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(str(self.path), timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=5000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def get_ingest_state(self, path):
        with self.connection() as connection:
            row = connection.execute("SELECT inode, offset FROM ingest_state WHERE path=?", (str(path),)).fetchone()
            return (int(row["inode"]), int(row["offset"])) if row else (0, 0)

    def set_ingest_state(self, connection, path, inode, offset, error=""):
        connection.execute(
            "INSERT INTO ingest_state(path,inode,offset,updated_at,error) VALUES(?,?,?,?,?) "
            "ON CONFLICT(path) DO UPDATE SET inode=excluded.inode,offset=excluded.offset,updated_at=excluded.updated_at,error=excluded.error",
            (str(path), int(inode), int(offset), int(time.time()), error[:500]),
        )

    def get_automation_scan_state(self, path):
        with self.connection() as connection:
            row = connection.execute(
                "SELECT inode,offset FROM automation_scan_state WHERE path=?", (str(path),)
            ).fetchone()
            return (int(row["inode"]), int(row["offset"])) if row else (0, 0)

    @staticmethod
    def _set_automation_scan_state(connection, path, inode, offset):
        connection.execute(
            "INSERT INTO automation_scan_state(path,inode,offset) VALUES(?,?,?) "
            "ON CONFLICT(path) DO UPDATE SET inode=excluded.inode,offset=excluded.offset",
            (str(path), int(inode), int(offset)),
        )

    def record_automated_hits(self, path, inode, offset, counts):
        with self.connection() as connection:
            connection.executemany(
                "INSERT INTO daily_automated_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in counts.items()),
            )
            self._set_automation_scan_state(connection, path, inode, offset)

    def get_crawler_scan_state(self, path):
        with self.connection() as connection:
            row = connection.execute(
                "SELECT inode,offset FROM crawler_scan_state WHERE path=?", (str(path),)
            ).fetchone()
            return (int(row["inode"]), int(row["offset"])) if row else (0, 0)

    @staticmethod
    def _set_crawler_scan_state(connection, path, inode, offset):
        connection.execute(
            "INSERT INTO crawler_scan_state(path,inode,offset) VALUES(?,?,?) "
            "ON CONFLICT(path) DO UPDATE SET inode=excluded.inode,offset=excluded.offset",
            (str(path), int(inode), int(offset)),
        )

    def record_crawler_hits(self, path, inode, offset, counts, migrate_automated=False, retained_automated=None):
        retained_automated = retained_automated or {}
        with self.connection() as connection:
            connection.executemany(
                "INSERT INTO daily_crawler_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in counts.items()),
            )
            if migrate_automated:
                # 旧版本把公开声明身份的正常爬虫也计入了自动化排除量；按原始日志精确移回正常统计。
                connection.executemany(
                    "UPDATE daily_automated_ip SET hits=MAX(hits-?,0) WHERE day=? AND ip=?",
                    ((hits, day, ip) for (day, ip), hits in counts.items()),
                )
                connection.executemany(
                    "INSERT INTO daily_automated_ip(day,ip,hits) VALUES(?,?,?) "
                    "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                    ((day, ip, hits) for (day, ip), hits in retained_automated.items()),
                )
                connection.execute("DELETE FROM daily_automated_ip WHERE hits<=0")
            self._set_crawler_scan_state(connection, path, inode, offset)

    def ingest(self, path, inode, offset, counts, automated, resolver, crawlers=None):
        crawlers = crawlers or {}
        ips = sorted({ip for _, ip in counts})
        with self.connection() as connection:
            self._ensure_geos(connection, ips, resolver)
            connection.executemany(
                "INSERT INTO daily_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in counts.items()),
            )
            connection.executemany(
                "INSERT INTO daily_automated_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in automated.items()),
            )
            connection.executemany(
                "INSERT INTO daily_crawler_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in crawlers.items()),
            )
            self.set_ingest_state(connection, path, inode, offset)
            self._set_automation_scan_state(connection, path, inode, offset)
            self._set_crawler_scan_state(connection, path, inode, offset)

    def import_legacy(self, source_id, source_path, content_sha256, filters, lines, counts, automated, resolver):
        with self.connection() as connection:
            existing = connection.execute("SELECT 1 FROM legacy_imports WHERE source_id=?", (source_id,)).fetchone()
            classified = connection.execute(
                "SELECT 1 FROM legacy_automation_imports WHERE source_id=?", (source_id,)
            ).fetchone()
            if existing and classified:
                return False
            self._ensure_geos(connection, sorted({ip for _, ip in counts}), resolver)
            if not existing:
                connection.executemany(
                    "INSERT INTO daily_ip(day,ip,hits) VALUES(?,?,?) "
                    "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                    ((day, ip, hits) for (day, ip), hits in counts.items()),
                )
                connection.execute(
                    "INSERT INTO legacy_imports(source_id,source_path,content_sha256,filters_json,imported_at,lines,hits) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (source_id, str(source_path), content_sha256, json.dumps(filters, sort_keys=True, separators=(",", ":")),
                     int(time.time()), int(lines), int(sum(counts.values()))),
                )
            connection.executemany(
                "INSERT INTO daily_automated_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in automated.items()),
            )
            connection.execute("INSERT INTO legacy_automation_imports(source_id) VALUES(?)", (source_id,))
            return not existing

    def import_legacy_behavior(self, source_id, automated):
        with self.connection() as connection:
            existing = connection.execute(
                "SELECT 1 FROM legacy_behavior_imports WHERE source_id=?", (source_id,)
            ).fetchone()
            if existing:
                return False
            connection.executemany(
                "INSERT INTO daily_automated_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in automated.items()),
            )
            connection.execute("INSERT INTO legacy_behavior_imports(source_id) VALUES(?)", (source_id,))
            return True

    def import_legacy_crawlers(self, source_id, crawlers, retained_automated=None):
        retained_automated = retained_automated or {}
        with self.connection() as connection:
            existing = connection.execute(
                "SELECT 1 FROM legacy_crawler_imports WHERE source_id=?", (source_id,)
            ).fetchone()
            if existing:
                return False
            was_excluded = connection.execute(
                "SELECT 1 FROM legacy_automation_imports WHERE source_id=?", (source_id,)
            ).fetchone()
            behavior_classified = connection.execute(
                "SELECT 1 FROM legacy_behavior_imports WHERE source_id=?", (source_id,)
            ).fetchone()
            connection.executemany(
                "INSERT INTO daily_crawler_ip(day,ip,hits) VALUES(?,?,?) "
                "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                ((day, ip, hits) for (day, ip), hits in crawlers.items()),
            )
            if was_excluded:
                connection.executemany(
                    "UPDATE daily_automated_ip SET hits=MAX(hits-?,0) WHERE day=? AND ip=?",
                    ((hits, day, ip) for (day, ip), hits in crawlers.items()),
                )
                if behavior_classified:
                    # 旧版本把所有声明爬虫直接排除，升级时只把其中仍命中恶意行为规则的请求留在排除量中。
                    connection.executemany(
                        "INSERT INTO daily_automated_ip(day,ip,hits) VALUES(?,?,?) "
                        "ON CONFLICT(day,ip) DO UPDATE SET hits=hits+excluded.hits",
                        ((day, ip, hits) for (day, ip), hits in retained_automated.items()),
                    )
                connection.execute("DELETE FROM daily_automated_ip WHERE hits<=0")
            connection.execute("INSERT INTO legacy_crawler_imports(source_id) VALUES(?)", (source_id,))
            return True

    @staticmethod
    def _ensure_geos(connection, ips, resolver):
        known = set()
        for start in range(0, len(ips), 500):
            batch = ips[start:start + 500]
            placeholders = ",".join("?" for _ in batch)
            if batch:
                known.update(row[0] for row in connection.execute(
                    "SELECT ip FROM ip_geo WHERE ip IN ({})".format(placeholders), batch
                ))
        for ip in ips:
            if ip not in known:
                geo = resolver.lookup(ip)
                connection.execute(
                    "INSERT OR IGNORE INTO ip_geo(ip,country,province,city,isp,country_code,location) VALUES(?,?,?,?,?,?,?)",
                    (ip, geo["country"], geo["province"], geo["city"], geo["source"], geo["country_code"], geo["location"]),
                )

    def mark_ingest_error(self, path, message):
        inode, offset = self.get_ingest_state(path)
        with self.connection() as connection:
            self.set_ingest_state(connection, path, inode, offset, message)

    def runtime_settings(self, defaults, limits=None):
        result = dict(defaults)
        with self.connection() as connection:
            rows = connection.execute("SELECT key,value FROM runtime_settings").fetchall()
        for row in rows:
            if row["key"] in result:
                value = int(row["value"])
                if limits is None or limits[row["key"]][0] <= value <= limits[row["key"]][1]:
                    result[row["key"]] = value
        return result

    def update_runtime_settings(self, values):
        now = int(time.time())
        with self.connection() as connection:
            connection.executemany(
                "INSERT INTO runtime_settings(key,value,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                ((key, int(value), now) for key, value in values.items()),
            )

    def prune(self, retention_days):
        cutoff = (date.today() - timedelta(days=retention_days - 1)).isoformat()
        now = int(time.time())
        with self.connection() as connection:
            connection.execute("DELETE FROM daily_ip WHERE day < ?", (cutoff,))
            connection.execute("DELETE FROM daily_automated_ip WHERE day < ?", (cutoff,))
            connection.execute("DELETE FROM daily_crawler_ip WHERE day < ?", (cutoff,))
            connection.execute("DELETE FROM ip_geo WHERE ip NOT IN (SELECT DISTINCT ip FROM daily_ip)")
            connection.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            connection.execute("DELETE FROM login_buckets WHERE window_started < ?", (now - 86400,))
            connection.execute("DELETE FROM auth_events WHERE happened_at < ?", (now - 30 * 86400,))

    def stats(self, days, excluded):
        excluded = sorted(set(excluded))
        start = (date.today() - timedelta(days=days - 1)).isoformat()
        where = "d.day >= ?"
        top_where = "d.day >= ?"
        parameters = [start]
        if excluded:
            where += " AND d.ip NOT IN ({})".format(",".join("?" for _ in excluded))
            top_where += " AND d.ip NOT IN ({})".format(",".join("?" for _ in excluded))
            parameters.extend(excluded)
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT d.day,SUM(MAX(d.hits-COALESCE(a.hits,0),0)) AS pv,"
                "SUM(CASE WHEN d.hits>COALESCE(a.hits,0) THEN 1 ELSE 0 END) AS uv "
                "FROM daily_ip d LEFT JOIN daily_automated_ip a ON a.day=d.day AND a.ip=d.ip "
                "WHERE {} GROUP BY d.day ORDER BY d.day".format(where), parameters
            ).fetchall()
            top = connection.execute(
                "SELECT d.ip,SUM(MAX(d.hits-COALESCE(a.hits,0),0)) AS hits,SUM(COALESCE(c.hits,0)) AS crawler_hits,"
                "g.country,g.province,g.city,g.isp,g.country_code,g.location "
                "FROM daily_ip d LEFT JOIN daily_automated_ip a ON a.day=d.day AND a.ip=d.ip "
                "LEFT JOIN daily_crawler_ip c ON c.day=d.day AND c.ip=d.ip "
                "JOIN ip_geo g ON g.ip=d.ip WHERE {} GROUP BY d.ip "
                "HAVING SUM(MAX(d.hits-COALESCE(a.hits,0),0))>0 "
                "ORDER BY SUM(MAX(d.hits-COALESCE(a.hits,0),0)) DESC LIMIT 100".format(top_where), parameters
            ).fetchall()
            regions = connection.execute(
                "SELECT g.country_code,g.province,SUM(MAX(d.hits-COALESCE(a.hits,0),0)) AS hits FROM daily_ip d "
                "LEFT JOIN daily_automated_ip a ON a.day=d.day AND a.ip=d.ip JOIN ip_geo g ON g.ip=d.ip "
                "WHERE {} GROUP BY g.country_code,g.province "
                "HAVING SUM(MAX(d.hits-COALESCE(a.hits,0),0))>0".format(top_where), parameters
            ).fetchall()
            ingest = connection.execute("SELECT updated_at,error FROM ingest_state ORDER BY updated_at DESC LIMIT 1").fetchone()
        by_day = {row["day"]: row for row in rows}
        data = []
        for index in range(days - 1, -1, -1):
            value = (date.today() - timedelta(days=index)).isoformat()
            row = by_day.get(value)
            data.append({"date": value[5:], "full_date": value, "pv": int(row["pv"]) if row else 0, "uv": int(row["uv"]) if row else 0})
        top_ip = [{
            "ip": row["ip"], "count": int(row["hits"]), "crawler": int(row["crawler_hits"] or 0) > 0,
            "geo": {"country": row["country"], "province": row["province"], "city": row["city"],
                    "source": row["isp"], "country_code": row["country_code"], "location": row["location"]}
        } for row in top]
        return {
            "data": data,
            "top_ip": top_ip,
            "regions": [{"country_code": row["country_code"], "province": row["province"], "count": int(row["hits"])} for row in regions],
            "excluded": excluded,
            "ingest": {"updated_at": int(ingest["updated_at"]), "error": ingest["error"]} if ingest else {"updated_at": 0, "error": "等待日志"},
        }

    def create_session(self, token_hash, username, csrf_token, user_agent_hash, now, expires_at):
        with self.connection() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            connection.execute(
                "INSERT INTO sessions(token_hash,username,csrf_token,user_agent_hash,created_at,last_seen,expires_at) VALUES(?,?,?,?,?,?,?)",
                (token_hash, username, csrf_token, user_agent_hash, now, now, expires_at),
            )

    def get_session(self, token_hash, user_agent_hash, now, duration_seconds):
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM sessions WHERE token_hash=?", (token_hash,)).fetchone()
            expires_at = int(row["created_at"]) + duration_seconds if row else 0
            if not row or expires_at <= now or row["user_agent_hash"] != user_agent_hash:
                connection.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
                return None
            if row["last_seen"] + 60 <= now or row["expires_at"] != expires_at:
                connection.execute("UPDATE sessions SET last_seen=?,expires_at=? WHERE token_hash=?", (now, expires_at, token_hash))
            result = dict(row)
            result["last_seen"] = now
            result["expires_at"] = expires_at
            return result

    def delete_session(self, token_hash):
        with self.connection() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))

    def sync_auth_generation(self, generation):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT value FROM auth_state WHERE key='generation'").fetchone()
            changed = not row or row["value"] != generation
            if changed:
                connection.execute("DELETE FROM sessions")
            connection.execute(
                "INSERT INTO auth_state(key,value) VALUES('generation',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (generation,),
            )
            return changed

    def allow_login_attempt(self, client_ip, now):
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            global_row = self._bucket(connection, "global", "login", now, 60)
            ip_row = self._bucket(connection, "ip", client_ip, now, 300)
            if global_row["attempts"] >= 60 or ip_row["blocked_until"] > now or ip_row["attempts"] >= 10:
                return False
            connection.execute("UPDATE login_buckets SET attempts=attempts+1 WHERE scope='global' AND bucket_key='login'")
            connection.execute("UPDATE login_buckets SET attempts=attempts+1 WHERE scope='ip' AND bucket_key=?", (client_ip,))
            return True

    def record_login_failure(self, client_ip, username, now):
        username_hash = hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = self._bucket(connection, "ip", client_ip, now, 300)
            failures = int(row["failures"]) + 1
            block = now + min(900, 15 * (2 ** max(0, failures - 5))) if failures >= 5 else 0
            connection.execute("UPDATE login_buckets SET failures=?,blocked_until=? WHERE scope='ip' AND bucket_key=?", (failures, block, client_ip))
            account = self._bucket(connection, "account", username_hash, now, 900)
            account_failures = int(account["failures"]) + 1
            connection.execute("UPDATE login_buckets SET failures=? WHERE scope='account' AND bucket_key=?", (account_failures, username_hash))
            connection.execute("INSERT INTO auth_events(happened_at,event,client_ip,username_hash) VALUES(?,?,?,?)", (now, "failure", client_ip, username_hash))
            return min(0.5, 0.1 * (2 ** max(0, account_failures - 3)))

    def record_login_success(self, client_ip, username, now):
        username_hash = hashlib.sha256(username.encode("utf-8")).hexdigest()[:16]
        with self.connection() as connection:
            connection.execute("DELETE FROM login_buckets WHERE scope='ip' AND bucket_key=?", (client_ip,))
            connection.execute("DELETE FROM login_buckets WHERE scope='account' AND bucket_key=?", (username_hash,))
            connection.execute("INSERT INTO auth_events(happened_at,event,client_ip,username_hash) VALUES(?,?,?,?)", (now, "success", client_ip, username_hash))

    def load_recovery_codes(self, hashes):
        hashes = sorted(set(hashes))
        with self.connection() as connection:
            if hashes:
                connection.execute(
                    "DELETE FROM recovery_codes WHERE code_hash NOT IN ({})".format(",".join("?" for _ in hashes)), hashes
                )
                connection.executemany("INSERT OR IGNORE INTO recovery_codes(code_hash) VALUES(?)", ((value,) for value in hashes))
            else:
                connection.execute("DELETE FROM recovery_codes")

    def consume_recovery_code(self, value, now):
        digest = hashlib.sha256(value.strip().upper().encode("ascii", "ignore")).hexdigest()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT used_at FROM recovery_codes WHERE code_hash=?", (digest,)).fetchone()
            if not row or row["used_at"] is not None:
                return False
            connection.execute("UPDATE recovery_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL", (now, digest))
            return connection.total_changes == 1

    @staticmethod
    def _bucket(connection, scope, key, now, window):
        row = connection.execute("SELECT * FROM login_buckets WHERE scope=? AND bucket_key=?", (scope, key)).fetchone()
        if not row or row["window_started"] + window <= now:
            connection.execute(
                "INSERT INTO login_buckets(scope,bucket_key,window_started,attempts,failures,blocked_until) VALUES(?,?,?,0,0,0) "
                "ON CONFLICT(scope,bucket_key) DO UPDATE SET window_started=excluded.window_started,attempts=0,failures=0,blocked_until=0",
                (scope, key, now),
            )
            row = connection.execute("SELECT * FROM login_buckets WHERE scope=? AND bucket_key=?", (scope, key)).fetchone()
        return row
