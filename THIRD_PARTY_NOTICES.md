# Third-Party Notices

本发行包包含以下第三方组件。各组件仍适用其各自许可证；图映自身的授权范围见 `DISTRIBUTION-NOTICE.md`。

## @jsquash/avif 2.1.1

- 用途：浏览器端 AVIF 编码与解码
- 许可证：Apache License 2.0
- 上游项目：<https://github.com/jamsinclair/jSquash>
- 许可证副本：`codecs/avif/LICENSE`

## wasm-feature-detect 1.8.0

- 用途：浏览器 WASM 能力检测
- 许可证：Apache License 2.0
- 上游项目：<https://github.com/GoogleChromeLabs/wasm-feature-detect>
- 许可证副本：`licenses/wasm-feature-detect-Apache-2.0.txt`
- 发行文件 SHA-256：`879dd39c8d9ebd5a3c64d1f18955b047907c677ca3b71865e2497264107e3aef`

## libheif-js 1.19.8

- 用途：浏览器端 HEIC / HEIF 解码
- 许可证：GNU Lesser General Public License v3.0
- 上游项目：<https://github.com/catdad-experiments/libheif-js/tree/1.19.8>
- LGPL 许可证副本：`licenses/libheif-js-LGPL-3.0.txt`
- WASM 第三方声明：`licenses/libheif-wasm-NOTICES.txt`
- 发行文件：`codecs/heic/libheif-bundle.mjs`
- 发行文件 SHA-256：`8363e27add6c587b20f183fb746a583f97f28e8641f12955a1a550c38a4f9969`

本发行包中的 `libheif-bundle.mjs` 是上述版本的未修改发行文件，可由使用者用同版本上游文件替换。

## Nginx

容器镜像基于 Nginx 官方镜像。其软件及基础镜像中的第三方组件按照镜像内附带的各自许可证提供：

- <https://hub.docker.com/_/nginx>
- <https://nginx.org/LICENSE>
