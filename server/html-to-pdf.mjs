import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChromiumPdfRenderer } from './chromium-pdf-renderer.mjs';

export const HTML_TO_PDF_PATH = '/api/html-to-pdf';
export const MAX_HTML_BYTES = 64 * 1024 * 1024;
export const MAX_SOURCE_PAGE_PX = 19_200;
const MAX_ACTIVE_JOBS = Math.max(1, Math.min(4, Number(process.env.IMGING_HTML_PDF_CONCURRENCY) || 2));
const RENDER_TIMEOUT_MS = Math.max(15_000, Math.min(180_000, Number(process.env.IMGING_HTML_PDF_TIMEOUT_MS) || 90_000));
let activeJobs = 0;
let sharedRenderer = null;

process.once('exit', () => {
  if (sharedRenderer) sharedRenderer.terminate();
});

const CHROME_CANDIDATES = [
  process.env.IMGING_CHROME_BIN,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

function chromeBinary() {
  const found = CHROME_CANDIDATES.find(candidate => existsSync(candidate));
  if (!found) throw Object.assign(new Error('未找到 Chromium / Google Chrome，HTML 转 PDF 服务未就绪。'), { statusCode: 503 });
  return found;
}

function renderer() {
  if (!sharedRenderer || sharedRenderer.closed) sharedRenderer = new ChromiumPdfRenderer(chromeBinary(), {
    root: typeof process.getuid === 'function' && process.getuid() === 0
  });
  return sharedRenderer;
}

export async function warmHtmlToPdfRenderer() {
  await renderer().warm();
  return true;
}

export function stopHtmlToPdfRenderer() {
  if (sharedRenderer) sharedRenderer.terminate();
  sharedRenderer = null;
}

async function renderWithRecovery(input, timeoutMs) {
  try {
    return await renderer().renderFile(input, timeoutMs);
  } catch (error) {
    if (!/^chromium-(?:exit|start|protocol)$/.test(String(error && error.code || ''))) throw error;
    stopHtmlToPdfRenderer();
    return renderer().renderFile(input, timeoutMs);
  }
}

export function normalizeSourcePageSize(width, height) {
  width = Number(width);
  height = Number(height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) {
    throw Object.assign(new Error('没有取得有效的 HTML 实际页面尺寸。'), { statusCode: 400 });
  }
  let scale = Math.min(1, MAX_SOURCE_PAGE_PX / Math.max(width, height));
  return {
    width: Math.max(16, Math.ceil(width * scale)),
    height: Math.max(16, Math.ceil(height * scale)),
    scale
  };
}

export function injectSourcePageSize(html, pageSize) {
  if (!pageSize) return String(html || '');
  const size = normalizeSourcePageSize(pageSize.width, pageSize.height);
  const widthIn = (size.width / 96).toFixed(6);
  const heightIn = (size.height / 96).toFixed(6);
  const style = `<style data-imging-source-page>@page{size:${widthIn}in ${heightIn}in;margin:0}</style>`;
  const source = String(html || '');
  if (/<\/head\s*>/i.test(source)) return source.replace(/<\/head\s*>/i, `${style}</head>`);
  return source.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`);
}

export async function renderHtmlToPdf(html, options = {}) {
  const original = Buffer.isBuffer(html) ? html.toString('utf8') : String(html || '');
  const prepared = options.sourcePageSize ? injectSourcePageSize(original, options.sourcePageSize) : original;
  const bytes = Buffer.from(prepared, 'utf8');
  if (!bytes.length) throw Object.assign(new Error('没有收到可转换的 HTML。'), { statusCode: 400 });
  if (bytes.length > MAX_HTML_BYTES) throw Object.assign(new Error(`转换快照超过 ${MAX_HTML_BYTES / 1024 / 1024} MB 安全上限。`), { statusCode: 413 });
  if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html[\s>]/i.test(bytes.toString('utf8', 0, Math.min(bytes.length, 2048)))) {
    throw Object.assign(new Error('收到的内容不是完整 HTML 页面。'), { statusCode: 400 });
  }

  const work = await mkdtemp(join(tmpdir(), 'imging-html-pdf-'));
  const input = join(work, 'page.html');
  try {
    await writeFile(input, bytes, { mode: 0o600 });
    return await renderWithRecovery(input, options.timeoutMs || RENDER_TIMEOUT_MS);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

async function readBody(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_HTML_BYTES) throw Object.assign(new Error(`转换快照超过 ${MAX_HTML_BYTES / 1024 / 1024} MB 安全上限。`), { statusCode: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_HTML_BYTES) throw Object.assign(new Error(`转换快照超过 ${MAX_HTML_BYTES / 1024 / 1024} MB 安全上限。`), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function handleHtmlToPdfRequest(req, res) {
  const path = (req.url || '').split('?')[0];
  if (path !== HTML_TO_PDF_PATH) return false;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { allow: 'POST, OPTIONS', 'cache-control': 'no-store' });
    res.end();
    return true;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '仅支持 POST。' });
    return true;
  }
  if (!/^text\/html(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] || ''))) {
    sendJson(res, 415, { ok: false, error: '仅接受 text/html 转换快照。' });
    return true;
  }
  if (activeJobs >= MAX_ACTIVE_JOBS) {
    sendJson(res, 429, { ok: false, error: '当前转换任务较多，请稍后重试。' });
    return true;
  }

  activeJobs++;
  try {
    const html = await readBody(req);
    const pageMode = String(req.headers['x-imging-page-mode'] || 'css').toLowerCase();
    if (pageMode !== 'css' && pageMode !== 'content') throw Object.assign(new Error('页面规格模式无效。'), { statusCode: 400 });
    const sourcePageSize = pageMode === 'content' ? {
      width: req.headers['x-imging-page-width-px'],
      height: req.headers['x-imging-page-height-px']
    } : null;
    const pdf = await renderHtmlToPdf(html, { sourcePageSize });
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': pdf.length,
      'content-disposition': 'inline; filename="imging.pdf"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-imging-renderer': 'chromium-skia',
      'x-imging-page-mode': pageMode
    });
    res.end(pdf);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || String(error) });
  } finally {
    activeJobs--;
  }
  return true;
}
