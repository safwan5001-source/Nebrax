import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// useRouter must return a stable reference (as it does in Next), otherwise
// refreshUser's [router] dependency changes every render and the sync effects
// loop forever.
const { mockRefresh, mockRouter } = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    mockRefresh: refresh,
    mockRouter: { refresh, push: () => {}, replace: () => {} },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/lib/data/customer", () => ({
  getAccountsAvailable: vi.fn(),
  syncSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { getAccountsAvailable, syncSession } from "@/lib/data/customer";

const mockSyncSession = vi.mocked(syncSession);
const mockAvailable = vi.mocked(getAccountsAvailable);

/** The JS-readable presence hint the login action writes next to the HttpOnly session cookie. */
function setHint(on: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: the test sets the JS-readable presence hint
  document.cookie = on
    ? "awj_account_hint=1; path=/"
    : "awj_account_hint=; path=/; max-age=0";
}

const mockCustomer = {
  id: "user-1",
  email: "test@example.com",
  first_name: "Test",
  last_name: "User",
} as never;

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** Dispatch a visibility change while pretending `msAhead` has elapsed. */
async function returnToTab(msAhead: number) {
  const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + msAhead);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  spy.mockRestore();
}

describe("AuthContext session sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHint(true);
    mockSyncSession.mockResolvedValue({
      available: true,
      customer: mockCustomer,
      refreshed: false,
    });
  });

  it("makes no request at all for a visitor with no session hint (guests and stores without accounts)", async () => {
    setHint(false);
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockSyncSession).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.accountsAvailable).toBeNull();

    await returnToTab(31_000);
    expect(mockSyncSession).not.toHaveBeenCalled();
  });

  it("learns whether the host has accounts only when an account screen asks", async () => {
    setHint(false);
    mockAvailable.mockResolvedValue(false);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.checkAccountsAvailable();
    });
    expect(result.current.accountsAvailable).toBe(false);
  });

  it("fails closed when the availability check itself fails", async () => {
    setHint(false);
    mockAvailable.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.checkAccountsAvailable();
    });
    expect(result.current.accountsAvailable).toBe(false);
  });

  it("syncs the session on mount and exposes the customer", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockSyncSession).toHaveBeenCalledTimes(1);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe("test@example.com");
  });

  it("re-syncs when the tab regains focus, throttling rapid events", async () => {
    renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(mockSyncSession).toHaveBeenCalledTimes(1));

    // Within the throttle window — ignored.
    await returnToTab(5_000);
    expect(mockSyncSession).toHaveBeenCalledTimes(1);

    // Past the throttle window — re-syncs.
    await returnToTab(31_000);
    await waitFor(() => expect(mockSyncSession).toHaveBeenCalledTimes(2));
  });

  it("re-renders server components after a transparent refresh", async () => {
    mockSyncSession.mockResolvedValue({
      available: true,
      customer: mockCustomer,
      refreshed: true,
    });

    renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it("clears the user when the session is gone", async () => {
    mockSyncSession.mockResolvedValue({
      available: true,
      customer: null,
      refreshed: false,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });
});
