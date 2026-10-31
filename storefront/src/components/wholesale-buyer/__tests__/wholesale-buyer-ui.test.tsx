import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

const actions = vi.hoisted(() => ({
  registerBuyer: vi.fn(),
  verifyBuyerEmail: vi.fn(),
  resendBuyerVerification: vi.fn(),
  signInBuyer: vi.fn(),
  signOutBuyer: vi.fn(),
  applyForWholesale: vi.fn(),
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("@/lib/data/wholesale-buyer", () => actions);
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: "en" | "ar" }) => {
    const messages = (locale === "en" ? en : ar).wholesaleBuyer as Record<
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
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/sa/en/buyer/membership",
  useSearchParams: () => new URLSearchParams(),
}));

import { BuyerMembershipPanel } from "../BuyerMembershipPanel";
import { BuyerRegisterForm } from "../BuyerRegisterForm";
import { BuyerResendForm } from "../BuyerResendForm";
import { BuyerSignInForm } from "../BuyerSignInForm";
import { BuyerVerifyEmail } from "../BuyerVerifyEmail";
import { CatalogAccessGate } from "../CatalogAccessGate";

const STATES = [
  "signed_out",
  "no_application",
  "pending",
  "approved",
  "rejected",
  "suspended",
  "unavailable",
] as const;

function withIntl(
  ui: React.ReactElement,
  locale: "en" | "ar" = "en",
  messages: Record<string, unknown> = locale === "en" ? en : ar,
) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("BuyerMembershipPanel — every state, both locales", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(STATES)("%s renders its own label and body (en + ar)", (state) => {
    for (const [locale, catalog] of [
      ["en", en],
      ["ar", ar],
    ] as const) {
      const status = (
        catalog.wholesaleBuyer.status as Record<
          string,
          { label: string; body: string }
        >
      )[state];
      const { container, unmount } = render(
        withIntl(
          <BuyerMembershipPanel
            state={state}
            displayName={null}
            basePath="/sa/en"
          />,
          locale,
        ),
      );
      expect(screen.getByText(status.label)).toBeInTheDocument();
      expect(screen.getByText(status.body)).toBeInTheDocument();
      expect(container.querySelector(`[data-state="${state}"]`)).not.toBeNull();
      unmount();
    }
  });

  it("only the approved state links to the catalogue; only no_application can apply; only signed_out shows sign-in", () => {
    const ctas = (state: (typeof STATES)[number]) => {
      const { unmount } = render(
        withIntl(
          <BuyerMembershipPanel
            state={state}
            displayName="Ann"
            basePath="/sa/en"
          />,
        ),
      );
      const result = {
        browse: screen.queryByRole("link", {
          name: "Browse wholesale catalogue",
        }),
        apply: screen.queryByRole("button", {
          name: "Apply for wholesale access",
        }),
        signIn: screen.queryByRole("link", { name: "Sign in" }),
      };
      unmount();
      return result;
    };

    for (const state of STATES) {
      const { browse, apply, signIn } = ctas(state);
      expect(!!browse).toBe(state === "approved");
      expect(!!apply).toBe(state === "no_application");
      expect(!!signIn).toBe(state === "signed_out");
    }
  });

  it("pending, rejected and suspended never offer the catalogue or a second application", () => {
    for (const state of ["pending", "rejected", "suspended"] as const) {
      const { unmount } = render(
        withIntl(
          <BuyerMembershipPanel
            state={state}
            displayName={null}
            basePath="/sa/en"
          />,
        ),
      );
      expect(screen.queryByRole("link", { name: /Browse/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
      unmount();
    }
  });

  it("applying calls the action and refreshes; a failure shows a catalogue message, not internals", async () => {
    actions.applyForWholesale.mockResolvedValueOnce({ success: true });
    render(
      withIntl(
        <BuyerMembershipPanel
          state="no_application"
          displayName={null}
          basePath="/sa/en"
        />,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply for wholesale access" }),
    );
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());

    actions.applyForWholesale.mockResolvedValueOnce({
      success: false,
      error: "generic",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply for wholesale access" }),
    );
    expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeInTheDocument();
  });

  it("approved copy states that products can be ordered (native ordering, H6 Batch K), not that ordering is unavailable", () => {
    render(
      withIntl(
        <BuyerMembershipPanel
          state="approved"
          displayName={null}
          basePath="/sa/en"
        />,
      ),
    );
    expect(
      screen.getByText(/you can add products to your cart and place orders/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not available yet/)).not.toBeInTheDocument();
  });
});

describe("BuyerSignInForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits credentials to the server action and routes to the membership page on success", async () => {
    actions.signInBuyer.mockResolvedValue({ success: true });
    render(withIntl(<BuyerSignInForm nextPath="/sa/en/buyer/membership" />));

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "b@x.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/sa/en/buyer/membership"),
    );
    expect(actions.signInBuyer).toHaveBeenCalledWith("b@x.test", "pw-123456");
  });

  it("shows one generic failure message and does not navigate", async () => {
    actions.signInBuyer.mockResolvedValue({
      success: false,
      error: "invalidCredentials",
    });
    render(withIntl(<BuyerSignInForm nextPath="/sa/en/buyer/membership" />));

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "b@x.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(/We could not sign you in/),
    ).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("CatalogAccessGate", () => {
  it.each([
    ["sign_in_required", "/sa/en/buyer/sign-in"],
    ["approval_required", "/sa/en/buyer/membership"],
  ] as const)("%s shows its message and links onward — and nothing priced", async (gate, href) => {
    const element = await CatalogAccessGate({
      gate,
      basePath: "/sa/en",
      locale: "en",
    });
    const { container } = render(element);

    const gateCopy = (
      en.wholesaleBuyer.gate as unknown as Record<
        string,
        { title: string; cta: string }
      >
    )[gate];
    expect(
      screen.getByRole("heading", { name: gateCopy.title }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: gateCopy.cta })).toHaveAttribute(
      "href",
      href,
    );
    expect(container.querySelector(`[data-gate="${gate}"]`)).not.toBeNull();
    expect(container.textContent).not.toMatch(/SAR|ر\.س|\d+\.\d{2}/);
  });

  it("is exported (route wiring imports it)", () => {
    expect(typeof CatalogAccessGate).toBe("function");
  });
});

describe("verification journey UI", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registration shows the same neutral 'check your email' result and never mentions whether the address existed", async () => {
    actions.registerBuyer.mockResolvedValue({ success: true });
    const { container } = render(withIntl(<BuyerRegisterForm />));

    fireEvent.change(screen.getByLabelText("Your name or company"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@x.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(
        container.querySelector('[data-state="registered"]'),
      ).not.toBeNull(),
    );
    expect(actions.registerBuyer).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Acme",
        email: "a@x.test",
        basePath: "/sa/en",
      }),
    );
    expect(container.textContent).toMatch(/If this address can be registered/);
    expect(container.textContent).not.toMatch(/already (registered|exists)/i);
  });

  it("registration failures show a catalogue message only", async () => {
    actions.registerBuyer.mockResolvedValue({
      success: false,
      error: "validation",
    });
    render(withIntl(<BuyerRegisterForm />));
    fireEvent.change(screen.getByLabelText("Your name or company"), {
      target: { value: "A" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@x.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(
        "Please check the details you entered and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("the link is NOT consumed while the page renders — only when the buyer presses the button", async () => {
    actions.verifyBuyerEmail.mockResolvedValue({ success: true });
    const token = "a".repeat(64);
    const { container } = render(withIntl(<BuyerVerifyEmail token={token} />));

    expect(actions.verifyBuyerEmail).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm email address" }),
    );

    await waitFor(() =>
      expect(container.querySelector('[data-state="verified"]')).not.toBeNull(),
    );
    expect(actions.verifyBuyerEmail).toHaveBeenCalledOnce();
    expect(actions.verifyBuyerEmail).toHaveBeenCalledWith(token);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("an invalid, expired or replayed link is one generic failure with a way to request a new one", async () => {
    actions.verifyBuyerEmail.mockResolvedValue({
      success: false,
      error: "validation",
    });
    const { container } = render(
      withIntl(<BuyerVerifyEmail token={"b".repeat(64)} />),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm email address" }),
    );

    await waitFor(() =>
      expect(container.querySelector('[data-state="failed"]')).not.toBeNull(),
    );
    expect(
      screen.getByRole("link", { name: "Send a new confirmation email" }),
    ).toBeInTheDocument();
  });

  it("no token (or a malformed one filtered out by the page) shows the missing-link state and offers no confirm button", () => {
    const { container } = render(withIntl(<BuyerVerifyEmail token={null} />));

    expect(container.querySelector('[data-state="failed"]')).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Confirm email address" }),
    ).toBeNull();
    expect(actions.verifyBuyerEmail).not.toHaveBeenCalled();
  });

  it("resend shows the same neutral answer", async () => {
    actions.resendBuyerVerification.mockResolvedValue({ success: true });
    const { container } = render(withIntl(<BuyerResendForm />));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ghost@x.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send email" }));

    await waitFor(() =>
      expect(container.querySelector('[data-state="resent"]')).not.toBeNull(),
    );
    expect(container.textContent).toMatch(
      /If this address belongs to an account/,
    );
  });

  it("every state has copy in Arabic too", () => {
    render(withIntl(<BuyerVerifyEmail token={null} />, "ar"));
    expect(
      screen.getByText(ar.wholesaleBuyer.verify.failedTitle),
    ).toBeInTheDocument();
  });
});
