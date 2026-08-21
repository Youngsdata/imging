"""下载并校验构建所需的固定版本离线数据。"""
import hashlib
import os
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen


ASSETS = {
    "ip2region-v4": (
        "https://raw.githubusercontent.com/lionsoul2014/ip2region/800d19424237f4be5f2081e6cd9547d98f3871c3/data/ip2region_v4.xdb",
        "/app/data/ip2region_v4.xdb", "c6edaf379fe524d7283a9c11c7eac27d5641a0976baa48c22c319ccd59aa3f36",
    ),
    "ip2region-v6": (
        "https://raw.githubusercontent.com/lionsoul2014/ip2region/800d19424237f4be5f2081e6cd9547d98f3871c3/data/ip2region_v6.xdb",
        "/app/data/ip2region_v6.xdb", "939f6b46bd2b8bec3cf7c5ceb8ba782266ae9b1f35b5ba7916700dec0b7506ed",
    ),
    "china-map": (
        "https://raw.githubusercontent.com/Supeset/China-GeoData/5822c4c0a0bdfd73327f9454976c8661bfd6ad9f/geojson/china_province_full.geojson",
        "/app/monitor/static/data/china.json", "99adfeded5223848bbe37a0a12f8023e11ee12161c7800521c27db42fdeac275",
    ),
    "world-map": (
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_admin_0_countries.geojson",
        "/app/monitor/static/data/world.json", "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
    ),
}


def fetch(url, destination, expected_sha256):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, 4):
        descriptor, temporary = tempfile.mkstemp(prefix=".asset-", dir=str(destination.parent))
        digest = hashlib.sha256()
        try:
            request = Request(url, headers={"User-Agent": "imging-monitor-build/1"})
            with urlopen(request, timeout=180) as response, os.fdopen(descriptor, "wb") as handle:
                descriptor = None
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            actual = digest.hexdigest()
            if actual != expected_sha256:
                raise RuntimeError("SHA-256 mismatch for {}: {}".format(url, actual))
            os.replace(temporary, destination)
            return
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt * 2)
        finally:
            if descriptor is not None:
                os.close(descriptor)
            if os.path.exists(temporary):
                os.unlink(temporary)


def main():
    names = sys.argv[1:] or list(ASSETS)
    unknown = [name for name in names if name not in ASSETS]
    if unknown:
        raise SystemExit("unknown asset: {}".format(", ".join(unknown)))
    for name in names:
        fetch(*ASSETS[name])


if __name__ == "__main__":
    main()
