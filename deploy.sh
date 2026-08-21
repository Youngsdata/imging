#!/usr/bin/env bash
set -Eeuo pipefail

# macOS 通过非登录 SSH 执行脚本时，Docker Desktop CLI 路径可能不在 PATH 中。
if ! command -v docker >/dev/null 2>&1; then
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
fi

readonly CONTAINER_NAME="imging"
readonly IMAGE="${IMGING_IMAGE:-ghcr.io/youngsdata/imging:latest}"
readonly DEFAULT_HOST_PORT="8080"
readonly DEFAULT_HTTPS_PORT="443"
readonly DEFAULT_BIND_ADDRESS="0.0.0.0"
readonly DEFAULT_TIMEZONE="UTC"
readonly SSL_LABEL="io.youngsdata.imging.ssl"
readonly CERT_LABEL="io.youngsdata.imging.ssl.cert"
readonly KEY_LABEL="io.youngsdata.imging.ssl.key"
readonly HTTPS_PORT_LABEL="io.youngsdata.imging.ssl.https-port"
readonly DEFAULT_SECCOMP_MODE="default"
readonly BIND_LABEL="io.youngsdata.imging.bind"
readonly PORT_LABEL="io.youngsdata.imging.port"
readonly SECCOMP_LABEL="io.youngsdata.imging.seccomp"
readonly ICP_LABEL="io.youngsdata.imging.beian.icp"
readonly OWNER_LABEL="io.youngsdata.imging.beian.owner"
readonly LOG_DIR_LABEL="io.youngsdata.imging.log-dir"
readonly TRUSTED_PROXIES_LABEL="io.youngsdata.imging.trusted-proxies"
readonly TIMEZONE_LABEL="io.youngsdata.imging.timezone"

usage() {
  cat <<'EOF'
用法: deploy.sh [选项]

  默认                     容器已存在时重启；不存在时在后台创建并启动
  -u, --update             先拉取最新镜像；镜像有变化时重建，否则重启
  -c, --cert FILE          启用 HTTPS，挂载证书或 fullchain 文件
  -k, --key FILE           启用 HTTPS，挂载证书私钥
      --https-port PORT    HTTPS 主机端口，默认 443
      --no-ssl             显式关闭已有容器的 HTTPS 配置
      --bind ADDR          端口绑定地址，默认 0.0.0.0；用前置反代时建议 127.0.0.1
      --port PORT          HTTP 主机端口，默认 8080
      --seccomp MODE       default(默认) 或 unconfined；老内核 libseccomp 过旧导致
                           nginx 报 "Operation not permitted" 时改用 unconfined
      --log-dir DIR        持久化 JSON access log 的宿主机目录
      --trusted-proxies CIDR[,CIDR...]
                           允许提供 X-Forwarded-For 的前置代理；必须使用精确 CIDR
      --timezone TZ        access log 与统计日界线时区，默认 UTC
      --icp TEXT           页脚展示的 ICP 备案号，传空串清除
      --owner TEXT         页脚展示的主办单位名称，传空串清除
  -h, --help               显示帮助

镜像可通过 IMGING_IMAGE 环境变量覆盖。再次执行或使用 -u 时，会自动继承已有容器的
HTTPS 配置、端口、绑定地址、日志目录、可信代理、时区与备案信息。
备案信息只写入容器环境变量，不进镜像也不进仓库。
EOF
}

update_image=false
disable_ssl=false
certificate_input=""
private_key_input=""
https_port_input=""
bind_input=""
host_port_input=""
seccomp_input=""
log_dir_input=""
trusted_proxies_input=""
timezone_input=""
icp_input=""
owner_input=""
certificate_option_seen=false
private_key_option_seen=false
https_port_option_seen=false
bind_option_seen=false
host_port_option_seen=false
seccomp_option_seen=false
log_dir_option_seen=false
trusted_proxies_option_seen=false
timezone_option_seen=false
icp_option_seen=false
owner_option_seen=false

while (( $# > 0 )); do
  case "$1" in
    -u|--update)
      update_image=true
      shift
      ;;
    -c|--cert)
      if (( $# < 2 )); then
        echo "选项 $1 缺少证书文件" >&2
        usage >&2
        exit 2
      fi
      certificate_input="$2"
      certificate_option_seen=true
      shift 2
      ;;
    --cert=*)
      certificate_input="${1#*=}"
      certificate_option_seen=true
      shift
      ;;
    -k|--key)
      if (( $# < 2 )); then
        echo "选项 $1 缺少私钥文件" >&2
        usage >&2
        exit 2
      fi
      private_key_input="$2"
      private_key_option_seen=true
      shift 2
      ;;
    --key=*)
      private_key_input="${1#*=}"
      private_key_option_seen=true
      shift
      ;;
    --https-port)
      if (( $# < 2 )); then
        echo "选项 --https-port 缺少端口" >&2
        usage >&2
        exit 2
      fi
      https_port_input="$2"
      https_port_option_seen=true
      shift 2
      ;;
    --https-port=*)
      https_port_input="${1#*=}"
      https_port_option_seen=true
      shift
      ;;
    --no-ssl)
      disable_ssl=true
      shift
      ;;
    --bind)
      if (( $# < 2 )); then
        echo "选项 --bind 缺少绑定地址" >&2
        usage >&2
        exit 2
      fi
      bind_input="$2"
      bind_option_seen=true
      shift 2
      ;;
    --bind=*)
      bind_input="${1#*=}"
      bind_option_seen=true
      shift
      ;;
    --port)
      if (( $# < 2 )); then
        echo "选项 --port 缺少端口" >&2
        usage >&2
        exit 2
      fi
      host_port_input="$2"
      host_port_option_seen=true
      shift 2
      ;;
    --port=*)
      host_port_input="${1#*=}"
      host_port_option_seen=true
      shift
      ;;
    --seccomp)
      if (( $# < 2 )); then
        echo "选项 --seccomp 缺少模式" >&2
        usage >&2
        exit 2
      fi
      seccomp_input="$2"
      seccomp_option_seen=true
      shift 2
      ;;
    --seccomp=*)
      seccomp_input="${1#*=}"
      seccomp_option_seen=true
      shift
      ;;
    --log-dir)
      if (( $# < 2 )); then
        echo "选项 --log-dir 缺少目录" >&2
        usage >&2
        exit 2
      fi
      log_dir_input="$2"
      log_dir_option_seen=true
      shift 2
      ;;
    --log-dir=*)
      log_dir_input="${1#*=}"
      log_dir_option_seen=true
      shift
      ;;
    --trusted-proxies)
      if (( $# < 2 )); then
        echo "选项 --trusted-proxies 缺少 CIDR" >&2
        usage >&2
        exit 2
      fi
      trusted_proxies_input="$2"
      trusted_proxies_option_seen=true
      shift 2
      ;;
    --trusted-proxies=*)
      trusted_proxies_input="${1#*=}"
      trusted_proxies_option_seen=true
      shift
      ;;
    --timezone)
      if (( $# < 2 )); then
        echo "选项 --timezone 缺少时区" >&2
        usage >&2
        exit 2
      fi
      timezone_input="$2"
      timezone_option_seen=true
      shift 2
      ;;
    --timezone=*)
      timezone_input="${1#*=}"
      timezone_option_seen=true
      shift
      ;;
    --icp)
      if (( $# < 2 )); then
        echo "选项 --icp 缺少备案号" >&2
        usage >&2
        exit 2
      fi
      icp_input="$2"
      icp_option_seen=true
      shift 2
      ;;
    --icp=*)
      icp_input="${1#*=}"
      icp_option_seen=true
      shift
      ;;
    --owner)
      if (( $# < 2 )); then
        echo "选项 --owner 缺少主办单位名称" >&2
        usage >&2
        exit 2
      fi
      owner_input="$2"
      owner_option_seen=true
      shift 2
      ;;
    --owner=*)
      owner_input="${1#*=}"
      owner_option_seen=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      if (( $# > 0 )); then
        echo "不支持的位置参数: $*" >&2
        usage >&2
        exit 2
      fi
      ;;
    -*)
      echo "未知选项: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      echo "不支持的位置参数: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$disable_ssl" == true ]] &&
   { [[ "$certificate_option_seen" == true ]] || [[ "$private_key_option_seen" == true ]] || [[ "$https_port_option_seen" == true ]]; }; then
  echo "--no-ssl 不能与 --cert、--key 或 --https-port 同时使用" >&2
  exit 2
fi

if [[ "$certificate_option_seen" != "$private_key_option_seen" ]]; then
  echo "--cert 和 --key 必须同时提供" >&2
  exit 2
fi

if [[ "$certificate_option_seen" == true ]] && { [[ -z "$certificate_input" ]] || [[ -z "$private_key_input" ]]; }; then
  echo "--cert 和 --key 的值不能为空" >&2
  exit 2
fi

if [[ "$https_port_option_seen" == true ]] && [[ -z "$https_port_input" ]]; then
  echo "--https-port 的值不能为空" >&2
  exit 2
fi

# --icp 与 --owner 允许空串（表示清除页脚展示），--bind 是必须落到 docker publish 上的地址，不能为空。
if [[ "$bind_option_seen" == true ]] && [[ -z "$bind_input" ]]; then
  echo "--bind 的值不能为空" >&2
  exit 2
fi

if [[ "$host_port_option_seen" == true ]] && [[ -z "$host_port_input" ]]; then
  echo "--port 的值不能为空" >&2
  exit 2
fi

if [[ "$log_dir_option_seen" == true ]] && [[ -z "$log_dir_input" ]]; then
  echo "--log-dir 的值不能为空" >&2
  exit 2
fi

if [[ "$timezone_option_seen" == true ]] &&
   { [[ -z "$timezone_input" ]] || [[ "$timezone_input" =~ [^A-Za-z0-9_+:/-] ]]; }; then
  echo "--timezone 只能包含时区名称使用的字母、数字、_、+、-、:、/" >&2
  exit 2
fi

if [[ "$trusted_proxies_option_seen" == true ]] && [[ "$trusted_proxies_input" =~ [^0-9A-Fa-f:.,/[:space:]] ]]; then
  echo "--trusted-proxies 包含非法字符" >&2
  exit 2
fi

if [[ "$seccomp_option_seen" == true ]] && [[ "$seccomp_input" != "default" ]] && [[ "$seccomp_input" != "unconfined" ]]; then
  echo "--seccomp 只支持 default 或 unconfined，当前: $seccomp_input" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 Docker CLI，请确认 Docker Desktop 已安装" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon 不可用，请先启动 Docker Desktop" >&2
  exit 1
fi

container_exists() {
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1
}

container_label() {
  local label_name="$1"
  local label_value

  label_value="$(docker container inspect --format "{{ index .Config.Labels \"$label_name\" }}" "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ "$label_value" == "<no value>" ]]; then
    label_value=""
  fi
  printf '%s' "$label_value"
}

validate_port() {
  local port="$1"
  local label="${2:-端口}"

  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    echo "无效的 $label: $port" >&2
    exit 2
  fi
}

resolve_directory() {
  local input_path="$1"
  local resolved_path

  if [[ ! -d "$input_path" ]]; then
    echo "目录不存在: $input_path" >&2
    exit 1
  fi
  resolved_path="$(cd "$input_path" && pwd)"
  if [[ ! -w "$resolved_path" ]]; then
    echo "目录不可写: $resolved_path" >&2
    exit 1
  fi
  printf '%s' "$resolved_path"
}

container_host_port() {
  docker container inspect --format '{{with index .NetworkSettings.Ports "80/tcp"}}{{with index . 0}}{{.HostPort}}{{end}}{{end}}' \
    "$CONTAINER_NAME" 2>/dev/null || true
}

resolve_file() {
  local input_path="$1"
  local input_directory
  local resolved_path

  if [[ "$input_path" == /* ]]; then
    resolved_path="$input_path"
  else
    input_directory="$(dirname "$input_path")"
    if [[ ! -d "$input_directory" ]]; then
      echo "目录不存在: $input_directory" >&2
      exit 1
    fi
    resolved_path="$(cd "$input_directory" && pwd)/$(basename "$input_path")"
  fi

  if [[ ! -f "$resolved_path" ]] || [[ ! -r "$resolved_path" ]]; then
    echo "文件不存在或不可读: $resolved_path" >&2
    exit 1
  fi

  printf '%s' "$resolved_path"
}

container_present=false
existing_ssl=false
if container_exists; then
  container_present=true
  if [[ "$(container_label "$SSL_LABEL")" == "true" ]]; then
    existing_ssl=true
  fi
fi

ssl_enabled=false
certificate_path=""
private_key_path=""
https_port="$DEFAULT_HTTPS_PORT"
configuration_changed=false

if [[ "$disable_ssl" == true ]]; then
  if [[ "$existing_ssl" == true ]]; then
    configuration_changed=true
  fi
elif [[ "$certificate_option_seen" == true ]]; then
  ssl_enabled=true
  certificate_path="$(resolve_file "$certificate_input")"
  private_key_path="$(resolve_file "$private_key_input")"
  if [[ "$https_port_option_seen" == true ]]; then
    https_port="$https_port_input"
  elif [[ "$existing_ssl" == true ]]; then
    https_port="$(container_label "$HTTPS_PORT_LABEL")"
    https_port="${https_port:-$DEFAULT_HTTPS_PORT}"
  fi
  configuration_changed=true
elif [[ "$existing_ssl" == true ]]; then
  ssl_enabled=true
  certificate_path="$(resolve_file "$(container_label "$CERT_LABEL")")"
  private_key_path="$(resolve_file "$(container_label "$KEY_LABEL")")"
  https_port="$(container_label "$HTTPS_PORT_LABEL")"
  https_port="${https_port:-$DEFAULT_HTTPS_PORT}"

  if [[ "$https_port_option_seen" == true ]] && [[ "$https_port_input" != "$https_port" ]]; then
    https_port="$https_port_input"
    configuration_changed=true
  fi
elif [[ "$https_port_option_seen" == true ]]; then
  echo "--https-port 需要同时提供 --cert 和 --key，或用于已有 HTTPS 容器" >&2
  exit 2
fi

if [[ "$ssl_enabled" == true ]]; then
  validate_port "$https_port" "HTTPS 端口"
fi

# 运行参数都落在 label 上：-u 拉到新镜像时容器会被重建，
# 不继承就会悄悄退回默认值——端口重新暴露到公网、页脚备案号消失，且两者都不会报错。
bind_address="$DEFAULT_BIND_ADDRESS"
host_port="$DEFAULT_HOST_PORT"
seccomp_mode="$DEFAULT_SECCOMP_MODE"
beian_icp=""
beian_owner=""
log_dir=""
trusted_proxies=""
timezone="$DEFAULT_TIMEZONE"

if [[ "$container_present" == true ]]; then
  bind_address="$(container_label "$BIND_LABEL")"
  bind_address="${bind_address:-$DEFAULT_BIND_ADDRESS}"
  host_port="$(container_label "$PORT_LABEL")"
  host_port="${host_port:-$(container_host_port)}"
  host_port="${host_port:-$DEFAULT_HOST_PORT}"
  seccomp_mode="$(container_label "$SECCOMP_LABEL")"
  seccomp_mode="${seccomp_mode:-$DEFAULT_SECCOMP_MODE}"
  beian_icp="$(container_label "$ICP_LABEL")"
  beian_owner="$(container_label "$OWNER_LABEL")"
  log_dir="$(container_label "$LOG_DIR_LABEL")"
  trusted_proxies="$(container_label "$TRUSTED_PROXIES_LABEL")"
  timezone="$(container_label "$TIMEZONE_LABEL")"
  timezone="${timezone:-$DEFAULT_TIMEZONE}"
fi

if [[ "$bind_option_seen" == true ]] && [[ "$bind_input" != "$bind_address" ]]; then
  bind_address="$bind_input"
  configuration_changed=true
fi

if [[ "$host_port_option_seen" == true ]] && [[ "$host_port_input" != "$host_port" ]]; then
  host_port="$host_port_input"
  configuration_changed=true
fi
validate_port "$host_port" "HTTP 端口"

if [[ "$seccomp_option_seen" == true ]] && [[ "$seccomp_input" != "$seccomp_mode" ]]; then
  seccomp_mode="$seccomp_input"
  configuration_changed=true
fi

if [[ "$log_dir_option_seen" == true ]]; then
  resolved_log_dir="$(resolve_directory "$log_dir_input")"
  if [[ "$resolved_log_dir" != "$log_dir" ]]; then
    log_dir="$resolved_log_dir"
    configuration_changed=true
  fi
elif [[ -n "$log_dir" ]]; then
  log_dir="$(resolve_directory "$log_dir")"
fi

if [[ "$trusted_proxies_option_seen" == true ]] && [[ "$trusted_proxies_input" != "$trusted_proxies" ]]; then
  trusted_proxies="$trusted_proxies_input"
  configuration_changed=true
fi

if [[ "$timezone_option_seen" == true ]] && [[ "$timezone_input" != "$timezone" ]]; then
  timezone="$timezone_input"
  configuration_changed=true
fi

if [[ "$icp_option_seen" == true ]] && [[ "$icp_input" != "$beian_icp" ]]; then
  beian_icp="$icp_input"
  configuration_changed=true
fi

if [[ "$owner_option_seen" == true ]] && [[ "$owner_input" != "$beian_owner" ]]; then
  beian_owner="$owner_input"
  configuration_changed=true
fi

start_container() {
  local -a docker_arguments=(
    docker run
    --detach
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    --publish "$bind_address:$host_port:80"
    --label "io.youngsdata.imging.managed-by=deploy.sh"
    --label "$BIND_LABEL=$bind_address"
    --label "$PORT_LABEL=$host_port"
    --label "$SECCOMP_LABEL=$seccomp_mode"
    --label "$ICP_LABEL=$beian_icp"
    --label "$OWNER_LABEL=$beian_owner"
    --label "$LOG_DIR_LABEL=$log_dir"
    --label "$TRUSTED_PROXIES_LABEL=$trusted_proxies"
    --label "$TIMEZONE_LABEL=$timezone"
    --env "TZ=$timezone"
  )

  # 老内核（如 CentOS 7）的 libseccomp 不认识新版 musl 使用的 pwritev2 等 syscall，
  # Docker 默认 profile 对未知 syscall 返回 EPERM，nginx 会卡在写 /run/nginx.pid 直接退出。
  if [[ "$seccomp_mode" == "unconfined" ]]; then
    docker_arguments+=(--security-opt "seccomp=unconfined")
  fi

  if [[ -n "$beian_icp" ]]; then
    docker_arguments+=(--env "IMGING_BEIAN_ICP=$beian_icp")
  fi

  if [[ -n "$beian_owner" ]]; then
    docker_arguments+=(--env "IMGING_SITE_OWNER=$beian_owner")
  fi

  if [[ -n "$log_dir" ]]; then
    docker_arguments+=(--mount "type=bind,source=$log_dir,target=/var/log/imging")
  fi

  if [[ -n "$trusted_proxies" ]]; then
    docker_arguments+=(--env "IMGING_TRUSTED_PROXIES=$trusted_proxies")
  fi

  if [[ "$ssl_enabled" == true ]]; then
    docker_arguments+=(
      --publish "$bind_address:$https_port:443"
      --env "IMGING_SSL_ENABLED=1"
      --mount "type=bind,source=$certificate_path,target=/etc/nginx/ssl/tls.crt,readonly"
      --mount "type=bind,source=$private_key_path,target=/etc/nginx/ssl/tls.key,readonly"
      --label "$SSL_LABEL=true"
      --label "$CERT_LABEL=$certificate_path"
      --label "$KEY_LABEL=$private_key_path"
      --label "$HTTPS_PORT_LABEL=$https_port"
    )
  else
    docker_arguments+=(--label "$SSL_LABEL=false")
  fi

  docker_arguments+=("$IMAGE")
  "${docker_arguments[@]}"
}

if [[ "$update_image" == true ]]; then
  echo "正在更新镜像: $IMAGE"
  docker pull "$IMAGE"
fi

recreate_container="$configuration_changed"
if [[ "$update_image" == true ]] && [[ "$container_present" == true ]]; then
  current_image_id="$(docker container inspect --format '{{.Image}}' "$CONTAINER_NAME")"
  latest_image_id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"

  if [[ "$current_image_id" != "$latest_image_id" ]]; then
    recreate_container=true
    echo "检测到新镜像，将重建容器: $CONTAINER_NAME"
  fi
fi

if [[ "$container_present" == true ]]; then
  if [[ "$recreate_container" == true ]]; then
    if [[ "$ssl_enabled" == true ]]; then
      echo "正在使用 HTTPS 配置重建容器: $CONTAINER_NAME"
    else
      echo "正在使用 HTTP 配置重建容器: $CONTAINER_NAME"
    fi
    docker rm --force "$CONTAINER_NAME" >/dev/null
    start_container
  else
    echo "容器已存在，正在重启: $CONTAINER_NAME"
    docker restart "$CONTAINER_NAME" >/dev/null
  fi
else
  echo "容器不存在，正在后台创建: $CONTAINER_NAME"
  start_container
fi

docker container inspect \
  --format '容器 {{.Name}} 已启动，状态={{.State.Status}}，镜像={{.Config.Image}}，端口={{json .NetworkSettings.Ports}}' \
  "$CONTAINER_NAME"
