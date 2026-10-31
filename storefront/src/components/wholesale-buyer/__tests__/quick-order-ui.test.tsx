import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickOrderLine } from "@/lib/commerce/quick-order";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

const actions = vi.hoisted(() => ({
  searchQuickOrder: vi.fn(),
  resolveQuickOrderSkus: vi.fn(),
  addQuickOrderLines: vi.fn(),
}));
const cart = vi.hoisted(() => ({ refreshCart: vi.fn(), openCart: vi.fn() }));

vi.mock("@/lib/data/wholesale-buyer", () => actions);
vi.mock("@/contexts/CartContext", () => ({ useCart: () => cart }));

import { QuickOrder } from "../QuickOrder";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "33333333-3333-4333-8333-333333333333";
const V1 = "22222222-2222-4222-8222-222222222222";

const line = (over: Partial<QuickOrderLine> = {}): QuickOrderLine => ({
  productId: P1,
  variantId: null,
  unitKey: "base",
  unitName: "piece",
  sku: "COF-100",
  name: "قهوة",
  nameEn: "Coffee",
  descriptor: null,
  price: { amountMinor: 700, currency: "SAR" },
  available: true,
  unavailableReason: null,
  inStock: null,
  exact: true,
  ...over,
});
const unavailable = line({
  productId: P2,
  sku: "TEA-200",
  name: "شاي",
  nameEn: "Tea",
  price: null,
  available: false,
  unavailableReason: "no_wholesale_price",
});
const variant = line({
  variantId: V1,
  sku: "SHIRT-RED",
  name: "قميص",
  nameEn: "Shirt",
  descriptor: "Red",
  price: { amountMinor: 2500, currency: "SAR" },
});

const wrap = (locale: "en" | "ar" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
    <QuickOrder basePath={`/sa/${locale}`} />
  </NextIntlClientProvider>
);

const search = async (term: string) => {
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search by SKU or product name" }),
    {
      target: { value: term },
    },
  );
  await waitFor(() => expect(actions.searchQuickOrder).toHaveBeenCalled(), {
    timeout: 2000,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  cart.refreshCart.mockResolvedValue(undefined);
});

describe("quick order UI", () => {
  it("starts empty with nothing to submit", () => {
    render(wrap());
    expect(screen.getByTestId("qo-empty")).toBeTruthy();
    expect(
      (screen.getByTestId("qo-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("searches by SKU/name, adds a result to the list and shows the server price", async () => {
    actions.searchQuickOrder.mockResolvedValue({
      kind: "ok",
      lines: [line(), variant],
    });
    render(wrap());

    await search("cof");
    const results = await screen.findByTestId("qo-results");
    expect(within(results).getByText("Coffee")).toBeTruthy();
    fireEvent.click(within(results).getAllByTestId("qo-pick")[0]);

    const row = screen.getByTestId("qo-line");
    expect(row.getAttribute("data-sku")).toBe("COF-100");
    expect(screen.getByTestId("qo-total").textContent).toContain("7.00");
    expect(
      (screen.getByTestId("qo-submit") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does not search for fewer than two characters", async () => {
    render(wrap());
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search by SKU or product name" }),
      {
        target: { value: "c" },
      },
    );
    await new Promise((r) => setTimeout(r, 450));
    expect(actions.searchQuickOrder).not.toHaveBeenCalled();
  });

  it("a variant keeps its descriptor and its own SKU", async () => {
    actions.searchQuickOrder.mockResolvedValue({
      kind: "ok",
      lines: [variant],
    });
    render(wrap());
    await search("shirt");
    fireEvent.click(await screen.findByTestId("qo-pick"));
    expect(screen.getByTestId("qo-line").textContent).toContain("Shirt — Red");
    expect(screen.getByTestId("qo-line").getAttribute("data-sku")).toBe(
      "SHIRT-RED",
    );
  });

  it("shows an unavailable line as excluded, without a price, and never submits it", async () => {
    actions.searchQuickOrder.mockResolvedValue({
      kind: "ok",
      lines: [unavailable],
    });
    render(wrap());
    await search("tea");
    fireEvent.click(await screen.findByTestId("qo-pick"));

    const row = screen.getByTestId("qo-line");
    expect(row.getAttribute("data-state")).toBe("unavailable");
    expect(row.textContent).toContain("No wholesale price is available");
    expect(row.textContent).toContain("will not be added");
    expect(row.textContent).not.toMatch(/SAR|ر\.س|\d\.\d\d/);
    expect(
      (screen.getByTestId("qo-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("flags invalid quantities and excludes the line until it is fixed", async () => {
    actions.searchQuickOrder.mockResolvedValue({ kind: "ok", lines: [line()] });
    render(wrap());
    await search("cof");
    fireEvent.click(await screen.findByTestId("qo-pick"));

    const qty = screen.getByTestId("qo-qty") as HTMLInputElement;
    for (const bad of ["0", "-3", "1.5", "abc", ""]) {
      fireEvent.change(qty, { target: { value: bad } });
      expect(screen.getByTestId("qo-line").getAttribute("data-state")).toBe(
        "invalid",
      );
      expect(
        (screen.getByTestId("qo-submit") as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    fireEvent.change(qty, { target: { value: "4" } });
    expect(screen.getByTestId("qo-line").getAttribute("data-state")).toBe(
      "ready",
    );
    expect(screen.getByTestId("qo-total").textContent).toContain("28.00");
  });

  it("pasted SKUs resolve exactly: found lines join the list, unknown and ambiguous ones are reported", async () => {
    actions.resolveQuickOrderSkus.mockResolvedValue({
      kind: "ok",
      rows: [
        { sku: "COF-100", lines: [line()] },
        { sku: "NOPE", lines: [] },
        {
          sku: "SHIRT",
          lines: [
            variant,
            {
              ...variant,
              variantId: "44444444-4444-4444-8444-444444444444",
              sku: "SHIRT-BLUE",
            },
          ],
        },
      ],
    });
    render(wrap());

    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: "COF-100 5\nNOPE 2\nSHIRT 1" },
    });
    fireEvent.click(screen.getByTestId("qo-import"));

    await waitFor(() =>
      expect(screen.getByTestId("qo-paste-issues")).toBeTruthy(),
    );
    expect(actions.resolveQuickOrderSkus).toHaveBeenCalledWith([
      "COF-100",
      "NOPE",
      "SHIRT",
    ]);
    expect(screen.getAllByTestId("qo-line")).toHaveLength(1);
    expect((screen.getByTestId("qo-qty") as HTMLInputElement).value).toBe("5");
    const issues = screen.getByTestId("qo-paste-issues").textContent ?? "";
    expect(issues).toContain("NOPE");
    expect(issues).toContain("not found");
    expect(issues).toContain("several variants");
    // the ambiguous parent's variants are handed to the picker
    expect(await screen.findByTestId("qo-results")).toBeTruthy();
  });

  it("the paste box is locked while an import is resolving, so typed edits cannot be overwritten", async () => {
    let release: (v: unknown) => void = () => {};
    actions.resolveQuickOrderSkus.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(wrap());
    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: "COF-100 2" },
    });
    fireEvent.click(screen.getByTestId("qo-import"));
    await waitFor(() =>
      expect(
        (screen.getByTestId("qo-paste") as HTMLTextAreaElement).disabled,
      ).toBe(true),
    );
    await act(async () => {
      release({ kind: "ok", rows: [{ sku: "COF-100", lines: [line()] }] });
    });
    await waitFor(() =>
      expect(
        (screen.getByTestId("qo-paste") as HTMLTextAreaElement).disabled,
      ).toBe(false),
    );
  });

  it("a lookup still in flight when the search box is cleared never repopulates the picker", async () => {
    let release: (v: unknown) => void = () => {};
    actions.searchQuickOrder.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(wrap());
    const box = screen.getByRole("textbox", {
      name: "Search by SKU or product name",
    });
    fireEvent.change(box, { target: { value: "cof" } });
    await waitFor(() => expect(actions.searchQuickOrder).toHaveBeenCalled(), {
      timeout: 2000,
    });
    fireEvent.change(box, { target: { value: "" } });
    await act(async () => {
      release({ kind: "ok", lines: [line()] });
    });
    expect(screen.queryByTestId("qo-results")).toBeNull();
    expect(screen.queryAllByTestId("qo-pick")).toHaveLength(0);
  });

  it("the variant choices handed over by an ambiguous parent SKU are not replaced by a substring search", async () => {
    const blue = {
      ...variant,
      variantId: "44444444-4444-4444-8444-444444444444",
      sku: "BLUE-001",
    };
    actions.resolveQuickOrderSkus.mockResolvedValue({
      kind: "ok",
      rows: [{ sku: "SHIRT", lines: [variant, blue] }],
    });
    // what a substring lookup for "SHIRT" would (wrongly) shrink the picker to
    actions.searchQuickOrder.mockResolvedValue({
      kind: "ok",
      lines: [variant],
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: "SHIRT 1" },
    });
    fireEvent.click(screen.getByTestId("qo-import"));
    await waitFor(() =>
      expect(screen.getAllByTestId("qo-pick")).toHaveLength(2),
    );
    // wait past the debounce window: the picker must keep both choices and no search may have been issued
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.getAllByTestId("qo-pick")).toHaveLength(2);
    expect(actions.searchQuickOrder).not.toHaveBeenCalled();
  });

  it("a one-character ambiguous parent SKU keeps its variant choices", async () => {
    const a1 = { ...variant, sku: "A-1" };
    const a2 = {
      ...variant,
      variantId: "44444444-4444-4444-8444-444444444444",
      sku: "A-2",
    };
    actions.resolveQuickOrderSkus.mockResolvedValue({
      kind: "ok",
      rows: [{ sku: "A", lines: [a1, a2] }],
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: "A 2" },
    });
    fireEvent.click(screen.getByTestId("qo-import"));
    await waitFor(() =>
      expect(screen.getAllByTestId("qo-pick")).toHaveLength(2),
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.getAllByTestId("qo-pick")).toHaveLength(2);
  });

  it("choosing a variant of an ambiguous pasted SKU keeps the quantity typed in that row", async () => {
    const blue = {
      ...variant,
      variantId: "44444444-4444-4444-8444-444444444444",
      sku: "SHIRT-BLUE",
    };
    actions.resolveQuickOrderSkus.mockResolvedValue({
      kind: "ok",
      rows: [{ sku: "SHIRT", lines: [variant, blue] }],
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: "SHIRT 12" },
    });
    fireEvent.click(screen.getByTestId("qo-import"));
    await waitFor(() =>
      expect(screen.getAllByTestId("qo-pick")).toHaveLength(2),
    );
    fireEvent.click(screen.getAllByTestId("qo-pick")[0]);
    expect((screen.getByTestId("qo-qty") as HTMLInputElement).value).toBe("12");
    // the quantity belongs to that one row: a second pick starts at 1
    fireEvent.click(screen.getAllByTestId("qo-pick")[1]);
    expect((screen.getAllByTestId("qo-qty")[1] as HTMLInputElement).value).toBe(
      "1",
    );
  });

  it("a partial import keeps only the unresolved rows in the paste box, so a retry cannot apply the good ones twice", async () => {
    actions.resolveQuickOrderSkus.mockResolvedValue({
      kind: "ok",
      rows: [
        { sku: "COF-100", lines: [line()] },
        { sku: "TYPO", lines: [] },
      ],
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: "COF-100 2\nTYPO 1" },
    });
    fireEvent.click(screen.getByTestId("qo-import"));
    await waitFor(() =>
      expect(screen.getByTestId("qo-paste-issues")).toBeTruthy(),
    );
    expect((screen.getByTestId("qo-paste") as HTMLTextAreaElement).value).toBe(
      "TYPO 1",
    );
    expect((screen.getByTestId("qo-qty") as HTMLInputElement).value).toBe("2");
  });

  it("rows that do not fit the 50-line list are reported and kept in the paste box, never dropped silently", async () => {
    const mk = (i: number) =>
      line({
        productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        sku: `S-${i}`,
      });
    const first = Array.from({ length: 49 }, (_, i) => mk(i + 1));
    actions.resolveQuickOrderSkus.mockResolvedValueOnce({
      kind: "ok",
      rows: first.map((l) => ({ sku: l.sku, lines: [l] })),
    });
    render(wrap());
    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: first.map((l) => `${l.sku} 1`).join("\n") },
    });
    fireEvent.click(screen.getByTestId("qo-import"));
    await waitFor(() =>
      expect(screen.getAllByTestId("qo-line")).toHaveLength(49),
    );

    const a = mk(100);
    const b = mk(101);
    actions.resolveQuickOrderSkus.mockResolvedValueOnce({
      kind: "ok",
      rows: [
        { sku: a.sku, lines: [a] },
        { sku: b.sku, lines: [b] },
      ],
    });
    fireEvent.change(screen.getByTestId("qo-paste"), {
      target: { value: `${a.sku} 1\n${b.sku} 1` },
    });
    fireEvent.click(screen.getByTestId("qo-import"));

    await waitFor(() =>
      expect(screen.getByTestId("qo-paste-issues")).toBeTruthy(),
    );
    expect(screen.getAllByTestId("qo-line")).toHaveLength(50);
    expect(screen.getByTestId("qo-paste-issues").textContent).toContain(
      "S-101",
    );
    expect(screen.getByTestId("qo-paste-issues").textContent).toContain(
      "maximum of 50",
    );
    expect((screen.getByTestId("qo-paste") as HTMLTextAreaElement).value).toBe(
      "S-101 1",
    );
  });

  it("submits only eligible ids, units and quantities — no price — then clears them and offers cart and checkout", async () => {
    actions.searchQuickOrder.mockResolvedValue({
      kind: "ok",
      lines: [line(), unavailable],
    });
    actions.addQuickOrderLines.mockResolvedValue({ kind: "ok" });
    render(wrap());
    await search("x1");
    const picks = await screen.findAllByTestId("qo-pick");
    fireEvent.click(picks[0]);
    fireEvent.click(picks[1]);
    fireEvent.change(screen.getAllByTestId("qo-qty")[0], {
      target: { value: "3" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("qo-submit"));
    });

    await waitFor(() => expect(screen.getByTestId("qo-added")).toBeTruthy());
    expect(actions.addQuickOrderLines).toHaveBeenCalledWith([
      { product_id: P1, unit_key: "base", quantity: 3 },
    ]);
    expect(JSON.stringify(actions.addQuickOrderLines.mock.calls)).not.toMatch(
      /price|amount/,
    );
    expect(cart.refreshCart).toHaveBeenCalled();
    expect(cart.openCart).toHaveBeenCalled();
    // the added line left the list; the unavailable one stays for review
    expect(screen.getAllByTestId("qo-line")).toHaveLength(1);
    expect(screen.getByTestId("qo-line").getAttribute("data-sku")).toBe(
      "TEA-200",
    );
    const links = within(screen.getByTestId("qo-added"))
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/sa/en/cart", "/sa/en/checkout"]);
  });

  it("while an add is in flight the submitted rows cannot be edited, removed or re-picked", async () => {
    actions.searchQuickOrder.mockResolvedValue({ kind: "ok", lines: [line()] });
    let release: (v: { kind: "ok" }) => void = () => {};
    actions.addQuickOrderLines.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(wrap());
    await search("x1");
    fireEvent.click((await screen.findAllByTestId("qo-pick"))[0]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("qo-submit"));
    });

    expect((screen.getByTestId("qo-qty") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getAllByTestId("qo-pick")[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: /remove/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await act(async () => {
      release({ kind: "ok" });
    });
    await waitFor(() => expect(screen.getByTestId("qo-added")).toBeTruthy());
  });

  it("a server rejection keeps every line, marks the failing one and says nothing was added", async () => {
    actions.searchQuickOrder.mockResolvedValue({
      kind: "ok",
      lines: [line(), variant],
    });
    actions.addQuickOrderLines.mockResolvedValue({
      kind: "rejected",
      failures: [{ index: 1, reason: "unavailable_for_wholesale" }],
    });
    render(wrap());
    await search("xx");
    const picks = await screen.findAllByTestId("qo-pick");
    fireEvent.click(picks[0]);
    fireEvent.click(picks[1]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("qo-submit"));
    });

    await waitFor(() => expect(screen.getByTestId("qo-rejected")).toBeTruthy());
    expect(screen.getByTestId("qo-rejected").textContent).toContain(
      "Nothing was added",
    );
    const rows = screen.getAllByTestId("qo-line");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-state")).toBe("ready");
    expect(rows[1].getAttribute("data-state")).toBe("rejected");
    expect(cart.openCart).not.toHaveBeenCalled();
  });

  it("an expired session or a suspended account is explained with a way forward", async () => {
    actions.searchQuickOrder.mockResolvedValue({ kind: "ok", lines: [line()] });
    actions.addQuickOrderLines.mockResolvedValue({
      kind: "not_approved",
      membership: "suspended",
    });
    render(wrap());
    await search("cof");
    fireEvent.click(await screen.findByTestId("qo-pick"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("qo-submit"));
    });
    const access = await screen.findByTestId("qo-access");
    expect(access.textContent).toContain("not approved for ordering");
    expect(within(access).getByRole("link").getAttribute("href")).toBe(
      "/sa/en/buyer/membership",
    );
  });

  it("merges the same item added twice and removes lines", async () => {
    actions.searchQuickOrder.mockResolvedValue({ kind: "ok", lines: [line()] });
    render(wrap());
    await search("cof");
    const pick = await screen.findByTestId("qo-pick");
    fireEvent.click(pick);
    fireEvent.click(pick);
    expect(screen.getAllByTestId("qo-line")).toHaveLength(1);
    expect((screen.getByTestId("qo-qty") as HTMLInputElement).value).toBe("2");
    fireEvent.click(screen.getByLabelText("Remove line"));
    expect(screen.getByTestId("qo-empty")).toBeTruthy();
  });

  it("renders in Arabic with Arabic copy, prices and the product's Arabic name", async () => {
    actions.searchQuickOrder.mockResolvedValue({ kind: "ok", lines: [line()] });
    render(wrap("ar"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "الطلب السريع",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "ابحث برمز SKU أو اسم المنتج" }),
      {
        target: { value: "قهوة" },
      },
    );
    const results = await screen.findByTestId("qo-results", undefined, {
      timeout: 2000,
    });
    expect(within(results).getByText("قهوة")).toBeTruthy();
  });
});
