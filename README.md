[![简体中文](https://img.shields.io/badge/语言-简体中文-0969da)](README.md)
[![English](https://img.shields.io/badge/Language-English-d0d7de)](README.en.md)

# 图映（imging）· 端侧图片与动图处理工具

图映把图片压缩、格式转换、在线做图、去背景、动图工坊和 PDF 工具放进一个可自托管的页面。PNG、JPEG、WebP 等常见格式直接在浏览器本地处理；在线做图可保存包含开放 JSON、原始素材和预览图的 `.imging` 可编辑工程；发行包内置的 WASM codecs 能在端侧完成 AVIF 编码和 HEIC 解码，自托管 ISNet / BEN2 / BiRefNet HR-Matting 模型还能完成快速、专业或骨灰级 AI 抠图。PDF 可在本地压缩，也可转换为包含可选择文字与获准字体、打开即显示正文且没有查看器菜单的单文件 HTML，文件无需上传。

**在线体验：<https://imging.cn>**

## 为什么选择图映

- **隐私优先**：常见格式、AVIF 编码和 HEIC 解码均可在设备本地完成。
- **本地专业去背景**：快速模式自动识别或手选四周任意底色，只移除外框连通区域并反混合去色边；AI 可选默认推荐、约 42 MB 的 ISNet INT8 快速模型，约 219 MB 的 BEN2 专业模型，或约 447 MB、按 2048×2048 处理的 BiRefNet HR-Matting 骨灰级模型。三档都从本站按需下载并独立缓存在浏览器，图片不会上传；输出支持 WebP、PNG 或 AVIF。
- **不只压单图**：支持 GIF、APNG、动图 WebP、动图 AVIF 的压缩与合成，并提供逐帧排序、删帧和时长调整。
- **开放设计工程**：在线做图支持保存和打开 `.imging` 工程，原始图片不重新编码；格式规范和 JSON Schema 见 [`docs/imging-project-format.md`](docs/imging-project-format.md)。
- **PDF 纯净单文件 HTML**：在浏览器本地按固定版式重建可选择文字、Type 3 矢量字形、路径、图片、平铺图案和轴向渐变，并检查 OpenType 字体嵌入许可；成品只包含页面正文与内联资源，不带缩放、报告或原 PDF 等查看器菜单。透明组、软蒙版等非等价特性会在工作台逐页提示。
- **一键自托管**：提供 `linux/amd64`、`linux/arm64` Docker 镜像，可部署在私有网络。
- **按能力透明降级**：浏览器无法处理的专业或老格式才交给可选的服务端解码器，不会把“服务端处理”伪装成“本地处理”。

> [!IMPORTANT]
> TIFF、JPEG 2000、PSD、DICOM、JXL，以及“把 PDF 当作图片输入”的专业格式解码所需的**服务端解码器为付费能力**；本地 PDF 压缩与 PDF 转单文件 HTML 不属于这项服务端能力。如需购买、集成或私有化部署，请联系 [admin@datadance.com](mailto:admin@datadance.com)。

## 与主流图片工具的产品力对比

| 维度 | 图映（本仓库发行包） | [Squoosh](https://squoosh.app/) · Google Chrome Labs | [TinyPNG / Tinify](https://tinypng.com/) | [CloudConvert](https://cloudconvert.com/) 类在线转换站 |
| --- | --- | --- | --- | --- |
| 核心定位 | 可自托管的端侧图片处理 + 完整动图工坊 | 专注单图的端侧压缩实验室 | 成熟的在线压缩服务 + API + CDN | 覆盖大量格式的云端转换服务 |
| 处理位置与图片隐私 | 常见格式、AVIF 编码、HEIC 解码均在设备本地完成；仅启用可选服务端解码器时上传到自有服务 | 全部压缩在浏览器本地完成，图片不上传 | 图片上传至 Tinify 服务处理 | 图片上传至服务端处理；以 CloudConvert 为例，文件处理后自动删除 |
| 单图压缩 | PNG-8 / JPEG / WebP / AVIF，PNG-8 参考测试约 45.8 dB，含 Lanczos-3 缩放 | PNG / JPEG / WebP / AVIF 等端侧编解码器，单图能力强 | JXL / AVIF / WebP / JPEG / PNG，单图压缩能力成熟 | 格式覆盖广，压缩或转换能力取决于服务端引擎 |
| 动图压缩 | GIF / APNG / 动图 WebP / 动图 AVIF，含帧间优化 | 未提供动图压缩工作流 | 公开支持 APNG；未提供同类多格式动图工坊 | 支持部分动图格式的服务端转换或优化 |
| 高级格式端侧能力 | WASM 本地 AVIF 编码 + HEIC 解码 | WASM 本地 AVIF 等格式编解码；未提供 HEIC 解码 | 无，AVIF / HEIC 等由云端处理 | 无，高级格式由云端处理 |
| 动图合成与逐帧编辑 | 支持拖拽排序、删帧、追加帧、单帧时长和循环设置 | 未提供 | 未提供 | 通常未提供同类交互式逐帧工坊 |
| 原图节奏读取 | 自动读取动图时长、循环与逐帧节奏 | 不适用 | 无独立逐帧节奏控制 | 取决于具体转换器和参数 |
| 自托管 / 离线 | 支持 Docker 私有化部署；本地路径不消耗云端调用额度 | 开源 PWA，加载后可本地处理 | 以托管 Web、Developer API 和 Image CDN 为主 | 以托管 Web、API 和第三方集成为主 |
| 免费、账号与水印 | 本地处理免费、免注册、无次数限制、无水印；吞吐受设备性能和浏览器内存约束 | 免费、免注册、无水印 | 免费 Web 端每批最多 20 张、每张最大 5 MB；免费格式转换最多 3 张 | 通常有免费额度；CloudConvert 免费档需注册，每日 10 个转换积分 |
| 开发者生态 | 聚焦可自托管页面；服务端解码器单独付费授权 | 开源 Web 应用，未提供同等成熟的托管 API / CDN | API、Image CDN、WordPress / Figma 插件及多语言 SDK 更成熟 | API、云存储和自动化集成成熟 |

图映的差异点不是只做单图压缩，而是把**端侧隐私、动图压缩与合成、逐帧编辑和自托管**放在一个工具里。Squoosh 同样坚持本地处理，单图能力很强；TinyPNG 强在成熟的云端压缩、API、CDN 和插件生态；CloudConvert 类服务则以服务端覆盖更多格式。对比依据为各家公开产品能力，信息核对日期为 **2026-08-11**；套餐和功能可能调整，请以 [Squoosh 项目说明](https://github.com/GoogleChromeLabs/squoosh)、[TinyPNG 官网](https://tinypng.com/)、[Developer API](https://tinify.com/developers)及 [CloudConvert 官网](https://cloudconvert.com/)为准。PNG-8 的 45.8 dB 为图映现有参考样例在 256 色下的 PSNR，不代表所有图片。

## 发行包

这是图映的公开发行仓库，只包含可直接部署的构建产物：

- 混淆后的正式单页应用 `dist/index.html`
- 浏览器端 AVIF / HEIC 运行时 codecs
- 浏览器端 AI 运行时与自托管 ISNet / BEN2 / BiRefNet HR-Matting 抠图模型
- Nginx Docker 镜像配置与一键启动脚本
- `.imging` 开放工程格式规范与机器可读 JSON Schema
- 浏览器本地 PDF 压缩与 PDF 转单文件 HTML 运行时
- 第三方软件许可证与声明

本仓库不包含图映的明文业务源码。图映自有页面及相关材料没有以开源许可证授权；公开可见、可拉取镜像不等于获得复制、修改或再发布授权。第三方组件仍分别适用其原有许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## Docker 部署

镜像支持 `linux/amd64` 和 `linux/arm64`：

### 一键部署

要求已安装并启动 Docker：

```bash
git clone https://github.com/Youngsdata/imging.git
cd imging
./deploy.sh
```

首次执行会在后台创建名为 `imging` 的容器，并将服务发布到 <http://localhost:8080>；再次执行会 restart 已有容器。

更新镜像并重启：

```bash
./deploy.sh -u
```

`-u` 会先拉取 `ghcr.io/youngsdata/imging:latest`。镜像有变化时重建容器以应用新 image；镜像未变化时直接 restart。容器使用 `unless-stopped` 重启策略。

### 直接启用 HTTPS（可选）

没有前置 Web/Nginx 时，可以把证书只读挂载进容器，直接发布 443：

```bash
./deploy.sh \
  --cert /etc/letsencrypt/live/imging.example.com/fullchain.pem \
  --key /etc/letsencrypt/live/imging.example.com/privkey.pem
```

此时同时提供：

- HTTP：<http://localhost:8080>
- HTTPS：`https://imging.example.com`（默认主机端口 `443`）

如 443 已被占用，可增加 `--https-port 8443`。已有 HTTPS 容器再次执行 `./deploy.sh` 或 `./deploy.sh -u` 时，会自动继承原证书路径和 HTTPS 端口；证书续期后执行一次脚本即可重启 Nginx 并加载新证书。更换证书路径时重新传入 `--cert` 和 `--key`，显式关闭 HTTPS 使用：

```bash
./deploy.sh --no-ssl
```

证书和私钥不会复制进镜像或 GitHub 仓库。

### 前置反代与端口绑定

默认发布到 `0.0.0.0:8080`。若前面另有一层 Nginx/Caddy 反代，用 `--bind` 把容器端口收回环回地址，避免公网绕过反代直连容器：

```bash
./deploy.sh --bind 127.0.0.1
```

Docker 的端口发布直接写在 iptables NAT 链上，位置先于 ufw 规则，`ufw deny 8080` 拦不住它，绑定地址才是可靠做法。

### 老内核宿主（CentOS 7 等）

若容器反复重启，日志停在：

```
nginx: [crit] pwrite() "/run/nginx.pid" failed (1: Operation not permitted)
```

说明宿主 libseccomp 过旧，不认识新版 Alpine musl 使用的 `pwritev2` 等 syscall，Docker 默认 seccomp profile 对未知 syscall 返回 EPERM。CentOS 7 官方源最高只到 libseccomp 2.3.1 且已 EOL，此时用：

```bash
./deploy.sh --seccomp unconfined
```

代价是该容器失去 syscall 过滤，建议同时用 `--bind 127.0.0.1` 收在前置反代之后。宿主可升级时优先升级 Docker 与 libseccomp，再用 `--seccomp default` 切回。

### 页脚站点信息

需要在页脚展示备案号、主办单位一类的部署方信息时（如在中国大陆部署需展示 ICP 备案号并链接到工信部），由容器启动时按环境变量注入，不写进镜像也不写进仓库：

```bash
./deploy.sh \
  --icp "浙ICP备00000000号-0" \
  --owner "示例科技有限公司"
```

两项可单独使用，传空串（`--icp ""`）清除。绑定地址与这两项都记录在容器 label 上，`./deploy.sh -u` 因新镜像重建容器时会自动继承。手工启动时对应 `--env IMGING_BEIAN_ICP=...` 和 `--env IMGING_SITE_OWNER=...`。

### 手工部署

```bash
docker pull ghcr.io/youngsdata/imging:latest
docker run --detach \
  --name imging \
  --restart unless-stopped \
  --publish 8080:80 \
  ghcr.io/youngsdata/imging:latest
```

手工启用 HTTPS：

```bash
docker run --detach \
  --name imging \
  --restart unless-stopped \
  --publish 8080:80 \
  --publish 443:443 \
  --env IMGING_SSL_ENABLED=1 \
  --mount type=bind,source=/absolute/path/fullchain.pem,target=/etc/nginx/ssl/tls.crt,readonly \
  --mount type=bind,source=/absolute/path/privkey.pem,target=/etc/nginx/ssl/tls.key,readonly \
  ghcr.io/youngsdata/imging:latest
```

然后访问 <http://localhost:8080>。

生产环境建议由 HTTPS 反向代理暴露服务。页面使用的 AVIF WASM 需要 Cross-Origin Isolation，镜像内置的 Nginx 配置已经发送所需响应头。

## 访问监控（可选）

`imging-monitor` 是独立的可选镜像，通过共享目录读取主 `imging` 容器的 JSON access log，不直接读取前置 Nginx 日志。它内置离线 IPv4/IPv6 地域库、增量统计、全量有效访问地域图与 Top 100 IP，并使用 Argon2id、TOTP、服务端会话、CSRF 和登录限流保护管理页面。只有 2xx/3xx 会进入 PV、UV 和地域统计，404、493 等失败或拦截请求不会入库。

有前置代理时，先让主镜像持久化日志并仅信任代理的精确 CIDR；以下示例中 `172.17.0.11` 是前置代理连接主机时的实际来源地址：

```bash
mkdir -p /data/imging/imging-logs
./deploy.sh -u --port 8082 \
  --log-dir /data/imging/imging-logs \
  --trusted-proxies 172.17.0.11/32 \
  --timezone Asia/Shanghai
```

主 Nginx 只会对来自该 CIDR 的连接解析 `X-Forwarded-For`，并把真实用户 IP 写入 `clientip`。不要信任整个内网网段。

```bash
mkdir -p monitor-secrets
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v "$PWD/monitor-secrets:/secrets" \
  ghcr.io/youngsdata/imging-monitor:latest \
  python -m monitor.cli --output /secrets --username admin

IMGING_MONITOR_PUBLIC_ORIGIN=https://status.example.com \
docker compose -f compose.monitor.yml up -d
```

`IMGING_MONITOR_PUBLIC_ORIGIN` 可省略；省略时 monitor 会按当前请求经可信代理还原后的 HTTPS Host 做同源校验，可部署到任意自有域名。设置后则严格锁定到该单一 Origin。两种模式都保留 CSRF、Secure Host-only Cookie 和可信代理校验。

已有 `deploy.sh` 管理的主容器时，用相同的 `IMGING_LOG_DIR` 执行 `docker compose -f compose.monitor.yml up -d --no-deps imging-monitor`，只启动 monitor。监控端口默认绑定 `127.0.0.1:8899`；远端前置代理需要通过 `IMGING_MONITOR_BIND` 绑定内网地址，并用防火墙和 `IMGING_MONITOR_TRUSTED_PROXIES` 仅允许、信任该代理。

旧前置 JSON 日志可通过 `python -m monitor.cli import-legacy` 导入。必须指定带时区的 `--before` 切换边界，并用 `--host` 只保留主站域名；相同快照重复执行不会重复计数。完整部署、历史迁移、日志轮转和持久化说明见源码仓库 `README.md`。

保存初始化时仅显示一次的 TOTP URI 和恢复码；缺少认证密钥时服务会拒绝启动。登录后可在“统计设置”中修改默认查看天数、SQLite 聚合数据保留天数、空闲扫描间隔和单批读取行数，无需重启；默认查看范围保存后立即切换。原始日志仍应按 `monitor/logrotate.example` 在宿主机轮转。

## 标签

- `latest`：公开仓库默认分支的最新构建
- `sha-<完整提交哈希>`：与一次 GitHub 提交精确对应
- `vX.Y.Z` / `X.Y.Z`：推送 SemVer Git tag 时生成

每次推送到本仓库都会由 GitHub Actions 构建并发布多架构镜像到 GitHub Container Registry。
