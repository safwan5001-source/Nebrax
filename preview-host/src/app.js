import { buildAssetLinks, buildAppleAssociation } from './associations.js';
import { FALLBACK_HTML, FALLBACK_CSP } from './fallback-page.js';

// Same shape the Flutter resolver accepts (mobile/lib/preview/preview_deep_link.dart):
// alphanumeric only, at most 128 characters. Checked on the RAW path segment —
// nothing is percent-decoded, so encoded separators or dots simply fail.
const REFERENCE_RE = /^[A-Za-z0-9]{1,128}$/;

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
};

const NO_STORE = { 'Cache-Control': 'no-store' };

const PAGE_HEADERS = {
  ...BASE_HEADERS,
  ...NO_STORE,
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': FALLBACK_CSP,
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
};

// Association files are public and identical for every caller. A short TTL
// lets a corrected fingerprint/Team ID take effect quickly. No cookies, no CSP
// or other headers that could interfere with the OS verification crawlers.
const ASSOCIATION_HEADERS = {
  ...BASE_HEADERS,
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
};

const defaultLog = (line) => process.stdout.write(`${line}\n`);

/**
 * Builds the request handler.
 *
 * Logging contract: one line per request, `METHOD LABEL STATUS`, where LABEL is
 * a fixed route label chosen by this code — never the request path, query,
 * headers or client address. Preview requests log as `/preview/[REDACTED]`;
 * anything unmatched logs as `[UNMATCHED]`, so a reference placed anywhere
 * else in the URL cannot reach the log either.
 */
export function createApp({ config, log = defaultLog }) {
  const assetLinksBody = config.androidFingerprints
    ? JSON.stringify(buildAssetLinks(config.androidFingerprints))
    : null;
  const appleBody = config.appleTeamId ? JSON.stringify(buildAppleAssociation(config.appleTeamId)) : null;

  function send(res, status, headers, body, head) {
    res.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body ?? '') });
    res.end(head ? undefined : body);
  }

  function route(method, rawPath) {
    // Raw split — no URL parsing/normalisation of the path.
    const path = rawPath.split(/[?#]/, 1)[0];
    if (path === '/health') return { label: '/health', kind: 'health' };
    if (path === '/.well-known/assetlinks.json') return { label: path, kind: 'assetlinks' };
    if (path === '/.well-known/apple-app-site-association') return { label: path, kind: 'aasa' };
    if (path.startsWith('/preview/')) {
      const segment = path.slice('/preview/'.length);
      return { label: '/preview/[REDACTED]', kind: REFERENCE_RE.test(segment) ? 'preview' : 'preview-malformed' };
    }
    return { label: '[UNMATCHED]', kind: 'unmatched' };
  }

  function handle(req, res) {
    const head = req.method === 'HEAD';
    const { label, kind } = route(req.method, req.url ?? '/');
    let status;

    if (req.method !== 'GET' && !head) {
      status = 405;
      send(res, status, { ...BASE_HEADERS, ...NO_STORE, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed\n', false);
    } else if (kind === 'health') {
      status = 200;
      send(res, status, { ...BASE_HEADERS, ...NO_STORE, 'Content-Type': 'application/json' }, '{"status":"ok"}', head);
    } else if (kind === 'assetlinks' || kind === 'aasa') {
      const body = kind === 'assetlinks' ? assetLinksBody : appleBody;
      if (body === null) {
        // Fail closed: never emit a placeholder association.
        status = 503;
        send(res, status, { ...BASE_HEADERS, ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' }, 'Service Unavailable\n', head);
      } else {
        status = 200;
        send(res, status, ASSOCIATION_HEADERS, body, head);
      }
    } else if (kind === 'preview' || kind === 'preview-malformed') {
      // Same generic page either way; only the status differs for a path that
      // cannot be a reference. The body never depends on the request.
      status = kind === 'preview' ? 200 : 404;
      send(res, status, PAGE_HEADERS, FALLBACK_HTML, head);
    } else {
      status = 404;
      send(res, status, PAGE_HEADERS, FALLBACK_HTML, head);
    }

    log(`${req.method} ${label} ${status}`);
  }

  return function app(req, res) {
    try {
      handle(req, res);
    } catch (err) {
      // Log the error class only: messages/stacks could embed request data.
      log(`ERROR ${err?.name ?? 'Error'}`);
      if (!res.headersSent) {
        res.writeHead(500, { ...BASE_HEADERS, ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error\n');
    }
  };
}
