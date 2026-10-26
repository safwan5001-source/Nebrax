// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "tenant-a.example.sa" }),
  cookies: async () => ({
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
// `react`'s per-request memo is a pass-through here so each case performs its own fetch.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import { getPolicy, PolicyUnavailableError } from "@/lib/data/policies";

const API = "https://api.awj.test";

function ok(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ data, meta: { request_id: "r" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function failure(status: number, code = "x", message = "boom") {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const published = {
  slug: "privacy-policy",
  locale: "ar",
  fallback: false,
  title: "الخصوصية",
  html: "<h2>بيانات</h2>\n<p>نص <strong>مهم</strong></p>",
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubEnv("AWJ_COMMERCE_API_URL", API);
  vi.stubGlobal("fetch", fetchMock);
});

describe("getPolicy — AWJ store/v1/policies/{slug} (X4)", () => {
  it("returns the published, sanitized policy keyed by the visitor host", async () => {
    fetchMock.mockResolvedValue(ok(published));

    await expect(
      getPolicy("privacy-policy", { locale: "ar" }),
    ).resolves.toEqual({
      slug: "privacy-policy",
      locale: "ar",
      fallback: false,
      title: "الخصوصية",
      html: published.html,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/store/v1/policies/privacy-policy?locale=ar`);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Storefront-Forwarded-Host"]).toBe("tenant-a.example.sa");
    expect(init.cache).toBe("no-store");
    expect(JSON.stringify(headers)).not.toMatch(/spree|publishable/i);
  });

  it("is tenant-specific: another host gets its own content, never a shared cache entry", async () => {
    const hosts = ["tenant-a.example.sa", "tenant-b.example.sa"];
    let call = 0;
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const host = (init.headers as Record<string, string>)[
        "X-Storefront-Forwarded-Host"
      ];
      return ok({ ...published, title: `title:${host}` });
    });
    const headersMod = await import("next/headers");
    vi.spyOn(headersMod, "headers").mockImplementation(
      async () => new Headers({ host: hosts[call++] }) as never,
    );

    const a = await getPolicy("privacy-policy", { locale: "ar" });
    const b = await getPolicy("privacy-policy", { locale: "ar" });

    expect(a?.title).toBe("title:tenant-a.example.sa");
    expect(b?.title).toBe("title:tenant-b.example.sa");
  });

  it("passes only ar/en as the locale and reports the served language and fallback", async () => {
    fetchMock.mockImplementation(async () =>
      ok({ ...published, locale: "en", fallback: true }),
    );

    const policy = await getPolicy("privacy-policy", { locale: "ar" });
    expect(policy).toMatchObject({ locale: "en", fallback: true });

    fetchMock.mockClear();
    await getPolicy("privacy-policy", { locale: "de" });
    await getPolicy("privacy-policy");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      `${API}/store/v1/policies/privacy-policy`,
      `${API}/store/v1/policies/privacy-policy`,
    ]);
  });

  it("an unknown slug is null without calling the API", async () => {
    for (const slug of [
      "about",
      "nope",
      "../etc/passwd",
      "PRIVACY-POLICY",
      "",
    ]) {
      await expect(getPolicy(slug, { locale: "ar" })).resolves.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null only for a genuine 404 (missing, disabled, unpublished or empty)", async () => {
    fetchMock.mockResolvedValue(
      failure(404, "not_found", "الصفحة غير موجودة."),
    );
    await expect(
      getPolicy("returns-policy", { locale: "ar" }),
    ).resolves.toBeNull();
  });

  it("an API failure is a distinct, generic error — never a 404 and never the upstream detail", async () => {
    for (const status of [500, 502, 503, 429, 401, 403]) {
      fetchMock.mockResolvedValueOnce(
        failure(status, "unavailable", "db-internal is down"),
      );
      const error = await getPolicy("privacy-policy", { locale: "ar" }).catch(
        (e: unknown) => e,
      );
      expect(error, String(status)).toBeInstanceOf(PolicyUnavailableError);
      expect((error as Error).message).toBe(
        "Policy page is temporarily unavailable.",
      );
      expect((error as Error).message).not.toMatch(/db-internal|spree/i);
    }
  });

  it("a transport failure or a malformed payload is also 'unavailable', not a 404", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(
      getPolicy("privacy-policy", { locale: "ar" }),
    ).rejects.toBeInstanceOf(PolicyUnavailableError);

    for (const bad of [
      {},
      { ...published, slug: "terms-of-service" },
      { ...published, locale: "fr" },
      { ...published, html: "" },
      { ...published, html: 5 },
    ]) {
      fetchMock.mockResolvedValueOnce(ok(bad));
      await expect(
        getPolicy("privacy-policy", { locale: "ar" }),
      ).rejects.toBeInstanceOf(PolicyUnavailableError);
    }
  });

  it("refuses HTML outside the strict allowlist (fails closed)", async () => {
    for (const html of [
      "<script>alert(1)</script>",
      '<p onclick="x">t</p>',
      '<a href="javascript:alert(1)">x</a>',
      '<img src="x" onerror="alert(1)">',
    ]) {
      fetchMock.mockResolvedValueOnce(ok({ ...published, html }));
      await expect(
        getPolicy("privacy-policy", { locale: "ar" }),
      ).rejects.toBeInstanceOf(PolicyUnavailableError);
    }
  });
});
