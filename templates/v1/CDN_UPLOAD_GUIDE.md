# CDN 上传说明

1. 将整个 `templates/` 目录原样上传到站点根目录或 CDN 对应路径。
2. 保持 `library.json`、`v1/projects`、`v1/materials`、`v1/previews` 和 `v1/thumbnails` 的相对关系。
3. `library.json` 建议不缓存或使用短缓存；`v1/` 下的版本化文件可使用一年强缓存。
4. 为 `.imging` 配置 `application/vnd.imging.project+zip`，SVG/PNG/WebP 使用标准 MIME。
5. 上传后以 `/templates/library.json` 为入口核对 `v1/cdn-manifest.json` 中的 SHA-256。

本目录不含第三方品牌商品图，具体许可见 `LICENSE.md`。
