import { describe, expect, it } from "vitest";
import { addressBody } from "@/lib/commerce/account";

/**
 * Codex P2 (PR #1860): a partial address update must be able to CLEAR an optional field. A blank required field is simply
 * omitted (the API keeps its value); a blank optional field is an explicit `null`, which the API's `nullable` rules persist.
 */
describe("addressBody", () => {
  const required = {
    recipient_name: "Sara",
    phone: "+966501234567",
    country: "sa",
    city: "Dammam",
    street: "King Fahd Rd",
  };

  it("sends an explicit null for every emptied optional field", () => {
    const body = addressBody({
      ...required,
      label: "",
      region: " ",
      district: "",
      building_no: "",
      additional_number: "",
      postal_code: "",
      delivery_notes: "   ",
    });
    expect(body).toMatchObject({
      label: null,
      region: null,
      district: null,
      building_no: null,
      additional_number: null,
      postal_code: null,
      delivery_notes: null,
    });
  });

  it("omits (never nulls) a blank REQUIRED field, so it can not be wiped by accident", () => {
    const body = addressBody({
      ...required,
      recipient_name: "",
      city: " ",
      street: "",
    });
    expect(body).not.toHaveProperty("recipient_name");
    expect(body).not.toHaveProperty("city");
    expect(body).not.toHaveProperty("street");
    expect(body.phone).toBe("+966501234567");
  });

  it("keeps non-empty values trimmed, upper-cases the country and passes booleans through", () => {
    expect(
      addressBody({ ...required, label: " Home ", is_default_shipping: false }),
    ).toMatchObject({
      label: "Home",
      country: "SA",
      is_default_shipping: false,
    });
  });

  it("does not invent keys that were never provided (an untouched optional field stays out of the PATCH)", () => {
    const body = addressBody({ ...required });
    for (const key of ["label", "region", "district", "delivery_notes"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("drops unknown / owner keys entirely", () => {
    const body = addressBody({
      ...required,
      ...({ customer_identity_id: "x", tenant_id: "y" } as object),
    });
    expect(body).not.toHaveProperty("customer_identity_id");
    expect(body).not.toHaveProperty("tenant_id");
  });
});
