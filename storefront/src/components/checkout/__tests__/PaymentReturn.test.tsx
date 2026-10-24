import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentReturn } from "@/components/checkout/awj/PaymentReturn";
import type { AwjOnlinePayment } from "@/lib/commerce/online-payment";
import {
  readPendingOnlinePayment,
  savePendingOnlinePayment,
} from "@/lib/commerce/pending-online-payment";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.amount ? `${key}|${values.amount}` : key,
}));

const status = vi.fn();
const start = vi.fn();
vi.mock("@/lib/data/awj-online-payment", () => ({
  getOnlinePaymentStatusAction: (...args: unknown[]) => status(...args),
  startOnlinePaymentAction: (...args: unknown[]) => start(...args),
}));

const payment = (over: Partial<AwjOnlinePayment>): AwjOnlinePayment => ({
  status: "pending",
  can_retry: false,
  amount: { amount_minor: 5000, currency: "SAR" },
  paid_at: null,
  expires_at: null,
  checkout_url: null,
  ...over,
});
const ok = (p: AwjOnlinePayment) => ({ success: true as const, payment: p });

const assign = vi.fn();

describe("PaymentReturn", () => {
  beforeEach(() => {
    window.localStorage.clear();
    status.mockReset();
    start.mockReset();
    assign.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
        search: "",
        pathname: "/sa/ar/checkout/payment-return",
      },
    });
    savePendingOnlinePayment({
      orderId: "o-1",
      orderReference: "ref-1",
      orderNumber: "CORD-1",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says honestly it cannot identify the order when this device holds none — and never calls the API", async () => {
    window.localStorage.clear();
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("unknownTitle")).toBeInTheDocument();
    expect(status).not.toHaveBeenCalled();
  });

  it("shows paid only when the server says paid, and forgets the order reference afterwards", async () => {
    status.mockResolvedValue(
      ok(payment({ status: "paid", paid_at: "2026-10-24T10:00:00Z" })),
    );
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("paidTitle")).toBeInTheDocument();
    expect(status).toHaveBeenCalledWith("o-1", "ref-1");
    expect(readPendingOnlinePayment()).toBeNull();
  });

  it("never trusts the address bar: a ?status=paid from the provider changes nothing", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
        search: "?status=paid&id=x&message=ok",
        pathname: "/x",
      },
    });
    status.mockResolvedValue(
      ok(payment({ status: "failed", can_retry: true })),
    );
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("failedTitle")).toBeInTheDocument();
    expect(screen.queryByText("paidTitle")).toBeNull();
  });

  it("a pending payment is polled, not declared paid, and offers to reopen the provider page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    status
      .mockResolvedValueOnce(
        ok(
          payment({
            status: "pending",
            checkout_url: "https://pay.example/p/1",
          }),
        ),
      )
      .mockResolvedValueOnce(ok(payment({ status: "paid" })));
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("pendingTitle")).toBeInTheDocument();
    expect(screen.queryByText("paidTitle")).toBeNull();
    fireEvent.click(screen.getByText("reopenPayment"));
    expect(assign).toHaveBeenCalledWith("https://pay.example/p/1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(await screen.findByText("paidTitle")).toBeInTheDocument();
  });

  it("only follows an https provider address handed back by the server", async () => {
    status.mockResolvedValue(
      ok(payment({ status: "pending", checkout_url: "javascript:alert(1)" })),
    );
    render(<PaymentReturn basePath="/sa/ar" />);
    await screen.findByText("pendingTitle");
    expect(screen.queryByText("reopenPayment")).toBeNull();
  });

  it("under review is neither paid nor failed and offers no retry", async () => {
    status.mockResolvedValue(ok(payment({ status: "under_review" })));
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("reviewTitle")).toBeInTheDocument();
    expect(screen.queryByText("tryAgain")).toBeNull();
    expect(screen.queryByText("payNow")).toBeNull();
  });

  it("a failed attempt can be retried: starts a new payment and goes to the provider", async () => {
    status.mockResolvedValue(
      ok(payment({ status: "failed", can_retry: true })),
    );
    start.mockResolvedValue(
      ok(
        payment({ status: "pending", checkout_url: "https://pay.example/p/2" }),
      ),
    );
    render(<PaymentReturn basePath="/sa/ar" />);
    fireEvent.click(await screen.findByText("tryAgain"));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://pay.example/p/2"),
    );
    expect(start).toHaveBeenCalledWith("o-1", "ref-1");
  });

  it("?start=1 starts an awaiting order exactly once and strips the flag", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign,
        search: "?start=1",
        pathname: "/sa/ar/checkout/payment-return",
      },
    });
    const replaceState = vi.spyOn(window.history, "replaceState");
    status.mockResolvedValue(
      ok(payment({ status: "awaiting_payment", can_retry: true })),
    );
    start.mockResolvedValue(
      ok(
        payment({ status: "pending", checkout_url: "https://pay.example/p/3" }),
      ),
    );
    render(<PaymentReturn basePath="/sa/ar" />);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://pay.example/p/3"),
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalled();
  });

  it("without ?start=1 an awaiting order only reports — it never charges or redirects by itself", async () => {
    status.mockResolvedValue(
      ok(payment({ status: "awaiting_payment", can_retry: true })),
    );
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("awaitingTitle")).toBeInTheDocument();
    expect(screen.getByText(/^awaitingBody\|/)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("an unknown order from the server clears the stored reference", async () => {
    status.mockResolvedValue({ success: false, reason: "not_found" });
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("unknownTitle")).toBeInTheDocument();
    expect(readPendingOnlinePayment()).toBeNull();
  });

  it("an unavailable gateway is a calm dead end with no retry button", async () => {
    status.mockResolvedValue({ success: false, reason: "unavailable" });
    render(<PaymentReturn basePath="/sa/ar" />);
    expect(await screen.findByText("unavailableTitle")).toBeInTheDocument();
    expect(screen.queryByText("checkAgain")).toBeNull();
  });
});
