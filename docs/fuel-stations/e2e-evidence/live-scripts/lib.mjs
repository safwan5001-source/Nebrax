import { chromium, devices } from '/home/user/Nebrax/web/node_modules/@playwright/test/index.mjs';
export const WEB = 'http://e2e-ui.awj.app:3012';
export async function newPhone(locale = 'ar') {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--unsafely-treat-insecure-origin-as-secure=http://e2e-ui.awj.app:3012'] });
  const ctx = await b.newContext({ ...devices['iPhone 14'], locale: locale === 'ar' ? 'ar-SA' : 'en-US', deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'locale', value: locale, url: WEB }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|webpack-hmr|INVALID_KEY|IntlError|Server\s+Error/.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
  page.on('requestfailed', r => errors.push('reqfailed: ' + r.method() + ' ' + r.url().slice(0, 100)));
  return { b, ctx, page, errors };
}
export async function dump(page) {
  return page.evaluate(() => [...document.querySelectorAll('main input,main button,main a,main select,main textarea,[role=dialog] button,[role=dialog] input,[role=dialog] textarea,nav a,header *[role=button]')].map(e => `${e.tagName}|tid=${e.getAttribute('data-testid')||''}|${(e.textContent||'').trim().replace(/\s+/g,' ').slice(0,40)}|${e.getAttribute('href')||''}|${e.disabled?'DISABLED':''}`).join('\n'));
}
export async function layout(page) {
  return page.evaluate(() => {
    const p = [];
    if (document.documentElement.scrollWidth - document.documentElement.clientWidth > 1) p.push('horizontal-overflow ' + document.documentElement.scrollWidth);
    for (const el of document.querySelectorAll('nav a, header a, main a, main button, main select, [role=dialog] button')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.height < 43.5 || r.width < 43.5)) p.push(`tap-target ${el.tagName}:${(el.textContent||'').trim().slice(0,20)}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const el of document.querySelectorAll('main input:not([type=checkbox]):not([type=radio]), main textarea, [role=dialog] input, [role=dialog] textarea')) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) p.push(`font-size ${fs}px on ${el.getAttribute('data-testid')||el.tagName}`);
    }
    const nonLatin = (document.body.innerText.match(/[٠-٩۰-۹]/g) || []).length;
    if (nonLatin) p.push(`non-latin-digits x${nonLatin}`);
    return p;
  });
}
