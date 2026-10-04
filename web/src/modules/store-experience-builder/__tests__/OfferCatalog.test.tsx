/**
 * @vitest-environment jsdom
 *
 * CUST-H4-7b — merchant CRUD over the configured Offers catalog, inside the
 * Offers section's Content panel (list + one inline form + inline delete
 * confirmation). `ControlPanels` stays presentational: the mutation actions are
 * injected (`OfferManagement`); reconciliation of the shared state is covered
 * by `ExperienceBuilder.offers-crud.test.tsx`.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import type { OfferManagement } from "../offers-management";
import { CUSTOMIZER_MESSAGES } from "../messages";
import type {
  WorkspaceOffer,
  WorkspaceOfferMutationFailure,
} from "@/modules/commerce-workspace/workspace-offers";
import type { WorkspaceProductSummary } from "@/modules/commerce-workspace/workspace-products";
import { hiddenOffer, liveOffer } from "./offers-fixtures";

const ar = CUSTOMIZER_MESSAGES.ar;

function product(overrides: Partial<WorkspaceProductSummary> = {}): WorkspaceProductSummary {
  return {
    id: "prod-1",
    name: "منتج أول",
    nameEn: "First product",
    thumbnailUrl: "https://cdn.example.test/p1.jpg",
    isVariantManaged: false,
    ...overrides,
  };
}

function failure(
  reason: WorkspaceOfferMutationFailure["reason"],
  extra: Partial<WorkspaceOfferMutationFailure> = {},
): WorkspaceOfferMutationFailure {
  return { ok: false, reason, message: "server message", fieldErrors: {}, ...extra };
}

function makeManagement(overrides: Partial<OfferManagement> = {}) {
  const management: OfferManagement = {
    maxOffers: 12,
    searchProducts: vi.fn(async () => ({
      ok: true as const,
      data: [product(), product({ id: "prod-2", name: "منتج ثانٍ", thumbnailUrl: null })],
      hasMore: false,
    })),
    create: vi.fn(async () => ({ ok: true as const, data: liveOffer({ id: "new" }) })),
    update: vi.fn(async () => ({ ok: true as const, data: liveOffer() })),
    remove: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
  return management;
}

function config(): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [{ id: "offers-1", type: "offers", visible: true }],
    },
  };
}

function renderPanel(options: {
  offers?: WorkspaceOffer[];
  management?: OfferManagement | null;
  locale?: "ar" | "en";
  state?: "idle" | "loading" | "error" | "ready";
}) {
  const management = options.management === null ? undefined : (options.management ?? makeManagement());
  render(
    <ControlPanels
      panel="homepage"
      config={config()}
      locale={options.locale ?? "ar"}
      liveStoreName={null}
      onChange={() => {}}
      selectedSection="offers-1"
      offers={options.offers ?? []}
      offersState={options.state ?? "ready"}
      offerManagement={management}
    />,
  );
  return { management };
}

const q = (selector: string) => document.querySelector(selector) as HTMLElement;

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  const button = q("[data-offer-add]") ?? q("[data-offer-create-empty]");
  await user.click(button);
  await waitFor(() => expect(q('[data-offer-form="create"]')).not.toBeNull());
}

async function pickProduct(user: ReturnType<typeof userEvent.setup>, id = "prod-1") {
  await waitFor(() => expect(q(`[data-offer-product-option="${id}"]`)).not.toBeNull());
  await user.click(q(`[data-offer-product-option="${id}"]`));
}

describe("Offers catalog CRUD UI — CUST-H4-7b", () => {
  afterEach(() => cleanup());

  describe("empty state and entry points", () => {
    it("an empty catalog offers a 'Create offer' action instead of a dead end", async () => {
      const user = userEvent.setup();
      renderPanel({ offers: [] });
      const empty = q("[data-offers-picker-empty]");
      expect(empty.textContent).toContain("لا عروض مهيّأة");
      const action = within(empty).getByRole("button", { name: ar.offersCreateAction });
      await user.click(action);
      expect(q('[data-offer-form="create"]')).not.toBeNull();
    });

    it("without management actions (local-only editor) no create/edit/delete control is rendered", () => {
      renderPanel({ offers: [liveOffer()], management: null });
      expect(q("[data-offer-add]")).toBeNull();
      expect(q("[data-offer-edit]")).toBeNull();
      expect(q("[data-offer-delete]")).toBeNull();
      cleanup();
      renderPanel({ offers: [], management: null });
      expect(q("[data-offer-create-empty]")).toBeNull();
    });

    it("shows 'Add offer' above a populated list, and edit/delete buttons that name the product", () => {
      renderPanel({ offers: [liveOffer({ id: "o1" })] });
      expect(screen.getByRole("button", { name: /إضافة عرض/ })).not.toBeNull();
      expect(screen.getByRole("button", { name: `${ar.offersEditAria}: هاتف ذكي` })).not.toBeNull();
      expect(screen.getByRole("button", { name: `${ar.offersDeleteAria}: هاتف ذكي` })).not.toBeNull();
    });

    it("keeps hidden reasons and the configured window visible on each row (text, not colour)", () => {
      renderPanel({
        offers: [
          hiddenOffer("scheduled", {
            id: "h1",
            startsAt: "2030-01-01T09:00:00.000Z",
            endsAt: "2030-02-01T09:00:00.000Z",
          }),
        ],
      });
      const row = q('[data-offers-option="h1"]');
      expect(row.textContent).toContain("غير ظاهر");
      expect(row.textContent).toContain(ar.offersReason_scheduled);
      expect(row.querySelector("[data-offer-window]")?.textContent).toContain(ar.offersWindowFrom);
      expect(row.querySelector("[data-offer-window]")?.textContent).toContain(ar.offersWindowTo);
    });
  });

  describe("max configured offers", () => {
    it("disables 'Add offer' at the server cap and says why", () => {
      const offers = Array.from({ length: 12 }, (_, i) => liveOffer({ id: `o${i}` }));
      renderPanel({ offers, management: makeManagement({ maxOffers: 12 }) });
      const add = q("[data-offer-add]") as HTMLButtonElement;
      expect(add.disabled).toBe(true);
      expect(q("[data-offers-cap]").textContent).toContain("12");
      expect(add.getAttribute("aria-describedby")).toBeTruthy();
    });

    it("keeps 'Add offer' enabled below the cap", () => {
      renderPanel({ offers: [liveOffer()], management: makeManagement({ maxOffers: 12 }) });
      expect((q("[data-offer-add]") as HTMLButtonElement).disabled).toBe(false);
      expect(q("[data-offers-cap]")).toBeNull();
    });
  });

  describe("create form", () => {
    it("labels every field and states the price boundary (no price/discount/stock/tax/price-list field exists)", async () => {
      const user = userEvent.setup();
      renderPanel({ offers: [] });
      await openCreate(user);
      const form = q('[data-offer-form="create"]');
      expect(within(form).getByLabelText(ar.offerFormProductSearch)).not.toBeNull();
      expect(within(form).getByLabelText(ar.offerFormActive)).not.toBeNull();
      expect(within(form).getByLabelText(ar.offerFormStarts)).not.toBeNull();
      expect(within(form).getByLabelText(ar.offerFormEnds)).not.toBeNull();
      expect(within(form).getByLabelText(ar.offerFormPosition)).not.toBeNull();
      expect(form.textContent).toContain(ar.offerFormPriceNote);
      // The form's accessible name is its title.
      expect(screen.getByRole("form", { name: ar.offerFormCreateTitle })).not.toBeNull();
      // Nothing price-shaped can be typed.
      const names = Array.from(form.querySelectorAll("input")).map((i) => `${i.name}${i.id}${i.getAttribute("data-offer-position") ?? ""}`);
      expect(names.join(" ")).not.toMatch(/price|discount|percent|saving|tax|stock|list/i);
    });

    it("loads real products from the injected workspace source and shows name + image/fallback", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await waitFor(() => expect(q('[data-offer-product-option="prod-1"]')).not.toBeNull());
      expect(management!.searchProducts).toHaveBeenCalledWith("", expect.any(AbortSignal));
      expect(q('[data-offer-product-option="prod-1"]').textContent).toContain("منتج أول");
      expect(q('[data-offer-product-option="prod-1"] img')?.getAttribute("src")).toBe("https://cdn.example.test/p1.jpg");
      expect(q('[data-offer-product-option="prod-2"] img')).toBeNull(); // honest fallback, no invented image
      // No raw id input anywhere.
      expect(screen.queryByLabelText(/معرّف المنتج|product id/i)).toBeNull();
    });

    it("searching passes the typed text to the product source", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await user.type(screen.getByLabelText(ar.offerFormProductSearch), "خوذة");
      await waitFor(() => expect(management!.searchProducts).toHaveBeenLastCalledWith("خوذة", expect.any(AbortSignal)));
    });

    it("shows loading, empty and error+retry states for the product list", async () => {
      const user = userEvent.setup();
      let calls = 0;
      const searchProducts = vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? { ok: false as const, reason: "failed" as const, message: "x" }
          : { ok: true as const, data: [], hasMore: false };
      });
      renderPanel({ offers: [], management: makeManagement({ searchProducts }) });
      await openCreate(user);
      await waitFor(() => expect(q("[data-offer-product-error]")).not.toBeNull());
      await user.click(within(q("[data-offer-product-error]")).getByRole("button", { name: "إعادة المحاولة" }));
      await waitFor(() => expect(q("[data-offer-product-empty]")).not.toBeNull());
    });

    it("variant-managed products are unavailable (disabled, with the reason) — no variant pricing invented", async () => {
      const user = userEvent.setup();
      renderPanel({
        offers: [],
        management: makeManagement({
          searchProducts: vi.fn(async () => ({
            ok: true as const,
            hasMore: false,
            data: [product({ id: "v1", name: "قميص بخيارات", isVariantManaged: true })],
          })),
        }),
      });
      await openCreate(user);
      await waitFor(() => expect(q('[data-offer-product-option="v1"]')).not.toBeNull());
      const option = q('[data-offer-product-option="v1"]') as HTMLButtonElement;
      expect(option.disabled).toBe(true);
      expect(option.textContent).toContain(ar.offerFormProductVariant);
    });

    it("a product that already has an offer is disabled with a reason (basic UX guard; the server still decides)", async () => {
      const user = userEvent.setup();
      renderPanel({
        offers: [liveOffer({ id: "o1", productId: "prod-1" })],
      });
      await openCreate(user);
      await waitFor(() => expect(q('[data-offer-product-option="prod-1"]')).not.toBeNull());
      const taken = q('[data-offer-product-option="prod-1"]') as HTMLButtonElement;
      expect(taken.disabled).toBe(true);
      expect(taken.textContent).toContain(ar.offerFormProductTaken);
      expect((q('[data-offer-product-option="prod-2"]') as HTMLButtonElement).disabled).toBe(false);
    });

    it("requires a product before submitting (no request is sent)", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await user.click(q("[data-offer-submit]"));
      expect(management!.create).not.toHaveBeenCalled();
      expect(q('[data-offer-field-error="product_id"]').textContent).toBe(ar.offerFormProductRequired);
      expect(q("[data-offer-form-error]").getAttribute("role")).toBe("alert");
    });

    it("creates with the chosen product, active=true and no dates/position by default (server appends)", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await pickProduct(user);
      expect(q("[data-offer-selected-product]").textContent).toContain("منتج أول");
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.create).toHaveBeenCalledTimes(1));
      expect(management!.create).toHaveBeenCalledWith({ productId: "prod-1", isActive: true, position: null });
      // Back to the list on success.
      await waitFor(() => expect(q("[data-offer-form]")).toBeNull());
    });

    it("sends active=false when the toggle is off", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await pickProduct(user);
      await user.click(screen.getByLabelText(ar.offerFormActive));
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.create).toHaveBeenCalled());
      expect(management!.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });

    it("converts start/end datetimes to ISO instants; a future start and an end are sent as chosen", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await pickProduct(user);
      fireEvent.change(screen.getByLabelText(ar.offerFormStarts), { target: { value: "2030-03-01T09:00" } });
      fireEvent.change(screen.getByLabelText(ar.offerFormEnds), { target: { value: "2030-03-31T18:30" } });
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.create).toHaveBeenCalled());
      expect(management!.create).toHaveBeenCalledWith({
        productId: "prod-1",
        isActive: true,
        position: null,
        startsAt: new Date(2030, 2, 1, 9, 0).toISOString(),
        endsAt: new Date(2030, 2, 31, 18, 30).toISOString(),
      });
    });

    it("a date can be cleared with a labelled button", async () => {
      const user = userEvent.setup();
      renderPanel({ offers: [] });
      await openCreate(user);
      const starts = screen.getByLabelText(ar.offerFormStarts) as HTMLInputElement;
      fireEvent.change(starts, { target: { value: "2030-03-01T09:00" } });
      await user.click(screen.getByRole("button", { name: `${ar.offerFormClearDate}: ${ar.offerFormStarts}` }));
      expect(starts.value).toBe("");
    });

    it("sends an explicit position, and rejects non-integer / out-of-range positions client-side", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await pickProduct(user);
      const position = screen.getByLabelText(ar.offerFormPosition);
      fireEvent.change(position, { target: { value: "1.5" } });
      await user.click(q("[data-offer-submit]"));
      expect(management!.create).not.toHaveBeenCalled();
      expect(q('[data-offer-field-error="position"]').textContent).toBe(ar.offerFormPositionInvalid);
      expect(position.getAttribute("aria-invalid")).toBe("true");
      fireEvent.change(position, { target: { value: "10000" } });
      await user.click(q("[data-offer-submit]"));
      expect(management!.create).not.toHaveBeenCalled();
      fireEvent.change(position, { target: { value: "4" } });
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.create).toHaveBeenCalledWith(expect.objectContaining({ position: 4 })));
    });

    it("opening the form moves focus into it", async () => {
      const user = userEvent.setup();
      renderPanel({ offers: [] });
      await openCreate(user);
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: ar.offerFormCreateTitle }));
    });

    it("cancel and Escape close the form without any request, returning focus to the opener", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [] });
      await openCreate(user);
      await user.click(q("[data-offer-cancel]"));
      expect(q("[data-offer-form]")).toBeNull();
      await openCreate(user);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(q("[data-offer-form]")).toBeNull());
      expect(management!.create).not.toHaveBeenCalled();
    });

    it("blocks a double submit while the request is in flight", async () => {
      const user = userEvent.setup();
      let resolve: (value: Awaited<ReturnType<OfferManagement["create"]>>) => void = () => {};
      const create = vi.fn(() => new Promise<Awaited<ReturnType<OfferManagement["create"]>>>((r) => (resolve = r)));
      renderPanel({ offers: [], management: makeManagement({ create }) });
      await openCreate(user);
      await pickProduct(user);
      const submit = q("[data-offer-submit]") as HTMLButtonElement;
      await user.click(submit);
      await waitFor(() => expect(submit.disabled).toBe(true));
      expect(submit.textContent).toBe(ar.offerFormSaving);
      expect((q("[data-offer-cancel]") as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(q("[data-offer-form]"));
      expect(create).toHaveBeenCalledTimes(1);
      resolve({ ok: true, data: liveOffer({ id: "new" }) });
      await waitFor(() => expect(q("[data-offer-form]")).toBeNull());
    });
  });

  describe("server errors are shown honestly and keep the merchant's input", () => {
    async function submitWith(result: WorkspaceOfferMutationFailure) {
      const user = userEvent.setup();
      const { management } = renderPanel({
        offers: [],
        management: makeManagement({ create: vi.fn(async () => result) }),
      });
      await openCreate(user);
      await pickProduct(user);
      fireEvent.change(screen.getByLabelText(ar.offerFormEnds), { target: { value: "2030-03-31T18:30" } });
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.create).toHaveBeenCalled());
      return user;
    }

    it("409 duplicate product → the product field says so; the form stays open with its values", async () => {
      await submitWith(failure("conflict"));
      await waitFor(() => expect(q('[data-offer-field-error="product_id"]')).not.toBeNull());
      expect(q('[data-offer-field-error="product_id"]').textContent).toBe(ar.offerErrConflict);
      expect(q("[data-offer-form-error]").textContent).toBe(ar.offerErrReview);
      expect(q('[data-offer-form="create"]')).not.toBeNull();
      expect((screen.getByLabelText(ar.offerFormEnds) as HTMLInputElement).value).toBe("2030-03-31T18:30");
      expect(q("[data-offer-selected-product]").textContent).toContain("منتج أول");
      expect((q("[data-offer-submit]") as HTMLButtonElement).disabled).toBe(false);
    });

    it("422 invalid range → the server's message is shown on the end field (associated via aria-describedby)", async () => {
      await submitWith(
        failure("validation", { fieldErrors: { ends_at: "يجب أن يكون وقت النهاية بعد وقت البداية." } }),
      );
      await waitFor(() => expect(q('[data-offer-field-error="ends_at"]')).not.toBeNull());
      expect(q('[data-offer-field-error="ends_at"]').textContent).toBe("يجب أن يكون وقت النهاية بعد وقت البداية.");
      const ends = screen.getByLabelText(ar.offerFormEnds);
      expect(ends.getAttribute("aria-invalid")).toBe("true");
      expect(ends.getAttribute("aria-describedby")).toContain(q('[data-offer-field-error="ends_at"]').id);
      expect(q("[data-offer-form-error]").textContent).toBe(ar.offerErrReview);
    });

    it("422 foreign / ineligible product and the 12-offer cap surface on the product field", async () => {
      await submitWith(
        failure("validation", { fieldErrors: { product_id: "بلغ المتجر الحد الأقصى من العروض المهيَّأة (12)." } }),
      );
      await waitFor(() => expect(q('[data-offer-field-error="product_id"]')).not.toBeNull());
      expect(q('[data-offer-field-error="product_id"]').textContent).toContain("12");
    });

    it("422 without field detail falls back to the server message", async () => {
      await submitWith(failure("validation", { message: "حقل غير مسموح" }));
      await waitFor(() => expect(q("[data-offer-form-error]")).not.toBeNull());
      expect(q("[data-offer-form-error]").textContent).toBe("حقل غير مسموح");
    });

    it.each([
      ["not_found", ar.offerErrNotFound],
      ["forbidden", ar.offerErrForbidden],
      ["failed", ar.offerErrFailed],
    ] as const)("%s → a plain, localized form-level alert", async (reason, text) => {
      await submitWith(failure(reason));
      await waitFor(() => expect(q("[data-offer-form-error]")).not.toBeNull());
      expect(q("[data-offer-form-error]").textContent).toBe(text);
      expect(q("[data-offer-form-error]").getAttribute("role")).toBe("alert");
      expect(q('[data-offer-form="create"]')).not.toBeNull();
    });

    it("English UI shows English status messages", async () => {
      const user = userEvent.setup();
      renderPanel({
        offers: [],
        locale: "en",
        management: makeManagement({ create: vi.fn(async () => failure("conflict")) }),
      });
      await user.click(q("[data-offer-create-empty]"));
      await waitFor(() => expect(q('[data-offer-product-option="prod-1"]')).not.toBeNull());
      await user.click(q('[data-offer-product-option="prod-1"]'));
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(q('[data-offer-field-error="product_id"]')).not.toBeNull());
      expect(q('[data-offer-field-error="product_id"]').textContent).toBe(CUSTOMIZER_MESSAGES.en.offerErrConflict);
    });
  });

  describe("edit", () => {
    const configured = () =>
      liveOffer({
        id: "o1",
        productId: "prod-1",
        position: 3,
        startsAt: new Date(2030, 0, 10, 8, 15).toISOString(),
        endsAt: new Date(2030, 1, 20, 17, 45).toISOString(),
      });

    async function openEdit(user: ReturnType<typeof userEvent.setup>, offer = configured()) {
      const rendered = renderPanel({ offers: [offer, liveOffer({ id: "o2", productId: "prod-2" })] });
      await user.click(q('[data-offer-edit="o1"]'));
      await waitFor(() => expect(q('[data-offer-form="edit"]')).not.toBeNull());
      return rendered;
    }

    it("pre-fills product, active state, dates and position from the server row", async () => {
      const user = userEvent.setup();
      await openEdit(user);
      expect(screen.getByRole("form", { name: ar.offerFormEditTitle })).not.toBeNull();
      expect(q("[data-offer-selected-product]").textContent).toContain("هاتف ذكي");
      expect((screen.getByLabelText(ar.offerFormActive) as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText(ar.offerFormStarts) as HTMLInputElement).value).toBe("2030-01-10T08:15");
      expect((screen.getByLabelText(ar.offerFormEnds) as HTMLInputElement).value).toBe("2030-02-20T17:45");
      expect((screen.getByLabelText(ar.offerFormPosition) as HTMLInputElement).value).toBe("3");
    });

    it("toggling active sends ONLY isActive", async () => {
      const user = userEvent.setup();
      const { management } = await openEdit(user);
      await user.click(screen.getByLabelText(ar.offerFormActive));
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.update).toHaveBeenCalledTimes(1));
      expect(management!.update).toHaveBeenCalledWith("o1", { isActive: false });
      await waitFor(() => expect(q("[data-offer-form]")).toBeNull());
    });

    it("changing dates and position sends only those; clearing a date sends null", async () => {
      const user = userEvent.setup();
      const { management } = await openEdit(user);
      fireEvent.change(screen.getByLabelText(ar.offerFormStarts), { target: { value: "2030-01-12T10:00" } });
      await user.click(screen.getByRole("button", { name: `${ar.offerFormClearDate}: ${ar.offerFormEnds}` }));
      fireEvent.change(screen.getByLabelText(ar.offerFormPosition), { target: { value: "0" } });
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.update).toHaveBeenCalled());
      expect(management!.update).toHaveBeenCalledWith("o1", {
        startsAt: new Date(2030, 0, 12, 10, 0).toISOString(),
        endsAt: null,
        position: 0,
      });
    });

    it("changing the product sends productId; the current product stays pickable, others with an offer do not", async () => {
      const user = userEvent.setup();
      const { management } = await openEdit(user);
      await user.click(q("[data-offer-product-change]"));
      await waitFor(() => expect(q('[data-offer-product-option="prod-1"]')).not.toBeNull());
      expect((q('[data-offer-product-option="prod-1"]') as HTMLButtonElement).disabled).toBe(false); // own product
      expect((q('[data-offer-product-option="prod-2"]') as HTMLButtonElement).disabled).toBe(true); // o2's product
      // A third product is not in the fixture list; pick prod-1 again → no change.
      await user.click(q('[data-offer-product-option="prod-1"]'));
      await user.click(q("[data-offer-submit]"));
      // Nothing changed → no request, form closes.
      await waitFor(() => expect(q("[data-offer-form]")).toBeNull());
      expect(management!.update).not.toHaveBeenCalled();
    });

    it("picking a different eligible product sends productId", async () => {
      const user = userEvent.setup();
      const management = makeManagement({
        searchProducts: vi.fn(async () => ({
          ok: true as const,
          hasMore: false,
          data: [product({ id: "prod-9", name: "منتج تاسع" })],
        })),
      });
      renderPanel({ offers: [configured()], management });
      await user.click(q('[data-offer-edit="o1"]'));
      await user.click(q("[data-offer-product-change]"));
      await waitFor(() => expect(q('[data-offer-product-option="prod-9"]')).not.toBeNull());
      await user.click(q('[data-offer-product-option="prod-9"]'));
      expect(q("[data-offer-selected-product]").textContent).toContain("منتج تاسع");
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management.update).toHaveBeenCalledWith("o1", { productId: "prod-9" }));
    });

    it("an unchanged edit closes without any request", async () => {
      const user = userEvent.setup();
      const { management } = await openEdit(user);
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(q("[data-offer-form]")).toBeNull());
      expect(management!.update).not.toHaveBeenCalled();
    });

    it("update errors (409 / 422 invalid range) are shown and the form stays open", async () => {
      const user = userEvent.setup();
      const update = vi
        .fn<OfferManagement["update"]>()
        .mockResolvedValueOnce(failure("conflict"))
        .mockResolvedValueOnce(failure("validation", { fieldErrors: { ends_at: "نافذة غير صالحة" } }));
      renderPanel({ offers: [configured()], management: makeManagement({ update }) });
      await user.click(q('[data-offer-edit="o1"]'));
      await user.click(screen.getByLabelText(ar.offerFormActive));
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(q('[data-offer-field-error="product_id"]')).not.toBeNull());
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(q('[data-offer-field-error="ends_at"]')).not.toBeNull());
      expect(q('[data-offer-field-error="ends_at"]').textContent).toBe("نافذة غير صالحة");
      expect(q('[data-offer-form="edit"]')).not.toBeNull();
    });

    it("an offer whose product was deleted can still be edited without inventing a name", async () => {
      const user = userEvent.setup();
      const { management } = await openEdit(
        user,
        hiddenOffer("product_unavailable", { id: "o1", productId: "gone", product: null, position: 1 }),
      );
      expect(q("[data-offer-selected-product]").textContent).toContain(ar.offersUnavailable);
      await user.click(screen.getByLabelText(ar.offerFormActive));
      await user.click(q("[data-offer-submit]"));
      await waitFor(() => expect(management!.update).toHaveBeenCalledWith("o1", { isActive: false }));
    });
  });

  describe("delete", () => {
    it("asks for an inline confirmation (alertdialog) with Cancel focused; nothing is deleted yet", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [liveOffer({ id: "o1" })] });
      await user.click(q('[data-offer-delete="o1"]'));
      const dialog = screen.getByRole("alertdialog", { name: ar.offerDeleteTitle });
      expect(dialog.textContent).toContain("هاتف ذكي");
      expect(dialog.textContent).toContain(ar.offerDeleteBody);
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: ar.offerFormCancel }));
      expect(management!.remove).not.toHaveBeenCalled();
    });

    it("Cancel and Escape dismiss the confirmation and return focus to the delete button", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [liveOffer({ id: "o1" })] });
      await user.click(q('[data-offer-delete="o1"]'));
      await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: ar.offerFormCancel }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(document.activeElement).toBe(q('[data-offer-delete="o1"]'));
      await user.click(q('[data-offer-delete="o1"]'));
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(management!.remove).not.toHaveBeenCalled();
    });

    it("confirming deletes exactly that offer", async () => {
      const user = userEvent.setup();
      const { management } = renderPanel({ offers: [liveOffer({ id: "o1" }), liveOffer({ id: "o2" })] });
      await user.click(q('[data-offer-delete="o2"]'));
      await user.click(q("[data-offer-delete-confirm-button]"));
      await waitFor(() => expect(management!.remove).toHaveBeenCalledWith("o2"));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("a failed delete keeps the confirmation open with an alert and lets the merchant retry", async () => {
      const user = userEvent.setup();
      const remove = vi
        .fn<OfferManagement["remove"]>()
        .mockResolvedValueOnce(failure("failed"))
        .mockResolvedValueOnce({ ok: true });
      renderPanel({ offers: [liveOffer({ id: "o1" })], management: makeManagement({ remove }) });
      await user.click(q('[data-offer-delete="o1"]'));
      await user.click(q("[data-offer-delete-confirm-button]"));
      await waitFor(() => expect(q("[data-offer-delete-error]")).not.toBeNull());
      expect(q("[data-offer-delete-error]").textContent).toBe(ar.offerErrFailed);
      expect(q("[data-offer-delete-error]").getAttribute("role")).toBe("alert");
      expect(screen.getByRole("alertdialog")).not.toBeNull();
      await user.click(q("[data-offer-delete-confirm-button]"));
      await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("a forbidden delete says so", async () => {
      const user = userEvent.setup();
      renderPanel({
        offers: [liveOffer({ id: "o1" })],
        management: makeManagement({ remove: vi.fn(async () => failure("forbidden")) }),
      });
      await user.click(q('[data-offer-delete="o1"]'));
      await user.click(q("[data-offer-delete-confirm-button]"));
      await waitFor(() => expect(q("[data-offer-delete-error]")).not.toBeNull());
      expect(q("[data-offer-delete-error]").textContent).toBe(ar.offerErrForbidden);
    });

    it("blocks a double confirm while the delete is in flight", async () => {
      const user = userEvent.setup();
      let resolve: (value: Awaited<ReturnType<OfferManagement["remove"]>>) => void = () => {};
      const remove = vi.fn(() => new Promise<Awaited<ReturnType<OfferManagement["remove"]>>>((r) => (resolve = r)));
      renderPanel({ offers: [liveOffer({ id: "o1" })], management: makeManagement({ remove }) });
      await user.click(q('[data-offer-delete="o1"]'));
      const confirm = q("[data-offer-delete-confirm-button]") as HTMLButtonElement;
      await user.click(confirm);
      await waitFor(() => expect(confirm.disabled).toBe(true));
      expect(confirm.textContent).toBe(ar.offerDeleting);
      fireEvent.click(confirm);
      expect(remove).toHaveBeenCalledTimes(1);
      resolve({ ok: true });
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });
  });
});
