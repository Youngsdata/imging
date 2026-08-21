import { createServer } from 'node:http';
import { handleHtmlToPdfRequest, warmHtmlToPdfRenderer } from './html-to-pdf.mjs';

const HOST = process.env.IMGING_HTML_PDF_HOST || '127.0.0.1';
const PORT = Number(process.env.IMGING_HTML_PDF_PORT) || 8091;

const server = createServer(async (req, res) => {
  if (await handleHtmlToPdfRequest(req, res)) return;
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
});

server.on('error', error => {
  console.error('[html-to-pdf] service error:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[html-to-pdf] Chromium renderer listening on http://${HOST}:${PORT}`);
  warmHtmlToPdfRenderer().then(() => {
    console.log('[html-to-pdf] Chromium renderer warmed');
  }).catch(error => {
    console.warn(`[html-to-pdf] Chromium warm-up deferred: ${error.message}`);
  });
});
