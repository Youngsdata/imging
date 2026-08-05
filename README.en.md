[![简体中文](https://img.shields.io/badge/语言-简体中文-d0d7de)](README.md)
[![English](https://img.shields.io/badge/Language-English-0969da)](README.en.md)

# imging · Client-side image and animation toolkit

imging brings image compression, format conversion, and an animation workshop into one self-hostable page. Common formats such as PNG, JPEG, and WebP are processed locally in the browser. The bundled WASM codecs also encode AVIF and decode HEIC on the client side, without uploading the image.

## Why imging

- **Privacy first**: common formats, AVIF encoding, and HEIC decoding can all run locally on the user's device.
- **More than static images**: compress and create GIF, APNG, animated WebP, and animated AVIF, with per-frame reordering, deletion, and duration controls.
- **One-command self-hosting**: Docker images are available for `linux/amd64` and `linux/arm64`, including private-network deployments.
- **Transparent capability fallback**: only professional or legacy formats that the browser cannot handle are sent to the optional server-side decoder. Server processing is never presented as local processing.

> [!IMPORTANT]
> The **server-side decoder is a paid capability** for professional and legacy formats such as TIFF, JPEG 2000, PSD, PDF, DICOM, and JXL. For licensing, integration, or private deployment, contact [admin@datadance.com](mailto:admin@datadance.com).

## Product comparison with TinyPNG

| Dimension | imging (this distribution) | [TinyPNG / Tinify](https://tinypng.com/) |
| --- | --- | --- |
| Primary focus | Self-hostable client-side image processing and an animation workshop | Mature online compression service, API, and CDN |
| Processing and privacy | Common formats, AVIF encoding, and HEIC decoding run locally in the browser; files handled by the optional server decoder are sent to your own service | Images are uploaded to Tinify for processing; its website states that files are retained for up to 48 hours |
| Static images | PNG / JPEG / WebP / AVIF compression and conversion, including PNG-8 quantization and Lanczos-3 resizing | JXL / AVIF / WebP / JPEG / PNG compression and conversion, with a mature static-image workflow |
| Animation | Compress and create GIF / APNG / animated WebP / animated AVIF, including inter-frame optimization | APNG compression is publicly listed; no comparable multi-format animation workshop is advertised |
| Frame editor | Drag to reorder, delete or append frames, adjust individual frame durations, and configure looping | No comparable frame editor is advertised |
| Self-hosting / offline use | Docker-based private deployment; local processing does not consume cloud API credits | Primarily offered as a hosted web app, Developer API, and Image CDN |
| Free web limits | No account or API quota for local processing; throughput is bounded by device performance and browser memory | Free web use allows up to 20 images per batch and 5 MB per image; free format conversion is limited to 3 images |
| Developer ecosystem | Focused on the self-hostable web app; the server-side decoder is licensed separately | More mature API, Image CDN, WordPress / Figma plugins, and multi-language SDKs |

Choose imging when **on-device privacy, private deployment, and a complete animation workflow** matter most. TinyPNG is a stronger fit when a team needs a **mature cloud service, API, CDN, and ready-made integrations**. This comparison is based on public product information checked on **2026-07-27**. Plans and features may change; refer to the [TinyPNG website](https://tinypng.com/) and [Developer API](https://tinify.com/developers) for current details.

## Distribution contents

This is the public imging distribution repository. It contains only deployable build artifacts:

- The obfuscated single-page app `图映-加密版-本地codecs.html`
- Browser-side AVIF / HEIC runtime codecs
- Nginx Docker image configuration and the one-command deployment script
- Third-party software licenses and notices

This repository does not contain imging's unobfuscated business source code. imging's proprietary pages and related materials are not licensed under an open-source license. Public access to the repository or container image does not grant permission to copy, modify, sublicense, or redistribute those materials. Third-party components remain subject to their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Docker deployment

The image supports `linux/amd64` and `linux/arm64`.

### One-command deployment

Docker must be installed and running:

```bash
git clone https://github.com/Youngsdata/imging.git
cd imging
./deploy.sh
```

The first run creates a background container named `imging` and publishes the service at <http://localhost:8080>. Subsequent runs restart the existing container.

To pull the latest image and restart:

```bash
./deploy.sh -u
```

`-u` pulls `ghcr.io/youngsdata/imging:latest` first. If the image changed, the script recreates the container with the new image; otherwise, it simply restarts it. The container uses the `unless-stopped` restart policy.

### Enable HTTPS directly (optional)

If there is no reverse proxy in front of the container, mount the certificate read-only and publish port 443 directly:

```bash
./deploy.sh \
  --cert /etc/letsencrypt/live/imging.example.com/fullchain.pem \
  --key /etc/letsencrypt/live/imging.example.com/privkey.pem
```

This exposes both:

- HTTP: <http://localhost:8080>
- HTTPS: `https://imging.example.com` (host port `443` by default)

If port 443 is already in use, add `--https-port 8443`. Running `./deploy.sh` or `./deploy.sh -u` again for an HTTPS-enabled container reuses the existing certificate paths and HTTPS port. After certificate renewal, rerun the script to restart Nginx and load the renewed certificate. Pass new `--cert` and `--key` paths to replace the certificate, or explicitly disable HTTPS with:

```bash
./deploy.sh --no-ssl
```

Certificates and private keys are never copied into the container image or GitHub repository.

### Reverse proxy and port binding

The container publishes to `0.0.0.0:8080` by default. When another Nginx/Caddy sits in front of it, use `--bind` to restrict the published port to loopback so the public internet cannot reach the container directly and bypass the proxy:

```bash
./deploy.sh --bind 127.0.0.1
```

Docker writes published ports straight into the iptables NAT chain, ahead of ufw rules, so `ufw deny 8080` will not block them — the bind address is the reliable control.

### Footer site information

To show deployment-specific information in the footer — for example, mainland China deployments must display an ICP filing number linking to MIIT — inject it from environment variables at container start. Nothing is written into the image or the repository:

```bash
./deploy.sh \
  --icp "浙ICP备00000000号-0" \
  --owner "Example Technology Co., Ltd."
```

Either option can be used on its own; pass an empty string (`--icp ""`) to clear it. The bind address and both values are stored as container labels, so `./deploy.sh -u` reuses them when a new image triggers a container rebuild. For manual startup the equivalents are `--env IMGING_BEIAN_ICP=...` and `--env IMGING_SITE_OWNER=...`.

### Manual deployment

```bash
docker pull ghcr.io/youngsdata/imging:latest
docker run --detach \
  --name imging \
  --restart unless-stopped \
  --publish 8080:80 \
  ghcr.io/youngsdata/imging:latest
```

To enable HTTPS manually:

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

Then open <http://localhost:8080>.

For production, expose the service through an HTTPS reverse proxy. The AVIF WASM runtime requires Cross-Origin Isolation; the bundled Nginx configuration already sends the required response headers.

## Image tags

- `latest`: the latest build from the public repository's default branch
- `sha-<full-commit-hash>`: a build corresponding exactly to one GitHub commit
- `vX.Y.Z` / `X.Y.Z`: generated when a SemVer Git tag is pushed

Every push to this repository triggers GitHub Actions to build and publish a multi-architecture image to GitHub Container Registry.
