import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn((name: string) =>
      store.has(name) ? { value: store.get(name) as string } : undefined,
    ),
    set: vi.fn(
      (name: string, value: string, _opts?: Record<string, unknown>) => {
        store.set(name, value);
      },
    ),
    writable: true,
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => {
    if (!mocks.writable) {
      throw new Error("Cookies can only be modified in a Server Action");
    }
    return { get: mocks.get, set: mocks.set };
  }),
}));

const {
  AWJ_CART_COOKIE_NAME,
  applyAwjSetCookie,
  clearAwjCartCookie,
  getAwjCartToken,
} = await import("../cart-cookies");

function responseWithSetCookie(...values: string[]): Response {
  return {
    headers: {
      getSetCookie: () => values,
      get: (name: string) =>
        name.toLowerCase() === "set-cookie" ? (values[0] ?? null) : null,
    },
  } as unknown as Response;
}

describe("commerce/cart-cookies — AWJ cart token cookie plumbing", () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.get.mockClear();
    mocks.set.mockClear();
    mocks.writable = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the visitor's cart token from the incoming cookie jar", async () => {
    mocks.store.set(AWJ_CART_COOKIE_NAME, "raw-token-value");

    await expect(getAwjCartToken()).resolves.toBe("raw-token-value");
  });

  it("returns undefined when no cart cookie is present", async () => {
    await expect(getAwjCartToken()).resolves.toBeUndefined();
  });

  it("mirrors a Set-Cookie awj_cart_token onto the Next.js response with our own trusted attributes", async () => {
    const response = responseWithSetCookie(
      "awj_cart_token=new-raw-token; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax",
    );

    await applyAwjSetCookie(response);

    expect(mocks.set).toHaveBeenCalledWith(
      AWJ_CART_COOKIE_NAME,
      "new-raw-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 2592000,
      }),
    );
  });

  it("never carries through an upstream Domain attribute — always host-only via Next's own cookies().set()", async () => {
    const response = responseWithSetCookie(
      "awj_cart_token=new-raw-token; Domain=laravel-internal.test; Max-Age=2592000; Path=/",
    );

    await applyAwjSetCookie(response);

    const [, , options] = mocks.set.mock.calls[0];
    expect(options).not.toHaveProperty("domain");
  });

  it("marks the cookie secure only in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = responseWithSetCookie(
      "awj_cart_token=t; Max-Age=100; Path=/",
    );

    await applyAwjSetCookie(response);

    expect(mocks.set).toHaveBeenCalledWith(
      AWJ_CART_COOKIE_NAME,
      "t",
      expect.objectContaining({ secure: true }),
    );
  });

  it("clears the local cookie when Laravel sends an immediate-expiry Set-Cookie (invalid/expired cart)", async () => {
    const response = responseWithSetCookie(
      "awj_cart_token=; Max-Age=0; Path=/",
    );

    await applyAwjSetCookie(response);

    expect(mocks.set).toHaveBeenCalledWith(AWJ_CART_COOKIE_NAME, "", {
      maxAge: -1,
      path: "/",
    });
  });

  it("ignores a response with no Set-Cookie header at all (a plain GET on a still-valid cart)", async () => {
    const response = { headers: { get: () => null } } as unknown as Response;

    await applyAwjSetCookie(response);

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("ignores Set-Cookie headers for cookies other than awj_cart_token", async () => {
    const response = responseWithSetCookie("some_other_cookie=value; Path=/");

    await applyAwjSetCookie(response);

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("never throws when called during a Server Component render (cookies() unwritable)", async () => {
    mocks.writable = false;
    const response = responseWithSetCookie(
      "awj_cart_token=t; Max-Age=1; Path=/",
    );

    await expect(applyAwjSetCookie(response)).resolves.toBeUndefined();
  });

  it("clearAwjCartCookie is best-effort and swallows a Server Component render error", async () => {
    mocks.writable = false;

    await expect(clearAwjCartCookie()).resolves.toBeUndefined();
  });
});
