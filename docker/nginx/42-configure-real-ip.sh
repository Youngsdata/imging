#!/bin/sh
set -eu

target=/etc/nginx/snippets/imging-real-ip.conf
: > "$target"

# 主镜像先创建日志文件，并只授予 monitor 容器的固定 GID 读取权限。
mkdir -p /var/log/imging
touch /var/log/imging/access.json
chgrp 10001 /var/log/imging /var/log/imging/access.json
chmod 0750 /var/log/imging
chmod 0640 /var/log/imging/access.json

trusted_proxies=${IMGING_TRUSTED_PROXIES:-}
if [ -z "$trusted_proxies" ]; then
    echo "imging: 未配置信任代理，访问日志使用连接来源 IP"
    exit 0
fi

old_ifs=$IFS
IFS=,
for network in $trusted_proxies; do
    network=$(printf '%s' "$network" | tr -d '[:space:]')
    case "$network" in
        ""|*[!0-9A-Fa-f:./]*)
            echo "imging: 非法的 IMGING_TRUSTED_PROXIES 项: $network" >&2
            exit 1
            ;;
    esac
    printf 'set_real_ip_from %s;\n' "$network" >> "$target"
done
IFS=$old_ifs

printf '%s\n' 'real_ip_header X-Forwarded-For;' 'real_ip_recursive on;' >> "$target"
echo "imging: 已配置显式可信代理网段"
