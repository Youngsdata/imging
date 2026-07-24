#!/bin/sh
set -eu

if [ "${IMGING_SSL_ENABLED:-0}" != "1" ]; then
    exit 0
fi

certificate_path="/etc/nginx/ssl/tls.crt"
private_key_path="/etc/nginx/ssl/tls.key"

if [ ! -r "$certificate_path" ]; then
    echo "SSL certificate is not readable: $certificate_path" >&2
    exit 1
fi

if [ ! -r "$private_key_path" ]; then
    echo "SSL private key is not readable: $private_key_path" >&2
    exit 1
fi

cp /etc/nginx/optional/ssl.conf /etc/nginx/conf.d/ssl.conf
echo "Enabled HTTPS listener on container port 443"
