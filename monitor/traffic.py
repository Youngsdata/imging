import re


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
