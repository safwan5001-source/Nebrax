import { describe, expect, it } from "vitest";
import ar from "../../../../messages/ar.json";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import fr from "../../../../messages/fr.json";
import pl from "../../../../messages/pl.json";
import { type AwjOrder, mapAwjOrderToViewModel } from "../checkout-types";

const base = (over: Partial<AwjOrder> = {}): AwjOrder => ({
  id: "o1",
  number: "ORD-1",
  status: "confirmed",
  delivery_method: "delivery",
  total: { amount_minor: 10000, currency: "SAR" },
  contact: { name: "A", phone: null, email: null },
  delivery: {
    country: null,
    city: null,
    district: null,
    street: null,
    postal_code: null,
    notes: null,
  },
  payment: { method: "cod", status: "cancelled", payment_method_name: null },
  items: [],
  created_at: "2026-05-01T00:00:00+00:00",
  ...over,
});

describe("order mapper — cancelled contract (O3c)", () => {
  it("maps a cancelled order with its timestamp", () => {
    const view = mapAwjOrderToViewModel(
      base({
        status: "cancelled",
        cancellation: { cancelled_at: "2026-05-03T10:00:00+00:00" },
      }),
    );
    expect(view.status).toBe("cancelled");
    expect(view.cancelledAt).toBe("2026-05-03T10:00:00+00:00");
    expect(view.total.amount_minor).toBe(10000);
  });

  it("tolerates a cancelled order missing the optional cancellation block", () => {
    const view = mapAwjOrderToViewModel(base({ status: "cancelled" }));
    expect(view.status).toBe("cancelled");
    expect(view.cancelledAt).toBeNull();
  });

  it("leaves non-cancelled payloads byte-identical (no cancelledAt key)", () => {
    const view = mapAwjOrderToViewModel(base());
    expect("cancelledAt" in view).toBe(false);
    expect(view.status).toBe("confirmed");
  });

  it("ignores any stray cancellation block on a non-cancelled order", () => {
    const view = mapAwjOrderToViewModel(
      base({ cancellation: { cancelled_at: "2026-05-03T10:00:00+00:00" } }),
    );
    expect("cancelledAt" in view).toBe(false);
  });
});

describe("cancelled order messages — locale parity (O3c)", () => {
  const locales = { ar, de, en, es, fr, pl } as const;
  for (const [name, m] of Object.entries(locales)) {
    it(`${name} defines every cancelled key, with the {date} placeholder`, () => {
      const o = m.orders;
      expect(o.statusCancelled.length).toBeGreaterThan(0);
      expect(o.cancelled.title.length).toBeGreaterThan(0);
      expect(o.cancelled.body).toContain("{date}");
      expect(o.cancelled.bodyNoDate).not.toContain("{date}");
      expect(o.cancelled.detail.length).toBeGreaterThan(0);
    });
  }
});
