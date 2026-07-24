#!/usr/bin/env bash
set -Eeuo pipefail

# macOS 通过非登录 SSH 执行脚本时，Docker Desktop CLI 路径可能不在 PATH 中。
if ! command -v docker >/dev/null 2>&1; then
  export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
fi

readonly CONTAINER_NAME="imging"
readonly IMAGE="ghcr.io/youngsdata/imging:latest"
readonly HOST_PORT="8080"
readonly DEFAULT_HTTPS_PORT="443"
readonly SSL_LABEL="io.youngsdata.imging.ssl"
readonly CERT_LABEL="io.youngsdata.imging.ssl.cert"
readonly KEY_LABEL="io.youngsdata.imging.ssl.key"
readonly HTTPS_PORT_LABEL="io.youngsdata.imging.ssl.https-port"

usage() {
  cat <<'EOF'
用法: deploy.sh [选项]

  默认                     容器已存在时重启；不存在时在后台创建并启动
  -u, --update             先拉取最新镜像；镜像有变化时重建，否则重启
  -c, --cert FILE          启用 HTTPS，挂载证书或 fullchain 文件
  -k, --key FILE           启用 HTTPS，挂载证书私钥
      --https-port PORT    HTTPS 主机端口，默认 443
      --no-ssl             显式关闭已有容器的 HTTPS 配置
  -h, --help               显示帮助

再次执行或使用 -u 时，会自动继承已有容器的 HTTPS 证书路径和端口。
EOF
}

update_image=false
disable_ssl=false
certificate_input=""
private_key_input=""
https_port_input=""
certificate_option_seen=false
private_key_option_seen=false
https_port_option_seen=false

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

  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    echo "无效的 HTTPS 端口: $port" >&2
    exit 2
  fi
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
  validate_port "$https_port"
fi

start_container() {
  local -a docker_arguments=(
    docker run
    --detach
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    --publish "$HOST_PORT:80"
    --label "io.youngsdata.imging.managed-by=deploy.sh"
  )

  if [[ "$ssl_enabled" == true ]]; then
    docker_arguments+=(
      --publish "$https_port:443"
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
