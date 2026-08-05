[![简体中文](https://img.shields.io/badge/语言-简体中文-0969da)](README.md)
[![English](https://img.shields.io/badge/Language-English-d0d7de)](README.en.md)

# 图映（imging）· 端侧图片与动图处理工具

图映把图片压缩、格式转换和动图工坊放进一个可自托管的页面。PNG、JPEG、WebP 等常见格式直接在浏览器本地处理；发行包内置的 WASM codecs 还能在端侧完成 AVIF 编码和 HEIC 解码，图片无需上传。

## 为什么选择图映

- **隐私优先**：常见格式、AVIF 编码和 HEIC 解码均可在设备本地完成。
- **不只压单图**：支持 GIF、APNG、动图 WebP、动图 AVIF 的压缩与合成，并提供逐帧排序、删帧和时长调整。
- **一键自托管**：提供 `linux/amd64`、`linux/arm64` Docker 镜像，可部署在私有网络。
- **按能力透明降级**：浏览器无法处理的专业或老格式才交给可选的服务端解码器，不会把“服务端处理”伪装成“本地处理”。

> [!IMPORTANT]
> TIFF、JPEG 2000、PSD、PDF、DICOM、JXL 等专业或老格式所需的**服务端解码器为付费能力**。如需购买、集成或私有化部署，请联系 [admin@datadance.com](mailto:admin@datadance.com)。

## 与 TinyPNG 的产品力对比

| 维度 | 图映（本仓库发行包） | [TinyPNG / Tinify](https://tinypng.com/) |
| --- | --- | --- |
| 核心定位 | 可自托管的端侧图片处理 + 动图工坊 | 成熟的在线压缩服务 + API + CDN |
| 处理位置与隐私 | 常见格式、AVIF 编码、HEIC 解码在浏览器本地完成；启用服务端解码器时，对应文件需要发送到自有服务 | 图片上传至 Tinify 服务处理；官网说明文件最多保留 48 小时 |
| 静态图片 | PNG / JPEG / WebP / AVIF 压缩与转换，含 PNG-8 减色和 Lanczos-3 缩放 | JXL / AVIF / WebP / JPEG / PNG 压缩与转换，单图压缩能力成熟 |
| 动图能力 | GIF / APNG / 动图 WebP / 动图 AVIF 压缩与合成，支持帧间优化 | 官网公开列出 APNG 压缩；未提供同类多格式动图工坊 |
| 逐帧编辑 | 支持拖拽排序、删帧、追加帧、单帧时长和循环设置 | 官网未提供同类逐帧编辑功能 |
| 自托管 / 离线 | 支持 Docker 私有化部署；本地路径不消耗云端调用额度 | 以托管 Web、Developer API 和 Image CDN 为主 |
| 免费 Web 限制 | 本地处理没有账号或 API 次数限制，实际吞吐受设备性能和浏览器内存约束 | 免费 Web 端每批最多 20 张、每张最大 5 MB；免费格式转换最多 3 张 |
| 开发者生态 | 聚焦可自托管页面；服务端解码器单独付费授权 | API、Image CDN、WordPress / Figma 插件及多语言 SDK 更成熟 |

图映更适合看重**图片不出设备、私有化部署和完整动图工作流**的场景；TinyPNG 更适合需要**成熟云服务、API、CDN 和现成生态集成**的团队。对比依据为双方公开产品能力，TinyPNG 信息核对于 **2026-07-27**，其套餐和功能可能调整，请以 [TinyPNG 官网](https://tinypng.com/)及 [Developer API](https://tinify.com/developers) 为准。

## 发行包

这是图映的公开发行仓库，只包含可直接部署的构建产物：

- 混淆后的单页应用 `图映-加密版-本地codecs.html`
- 浏览器端 AVIF / HEIC 运行时 codecs
- Nginx Docker 镜像配置与一键启动脚本
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

## 标签

- `latest`：公开仓库默认分支的最新构建
- `sha-<完整提交哈希>`：与一次 GitHub 提交精确对应
- `vX.Y.Z` / `X.Y.Z`：推送 SemVer Git tag 时生成

每次推送到本仓库都会由 GitHub Actions 构建并发布多架构镜像到 GitHub Container Registry。
