#!/bin/sh
set -eu

# 备案号 / 主办单位属于部署方信息，不进仓库也不进公开镜像，只在容器启动时由环境变量注入。
icp_number="${IMGING_BEIAN_ICP:-}"
site_owner="${IMGING_SITE_OWNER:-}"

if [ -z "$icp_number" ] && [ -z "$site_owner" ]; then
    exit 0
fi

index_path="/usr/share/nginx/html/index.html"
pristine_path="/var/lib/imging/index.html.pristine"

if [ ! -r "$index_path" ]; then
    echo "Index page is not readable: $index_path" >&2
    exit 1
fi

# 原始副本放在站点根目录之外，避免未注入的页面被直接请求到。
# 容器 restart 会重跑本脚本，每次都从原始副本重新注入：既不会重复追加，改了备案号也不会残留旧值。
mkdir -p "$(dirname "$pristine_path")"
if [ ! -f "$pristine_path" ]; then
    cp "$index_path" "$pristine_path"
fi
cp "$pristine_path" "$index_path"

if ! grep -q '</footer>' "$index_path"; then
    echo "Footer anchor </footer> not found in $index_path" >&2
    exit 1
fi

# 反斜杠、& 和分隔符 # 在 sed 替换串里有特殊含义，注入前逐一转义。
escape_for_sed() {
    printf '%s' "$1" | sed -e 's/[\\&#]/\\&/g'
}

fragment='<div class="wrap" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px;line-height:1.7;opacity:.85">'

if [ -n "$site_owner" ]; then
    fragment="${fragment}<span>© $(escape_for_sed "$site_owner")</span>"
fi

# 工信部要求备案号在首页可见且能跳转到 beian.miit.gov.cn。
if [ -n "$icp_number" ]; then
    fragment="${fragment}<a href=\"https://beian.miit.gov.cn/\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"color:inherit;text-decoration:none;border-bottom:1px dashed currentColor\">$(escape_for_sed "$icp_number")</a>"
fi

fragment="${fragment}</div>"

sed -i "s#</footer>#${fragment}</footer>#" "$index_path"
echo "Injected filing information into footer: ${icp_number:-<none>}"
