import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * CUST-HV V5c review (cascade layers) — the Canvas proof runs on the builder's own,
 * *unlayered* stylesheet. The published storefront is Tailwind v4: its utilities live in
 * `@layer utilities`, where an unlayered block would outrank every utility regardless of
 * specificity. This spec compiles the REAL storefront `globals.css` and renders
 * representative section markup (the exact class strings the components use) in Chromium,
 * so the two cascades cannot silently disagree.
 */
let css = '';
test.beforeAll(() => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'sf-css-')), 'storefront.css');
  execFileSync('node', [path.resolve(__dirname, 'support/compile-storefront-css.mjs'), out], { stdio: 'pipe' });
  css = readFileSync(out, 'utf8');
});

const frame = (type: string, sd: string, vars: string, inner: string) =>
  `<div data-sd="${sd}" data-design-type="${type}" style="${vars}">${inner}</div>`;

async function mount(page: import('@playwright/test').Page, body: string) {
  await page.setContent(`<!doctype html><html lang="en" dir="ltr"><head><style>${css}</style></head><body><div style="padding:24px;width:760px">${body}</div></body></html>`);
}
const style = (page: import('@playwright/test').Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage, borderTop: cs.borderTopWidth };
  });

test('a designed banner: the design replaces the legacy surface and a nested CTA keeps its own colours', async ({ page }) => {
  await mount(
    page,
    frame(
      'banner',
      'bg fg heading link border',
      '--sec-bg:#101820;--sec-fg:#ffffff;--sec-heading:#ffffff;--sec-link:#ffffff;--sec-bw:0px;--sec-bc:transparent',
      `<section id="root" class="overflow-hidden rounded-store border border-store-border bg-store-surface">
         <h2 id="h" class="text-lg font-extrabold text-store-foreground">Title</h2>
         <p id="p" class="text-sm text-store-muted-foreground">copy</p>
         <a id="cta" href="#" class="inline-block rounded-store bg-store-primary px-3 text-store-primary-foreground">CTA</a>
       </section>`,
    ),
  );
  const root = await style(page, '#root');
  expect(root.bg).toBe('rgba(0, 0, 0, 0)'); // the legacy white card is gone
  expect(root.borderTop).toBe('0px'); // and so is its border
  expect((await style(page, '#h')).color).toBe('rgb(255, 255, 255)');
  expect((await style(page, '#p')).color).toBe('rgb(255, 255, 255)');
  // the P1: a utility on the element itself beats the zero-specificity reset (same layer)
  const cta = await style(page, '#cta');
  expect(cta.color).toBe('rgb(255, 255, 255)'); // text-store-primary-foreground, not the dark base
  expect(cta.bg).toBe('rgb(18, 55, 42)'); // bg-store-primary
});

test('links default to the proven foreground; a transparent CTA that turns dark on hover keeps contrast', async ({ page }) => {
  await mount(
    page,
    frame(
      'wholesale',
      'bg fg heading link',
      '--sec-bg:#e0f2fe;--sec-fg:#000000;--sec-heading:#000000;--sec-link:#000000',
      `<section class="rounded-store bg-store-footer px-5 py-10 text-store-footer-link">
         <h2 class="text-xl font-extrabold text-store-footer-foreground">Wholesale</h2>
         <a id="viewall" href="#" class="text-store-primary">View all</a>
         <a id="cta2" href="#" class="inline-block border bg-transparent px-4 py-2 text-store-footer-link hover:bg-store-footer-border hover:text-store-footer-foreground">Secondary</a>
       </section>`,
    ),
  );
  expect((await style(page, '#viewall')).color).toBe('rgb(0, 0, 0)');
  expect((await style(page, '#cta2')).color).toBe('rgb(0, 0, 0)'); // light-on-light never
  await page.locator('#cta2').hover();
  const hovered = await style(page, '#cta2');
  expect(hovered.bg).toBe('rgb(31, 41, 55)'); // hover:bg-store-footer-border
  expect(hovered.color).toBe('rgb(255, 255, 255)'); // hover:text-store-footer-foreground, original token
});

test('translucent nested fills become opaque surfaces with their own proven foreground (mid-tone design background)', async ({ page }) => {
  await mount(
    page,
    frame(
      'wholesale',
      'bg fg heading link',
      '--sec-bg:#757575;--sec-fg:#000000;--sec-heading:#000000;--sec-link:#000000',
      `<section class="rounded-store bg-store-footer px-5 py-10 text-store-footer-link">
         <div id="card" class="rounded-store bg-store-footer-border/40 p-4"><p id="cardp" class="text-store-footer-foreground">Card copy</p></div>
       </section>`,
    ),
  );
  const card = await style(page, '#card');
  expect(card.bg).toBe('rgb(31, 41, 55)'); // opaque footer-border, not a 40 % blend over #757575
  expect((await style(page, '#cardp')).color).toBe('rgb(255, 255, 255)'); // original light token on the dark card
});

test('the themed primary foreground survives on a nested CTA (light primary colour)', async ({ page }) => {
  // publishedThemeStyle puts the themed value AND its base on the theme wrapper
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
    <div style="--store-primary:#f5e6a8;--store-primary-foreground:#111827;--store-primary-foreground-base:#111827">
      <div data-sd="bg fg" data-design-type="banner" style="--sec-bg:#101820;--sec-fg:#ffffff">
        <section class="bg-store-surface"><a id="cta" href="#" class="bg-store-primary text-store-primary-foreground px-3">CTA</a></section>
      </div></div></body></html>`);
  const cta = await style(page, '#cta');
  expect(cta.bg).toBe('rgb(245, 230, 168)');
  expect(cta.color).toBe('rgb(17, 24, 39)'); // dark on the light primary, not the :root default white
});

test('inner spacing replaces legacy padding; block alignment is separate from text alignment; focus never paints the hover surface', async ({ page }) => {
  await mount(
    page,
    frame(
      'banner',
      'bg fg heading link pi',
      '--sec-bg:#101820;--sec-fg:#ffffff;--sec-heading:#ffffff;--sec-link:#ffffff;--sec-pi:0px',
      `<section id="root" class="overflow-hidden rounded-store border border-store-border bg-store-surface">
         <div id="inner" data-section-content="" class="flex flex-col gap-4 p-5 md:p-8"><p>copy</p></div>
         <details id="acc" class="rounded-store border px-4 open:pb-4"><summary>q</summary>a</details>
       </section>`,
    ) +
      frame(
        'hero',
        'bg fg heading link balign',
        '--sec-bg:#fde68a;--sec-fg:#000000;--sec-heading:#000000;--sec-link:#000000;--sec-bms:auto;--sec-bme:auto',
        `<section class="flex items-center rounded-store bg-linear-to-r from-primary-700 to-primary-500 text-store-primary-foreground">
           <div id="herobox" data-section-content="" class="max-w-xs p-5"><h1>Hero</h1></div>
         </section>`,
      ) +
      frame(
        'customContent',
        'balign align',
        '--sec-bms:auto;--sec-bme:auto;--sec-align:start',
        `<section id="block" class="max-w-md min-w-0 space-y-3"><p id="blockp">text</p></section>`,
      ) +
      frame(
        'wholesale',
        'bg fg heading link',
        '--sec-bg:#e0f2fe;--sec-fg:#000000;--sec-heading:#000000;--sec-link:#000000',
        `<section class="rounded-store bg-store-footer px-5 py-10 text-store-footer-link">
           <a id="cta3" href="#" class="inline-block border bg-transparent px-4 py-2 text-store-footer-link hover:bg-store-footer-border hover:text-store-footer-foreground">Secondary</a>
         </section>`,
      ),
  );
  expect(await page.locator('#inner').evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px'); // `none` removes the legacy p-5 / md:p-8
  expect(await page.locator('#root').evaluate((el) => getComputedStyle(el).paddingTop)).toBe('0px');
  // an accordion card inside the section keeps its own padding (only marked content boxes are reset)
  expect(await page.locator('#acc').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('16px');
  // the hero's actual constrained content box is what gets positioned
  const hero = await page.locator('#herobox').evaluate((el) => getComputedStyle(el).marginLeft);
  expect(hero).not.toBe('0px');
  const margins = await page.locator('#block').evaluate((el) => { const cs = getComputedStyle(el); return [cs.marginLeft, cs.marginRight]; });
  expect(margins[0]).not.toBe('0px'); // centred block…
  expect(margins[0]).toBe(margins[1]);
  expect(await page.locator('#blockp').evaluate((el) => getComputedStyle(el).textAlign)).toBe('start'); // …with start-aligned copy
  await page.locator('#cta3').focus();
  await page.keyboard.press('Tab'); // leave, then come back by keyboard
  await page.keyboard.press('Shift+Tab');
  const focused = await style(page, '#cta3');
  expect(focused.bg).toBe('rgba(0, 0, 0, 0)'); // focus paints no surface…
  expect(focused.color).toBe('rgb(0, 0, 0)'); // …so the proven foreground stays
});

test('block alignment really positions a banner\'s content group (it shrinks to its content first)', async ({ page }) => {
  await mount(
    page,
    frame(
      'banner',
      'bg fg balign',
      '--sec-bg:#101820;--sec-fg:#ffffff;--sec-bms:auto;--sec-bme:auto',
      `<section id="broot" class="overflow-hidden rounded-store border border-store-border bg-store-surface">
         <div id="bbox" data-section-content="" class="flex min-w-0 flex-col gap-4 p-5 md:flex-row md:items-center md:p-8"><p>short copy</p></div>
       </section>`,
    ),
  );
  const geo = await page.evaluate(() => {
    const root = document.getElementById('broot')!.getBoundingClientRect();
    const box = document.getElementById('bbox')!.getBoundingClientRect();
    return { rootW: root.width, boxW: box.width, left: box.left - root.left, right: root.right - box.right };
  });
  expect(geo.boxW).toBeLessThan(geo.rootW - 40); // narrower than the section…
  expect(Math.abs(geo.left - geo.right)).toBeLessThan(2); // …and centred in it
});

test('benefits: its root is the block that gets positioned (shrink-wrapped), and a label action follows the link colour', async ({ page }) => {
  await mount(
    page,
    frame(
      'benefits',
      'bg fg heading link balign',
      '--sec-bg:#101820;--sec-fg:#ffffff;--sec-heading:#ffffff;--sec-link:#ffffff;--sec-bms:auto;--sec-bme:auto',
      `<section id="ben" data-section-block="" class="min-w-0">
         <h2 class="text-lg">Benefits</h2>
         <span id="act" data-section-action="" class="text-store-primary">View all</span>
         <ul class="mt-4 grid gap-3 sm:grid-cols-2"><li class="rounded-store border bg-store-surface px-4 py-4">One</li></ul>
       </section>`,
    ),
  );
  const geo = await page.evaluate(() => {
    const frame = document.querySelector('[data-sd]')!.getBoundingClientRect();
    const box = document.getElementById('ben')!.getBoundingClientRect();
    return { frameW: frame.width, boxW: box.width, left: box.left - frame.left, right: frame.right - box.right };
  });
  expect(geo.boxW).toBeLessThan(geo.frameW - 40);
  expect(Math.abs(geo.left - geo.right)).toBeLessThan(2);
  expect((await style(page, '#act')).color).toBe('rgb(255, 255, 255)');
});

test('hero CTA focus ring is drawn in the designed foreground, not the restored white', async ({ page }) => {
  await mount(
    page,
    frame(
      'hero',
      'bg fg heading link',
      '--sec-bg:#fde68a;--sec-fg:#000000;--sec-heading:#000000;--sec-link:#000000',
      `<section class="flex items-center rounded-store text-store-primary-foreground">
         <a id="herocta" href="#" class="inline-flex bg-store-primary-foreground px-4 text-store-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary-foreground">Shop now</a>
       </section>`,
    ),
  );
  await page.locator('#herocta').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const outline = await page.locator('#herocta').evaluate((el) => getComputedStyle(el).outlineColor);
  expect(outline).toBe('rgb(0, 0, 0)');
});

test('a category card link\'s focus ring (outline-store-primary) is redrawn against a primary-coloured designed background', async ({ page }) => {
  await mount(
    page,
    frame(
      'categories',
      'bg fg heading link',
      '--sec-bg:#12372a;--sec-fg:#ffffff;--sec-heading:#ffffff;--sec-link:#ffffff',
      `<section><a id="catcard" href="#" class="block rounded-store border bg-store-surface p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-store-primary">Card</a></section>`,
    ),
  );
  await page.locator('#catcard').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  expect(await page.locator('#catcard').evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(255, 255, 255)');
});

