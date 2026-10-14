import { createHash } from 'node:crypto';

// Static, generic fallback page. It is a constant: no request data (path,
// query, headers) is ever interpolated into it, so the exchange reference
// cannot be reflected, and valid/expired/consumed/unknown references are
// indistinguishable.

const STYLE = `
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI","Noto Naskh Arabic","Noto Sans Arabic",Tahoma,sans-serif;background:#f6f7f9;color:#14181f}
main{max-width:420px;text-align:center;line-height:1.9}
h1{font-size:1.35rem;margin:0 0 12px}
p{margin:0;color:#4a5361}
@media (prefers-color-scheme:dark){body{background:#12151a;color:#eef0f3}p{color:#a9b1bd}}
`;

export const FALLBACK_TITLE = 'معاينة أَوْج على الجوال';
export const FALLBACK_BODY =
  'افتح الرابط من جهاز يحتوي على تطبيق المعاينة. إذا انتهت صلاحية الرابط، أنشئ رابط معاينة جديدًا من أَوْج.';

export const FALLBACK_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${FALLBACK_TITLE}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${FALLBACK_TITLE}</h1>
<p>${FALLBACK_BODY}</p>
</main>
</body>
</html>
`;

// The only inline resource is the stylesheet above, allowed by hash so the
// CSP needs no 'unsafe-inline' and permits nothing else.
const styleHash = createHash('sha256').update(STYLE).digest('base64');

export const FALLBACK_CSP = [
  "default-src 'none'",
  `style-src 'sha256-${styleHash}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
