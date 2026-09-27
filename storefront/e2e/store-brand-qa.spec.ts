import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

const widths = [390, 430, 768, 1024, 1280, 1440] as const;
const locales = ["ar", "en"] as const;
const evidenceDir = path.resolve(process.cwd(), "test-results/store-brand-qa");

function expectedColumns(width: number) {
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function assertTouchTarget(locator: Locator, minimum = 40) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(minimum);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(minimum);
}

async function assertKeyboardFocusVisible(page: Page, target: Locator) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => document.activeElement === el)) {
      const focus = await target.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          outlineWidth: Number.parseFloat(style.outlineWidth || "0"),
          outlineStyle: style.outlineStyle,
        };
      });
      expect(focus.outlineStyle).not.toBe("none");
      expect(focus.outlineWidth).toBeGreaterThan(0);
      return;
    }
  }
  throw new Error("Target was not reached by keyboard navigation");
}

async function assertFullFooter(
  page: Page,
  width: number,
  directionLocator: Locator,
  locale: "ar" | "en",
) {
  await expect(directionLocator).toHaveAttribute(
    "dir",
    locale === "ar" ? "rtl" : "ltr",
  );
  await assertNoOverflow(page);

  const footer = page.locator("footer");
  await expect(footer).toBeVisible();

  const grids = footer.locator(".grid");
  expect(await grids.count()).toBeGreaterThanOrEqual(2);
  const trustGrid = grids.nth(1);
  const columns = await trustGrid.evaluate(
    (el) =>
      getComputedStyle(el)
        .gridTemplateColumns.trim()
        .split(/\s+/)
        .filter(Boolean).length,
  );
  expect(columns).toBe(expectedColumns(width));

  for (const network of [
    "instagram",
    "x",
    "tiktok",
    "snapchat",
    "youtube",
    "linkedin",
    "facebook",
  ]) {
    const mark = footer.locator(`[data-official-social="${network}"]`);
    await expect(mark).toHaveCount(1);
    const anchor = mark.locator("xpath=ancestor::a[1]");
    await expect(anchor).toHaveAttribute("aria-label", /.+/);
    await expect(anchor).toHaveAttribute("rel", /noopener/);
  }

  for (const kind of ["phone", "email", "address", "hours"]) {
    const icon = footer.locator(`[data-contact-icon="${kind}"]`);
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
  }

  expect(
    await page.locator('[data-official-social="whatsapp"]').count(),
  ).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("img", { name: "App Store" })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Google Play" })).toHaveCount(2);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

for (const locale of locales) {
  for (const width of widths) {
    test(`published fixture full ${locale} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `/dev/trust-visual?surface=published&locale=${locale}&scenario=full`,
      );
      await page.waitForLoadState("networkidle");
      await assertFullFooter(
        page,
        width,
        page.locator('[data-trust-surface="published"]'),
        locale,
      );
      await page.screenshot({
        path: path.join(
          evidenceDir,
          `published-fixture-full-${locale}-${width}.png`,
        ),
        fullPage: true,
      });
    });
  }
}

for (const locale of locales) {
  for (const width of [390, 1440] as const) {
    test(`actual published route ${locale} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.setExtraHTTPHeaders({ "accept-language": locale });
      await page.goto(`/sa/${locale}`);
      await page.waitForLoadState("networkidle");

      await assertFullFooter(page, width, page.locator("html"), locale);
      await expect(page.locator("footer")).toContainText("7050247977");
      await expect(page.locator("footer")).toContainText("310123456700003");

      await page.screenshot({
        path: path.join(evidenceDir, `published-route-${locale}-${width}.png`),
        fullPage: true,
      });
    });
  }
}

const stateCases = [
  [
    "empty",
    {
      phone: 0,
      email: 0,
      address: 0,
      hours: 0,
      instagram: 0,
      whatsapp: 0,
      apple: 0,
      google: 0,
    },
  ],
  [
    "partial",
    {
      phone: 1,
      email: 0,
      address: 0,
      hours: 0,
      instagram: 1,
      whatsapp: 1,
      apple: 0,
      google: 0,
    },
  ],
  [
    "missing-identity",
    {
      phone: 1,
      email: 1,
      address: 1,
      hours: 1,
      instagram: 1,
      whatsapp: 2,
      apple: 2,
      google: 2,
    },
  ],
  [
    "apps-one",
    {
      phone: 1,
      email: 1,
      address: 1,
      hours: 1,
      instagram: 0,
      whatsapp: 0,
      apple: 2,
      google: 0,
    },
  ],
  [
    "apps-google",
    {
      phone: 1,
      email: 1,
      address: 1,
      hours: 1,
      instagram: 0,
      whatsapp: 0,
      apple: 0,
      google: 2,
    },
  ],
  [
    "whatsapp-floating",
    {
      phone: 1,
      email: 1,
      address: 1,
      hours: 1,
      instagram: 0,
      whatsapp: 1,
      apple: 2,
      google: 2,
    },
  ],
] as const;

for (const [scenario, expected] of stateCases) {
  test(`published state ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(
      `/dev/trust-visual?surface=published&locale=en&scenario=${scenario}`,
    );
    await page.waitForLoadState("networkidle");
    await assertNoOverflow(page);

    for (const kind of ["phone", "email", "address", "hours"] as const) {
      await expect(page.locator(`[data-contact-icon="${kind}"]`)).toHaveCount(
        expected[kind],
      );
    }
    await expect(
      page.locator('[data-official-social="instagram"]'),
    ).toHaveCount(expected.instagram);
    await expect(page.locator('[data-official-social="whatsapp"]')).toHaveCount(
      expected.whatsapp,
    );
    await expect(page.getByRole("img", { name: "App Store" })).toHaveCount(
      expected.apple,
    );
    await expect(page.getByRole("img", { name: "Google Play" })).toHaveCount(
      expected.google,
    );

    if (scenario === "missing-identity") {
      await expect(page.locator("#footer-identity")).toHaveCount(0);
    }
  });
}

test("published long values do not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(
    "/dev/trust-visual?surface=published&locale=en&scenario=long",
  );
  await page.waitForLoadState("networkidle");
  await assertNoOverflow(page);
});

test("published unsafe values fail closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(
    "/dev/trust-visual?surface=published&locale=en&scenario=unsafe",
  );
  await page.waitForLoadState("networkidle");

  const hrefs = await page
    .locator("footer a")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).href),
    );
  expect(hrefs.some((href) => href.startsWith("javascript:"))).toBe(false);
  await expect(page.locator('[data-official-social="x"]')).toHaveCount(0);
  await expect(page.locator('[data-official-social="tiktok"]')).toHaveCount(0);
  await expect(page.getByRole("img", { name: "App Store" })).toHaveCount(0);
});

test("published icon targets are usable and keyboard focus is visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.setExtraHTTPHeaders({ "accept-language": "en" });
  await page.goto("/sa/en");
  await page.waitForLoadState("networkidle");

  const instagram = page
    .locator('footer [data-official-social="instagram"]')
    .locator("xpath=ancestor::a[1]");
  const floatingWhatsapp = page
    .locator('[data-official-social="whatsapp"]')
    .last()
    .locator("xpath=ancestor::a[1]");

  await assertTouchTarget(instagram);
  await assertTouchTarget(floatingWhatsapp);
  await assertKeyboardFocusVisible(page, instagram);
});
