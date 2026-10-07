import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * CUST-HV V5e-2a — document-level global tokens, proved on the REAL compiled storefront
 * stylesheet (Tailwind v4, native cascade layers) in Chromium. Every token must (a) change
 * what it claims to change and (b) change NOTHING when absent — the byte-identical guarantee
 * is asserted on computed styles, side by side.
 */
let css = '';
test.beforeAll(() => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'sf-css-')), 'storefront.css');
  execFileSync('node', [path.resolve(__dirname, 'support/compile-storefront-css.mjs'), out], { stdio: 'pipe' });
  css = readFileSync(out, 'utf8');
});

const page_ = (inner: string) => inner;

/** The same markup, under a theme wrapper with and without tokens. */
const markup = `
  <section id="s">
    <div data-section-heading class="flex items-start justify-between gap-4">
      <div class="flex min-w-0 items-start gap-2">
        <span data-heading-bar aria-hidden="true" class="mt-1 h-4 w-1.5 shrink-0 rounded-full bg-store-primary"></span>
        <div class="min-w-0"><h2 id="h" class="text-base font-extrabold leading-tight text-store-foreground md:text-lg">Heading</h2></div>
      </div>
    </div>
    <p id="p" class="text-sm text-store-muted-foreground leading-tight">Body copy</p>
    <div id="card" class="rounded-store border border-store-border bg-store-surface px-4 py-4 transition-colors duration-200">Card</div>
    <ul><li id="li" class="leading-tight"><p id="lip">in list</p></li></ul>
  </section>
  <div data-sd="hstyle-plain" data-design-type="benefits">
    <div data-section-heading class="flex items-start justify-between gap-4">
      <span data-heading-bar aria-hidden="true" class="h-4 w-1.5 bg-store-primary"></span>
      <h2 id="h2" class="text-base font-extrabold">Own style</h2>
    </div>
  </div>`;

async function mount(page: import('@playwright/test').Page, wrapperAttrs: string, wrapperStyle: string) {
  await page.setContent(
    `<!doctype html><html lang="en" dir="ltr"><head><style>${css}</style></head><body>
       <div id="wrap" ${wrapperAttrs} style="${wrapperStyle}"><div style="padding:24px;width:760px">${page_(markup)}</div></div>
     </body></html>`,
  );
}

const computed = (page: import('@playwright/test').Page, selector: string, props: string[]) =>
  page.locator(selector).first().evaluate(
    (el, ps) => {
      const cs = getComputedStyle(el) as unknown as Record<string, string>;
      return Object.fromEntries(ps.map((p) => [p, cs[p]]));
    },
    props,
  );

const SNAPSHOT = {
  h: ['fontWeight', 'zoom', 'borderBottomWidth', 'fontSize'],
  p: ['zoom', 'lineHeight', 'fontWeight'],
  card: ['borderTopWidth', 'boxShadow', 'borderTopLeftRadius', 'transitionDuration', 'transitionTimingFunction'],
  '[data-heading-bar]': ['display'],
};

async function snapshot(page: import('@playwright/test').Page) {
  const out: Record<string, unknown> = {};
  for (const [sel, props] of Object.entries(SNAPSHOT)) {
    out[sel] = await computed(page, sel.startsWith('[') ? sel : `#${sel}`, props);
  }
  return out;
}

test('absent tokens: a wrapper with no data-gt renders exactly what a bare wrapper renders', async ({ page }) => {
  await mount(page, '', '');
  const bare = await snapshot(page);
  await mount(page, '', '--gt-hz:1.5;--gt-hw:400;--gt-sbw:5px;--gt-shd:0 0 9px red;--gt-md:900ms'); // vars without tokens
  expect(await snapshot(page)).toEqual(bare);
});

test('typography: heading scale multiplies, weights apply, line height steps, body zoom', async ({ page }) => {
  await mount(page, 'data-gt="hz bz hw bw lh"', '--gt-hz:1.125;--gt-bz:0.94;--gt-hw:700;--gt-bw:500;--gt-lh:1.75');
  const h = await computed(page, '#h', ['zoom', 'fontWeight']);
  expect(parseFloat(h.zoom)).toBeCloseTo(1.125, 3);
  expect(h.fontWeight).toBe('700'); // beat the component's own `font-extrabold` (800)
  const p = await computed(page, '#p', ['zoom', 'lineHeight']);
  expect(parseFloat(p.zoom)).toBeCloseTo(0.94, 3);
  expect(parseFloat(p.lineHeight) / parseFloat(await page.locator('#p').evaluate((e) => getComputedStyle(e).fontSize))).toBeCloseTo(1.75, 2);
  // a paragraph nested in a list item is scaled once (the list item itself is not zoomed)
  expect(parseFloat((await computed(page, '#li', ['zoom'])).zoom)).toBe(1);
  expect((await computed(page, '#wrap', ['fontWeight'])).fontWeight).toBe('500');
});

test('surfaces: card border width, shadow and radius follow the tokens', async ({ page }) => {
  await mount(page, 'data-gt="sbw shd"', '--gt-sbw:2px;--gt-shd:0 6px 16px rgba(17,24,39,.12);--store-radius:1.75rem');
  const card = await computed(page, '#card', ['borderTopWidth', 'boxShadow', 'borderTopLeftRadius']);
  expect(card.borderTopWidth).toBe('2px');
  expect(card.boxShadow).not.toBe('none');
  expect(parseFloat(card.borderTopLeftRadius)).toBeCloseTo(28, 0);

  await mount(page, 'data-gt="sbw"', '--gt-sbw:0px');
  expect((await computed(page, '#card', ['borderTopWidth'])).borderTopWidth).toBe('0px');
});

test('motion: bounded duration/easing replace the component transition values', async ({ page }) => {
  await mount(page, 'data-gt="mo-d mo-e"', '--gt-md:500ms;--gt-me:cubic-bezier(0.2, 0, 0, 1)');
  const card = await computed(page, '#card', ['transitionDuration', 'transitionTimingFunction']);
  expect(card.transitionDuration).toBe('0.5s'); // beat the component's `duration-200`
  expect(card.transitionTimingFunction).toContain('cubic-bezier(0.2, 0, 0, 1)');
});

test('motion: everything is static under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, 'data-gt="mo-d"', '--gt-md:500ms');
  const card = await computed(page, '#card', ['transitionDuration']);
  expect(parseFloat(card.transitionDuration)).toBeLessThan(0.001);
});

test('layout: the content width variable drives the container utility', async ({ page }) => {
  await mount(page, '', '--store-content-max:64rem');
  const max = await page.evaluate(() => getComputedStyle(document.getElementById('wrap')!).getPropertyValue('--store-content-max').trim());
  expect(max).toBe('64rem');
});

test('section heading default style: applies to plain headings, never over a section that chose its own', async ({ page }) => {
  await mount(page, 'data-gt="hs-underline"', '');
  const h = await computed(page, '#h', ['borderBottomWidth']);
  expect(parseFloat(h.borderBottomWidth)).toBe(2);
  expect((await computed(page, '#s [data-heading-bar]', ['display'])).display).toBe('none');
  // the section whose own design set `hstyle-plain` keeps its own choice (its bar stays hidden by
  // its own rule, and the global underline does not reach it)
  const own = await computed(page, '#h2', ['borderBottomWidth']);
  expect(parseFloat(own.borderBottomWidth)).toBe(0);

  await mount(page, 'data-gt="hs-centered"', '');
  expect((await computed(page, '#s [data-section-heading]', ['justifyContent'])).justifyContent).toBe('center');
  expect((await computed(page, '[data-design-type] [data-section-heading]', ['justifyContent'])).justifyContent).not.toBe('center');
});
