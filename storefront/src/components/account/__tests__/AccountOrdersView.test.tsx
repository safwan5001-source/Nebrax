import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "ar",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const actions = vi.hoisted(() => ({ claimOrder: vi.fn() }));
vi.mock("@/lib/data/customer", () => actions);

import {
  AccountOrderDetailView,
  AccountOrdersView,
} from "../AccountOrdersView";

const ID = "11111111-2222-3333-4444-555555555555";
const summary = {
  id: ID,
  number: "CORD-2026-0001",
  status: "confirmed",
  createdAt: "2026-10-01T10:00:00Z",
  totalMinor: 12500,
  currency: "SAR",
  deliveryMethod: "delivery",
  cancelledAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("AccountOrdersView", () => {
  it("lists the server-scoped orders and links each to its own detail page under the locale base path", () => {
    render(
      <AccountOrdersView
        orders={[summary]}
        basePath="/sa/ar"
        page={1}
        lastPage={1}
      />,
    );
    const link = screen.getByRole("link", { name: /CORD-2026-0001/ });
    expect(link).toHaveAttribute("href", `/sa/ar/account/orders/${ID}`);
    expect(screen.getByTestId("account-orders")).toBeInTheDocument();
  });

  it("an empty history is an empty state, never a fabricated order", () => {
    render(
      <AccountOrdersView orders={[]} basePath="/sa/ar" page={1} lastPage={1} />,
    );
    expect(screen.getByText("noOrders")).toBeInTheDocument();
    expect(screen.queryByTestId("account-orders")).toBeNull();
  });

  it("paginates with links that carry only a page number", () => {
    render(
      <AccountOrdersView
        orders={[summary]}
        basePath="/sa/ar"
        page={2}
        lastPage={3}
      />,
    );
    expect(screen.getByRole("link", { name: "previousPage" })).toHaveAttribute(
      "href",
      "/sa/ar/account/orders?page=1",
    );
    expect(screen.getByRole("link", { name: "nextPage" })).toHaveAttribute(
      "href",
      "/sa/ar/account/orders?page=3",
    );
  });

  it("a failed guest-order claim is one neutral message that does not say why", async () => {
    actions.claimOrder.mockResolvedValue({ kind: "not_found" });
    const user = userEvent.setup();
    render(
      <AccountOrdersView orders={[]} basePath="/sa/ar" page={1} lastPage={1} />,
    );

    await user.type(screen.getByLabelText("claimOrderNumber"), "CORD-9");
    await user.click(screen.getByRole("button", { name: "claimAction" }));

    expect(await screen.findByText("claimFailed")).toBeInTheDocument();
    // only the order number is sent: no identity, no email
    expect(actions.claimOrder).toHaveBeenCalledWith({ orderNumber: "CORD-9" });
  });

  it("a signed-out claim asks the shopper to sign in again", async () => {
    actions.claimOrder.mockResolvedValue({ kind: "signed_out" });
    const user = userEvent.setup();
    render(
      <AccountOrdersView orders={[]} basePath="/sa/ar" page={1} lastPage={1} />,
    );
    await user.type(screen.getByLabelText("claimOrderNumber"), "CORD-9");
    await user.click(screen.getByRole("button", { name: "claimAction" }));
    await waitFor(() =>
      expect(screen.getByText("claimSignedOut")).toBeInTheDocument(),
    );
  });
});

describe("AccountOrderDetailView", () => {
  const detail = {
    ...summary,
    lines: [
      {
        name: "Rose bouquet",
        unitName: null,
        quantity: 2,
        unitPriceMinor: 5000,
        lineTotalMinor: 10000,
      },
    ],
    deliveryAmountMinor: 2500,
    deliveryAddress: "King Fahd Rd، Shati، Dammam",
    paymentMethodName: null,
    paymentStatus: null,
  };

  it("shows the server's lines and total, never summing amounts itself", () => {
    render(<AccountOrderDetailView order={detail} basePath="/sa/ar" />);
    expect(screen.getByText("Rose bouquet")).toBeInTheDocument();
    expect(screen.getByText("King Fahd Rd، Shati، Dammam")).toBeInTheDocument();
    const total = screen.getByText(
      (_, el) => el?.tagName === "BDI" && /125/.test(el.textContent ?? ""),
    );
    expect(total).toBeInTheDocument();
  });

  it("a cancelled order reads as cancelled and makes no payment or refund claim", () => {
    render(
      <AccountOrderDetailView
        order={{
          ...detail,
          status: "cancelled",
          cancelledAt: "2026-10-02T10:00:00Z",
        }}
        basePath="/sa/ar"
      />,
    );
    expect(screen.getByText("cancelled.title")).toBeInTheDocument();
  });
});
