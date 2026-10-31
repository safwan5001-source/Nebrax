import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCart } from "@/contexts/CartContext";
import type { CountryWithMarket } from "@/contexts/StoreContext";
import { setStoreCookies } from "@/lib/utils/cookies";
import { useCountrySwitch } from "../useCountrySwitch";

vi.mock("next/navigation", () => ({
  usePathname: () => "/us/en/products",
}));

vi.mock("@/contexts/CartContext", () => ({
  useCart: vi.fn(),
}));

vi.mock("@/lib/utils/cookies", () => ({
  setStoreCookies: vi.fn(),
}));

vi.mock("@/lib/utils/account-redirect", () => ({
  rebaseAccountRedirectSearch: vi.fn((search: string) => search),
}));

const mockUseCart = vi.mocked(useCart);
const mockSetStoreCookies = vi.mocked(setStoreCookies);

const targetCountry = {
  iso: "DE",
  currency: "EUR",
  default_locale: "de",
  supported_locales: ["de", "en"],
} as unknown as CountryWithMarket;

describe("useCountrySwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCart.mockReturnValue({ loading: false } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("blocks switching while the cart is still loading", async () => {
    mockUseCart.mockReturnValue({ loading: true } as never);

    const { result } = renderHook(() =>
      useCountrySwitch({
        currentCountry: "us",
        currentLocale: "en",
      }),
    );
    expect(result.current.isCartLoading).toBe(true);

    let switched = true;
    await act(async () => {
      switched = await result.current.handleCountrySelect(targetCountry, "de");
    });

    expect(switched).toBe(false);
    expect(mockSetStoreCookies).not.toHaveBeenCalled();
  });

  it("sets the store cookies and preserves the current path when switching", async () => {
    const { result } = renderHook(() =>
      useCountrySwitch({
        currentCountry: "us",
        currentLocale: "en",
      }),
    );
    const mockAssign = vi.fn();
    vi.stubGlobal("window", {
      location: { assign: mockAssign, hash: "", search: "" },
    });

    await act(async () => {
      await result.current.handleCountrySelect(targetCountry, "de");
    });

    expect(mockSetStoreCookies).toHaveBeenCalledWith("de", "de");
    expect(mockAssign).toHaveBeenCalledWith("/de/de/products");
  });

  it("rebases a login return target when switching market", async () => {
    const { rebaseAccountRedirectSearch } = await import(
      "@/lib/utils/account-redirect"
    );
    vi.mocked(rebaseAccountRedirectSearch).mockReturnValueOnce(
      "?redirect=%2Fde%2Fde%2Faccount%2Forders",
    );

    const { result } = renderHook(() =>
      useCountrySwitch({
        currentCountry: "us",
        currentLocale: "en",
      }),
    );
    const mockAssign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        assign: mockAssign,
        hash: "",
        search: "?redirect=%2Fus%2Fen%2Faccount%2Forders",
      },
    });

    await act(async () => {
      await result.current.handleCountrySelect(targetCountry, "de");
    });

    expect(rebaseAccountRedirectSearch).toHaveBeenCalledWith(
      "?redirect=%2Fus%2Fen%2Faccount%2Forders",
      "/us/en",
      "/de/de",
    );
    expect(mockAssign).toHaveBeenCalledWith(
      "/de/de/products?redirect=%2Fde%2Fde%2Faccount%2Forders",
    );
  });
});
