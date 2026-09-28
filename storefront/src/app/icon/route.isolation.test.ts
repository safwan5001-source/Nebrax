import { afterEach, describe, expect, it, vi } from "vitest";

function presentationResponse(faviconDataUrl: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        name: "Store",
        default_locale: "ar",
        presentation: {
          version: 1,
          branding: { faviconDataUrl },
        },
      },
    }),
  } as Response;
}

async function iconForHost(host: string, faviconDataUrl: string) {
  vi.resetModules();
  vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
  vi.stubEnv("NODE_ENV", "production");
  vi.doMock("next/headers", () => ({
    headers: async () => new Headers({ host }),
  }));
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    presentationResponse(faviconDataUrl),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { GET } = await import("./route");
  const response = await GET(new Request(`https://${host}/icon`));
  const body = Buffer.from(await response.arrayBuffer());
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as
    | Record<string, string>
    | undefined;
  const forwarded = headers?.["X-Storefront-Forwarded-Host"];

  return { response, body, forwarded };
}

describe("storefront icon host isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("next/headers");
    vi.resetModules();
  });

  it("returns each host's published icon and does not leak the other store", async () => {
    const storeA = await iconForHost(
      "store-a.example",
      "data:image/png;base64,QQ==",
    );
    const storeB = await iconForHost(
      "store-b.example",
      "data:image/png;base64,Qg==",
    );

    expect(storeA.response.status).toBe(200);
    expect(storeA.response.headers.get("content-type")).toBe("image/png");
    expect(storeA.body).toEqual(Buffer.from([0x41]));
    expect(storeA.forwarded).toBe("store-a.example");

    expect(storeB.response.status).toBe(200);
    expect(storeB.response.headers.get("content-type")).toBe("image/png");
    expect(storeB.body).toEqual(Buffer.from([0x42]));
    expect(storeB.forwarded).toBe("store-b.example");
    expect(storeB.body.equals(storeA.body)).toBe(false);
  });
});
