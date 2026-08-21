FROM python:3.13.11-slim-bookworm@sha256:20080e807bfc404f8450b185cf0fc95d553462673598549613735f70a5b4d5d0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_PROGRESS_BAR=off \
    TZ=UTC

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN apt-get update \
    && apt-get install --yes --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir --root-user-action=ignore --requirement /app/requirements.txt \
    && groupadd --gid 10001 imging \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin imging \
    && mkdir -p /app/data /app/monitor/static/data /var/lib/imging-monitor \
    && chown -R imging:imging /var/lib/imging-monitor

COPY . /app/monitor/

RUN python -m monitor.fetch_assets ip2region-v4
RUN python -m monitor.fetch_assets ip2region-v6
RUN python -m monitor.fetch_assets china-map
RUN python -m monitor.fetch_assets world-map

USER 10001:10001

RUN python -c "from pathlib import Path; [path.open('rb').read(1) for path in (Path('/app/data/ip2region_v4.xdb'), Path('/app/data/ip2region_v6.xdb'), Path('/app/monitor/static/data/china.json'), Path('/app/monitor/static/data/world.json'))]"

EXPOSE 8899

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8899/healthz', timeout=2).read()"]

CMD ["python", "-m", "monitor.supervisor"]
