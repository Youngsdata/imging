import ipaddress
import threading


class GeoResolver:
    def __init__(self, ipv4_path, ipv6_path):
        self._lock = threading.Lock()
        self._searchers = {}
        try:
            import ip2region.searcher as searcher
            import ip2region.util as util
        except ImportError:
            return
        for address_version, xdb_version, path in ((4, util.IPv4, ipv4_path), (6, util.IPv6, ipv6_path)):
            if not path.is_file():
                continue
            util.verify_from_file(str(path))
            content = util.load_content_from_file(str(path))
            self._searchers[address_version] = searcher.new_with_buffer(xdb_version, content)

    def lookup(self, value):
        try:
            address = ipaddress.ip_address(value)
        except ValueError:
            return self._empty("无效地址")
        if address.is_loopback:
            return self._empty("本机地址")
        if address.is_private:
            return self._empty("内网地址")
        if address.is_link_local or address.is_multicast or address.is_reserved or address.is_unspecified:
            return self._empty("保留地址")
        version = 4 if address.version == 4 else 6
        searcher = self._searchers.get(version)
        if searcher is None:
            return self._empty("地域库未加载")
        # 全内存查询器可并发安全使用；锁仅保护第三方 binding 的未来实现变化。
        with self._lock:
            result = searcher.search(str(address))
        parts = (result or "").split("|")
        parts += [""] * (5 - len(parts))
        country, province, city, isp, country_code = parts[:5]
        values = [item for item in (country, province, city) if item and item != "0"]
        location = " / ".join(values) or "未知"
        if isp and isp != "0":
            location += " · " + isp
        return {
            "country": "" if country == "0" else country,
            "province": "" if province == "0" else province,
            "city": "" if city == "0" else city,
            "source": "" if isp == "0" else isp,
            "country_code": "" if country_code == "0" else country_code,
            "location": location,
        }

    @staticmethod
    def _empty(location):
        return {"country": "", "province": "", "city": "", "source": "", "country_code": "", "location": location}
