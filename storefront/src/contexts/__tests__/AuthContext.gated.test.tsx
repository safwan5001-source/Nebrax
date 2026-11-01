import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncSession = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/data/customer", () => ({
  getAccountsAvailable: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  syncSession,
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function Probe() {
  const { loading, isAuthenticated, accountsAvailable } = useAuth();
  return (
    <span data-testid="s">
      {loading ? "loading" : `${isAuthenticated}/${String(accountsAvailable)}`}
    </span>
  );
}

describe("AuthProvider for a guest / a store without accounts", () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: the test clears the JS-readable presence hint
    document.cookie = "awj_account_hint=; path=/; max-age=0";
    syncSession.mockReset();
  });

  it("settles as anonymous without calling the server (no session hint, no request)", async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(getByTestId("s").textContent).toBe("false/null"),
    );
    expect(syncSession).not.toHaveBeenCalled();
  });
});
