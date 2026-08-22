FROM nginx:1.30.4-alpine-slim@sha256:ddde39c6e51f02fde7410c2e9c234cf2d0a4c7bdbbe176aeb37d8ad7ab4eb58c

# 配置先于 1.9 GB 模型层校验。正则引号、include 或指令一旦有误，镜像会在
# 发布大文件前直接构建失败，避免“镜像能 build、容器启动才发现 Nginx 挂掉”。
COPY --link docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --link docker/nginx/app.conf /etc/nginx/snippets/imging-app.conf
RUN mkdir -p /var/log/imging /etc/nginx/snippets \
    && touch /etc/nginx/snippets/imging-real-ip.conf \
    && nginx -t

ENV TZ=UTC

RUN apk add --no-cache tzdata nodejs chromium font-noto-cjk font-noto-emoji

# Keep large, slow-changing assets in independent linked layers. A page/config
# change then reuses these layers instead of invalidating their BuildKit cache.
COPY --link codecs/ /usr/share/nginx/html/codecs/
COPY --link ai/ort.webgpu.min.js /usr/share/nginx/html/ai/ort.webgpu.min.js
COPY --link ai/ort-wasm-simd-threaded.asyncify.mjs /usr/share/nginx/html/ai/ort-wasm-simd-threaded.asyncify.mjs
COPY --link ai/ort-wasm-simd-threaded.asyncify.wasm /usr/share/nginx/html/ai/ort-wasm-simd-threaded.asyncify.wasm
COPY --link models/background-removal/isnet-general-int8.onnx /usr/share/nginx/html/models/background-removal/isnet-general-int8.onnx
COPY --link models/background-removal/isnet-general-fp16.onnx /usr/share/nginx/html/models/background-removal/isnet-general-fp16.onnx
COPY --link models/background-removal/ben2-fp16.onnx /usr/share/nginx/html/models/background-removal/ben2-fp16.onnx
COPY --link models/background-removal/birefnet-hr-matting-fp16.onnx /usr/share/nginx/html/models/background-removal/birefnet-hr-matting-fp16.onnx
COPY --link models/video-matting/rvm-mobilenetv3-fp16.onnx /usr/share/nginx/html/models/video-matting/rvm-mobilenetv3-fp16.onnx
COPY --link models/video-matting/rvm-resnet50-fp16.onnx /usr/share/nginx/html/models/video-matting/rvm-resnet50-fp16.onnx
COPY --link licenses/ /usr/share/nginx/html/licenses/
COPY --link assets/ /usr/share/nginx/html/assets/
COPY --link templates/ /usr/share/nginx/html/templates/
COPY --link docs/imging-project-v1.schema.json /usr/share/nginx/html/schemas/imging-project-v1.schema.json
COPY --link docs/imging-project-v2.schema.json /usr/share/nginx/html/schemas/imging-project-v2.schema.json
COPY --link docs/imging-project-v3.schema.json /usr/share/nginx/html/schemas/imging-project-v3.schema.json
COPY --link ai/background-removal.js /usr/share/nginx/html/ai/background-removal.js
COPY --link ai/video-matting.js /usr/share/nginx/html/ai/video-matting.js
COPY --link video/ /usr/share/nginx/html/video/
COPY --link pdf/ /usr/share/nginx/html/pdf/
# 构建生成的内容指纹入口覆盖在稳定资源目录之上；代码更新只新增 URL，
# 已缓存的旧入口仍可继续使用，HTML 会立即切换到当前内容哈希。
COPY --link dist/runtime/ /usr/share/nginx/html/
COPY --link server/ /opt/imging/server/
COPY --link fonts/ /usr/share/nginx/html/fonts/
COPY --link seo/ /usr/share/nginx/html/
# imging-locales:start
COPY --link en/ /usr/share/nginx/html/en/
COPY --link ja/ /usr/share/nginx/html/ja/
COPY --link ko/ /usr/share/nginx/html/ko/
COPY --link de/ /usr/share/nginx/html/de/
COPY --link es/ /usr/share/nginx/html/es/
COPY --link pt/ /usr/share/nginx/html/pt/
COPY --link fr/ /usr/share/nginx/html/fr/
# imging-locales:end
COPY --link dist/index.html /usr/share/nginx/html/index.html
COPY --link robots.txt sitemap.xml llms.txt /usr/share/nginx/html/
COPY --link b3449251ce1eb68a7b2920d31af684c1.txt /usr/share/nginx/html/

# Small, mutable deployment files are last so they cannot invalidate assets.
COPY --link docker/nginx/ssl.conf /etc/nginx/optional/ssl.conf
COPY --link --chmod=755 docker/nginx/40-enable-ssl.sh /docker-entrypoint.d/40-enable-ssl.sh
COPY --link --chmod=755 docker/nginx/41-inject-beian.sh /docker-entrypoint.d/41-inject-beian.sh
COPY --link --chmod=755 docker/nginx/42-configure-real-ip.sh /docker-entrypoint.d/42-configure-real-ip.sh
COPY --link --chmod=755 docker/nginx/43-start-html-pdf.sh /docker-entrypoint.d/43-start-html-pdf.sh

EXPOSE 80 443

STOPSIGNAL SIGQUIT
