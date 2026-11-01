import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

const actions = vi.hoisted(() => ({
  listAddresses: vi.fn(),
  saveAddress: vi.fn(),
  deleteAddress: vi.fn(),
}));
vi.mock("@/lib/data/customer", () => actions);

import { ACCOUNT_ADDRESSES_CAPABILITY } from "@/lib/commerce/capabilities";
import { AccountAddresses } from "../AccountAddresses";

const ID = "11111111-2222-3333-4444-555555555555";
const address = {
  id: ID,
  label: "Home",
  recipientName: "Sara",
  phone: "+966501234567",
  country: "SA",
  region: null,
  city: "Dammam",
  district: "Shati",
  street: "King Fahd Rd",
  buildingNo: "1234",
  additionalNumber: "5678",
  postalCode: "31411",
  deliveryNotes: null,
  isDefaultShipping: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  actions.listAddresses.mockResolvedValue({ kind: "ok", data: [address] });
  actions.saveAddress.mockResolvedValue({ kind: "ok", data: address });
  actions.deleteAddress.mockResolvedValue({ kind: "ok", data: true });
});

describe("AccountAddresses — live address book (B2C-ACCOUNTS)", () => {
  it("is live and shows only what the owner-scoped API returned", async () => {
    expect(ACCOUNT_ADDRESSES_CAPABILITY).toBe("live");
    render(<AccountAddresses />);
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(screen.getByText(/King Fahd Rd/)).toBeInTheDocument();
    expect(screen.getByText("defaultAddress")).toBeInTheDocument();
    expect(actions.listAddresses).toHaveBeenCalledTimes(1);
  });

  it("an empty book is an honest empty state", async () => {
    actions.listAddresses.mockResolvedValue({ kind: "ok", data: [] });
    render(<AccountAddresses />);
    expect(await screen.findByText("noAddresses")).toBeInTheDocument();
  });

  it("a failed load says so instead of showing a stale or fabricated book", async () => {
    actions.listAddresses.mockResolvedValue({ kind: "unavailable" });
    render(<AccountAddresses />);
    expect(await screen.findByText("addressLoadFailed")).toBeInTheDocument();
  });

  it("validates the Saudi digit fields locally and sends nothing when they are wrong", async () => {
    const user = userEvent.setup();
    render(<AccountAddresses />);
    await screen.findByText("Home");
    await user.click(screen.getByRole("button", { name: "addNewAddress" }));

    await user.type(screen.getByLabelText("recipientName"), "Sara");
    await user.type(screen.getByLabelText("phone"), "+966501234567");
    await user.type(screen.getByLabelText("city"), "Dammam");
    await user.type(screen.getByLabelText("district"), "Shati");
    await user.type(screen.getByLabelText("street"), "King Fahd");
    await user.type(screen.getByLabelText("buildingNo"), "12");
    await user.type(screen.getByLabelText("additionalNo"), "5678");
    await user.type(screen.getByLabelText("postalCode"), "31411");
    await user.click(screen.getByRole("button", { name: "saveAddress" }));

    expect(await screen.findAllByText("addressDigits")).not.toHaveLength(0);
    expect(actions.saveAddress).not.toHaveBeenCalled();
  });

  it("normalizes Arabic-Indic digits and saves a Saudi address with no owner field", async () => {
    const user = userEvent.setup();
    render(<AccountAddresses />);
    await screen.findByText("Home");
    await user.click(screen.getByRole("button", { name: "addNewAddress" }));

    await user.type(screen.getByLabelText("recipientName"), "Sara");
    await user.type(screen.getByLabelText("phone"), "+966501234567");
    await user.type(screen.getByLabelText("city"), "Dammam");
    await user.type(screen.getByLabelText("district"), "Shati");
    await user.type(screen.getByLabelText("street"), "King Fahd");
    await user.type(screen.getByLabelText("buildingNo"), "١٢٣٤");
    await user.type(screen.getByLabelText("additionalNo"), "٥٦٧٨");
    await user.type(screen.getByLabelText("postalCode"), "٣١٤١١");
    await user.click(screen.getByRole("button", { name: "saveAddress" }));

    await waitFor(() => expect(actions.saveAddress).toHaveBeenCalledTimes(1));
    const [input, id] = actions.saveAddress.mock.calls[0];
    expect(id).toBeUndefined();
    expect(input).toMatchObject({
      country: "SA",
      building_no: "1234",
      additional_number: "5678",
      postal_code: "31411",
    });
    expect(Object.keys(input)).not.toEqual(
      expect.arrayContaining(["customer_identity_id"]),
    );
    expect(Object.keys(input)).not.toEqual(
      expect.arrayContaining(["tenant_id"]),
    );
  });

  it("deleting needs a confirmation and only then calls the API with the row's own id", async () => {
    const user = userEvent.setup();
    render(<AccountAddresses />);
    await screen.findByText("Home");

    await user.click(screen.getByRole("button", { name: "delete" }));
    expect(actions.deleteAddress).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "confirmDelete" }));
    await waitFor(() => expect(actions.deleteAddress).toHaveBeenCalledWith(ID));
  });

  it("editing an address and emptying optional fields submits the cleared values (not an omission)", async () => {
    actions.listAddresses.mockResolvedValue({
      kind: "ok",
      data: [{ ...address, label: "Home", deliveryNotes: "Gate code 1234" }],
    });
    const user = userEvent.setup();
    render(<AccountAddresses />);
    await screen.findByText("Home");

    await user.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByLabelText("deliveryNotes")).toHaveValue(
      "Gate code 1234",
    );
    await user.clear(screen.getByLabelText("addressLabel"));
    await user.clear(screen.getByLabelText("deliveryNotes"));
    await user.click(screen.getByRole("button", { name: "saveAddress" }));

    await waitFor(() => expect(actions.saveAddress).toHaveBeenCalledTimes(1));
    const [input, id] = actions.saveAddress.mock.calls[0];
    expect(id).toBe(ID);
    // the editor passes the emptied optional fields through; the action layer turns them into explicit nulls
    expect(input).toMatchObject({ label: "", delivery_notes: "" });
  });
});
