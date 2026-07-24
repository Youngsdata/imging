# 图映（imging）发行包

这是图映的公开发行仓库，只包含可直接部署的构建产物：

- 混淆后的单页应用 `图映-加密版-本地codecs.html`
- 浏览器端 AVIF / HEIC 运行时 codecs
- Nginx Docker 镜像配置与一键启动脚本
- 第三方软件许可证与声明

本仓库不包含图映的明文业务源码。图映自有页面及相关材料没有以开源许可证授权；公开可见、可拉取镜像不等于获得复制、修改或再发布授权。第三方组件仍分别适用其原有许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## Docker

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
