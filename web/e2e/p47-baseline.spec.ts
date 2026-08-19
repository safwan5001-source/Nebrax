import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve(process.cwd(), 'test-results/p47-baseline');
const baseUrl = process.env.P47_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';

type BaselineMetrics = {
  viewport: { width: number; height: number };
  documentWidth: number;
  horizontalOverflow: boolean;
  activeElement: { tag: string; label: string | null };
};

async function enterDemo(page: Page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: 'دخول تجريبي' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function saveEvidence(name: string, value: unknown) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `${name}.json`), JSON.stringify(value, null, 2));
}

async function captureBaseline(page: Page, name: string) {
  const metrics = await page.evaluate<BaselineMetrics>(() => {
    const active = document.activeElement as HTMLElement | null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      activeElement: {
        tag: active?.tagName.toLowerCase() ?? 'none',
        label: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? null,
      },
    };
  });

  await test.info().attach(`${name}-metrics.json`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  await saveEvidence(`${name}-metrics`, metrics);
  await page.screenshot({ path: `test-results/p47-baseline/${name}.png`, fullPage: true });

  return metrics;
}

async function collectAccessibilityBaseline(page: Page) {
  const interactive = await page.locator('button, a[href], input, select, textarea').evaluateAll((elements) => elements
    .map((element) => {
      const target = element as HTMLElement;
      const rect = target.getBoundingClientRect();
      return {
        tag: target.tagName.toLowerCase(),
        label: target.getAttribute('aria-label') ?? target.textContent?.trim() ?? target.getAttribute('placeholder') ?? null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        disabled: (target as HTMLButtonElement | HTMLInputElement).disabled ?? false,
        inViewport: rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < window.innerHeight
          && rect.left < window.innerWidth
          && getComputedStyle(target).visibility !== 'hidden'
          && getComputedStyle(target).display !== 'none',
      };
    })
    .filter((target) => target.inViewport));

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const focusOrder = [];
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press('Tab');
    focusOrder.push(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const rect = active?.getBoundingClientRect();
      return {
        tag: active?.tagName.toLowerCase() ?? 'none',
        label: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? active?.getAttribute('placeholder') ?? null,
        id: active?.id ?? null,
        visible: Boolean(
          rect
          && rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < window.innerHeight
          && rect.left < window.innerWidth,
        ),
      };
    }));
  }

  return {
    documentWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    viewportWidth: await page.evaluate(() => window.innerWidth),
    targetsBelow44: interactive.filter((target) => target.width < 44 || target.height < 44),
    focusOrder,
  };
}

async function openStudioFromLibrary(page: Page, name: string) {
  await page.getByRole('button', { name: /^فاتورة ضريبية/ }).first().click();
  await expect(page.getByRole('heading', { name: 'مكتبة قوالب الطباعة' })).toBeVisible();
  await captureBaseline(page, `${name}-library`);

  await page.getByRole('button', { name: 'ابدأ قالباً أساسياً' }).click();
  await page.getByRole('button', { name: 'التالي' }).click();
  await page.getByRole('button', { name: 'التالي' }).click();
  await page.getByLabel('اسم القالب').fill(`خط أساس P47 ${name}`);
  await page.getByRole('button', { name: 'إنشاء المسودة' }).click();
  await expect(page.getByRole('tab', { name: 'المراجعات والتعيينات' })).toBeVisible();
  await page.getByRole('tab', { name: 'المراجعات والتعيينات' }).click();
  await captureBaseline(page, `${name}-studio-governance`);
}

test.describe('P47 — خط الأساس المرئي والتفاعل الآمن', () => {
  test('سطح المكتب: يسجل المركز والمكتبة والحوكمة مع مقاييس العرض', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterDemo(page);
    await page.goto(`${baseUrl}/document-design`);
    await expect(page.getByRole('heading', { name: 'مركز قوالب الطباعة' })).toBeVisible();
    await captureBaseline(page, 'desktop-center');
    await openStudioFromLibrary(page, 'desktop');
  });

  test('الجوال الضيق: يسجل الرحلة نفسها ويرصد أي تجاوز أفقي قبل الإصلاح', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await enterDemo(page);
    await page.goto(`${baseUrl}/document-design`);
    await expect(page.getByRole('heading', { name: 'مركز قوالب الطباعة' })).toBeVisible();
    await captureBaseline(page, 'mobile-360-center');
    await openStudioFromLibrary(page, 'mobile-360');
  });

  test('الوضع الداكن ولوحة المفاتيح: يسجلان حالة التركيز قبل أي تعديل', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterDemo(page);
    await page.goto(`${baseUrl}/document-design`);
    await page.getByRole('button', { name: 'تبديل الوضع' }).click();
    await page.keyboard.press('Tab');
    await captureBaseline(page, 'desktop-dark-keyboard-focus');
  });

  test('مصفوفة الوصول والاستجابة: تسجل المقاييس على العروض المرجعية قبل الإصلاح', async ({ page }) => {
    const viewports = [
      { name: 'mobile-360', width: 360, height: 800 },
      { name: 'mobile-390', width: 390, height: 844 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1280', width: 1280, height: 900 },
      { name: 'desktop-1440', width: 1440, height: 900 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await enterDemo(page);
      await page.goto(`${baseUrl}/document-design`);
      await expect(page.getByRole('heading', { name: 'مركز قوالب الطباعة' })).toBeVisible();
      const baseline = await collectAccessibilityBaseline(page);
      await test.info().attach(`${viewport.name}-accessibility-baseline.json`, {
        body: JSON.stringify(baseline, null, 2),
        contentType: 'application/json',
      });
      await saveEvidence(`${viewport.name}-accessibility-baseline`, baseline);
      await page.screenshot({ path: `test-results/p47-baseline/${viewport.name}-center.png`, fullPage: true });
    }
  });
});
