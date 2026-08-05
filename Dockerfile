FROM nginx:1.30.4-alpine-slim@sha256:ddde39c6e51f02fde7410c2e9c234cf2d0a4c7bdbbe176aeb37d8ad7ab4eb58c

COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/app.conf /etc/nginx/snippets/imging-app.conf
COPY docker/nginx/ssl.conf /etc/nginx/optional/ssl.conf
COPY --chmod=755 docker/nginx/40-enable-ssl.sh /docker-entrypoint.d/40-enable-ssl.sh
COPY --chmod=755 docker/nginx/41-inject-beian.sh /docker-entrypoint.d/41-inject-beian.sh
COPY 图映-加密版-本地codecs.html /usr/share/nginx/html/index.html
COPY codecs/ /usr/share/nginx/html/codecs/

EXPOSE 80 443

STOPSIGNAL SIGQUIT
