#!/bin/sh
set -eu

export IMGING_CHROME_BIN="${IMGING_CHROME_BIN:-/usr/bin/chromium-browser}"
export IMGING_HTML_PDF_HOST="${IMGING_HTML_PDF_HOST:-127.0.0.1}"
export IMGING_HTML_PDF_PORT="${IMGING_HTML_PDF_PORT:-8091}"

node /opt/imging/server/html-to-pdf-service.mjs &
