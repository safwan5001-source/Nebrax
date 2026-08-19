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


test('P47.3: لا يمر Tab عبر درج الجوال المخفي ويعود إلى زر القائمة عند الإغلاق', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/document-design`);
  await expect(page.getByRole('heading', { name: 'مركز قوالب الطباعة' })).toBeVisible();

  const sidebar = page.locator('aside');
  const menuButton = page.getByRole('button', { name: 'القائمة' });
  const closeButton = page.getByRole('button', { name: 'إغلاق القائمة' });

  await expect.poll(() => sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await menuButton.focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(false);

  await menuButton.press('Enter');
  await expect(closeButton).toBeFocused();
  await expect.poll(() => sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(false);

  await page.keyboard.press('Escape');
  await expect(menuButton).toBeFocused();
  await expect.poll(() => sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
});


async function expectTargetsAtLeast44(locator: ReturnType<Page['locator']>) {
  const dimensions = await locator.evaluateAll((elements) => elements
    .filter((element) => {
      const rect = (element as HTMLElement).getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
    })
    .map((element) => {
      const rect = (element as HTMLElement).getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }));

  expect(dimensions).not.toHaveLength(0);
  expect(dimensions.every((target) => target.width >= 44 && target.height >= 44), JSON.stringify(dimensions, null, 2)).toBe(true);
}

test('P47: تحقق أدوات غلاف الجوال وقوائمه هدف لمس 44px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/document-design`);
  await expect(page.getByRole('heading', { name: 'مركز قوالب الطباعة' })).toBeVisible();

  await expectTargetsAtLeast44(page.locator('header button:visible'));
  await expectTargetsAtLeast44(page.getByRole('button', { name: 'إغلاق' }));

  await page.getByRole('button', { name: 'القائمة' }).click();
  await expect(page.getByRole('button', { name: 'إغلاق القائمة' })).toBeVisible();
  await expectTargetsAtLeast44(page.locator('aside button:visible, aside a[href]:visible'));
  await page.getByRole('button', { name: 'إغلاق القائمة' }).click();

  await page.getByRole('button', { name: 'إنشاء سريع' }).click();
  await expectTargetsAtLeast44(page.getByRole('menu', { name: 'إنشاء سريع' }).getByRole('menuitem'));
  await page.getByRole('button', { name: 'إنشاء سريع' }).click();

  await page.getByRole('button', { name: 'الحساب' }).click();
  await expectTargetsAtLeast44(page.getByRole('menu', { name: 'الحساب' }).getByRole('menuitem'));

  await page.setViewportSize({ width: 1280, height: 900 });
  await expectTargetsAtLeast44(page.locator('header input:visible'));
});


test('P47.1: تحقق عناصر مركز القوالب الظاهرة هدف لمس 44px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await enterDemo(page);
  await page.goto(`${baseUrl}/document-design`);
  await expect(page.getByRole('heading', { name: 'مركز قوالب الطباعة' })).toBeVisible();

  await expectTargetsAtLeast44(page.locator('#template-center-search'));
  const documentTypeButtons = page.locator('section[aria-labelledby="template-center-families-title"] button');
  await documentTypeButtons.first().scrollIntoViewIfNeeded();
  await expectTargetsAtLeast44(documentTypeButtons);
});


type StudioBaselineMetrics = {
  viewport: { width: number; height: number };
  documentWidth: number;
  horizontalOverflow: boolean;
  tabList: { clientWidth: number; scrollWidth: number; scrollLeft: number; horizontalOverflow: boolean } | null;
  tabs: Array<{ label: string | null; selected: boolean; width: number; height: number; visible: boolean }>;
  targetsBelow44: Array<{ tag: string; label: string | null; width: number; height: number }>;
  activePanel: { id: string | null; width: number; height: number; visible: boolean } | null;
  preview: { width: number; height: number; visible: boolean } | null;
  governanceSections: Array<{ id: string; width: number; height: number; visible: boolean }>;
};

async function captureStudioBaseline(page: Page, name: string) {
  const metrics = await page.evaluate<StudioBaselineMetrics>(() => {
    const inViewport = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
    };
    const tabList = document.querySelector<HTMLElement>('[role="tablist"]');
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
    const preview = document.getElementById('print-template-preview');
    const targetsBelow44 = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'))
      .filter((target) => inViewport(target))
      .map((target) => {
        const rect = target.getBoundingClientRect();
        return {
          tag: target.tagName.toLowerCase(),
          label: target.getAttribute('aria-label') ?? target.textContent?.trim() ?? target.getAttribute('placeholder') ?? null,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((target) => target.width < 44 || target.height < 44);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      tabList: tabList ? {
        clientWidth: Math.round(tabList.clientWidth),
        scrollWidth: Math.round(tabList.scrollWidth),
        scrollLeft: Math.round(tabList.scrollLeft),
        horizontalOverflow: tabList.scrollWidth > tabList.clientWidth,
      } : null,
      targetsBelow44,
      tabs: Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => {
        const rect = tab.getBoundingClientRect();
        return {
          label: tab.textContent?.trim() ?? null,
          selected: tab.getAttribute('aria-selected') === 'true',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: inViewport(tab),
        };
      }),
      activePanel: panel ? {
        id: panel.id || null,
        width: Math.round(panel.getBoundingClientRect().width),
        height: Math.round(panel.getBoundingClientRect().height),
        visible: inViewport(panel),
      } : null,
      preview: preview ? {
        width: Math.round(preview.getBoundingClientRect().width),
        height: Math.round(preview.getBoundingClientRect().height),
        visible: inViewport(preview),
      } : null,
      governanceSections: ['template-revision-history', 'template-assignments'].flatMap((id) => {
        const section = document.getElementById(id);
        if (!section) return [];
        const rect = section.getBoundingClientRect();
        return [{
          id,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: inViewport(section),
        }];
      }),
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

async function openStudioForP472(page: Page, name: string) {
  await page.goto(`${baseUrl}/document-design`);
  await expect(page.getByRole('heading', { name: 'مركز قوالب الطباعة' })).toBeVisible();
  await page.getByRole('button', { name: /^فاتورة ضريبية/ }).first().click();
  await expect(page.getByRole('heading', { name: 'مكتبة قوالب الطباعة' })).toBeVisible();
  await page.getByRole('button', { name: 'ابدأ قالباً أساسياً' }).click();
  await page.getByRole('button', { name: 'التالي' }).click();
  await page.getByRole('button', { name: 'التالي' }).click();
  await page.getByLabel('اسم القالب').fill(`خط أساس P47.2 ${name}`);
  await page.getByRole('button', { name: 'إنشاء المسودة' }).click();
  await expect(page.getByRole('tab', { name: 'المعاينة' })).toBeVisible();
}

test('P47.2: يوثق الاستوديو والمعاينة والحوكمة عبر العروض المرجعية', async ({ page }) => {
  const viewports = [
    { name: 'p47-2-mobile-360', width: 360, height: 800 },
    { name: 'p47-2-mobile-390', width: 390, height: 844 },
    { name: 'p47-2-tablet-768', width: 768, height: 1024 },
    { name: 'p47-2-desktop-1280', width: 1280, height: 900 },
  ];
  const workspaces = [
    { id: 'structure', label: 'البنية' },
    { id: 'properties', label: 'الخصائص' },
    { id: 'preview', label: 'المعاينة' },
    { id: 'governance', label: 'المراجعات والتعيينات' },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await enterDemo(page);
    await openStudioForP472(page, viewport.name);

    for (const workspace of workspaces) {
      const tab = page.getByRole('tab', { name: workspace.label });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await captureStudioBaseline(page, `${viewport.name}-${workspace.id}`);
    }
  }
});


test('P47.2: يوثق تنقل لوحة المفاتيح وتكشف تبويبات الاستوديو على الجوال', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await enterDemo(page);
  await openStudioForP472(page, 'keyboard-mobile-360');

  const previewTab = page.getByRole('tab', { name: 'المعاينة' });
  const governanceTab = page.getByRole('tab', { name: 'المراجعات والتعيينات' });
  const structureTab = page.getByRole('tab', { name: 'البنية' });

  await previewTab.focus();
  await page.keyboard.press('End');
  await expect(governanceTab).toHaveAttribute('aria-selected', 'true');
  await expect(governanceTab).toBeFocused();

  const endState = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tablist"]');
    const active = document.activeElement as HTMLElement | null;
    const activeRect = active?.getBoundingClientRect();
    return {
      activeLabel: active?.textContent?.trim() ?? null,
      activeVisible: Boolean(activeRect
        && activeRect.width > 0
        && activeRect.height > 0
        && activeRect.bottom > 0
        && activeRect.right > 0
        && activeRect.top < window.innerHeight
        && activeRect.left < window.innerWidth),
      scrollLeft: list?.scrollLeft ?? null,
      scrollWidth: list?.scrollWidth ?? null,
      clientWidth: list?.clientWidth ?? null,
    };
  });

  await page.keyboard.press('Home');
  await expect(structureTab).toHaveAttribute('aria-selected', 'true');
  await expect(structureTab).toBeFocused();

  await test.info().attach('p47-2-mobile-360-tabs-keyboard.json', {
    body: JSON.stringify(endState, null, 2),
    contentType: 'application/json',
  });
  await saveEvidence('p47-2-mobile-360-tabs-keyboard', endState);
  await page.screenshot({ path: 'test-results/p47-baseline/p47-2-mobile-360-tabs-keyboard.png', fullPage: true });
});


test('P47.2: تحقق إجراءات رأس الاستوديو وأدوات البنية هدف لمس 44px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await enterDemo(page);
  await openStudioForP472(page, 'touch-targets-mobile-360');

  for (const name of ['العودة إلى المكتبة', 'قالب جديد', 'نسخ', 'حفظ المسودة', 'نشر المراجعة 1']) {
    const action = page.getByRole('button', { name });
    await action.scrollIntoViewIfNeeded();
    await expectTargetsAtLeast44(action);
  }

  const structureTab = page.getByRole('tab', { name: 'البنية' });
  await structureTab.click();
  await expect(structureTab).toHaveAttribute('aria-selected', 'true');

  const structurePanel = page.locator('#template-structure-panel');
  await structurePanel.scrollIntoViewIfNeeded();
  await expectTargetsAtLeast44(structurePanel.getByRole('button'));
  expect(await page.evaluate(() => window.innerWidth)).toBe(360);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});
