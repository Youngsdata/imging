# 图映（imging）发行包

这是图映的公开发行仓库，只包含可直接部署的构建产物：

- 混淆后的单页应用 `图映-加密版-本地codecs.html`
- 浏览器端 AVIF / HEIC 运行时 codecs
- Nginx Docker 镜像配置
- 第三方软件许可证与声明

本仓库不包含图映的明文业务源码。图映自有页面及相关材料没有以开源许可证授权；公开可见、可拉取镜像不等于获得复制、修改或再发布授权。第三方组件仍分别适用其原有许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## Docker

镜像支持 `linux/amd64` 和 `linux/arm64`：

```bash
docker pull ghcr.io/youngsdata/imging:latest
docker run --rm -p 8080:80 ghcr.io/youngsdata/imging:latest
```

然后访问 <http://localhost:8080>。

生产环境建议由 HTTPS 反向代理暴露服务。页面使用的 AVIF WASM 需要 Cross-Origin Isolation，镜像内置的 Nginx 配置已经发送所需响应头。

## 标签

- `latest`：公开仓库默认分支的最新构建
- `sha-<完整提交哈希>`：与一次 GitHub 提交精确对应
- `vX.Y.Z` / `X.Y.Z`：推送 SemVer Git tag 时生成

每次推送到本仓库都会由 GitHub Actions 构建并发布多架构镜像到 GitHub Container Registry。
