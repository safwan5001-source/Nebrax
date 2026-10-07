import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * CUST-HV V5e-2b — global button tokens, proved on the REAL compiled storefront stylesheet
 * (Tailwind v4, native cascade layers) with the exact class strings the components use. Each
 * token must change what it claims and NOTHING else: the hero CTA (inverted on the brand
 * gradient — V6 owns it), icon-only buttons and ghost/link variants are never reached, and a
 * wrapper with no `data-gt` renders exactly what a bare one does.
 */
let css = '';
test.beforeAll(() => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'sf-css-')), 'storefront.css');
  execFileSync('node', [path.resolve(__dirname, 'support/compile-storefront-css.mjs'), out], { stdio: 'pipe' });
  css = readFileSync(out, 'utf8');
});

const BUTTONS = `
  <a id="banner" href="#" class="mt-4 inline-flex h-10 items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground">Banner CTA</a>
  <a id="card" href="#" class="block w-full rounded-store bg-store-primary px-3 py-1.5 text-xs font-bold text-store-primary-foreground transition-colors hover:bg-store-primary-hover">Add</a>
  <button id="ui" data-slot="button" data-variant="default" data-size="default" class="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-primary text-primary-foreground hover:bg-primary/80 h-11 px-2.5 text-sm font-medium">UI default</button>
  <button id="uiOutline" data-slot="button" data-variant="outline" data-size="default" class="inline-flex items-center justify-center rounded-md border border-border bg-background h-11 px-2.5 text-sm font-medium">UI outline</button>
  <button id="uiIcon" data-slot="button" data-variant="default" data-size="icon" class="inline-flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">i</button>
  <button id="uiGhost" data-slot="button" data-variant="ghost" data-size="default" class="inline-flex h-11 px-2.5 text-sm hover:bg-muted">ghost</button>
  <button id="uiDisabled" disabled data-slot="button" data-variant="default" data-size="default" class="inline-flex h-11 px-2.5 text-sm bg-primary text-primary-foreground disabled:opacity-50">disabled</button>
  <a id="hero" href="#" class="mt-4 inline-flex h-9 items-center gap-1.5 rounded-store bg-store-primary-foreground px-4 text-xs font-bold text-store-primary shadow-md">Hero CTA</a>
  <div id="sec" data-sd="bg fg link" data-design-type="benefits" style="--sec-link:#ffffff;--sec-fg:#ffffff;--sec-bg:#101820">
    <div><a id="inSec" href="#" class="inline-flex h-10 items-center rounded-store bg-store-primary px-4 text-sm font-bold text-store-primary-foreground">In section</a></div>
  </div>`;

async function mount(page: Page, attrs: string, vars: string) {
  await page.setContent(
    `<!doctype html><html lang="en" dir="ltr"><head><style>${css}</style></head><body>
       <div id="wrap" ${attrs} style="${vars}"><div style="padding:24px;width:760px">${BUTTONS}</div></div>
     </body></html>`,
  );
}

type Props = readonly string[];
const read = (page: Page, selector: string, props: Props) =>
  page.locator(selector).evaluate(
    (el, ps) => {
      const cs = getComputedStyle(el) as unknown as Record<string, string>;
      return Object.fromEntries(ps.map((p) => [p, cs[p]]));
    },
    props as string[],
  );

const PROPS: Props = ['backgroundColor', 'color', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft', 'fontSize', 'fontWeight', 'textTransform', 'textDecorationLine', 'height'];
const IDS = ['banner', 'card', 'ui', 'uiOutline', 'uiIcon', 'uiGhost', 'hero', 'inSec'];
async function snapshot(page: Page) {
  const out: Record<string, unknown> = {};
  for (const id of IDS) out[id] = await read(page, `#${id}`, PROPS);
  return out;
}

// what the resolver emits for a soft brand button (arbitrary but distinct, so each use is visible)
const COLOURS = '--gt-bf:rgb(231, 238, 235);--gt-bl:rgb(18, 55, 42);--gt-bb:rgb(231, 238, 235);--gt-bhf:rgb(205, 217, 212);--gt-bhl:rgb(18, 55, 42);--gt-bhb:rgb(205, 217, 212)';

test('absent tokens: a wrapper with no data-gt renders exactly what a bare wrapper renders', async ({ page }) => {
  await mount(page, '', '');
  const bare = await snapshot(page);
  await mount(page, '', `${COLOURS};--gt-bpy:5px;--gt-bpx:9px;--gt-bfs:3px;--gt-brad:1px;--gt-bfw:300`); // variables, no tokens
  expect(await snapshot(page)).toEqual(bare);
});

test('primary colours: only the solid CTAs and the shared default Button follow; everything else is untouched', async ({ page }) => {
  await mount(page, '', '');
  const bare = await snapshot(page);
  await mount(page, 'data-gt="b-pri"', COLOURS);
  const styled = (await snapshot(page)) as Record<string, Record<string, string>>;
  for (const id of ['banner', 'card', 'ui', 'inSec']) {
    expect(styled[id].backgroundColor, id).toBe('rgb(231, 238, 235)');
    expect(styled[id].color, id).toBe('rgb(18, 55, 42)');
    expect(styled[id].borderTopColor, id).toBe('rgb(231, 238, 235)');
  }
  // never reached: the inverted hero CTA, the outline variant, the icon button, the ghost variant
  for (const id of ['hero', 'uiOutline', 'uiIcon', 'uiGhost']) expect(styled[id], id).toEqual((bare as Record<string, unknown>)[id]);
});

test('hover: the hover fill/label replace the component hover — but never on a disabled button', async ({ page }) => {
  await mount(page, 'data-gt="b-pri"', COLOURS);
  // the component's own `transition-colors` is still running for ~150 ms: poll to the settled value
  await page.locator('#card').hover();
  await expect.poll(async () => (await read(page, '#card', ['backgroundColor'])).backgroundColor).toBe('rgb(205, 217, 212)');
  await page.locator('#ui').hover();
  await expect.poll(async () => (await read(page, '#ui', ['backgroundColor'])).backgroundColor).toBe('rgb(205, 217, 212)');
  await page.locator('#uiDisabled').hover({ force: true });
  // the disabled button has no `data-gt` styling at rest beyond the token, and never takes the hover fill
  expect((await read(page, '#uiDisabled', ['backgroundColor'])).backgroundColor).not.toBe('rgb(205, 217, 212)');
});

test('sizes: sm / lg step padding and type for every button but icon-only', async ({ page }) => {
  await mount(page, 'data-gt="b-sz"', '--gt-bpy:0.875rem;--gt-bpx:1.5rem;--gt-bfs:1rem');
  for (const id of ['banner', 'card', 'ui', 'uiOutline']) {
    const r = await read(page, `#${id}`, ['paddingTop', 'paddingLeft', 'fontSize']);
    expect(r, id).toEqual({ paddingTop: '14px', paddingLeft: '24px', fontSize: '16px' });
  }
  const icon = await read(page, '#uiIcon', ['paddingTop', 'height']);
  expect(icon.height).toBe('32px'); // size-8 stays
  expect((await read(page, '#hero', ['paddingLeft'])).paddingLeft).toBe('16px'); // hero CTA untouched
  expect((await read(page, '#uiGhost', ['paddingLeft'])).paddingLeft).toBe('10px');
});

test('radius, weight and case apply to every button; case is uppercase only where set', async ({ page }) => {
  await mount(page, 'data-gt="b-rad b-fw b-up"', '--gt-brad:9999px;--gt-bfw:800');
  for (const id of ['banner', 'ui', 'uiOutline']) {
    const r = await read(page, `#${id}`, ['borderTopLeftRadius', 'fontWeight', 'textTransform']);
    expect(parseFloat(r.borderTopLeftRadius), id).toBeGreaterThan(1000);
    expect(r.fontWeight, id).toBe('800');
    expect(r.textTransform, id).toBe('uppercase');
  }
  expect((await read(page, '#hero', ['textTransform'])).textTransform).toBe('none');
});

test('outline: transparent fill and a 2px border in the role colour; inside a designed section it follows the section foreground', async ({ page }) => {
  await mount(page, 'data-gt="b-pri b-sty-outline"', '--gt-bf:transparent;--gt-bl:rgb(18, 55, 42);--gt-bb:rgb(18, 55, 42);--gt-bhf:rgb(231, 238, 235);--gt-bhl:rgb(18, 55, 42);--gt-bhb:rgb(18, 55, 42)');
  const banner = await read(page, '#banner', ['backgroundColor', 'color', 'borderTopWidth', 'borderTopColor']);
  expect(banner.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(banner.borderTopWidth).toBe('2px');
  expect(banner.color).toBe('rgb(18, 55, 42)');
  const inSec = await read(page, '#inSec', ['color', 'borderTopColor']);
  expect(inSec.color).toBe('rgb(255, 255, 255)'); // the section's proven link colour, not the page-judged one
  expect(inSec.borderTopColor).toBe('rgb(255, 255, 255)');
});

test('link: no fill, underlined; lift and underline hovers; lift is static under reduced motion', async ({ page }) => {
  await mount(page, 'data-gt="b-pri b-sty-link b-hv-underline"', '--gt-bf:transparent;--gt-bl:rgb(18, 55, 42);--gt-bb:transparent;--gt-bhf:transparent;--gt-bhl:rgb(18, 55, 42);--gt-bhb:transparent');
  expect((await read(page, '#banner', ['textDecorationLine'])).textDecorationLine).toBe('underline');

  await mount(page, 'data-gt="b-pri b-hv-lift"', COLOURS);
  await page.locator('#banner').hover();
  expect((await read(page, '#banner', ['transform']) as unknown as { transform: string }).transform).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, 'data-gt="b-pri b-hv-lift"', COLOURS);
  await page.locator('#banner').hover();
  expect((await read(page, '#banner', ['transform']) as unknown as { transform: string }).transform).toBe('none');
});
