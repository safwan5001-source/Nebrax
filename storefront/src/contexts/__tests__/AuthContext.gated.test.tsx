import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const syncSession = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/data/customer", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  syncSession,
}));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";

function Probe() {
  const { loading, isAuthenticated } = useAuth();
  return (
    <span data-testid="s">{loading ? "loading" : String(isAuthenticated)}</span>
  );
}

describe("AuthProvider while buyer authentication is gated", () => {
  it("settles as anonymous without calling the server", async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(getByTestId("s").textContent).toBe("false"));
    expect(syncSession).not.toHaveBeenCalled();
  });
});
