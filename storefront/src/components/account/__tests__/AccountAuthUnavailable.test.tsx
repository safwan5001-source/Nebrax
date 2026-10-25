import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshUser: vi.fn(),
  user: null as null | { id: string; email: string },
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/sa/ar/account",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: authMock.user,
    loading: false,
    isAuthenticated: !!authMock.user,
    login: authMock.login,
    register: authMock.register,
    logout: authMock.logout,
    refreshUser: authMock.refreshUser,
  }),
}));
vi.mock("@/lib/data/customer", () => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  updateCustomer: vi.fn(),
}));

import ProfilePage from "@/app/[country]/[locale]/(storefront)/account/(authenticated)/profile/page";
import ForgotPasswordPage from "@/app/[country]/[locale]/(storefront)/account/forgot-password/page";
import RegisterPage from "@/app/[country]/[locale]/(storefront)/account/register/page";
import ResetPasswordPage from "@/app/[country]/[locale]/(storefront)/account/reset-password/page";
import { AccountSignIn } from "@/components/account/AccountSignIn";

const SURFACES: Array<[string, () => React.JSX.Element]> = [
  ["sign-in", () => <AccountSignIn />],
  ["register", () => <RegisterPage />],
  ["forgot-password", () => <ForgotPasswordPage />],
  ["reset-password", () => <ResetPasswordPage />],
  ["profile", () => <ProfilePage />],
];

describe("auth surfaces while buyer authentication is gated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.user = null;
  });

  it.each(
    SURFACES,
  )("%s shows the unavailable notice with no form and no submit path", (_name, renderSurface) => {
    const { container } = render(renderSurface());

    expect(screen.getByTestId("account-auth-unavailable")).toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button[type='submit']")).toBeNull();
    expect(authMock.login).not.toHaveBeenCalled();
    expect(authMock.register).not.toHaveBeenCalled();
  });

  it("offers the guest journey (shop / cart) under the locale base path", () => {
    render(<AccountSignIn />);
    expect(
      screen.getByRole("link", { name: "continueShopping" }),
    ).toHaveAttribute("href", "/sa/ar");
    expect(screen.getByRole("link", { name: "viewCart" })).toHaveAttribute(
      "href",
      "/sa/ar/cart",
    );
  });

  it("never renders an internal error or environment detail", () => {
    const { container } = render(<RegisterPage />);
    expect(container.textContent ?? "").not.toMatch(
      /spree|SPREE_|not configured|environment/i,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses logical-direction layout only (RTL/LTR safe)", () => {
    const { container } = render(<AccountSignIn />);
    expect(container.innerHTML).not.toMatch(
      /\b(ml|mr|pl|pr)-\d|text-(left|right)\b/,
    );
  });
});
