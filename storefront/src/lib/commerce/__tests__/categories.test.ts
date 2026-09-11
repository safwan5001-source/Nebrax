import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCategories, fetchCategory } from "../categories";
import type {
  AwjCategory,
  AwjListResponse,
  AwjResourceResponse,
} from "../types";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("commerce/categories", () => {
  beforeEach(() => {
    vi.stubEnv("AWJ_COMMERCE_API_URL", "http://awj-api.test");
    vi.stubEnv("AWJ_STORE_TENANT_SLUG", "demo-tenant");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches the root category tree", async () => {
    const category: AwjCategory = {
      id: "c1",
      name: "إلكترونيات",
      description: null,
      color: null,
      parent_id: null,
      children: [
        {
          id: "c2",
          name: "هواتف",
          description: null,
          color: null,
          parent_id: "c1",
        },
      ],
    };
    const body: AwjListResponse<AwjCategory> = {
      data: [category],
      meta: { request_id: "r1" } as never,
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchCategories();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].children).toHaveLength(1);
    expect(result.data[0].children?.[0].id).toBe("c2");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(
      "http://awj-api.test/store/v1/demo-tenant/categories",
    );
  });

  it("returns an empty tree when the tenant has no categories", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: [], meta: { request_id: "r2" } }),
    );

    const result = await fetchCategories();

    expect(result.data).toEqual([]);
  });

  it("fetches a single category with ancestors", async () => {
    const body: AwjResourceResponse<AwjCategory> = {
      data: {
        id: "c2",
        name: "هواتف",
        description: null,
        color: null,
        parent_id: "c1",
        ancestors: [{ id: "c1", name: "إلكترونيات" }],
      },
      meta: { request_id: "r3" },
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));

    const category = await fetchCategory("c2");

    expect(category.id).toBe("c2");
    expect(category.ancestors).toEqual([
      expect.objectContaining({ id: "c1", name: "إلكترونيات" }),
    ]);
  });

  it("throws on an unknown category id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "not_found", message: "التصنيف غير موجود." } },
        false,
        404,
      ),
    );

    await expect(fetchCategory("missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});
