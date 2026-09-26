import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const widths = [390, 430, 768, 1024, 1280, 1440] as const;
const locales = ["ar", "en"] as const;
const evidenceDir = path.resolve(process.cwd(), "test-results/store-brand-qa");

function expectedColumns(width: number) {
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

async function assertPublishedFooter(
  page: Page,
  width: number,
  locale: "ar" | "en",
) {
  await expect(page.locator("html")).toHaveAttribute(
    "dir",
    locale === "ar" ? "rtl" : "ltr",
  );

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

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

  expect(await page.locator('[data-official-social="whatsapp"]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("img", { name: "App Store" })).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Google Play" })).toHaveCount(2);
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

for (const locale of locales) {
  for (const width of widths) {
    test(`published full ${locale} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `/dev/trust-visual?surface=published&locale=${locale}&scenario=full`,
      );
      await page.waitForLoadState("networkidle");
      await assertPublishedFooter(page, width, locale);
      await page.screenshot({
        path: path.join(
          evidenceDir,
          `published-full-${locale}-${width}.png`,
        ),
        fullPage: true,
      });
    });
  }
}

test("published unsafe values fail closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(
    "/dev/trust-visual?surface=published&locale=en&scenario=unsafe",
  );
  await page.waitForLoadState("networkidle");

  const hrefs = await page.locator("footer a").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLAnchorElement).href),
  );
  expect(hrefs.some((href) => href.startsWith("javascript:"))).toBe(false);
  expect(hrefs.some((href) => href.startsWith("http://"))).toBe(false);
  await expect(page.locator('[data-official-social="x"]')).toHaveCount(0);
  await expect(page.locator('[data-official-social="tiktok"]')).toHaveCount(0);
  await expect(page.getByRole("img", { name: "App Store" })).toHaveCount(0);
});
