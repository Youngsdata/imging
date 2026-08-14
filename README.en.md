[![简体中文](https://img.shields.io/badge/语言-简体中文-d0d7de)](README.md)
[![English](https://img.shields.io/badge/Language-English-0969da)](README.en.md)

# imging · Client-side image and animation toolkit

imging brings image compression, format conversion, background removal, and an animation workshop into one self-hostable page. Common formats such as PNG, JPEG, and WebP are processed locally in the browser. Bundled WASM codecs encode AVIF and decode HEIC on the client, while self-hosted ISNet, BEN2, and BiRefNet HR-Matting models provide quick, professional, or maximum-fidelity AI cutouts without uploading the image.

**Live demo: <https://imging.cn>**

## Why imging

- **Privacy first**: common formats, AVIF encoding, and HEIC decoding can all run locally on the user's device.
- **Professional local background removal**: quick mode auto-detects or accepts any boundary background color and removes only connected outer regions. AI mode offers the recommended roughly 42 MB ISNet INT8 quick model, a roughly 219 MB BEN2 professional model, and a roughly 447 MB BiRefNet HR-Matting maximum-fidelity model. The latter runs at 2048×2048 for hair, veils, glass, and semi-transparent edges. Each model is downloaded on demand from the same site and cached independently; images are never uploaded.
- **More than static images**: compress and create GIF, APNG, animated WebP, and animated AVIF, with per-frame reordering, deletion, and duration controls.
- **One-command self-hosting**: Docker images are available for `linux/amd64` and `linux/arm64`, including private-network deployments.
- **Transparent capability fallback**: only professional or legacy formats that the browser cannot handle are sent to the optional server-side decoder. Server processing is never presented as local processing.

> [!IMPORTANT]
> The **server-side decoder is a paid capability** for professional and legacy formats such as TIFF, JPEG 2000, PSD, PDF, DICOM, and JXL. For licensing, integration, or private deployment, contact [admin@datadance.com](mailto:admin@datadance.com).

## Product comparison with mainstream image tools

| Dimension | imging (this distribution) | [Squoosh](https://squoosh.app/) · Google Chrome Labs | [TinyPNG / Tinify](https://tinypng.com/) | Online converters such as [CloudConvert](https://cloudconvert.com/) |
| --- | --- | --- | --- | --- |
| Primary focus | Self-hostable client-side image processing and a complete animation workshop | Client-side image lab focused on individual images | Mature online compression service, API, and CDN | Cloud conversion across a broad range of formats |
| Processing and image privacy | Common formats, AVIF encoding, and HEIC decoding run on the device; only the optional server decoder sends files to your own service | All compression runs locally in the browser; images are not uploaded | Images are uploaded to Tinify for processing | Images are uploaded for server-side processing; CloudConvert automatically deletes files after processing |
| Static image compression | PNG-8 / JPEG / WebP / AVIF, with about 45.8 dB in the reference PNG-8 test and Lanczos-3 resizing | Strong client-side PNG / JPEG / WebP / AVIF and other codecs | Mature JXL / AVIF / WebP / JPEG / PNG compression | Broad format coverage; compression and conversion depend on the server-side engine |
| Animation compression | GIF / APNG / animated WebP / animated AVIF with inter-frame optimization | No animation compression workflow | APNG is publicly supported; no comparable multi-format animation workshop | Server-side conversion or optimization for selected animated formats |
| Advanced formats on the client | Local WASM AVIF encoding and HEIC decoding | Local WASM codecs including AVIF; no HEIC decoding | None; AVIF, HEIC, and similar formats are processed in the cloud | None; advanced formats are processed in the cloud |
| Animation creation and frame editing | Reorder, delete, or append frames; adjust per-frame duration and looping | Not provided | Not provided | Generally no comparable interactive frame workshop |
| Source animation timing | Automatically reads duration, loop settings, and per-frame timing | Not applicable | No independent per-frame timing controls | Depends on the converter and selected options |
| Self-hosting / offline use | Docker-based private deployment; local processing consumes no cloud credits | Open-source PWA with local processing after load | Primarily a hosted web app, Developer API, and Image CDN | Primarily a hosted web app, API, and third-party integrations |
| Free use, accounts, and watermarks | Free local processing with no registration, quotas, or watermarks; throughput is bounded by device performance and browser memory | Free, no registration, and no watermark | Free web use allows up to 20 images per batch and 5 MB per image; free format conversion is limited to 3 images | Free tiers usually have quotas; CloudConvert requires sign-up and includes 10 conversion credits per day |
| Developer ecosystem | Focused on the self-hostable web app; the server-side decoder is licensed separately | Open-source web app without an equally mature hosted API or CDN | More mature API, Image CDN, WordPress / Figma plugins, and multi-language SDKs | Mature API, cloud-storage, and automation integrations |

imging differs by combining **on-device privacy, animation compression and creation, per-frame editing, and self-hosting** in one tool rather than focusing only on individual images. Squoosh also keeps processing local and is strong for individual images. TinyPNG stands out for its mature cloud compression, API, CDN, and plugin ecosystem, while CloudConvert-style services cover more formats on the server. This comparison is based on public product information checked on **2026-08-11**. Plans and features may change; refer to the [Squoosh project](https://github.com/GoogleChromeLabs/squoosh), [TinyPNG website](https://tinypng.com/), [Developer API](https://tinify.com/developers), and [CloudConvert website](https://cloudconvert.com/) for current details. The 45.8 dB PNG-8 figure is PSNR from imging's existing 256-color reference sample, not a guarantee for every image.

## Distribution contents

This is the public imging distribution repository. It contains only deployable build artifacts:

- The obfuscated single-page app `图映-加密版-本地codecs.html`
- Browser-side AVIF / HEIC runtime codecs
- Browser-side AI runtime and self-hosted ISNet / BEN2 / BiRefNet HR-Matting cutout models
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

### Hosts with an old kernel (CentOS 7 and similar)

If the container restarts in a loop and its log stops at:

```
nginx: [crit] pwrite() "/run/nginx.pid" failed (1: Operation not permitted)
```

the host's libseccomp is too old to recognise syscalls such as `pwritev2` used by recent Alpine musl, and Docker's default seccomp profile returns EPERM for unknown syscalls. CentOS 7 ships libseccomp 2.3.1 at most and is end-of-life, so use:

```bash
./deploy.sh --seccomp unconfined
```

The trade-off is that this container loses syscall filtering, so pair it with `--bind 127.0.0.1` behind a reverse proxy. Once the host can be upgraded, update Docker and libseccomp, then switch back with `--seccomp default`.

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
