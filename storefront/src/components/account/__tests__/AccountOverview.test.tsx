import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ORDER_HISTORY_CAPABILITY } from "@/lib/commerce/capabilities";
import { AccountOverview } from "../AccountOverview";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/sa/en/account",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      email: "noura@example.com",
      first_name: "Noura",
      last_name: "A",
    },
    logout: vi.fn(),
  }),
}));

describe("AccountOverview", () => {
  it("does not fabricate order history on the landing page", () => {
    expect(ACCOUNT_ORDER_HISTORY_CAPABILITY).toBe("design_only");
    render(<AccountOverview />);
    expect(screen.getByText("lookupUnavailableTitle")).toBeInTheDocument();
    expect(screen.queryByText(/AWJ-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/invoice/i)).not.toBeInTheDocument();
  });
});
