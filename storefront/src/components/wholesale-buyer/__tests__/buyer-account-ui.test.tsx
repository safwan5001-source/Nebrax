import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../../../messages/ar.json";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";

const actions = vi.hoisted(() => ({
  requestBuyerPasswordReset: vi.fn(),
  resetBuyerPassword: vi.fn(),
  registerBuyer: vi.fn(),
  verifyBuyerEmail: vi.fn(),
  resendBuyerVerification: vi.fn(),
  signInBuyer: vi.fn(),
  signOutBuyer: vi.fn(),
  applyForWholesale: vi.fn(),
}));

vi.mock("@/lib/data/wholesale-buyer", () => actions);
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: "en" | "ar" | "de" }) => {
    const messages = ({ en, ar, de }[locale] ?? en).wholesaleBuyer as Record<
      string,
      unknown
    >;
    return (key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (o, k) => (o as Record<string, unknown>)[k],
          messages,
        ) as string;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sa/en/buyer/forgot-password",
  useSearchParams: () => new URLSearchParams(),
}));

import { BuyerForgotPasswordForm } from "../BuyerForgotPasswordForm";
import { BuyerMembershipPanel } from "../BuyerMembershipPanel";
import { BuyerOrderDetailView, BuyerOrdersList } from "../BuyerOrdersView";
import { BuyerResetPasswordForm } from "../BuyerResetPasswordForm";
import { CatalogAccessGate } from "../CatalogAccessGate";

const wrap = (node: React.ReactNode, messages = en) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {node}
  </NextIntlClientProvider>
);
const TOKEN = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("forgot password form", () => {
  it("shows one neutral confirmation and never says whether a mail was sent", async () => {
    actions.requestBuyerPasswordReset.mockResolvedValue({ success: true });
    render(wrap(<BuyerForgotPasswordForm />));

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "who@x.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(document.querySelector('[data-state="requested"]')).not.toBeNull(),
    );
    expect(actions.requestBuyerPasswordReset).toHaveBeenCalledWith({
      email: "who@x.test",
      basePath: "/sa/en",
    });
    expect(document.body.textContent).toContain(
      "If this address belongs to a confirmed account",
    );
  });

  it("surfaces throttling in words and keeps the form", async () => {
    actions.requestBuyerPasswordReset.mockResolvedValue({
      success: false,
      error: "rateLimited",
    });
    render(wrap(<BuyerForgotPasswordForm />));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "who@x.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(
      await screen.findByText(en.wholesaleBuyer.errors.rateLimited),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Send reset link" }),
    ).toBeTruthy();
  });
});

describe("reset password form", () => {
  it("without a valid link it offers a new one and never calls the API", () => {
    render(wrap(<BuyerResetPasswordForm token={null} />));
    expect(
      document.querySelector('[data-state="reset-failed"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Send a new reset email" }),
    ).toBeTruthy();
    expect(actions.resetBuyerPassword).not.toHaveBeenCalled();
  });

  it("validates length and confirmation locally before spending the single-use token", () => {
    render(wrap(<BuyerResetPasswordForm token={TOKEN} />));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      screen.getByText("The password must be at least 8 characters."),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "long-enough-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByText("The two passwords do not match.")).toBeTruthy();
    expect(actions.resetBuyerPassword).not.toHaveBeenCalled();
  });

  it("sends only the token and the new password, then points to sign-in", async () => {
    actions.resetBuyerPassword.mockResolvedValue({ success: true });
    render(wrap(<BuyerResetPasswordForm token={TOKEN} />));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "long-enough-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "long-enough-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(
        document.querySelector('[data-state="reset-done"]'),
      ).not.toBeNull(),
    );
    expect(actions.resetBuyerPassword).toHaveBeenCalledWith({
      token: TOKEN,
      password: "long-enough-1",
    });
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it("any server refusal is one generic failure with a way to request a new link", async () => {
    actions.resetBuyerPassword.mockResolvedValue({
      success: false,
      error: "validation",
    });
    render(wrap(<BuyerResetPasswordForm token={TOKEN} />));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "long-enough-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "long-enough-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() =>
      expect(
        document.querySelector('[data-state="reset-failed"]'),
      ).not.toBeNull(),
    );
    expect(document.body.textContent).toContain(
      "invalid, expired, or already used",
    );
  });
});

describe("membership application", () => {
  it("offers optional company and phone, sends them, and nothing that sets pricing or partner", async () => {
    actions.applyForWholesale.mockResolvedValue({ success: true });
    render(
      wrap(
        <BuyerMembershipPanel
          state="no_application"
          displayName="Najd"
          basePath="/sa/en"
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Company name (optional)"), {
      target: { value: "Horizon Co" },
    });
    fireEvent.change(screen.getByLabelText("Contact phone (optional)"), {
      target: { value: "+966501234567" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: en.wholesaleBuyer.membership.apply }),
    );

    await waitFor(() =>
      expect(actions.applyForWholesale).toHaveBeenCalledWith({
        companyName: "Horizon Co",
        contactPhone: "+966501234567",
      }),
    );
    expect(screen.getByText(/does not change your prices/)).toBeTruthy();
  });

  it("an approved buyer sees the order history link; others never do", () => {
    const { unmount } = render(
      wrap(
        <BuyerMembershipPanel
          state="approved"
          displayName="Najd"
          basePath="/sa/en"
        />,
      ),
    );
    expect(
      screen.getByRole("link", { name: "My orders" }).getAttribute("href"),
    ).toBe("/sa/en/buyer/orders");
    unmount();

    for (const state of [
      "pending",
      "rejected",
      "suspended",
      "no_application",
      "signed_out",
    ] as const) {
      const view = render(
        wrap(
          <BuyerMembershipPanel
            state={state}
            displayName={null}
            basePath="/sa/en"
          />,
        ),
      );
      expect(screen.queryByRole("link", { name: "My orders" })).toBeNull();
      view.unmount();
    }
  });
});

describe("access gate wording tells the truth about the buyer's own state", () => {
  it.each([
    ["suspended", "Your wholesale account is suspended"],
    ["rejected", "Your application was not approved"],
    ["pending", "Your application is under review"],
    ["none", "Apply for wholesale access"],
  ] as const)("%s", async (membership, title) => {
    render(
      await CatalogAccessGate({
        gate: "approval_required",
        membership,
        basePath: "/sa/en",
        locale: "en" as Locale,
      }),
    );
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "has not been approved yet",
    );
  });

  it("without a reported state it keeps the generic wording, and sign-in is unaffected", async () => {
    const { unmount } = render(
      await CatalogAccessGate({
        gate: "approval_required",
        basePath: "/sa/en",
        locale: "en" as Locale,
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: en.wholesaleBuyer.gate.approval_required.title,
      }),
    ).toBeTruthy();
    unmount();
    render(
      await CatalogAccessGate({
        gate: "sign_in_required",
        membership: "suspended",
        basePath: "/sa/en",
        locale: "en" as Locale,
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: en.wholesaleBuyer.gate.sign_in_required.title,
      }),
    ).toBeTruthy();
  });
});

const order = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  number: "CORD-2026-00001",
  status: "confirmed",
  createdAt: "2026-10-31T10:00:00+03:00",
  totalMinor: 1600,
  currency: "SAR",
  deliveryMethod: "pickup",
  cancelledAt: null,
  ...over,
});

describe("order history views", () => {
  it("lists the buyer's orders as links to their own detail pages", async () => {
    render(
      await BuyerOrdersList({
        result: {
          kind: "ok",
          data: { orders: [order() as never], page: 1, lastPage: 1 },
        },
        page: 1,
        basePath: "/sa/en",
        locale: "en" as Locale,
      }),
    );
    expect(
      screen
        .getByRole("link", { name: /CORD-2026-00001/ })
        .getAttribute("href"),
    ).toBe("/sa/en/buyer/orders/11111111-1111-4111-8111-111111111111");
    expect(document.body.textContent).toMatch(/16\.00/);
  });

  it("an empty history is an invitation, not an error", async () => {
    render(
      await BuyerOrdersList({
        result: { kind: "ok", data: { orders: [], page: 1, lastPage: 1 } },
        page: 1,
        basePath: "/sa/en",
        locale: "en" as Locale,
      }),
    );
    expect(screen.getByText("No orders yet")).toBeTruthy();
  });

  it("every refusal renders a state and never the data", async () => {
    const list = (result: never) =>
      BuyerOrdersList({
        result,
        page: 1,
        basePath: "/sa/en",
        locale: "en" as Locale,
      });

    const { unmount: u1 } = render(await list({ kind: "signed_out" } as never));
    expect(
      document.querySelector('[data-gate="sign_in_required"]'),
    ).not.toBeNull();
    u1();
    const { unmount: u2 } = render(
      await list({ kind: "not_approved", membership: "suspended" } as never),
    );
    expect(
      screen.getByRole("heading", {
        name: "Your wholesale account is suspended",
      }),
    ).toBeTruthy();
    u2();
    render(await list({ kind: "unavailable" } as never));
    expect(
      document.querySelector('[data-state="orders-unavailable"]'),
    ).not.toBeNull();
  });

  it("the detail shows lines and totals, and a missing or foreign order is one not-found state", async () => {
    const { unmount } = render(
      await BuyerOrderDetailView({
        result: {
          kind: "ok",
          data: order({
            lines: [
              {
                name: "صنف جملة",
                unitName: "piece",
                quantity: 2,
                unitPriceMinor: 500,
                lineTotalMinor: 1000,
              },
            ],
            deliveryAmountMinor: 0,
            deliveryAddress: "الدمام",
            paymentMethodName: null,
            paymentStatus: null,
          }) as never,
        },
        basePath: "/sa/en",
        locale: "en" as Locale,
      }),
    );
    expect(document.body.textContent).toContain("صنف جملة");
    expect(document.body.textContent).toMatch(/2 × .*5\.00/);
    expect(document.body.textContent).toContain(
      "No payment is taken on this page",
    );
    unmount();

    render(
      await BuyerOrderDetailView({
        result: { kind: "not_found" },
        basePath: "/sa/en",
        locale: "en" as Locale,
      }),
    );
    expect(
      document.querySelector('[data-state="order-not-found"]'),
    ).not.toBeNull();
  });
});

describe("new copy exists in every checked locale", () => {
  it("ar and de carry the account strings", () => {
    for (const messages of [ar, de]) {
      const wb = messages.wholesaleBuyer as Record<
        string,
        Record<string, unknown>
      >;
      expect(wb.orders.title).toBeTruthy();
      expect(wb.forgot.title).toBeTruthy();
      expect(wb.reset.title).toBeTruthy();
      expect(
        (wb.gate.membership as Record<string, unknown>).suspended,
      ).toBeTruthy();
    }
  });
});
