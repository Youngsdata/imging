FROM nginx:1.30.4-alpine-slim@sha256:ddde39c6e51f02fde7410c2e9c234cf2d0a4c7bdbbe176aeb37d8ad7ab4eb58c

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
COPY --link licenses/ /usr/share/nginx/html/licenses/
COPY --link assets/ /usr/share/nginx/html/assets/
COPY --link docs/imging-project-v1.schema.json /usr/share/nginx/html/schemas/imging-project-v1.schema.json
COPY --link ai/background-removal.js /usr/share/nginx/html/ai/background-removal.js
COPY --link seo/ /usr/share/nginx/html/
COPY --link en/ /usr/share/nginx/html/en/
COPY --link dist/index.html /usr/share/nginx/html/index.html
COPY --link robots.txt sitemap.xml llms.txt /usr/share/nginx/html/

# Small, mutable deployment files are last so they cannot invalidate assets.
COPY --link docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --link docker/nginx/app.conf /etc/nginx/snippets/imging-app.conf
COPY --link docker/nginx/ssl.conf /etc/nginx/optional/ssl.conf
COPY --link --chmod=755 docker/nginx/40-enable-ssl.sh /docker-entrypoint.d/40-enable-ssl.sh
COPY --link --chmod=755 docker/nginx/41-inject-beian.sh /docker-entrypoint.d/41-inject-beian.sh

EXPOSE 80 443

STOPSIGNAL SIGQUIT
