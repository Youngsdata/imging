import re
from collections import Counter, defaultdict, deque


# 只识别公开声明身份的搜索、预览、AI 与安全情报采集器。攻击判定不能依赖 User-Agent；
# 伪装成正常爬虫的敏感路径探测由 Nginx 的路径规则拦截，4xx/493 本来也不会进入统计。
AUTOMATED_USER_AGENT = re.compile(
    r"(?:"
    r"(?:googlebot|googleother|google-inspectiontool|adsbot-google|mediapartners-google)|"
    r"(?:bingbot|bingpreview|adidxbot|baiduspider|sogou|yandexbot|duckduckbot|applebot|petalbot|bytespider)|"
    r"(?:gptbot|chatgpt-user|oai-searchbot|claudebot|anthropic-ai|cohere-ai|perplexitybot)|"
    r"(?:facebookbot|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp)|"
    r"(?:gcombinator|livelapbot|wpnews-discovery|kingfisherdiscovery|threatintelagent)|"
    r"(?:crawler|spider|bot(?:[/; )]|$))"
    r")",
    re.IGNORECASE,
)


def is_automated_user_agent(value):
    return bool(AUTOMATED_USER_AGENT.search(str(value or "")[:1024]))


# 正常浏览器也会并发加载首页脚本，不能仅凭“短时间请求很多资源”判成爬虫。
# 这里只识别两类更强的行为信号：带 llms.txt 的多工具页扫取，以及同一 IP 在一分钟内
# 用不同浏览器身份重复执行完整首页预加载。规则不依赖国家、ASN 或具体 IP。
BOOTSTRAP_ASSETS = frozenset({
    "/ai/background-removal.js",
    "/ai/video-matting.js",
    "/video/editor.js",
    "/pdf/workspace.js",
})
TOOL_PAGE_PATHS = frozenset({"/img", "/gif", "/video", "/pdf", "/ai"})


class AutomatedTrafficClassifier:
    """按时间顺序流式识别自动化请求，事件保留一分钟且索引定期清理。"""

    def __init__(self, include_declared=True):
        self.include_declared = include_declared
        self.current_day = ""
        self.sequence = 0
        self.emitted = set()
        self.emitted_order = deque()
        self.path_windows = defaultdict(deque)
        self.ip_windows = defaultdict(deque)
        self.loads = {}
        self.load_candidates = defaultdict(deque)

    def feed(self, parsed):
        day, ip, declared, second, uri, missing_referer, agent_signature = parsed
        if day != self.current_day:
            self._reset_day(day)
        self.sequence += 1
        token = self.sequence
        self._expire_emitted(second)
        if self.sequence % 10000 == 0:
            self._prune_indexes(second)
        result = Counter()
        if declared:
            if self.include_declared:
                self._mark(day, ip, (token,), second, result)
            return result

        path_window = self.path_windows[(ip, uri)]
        self._expire_window(path_window, second, 60)
        path_window.append((second, token))
        if uri and len(path_window) >= 10:
            self._mark(day, ip, (item[1] for item in path_window), second, result)

        ip_window = self.ip_windows[ip]
        self._expire_window(ip_window, second, 5)
        ip_window.append((second, token, uri, missing_referer))
        eligible = [item for item in ip_window if item[3]]
        paths = {item[2] for item in eligible}
        if "/llms.txt" in paths and len(paths & TOOL_PAGE_PATHS) >= 3:
            self._mark(day, ip, (item[1] for item in eligible), second, result)

        self._classify_duplicate_bootstrap(
            day, ip, second, token, uri, missing_referer, agent_signature, result,
        )
        return result

    def _classify_duplicate_bootstrap(self, day, ip, second, token, uri, missing_referer, agent_signature, result):
        key = (ip, agent_signature)
        if uri == "/" and missing_referer:
            load = {
                "start": second, "agent": agent_signature, "tokens": [token],
                "assets": set(), "candidate": False, "automated": False,
            }
            self.loads[key] = load
        else:
            load = self.loads.get(key)
            if not load or second < load["start"] or second - load["start"] > 5:
                return
            load["tokens"].append(token)
            if uri in BOOTSTRAP_ASSETS:
                load["assets"].add(uri)
            if load["automated"]:
                self._mark(day, ip, (token,), second, result)
        if len(load["assets"]) < 3 or load["candidate"]:
            return
        load["candidate"] = True
        candidates = self.load_candidates[ip]
        while candidates and second - candidates[0]["start"] > 60:
            candidates.popleft()
        for other in candidates:
            if other["agent"] == agent_signature:
                continue
            other["automated"] = True
            load["automated"] = True
            self._mark(day, ip, other["tokens"], second, result)
            self._mark(day, ip, load["tokens"], second, result)
        candidates.append(load)

    def _mark(self, day, ip, tokens, second, result):
        for token in tokens:
            if token in self.emitted:
                continue
            self.emitted.add(token)
            self.emitted_order.append((second, token))
            result[(day, ip)] += 1

    def _expire_emitted(self, second):
        while self.emitted_order and second - self.emitted_order[0][0] > 60:
            _, token = self.emitted_order.popleft()
            self.emitted.discard(token)

    @staticmethod
    def _expire_window(window, second, duration):
        while window and second - window[0][0] > duration:
            window.popleft()

    def _prune_indexes(self, second):
        for key, window in list(self.path_windows.items()):
            if not window or second - window[-1][0] > 60:
                del self.path_windows[key]
        for key, window in list(self.ip_windows.items()):
            if not window or second - window[-1][0] > 5:
                del self.ip_windows[key]
        for key, load in list(self.loads.items()):
            if second - load["start"] > 60:
                del self.loads[key]
        for key, candidates in list(self.load_candidates.items()):
            while candidates and second - candidates[0]["start"] > 60:
                candidates.popleft()
            if not candidates:
                del self.load_candidates[key]

    def _reset_day(self, day):
        self.current_day = day
        self.emitted.clear()
        self.emitted_order.clear()
        self.path_windows.clear()
        self.ip_windows.clear()
        self.loads.clear()
        self.load_candidates.clear()
