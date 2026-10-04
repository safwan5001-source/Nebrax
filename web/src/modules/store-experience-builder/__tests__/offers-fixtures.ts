import type { WorkspaceOffer } from "@/modules/commerce-workspace/workspace-offers";

/** CUST-H4-7 test fixtures — shaped exactly like the parsed workspace client output. */
export function liveOffer(overrides: Partial<WorkspaceOffer> = {}): WorkspaceOffer {
  return {
    id: "o1",
    productId: `p-${overrides.id ?? "o1"}`,
    position: 0,
    product: { name: "هاتف ذكي", nameEn: "Smart phone", thumbnailUrl: "https://cdn.example.test/o1.jpg" },
    isActive: true,
    startsAt: null,
    endsAt: null,
    isLive: true,
    reason: null,
    referencePrice: { amountMinor: 25000, currency: "SAR" },
    offerPrice: { amountMinor: 19000, currency: "SAR" },
    discountPercent: 24,
    ...overrides,
  };
}

export function hiddenOffer(reason: string, overrides: Partial<WorkspaceOffer> = {}): WorkspaceOffer {
  return {
    id: `h-${reason}`,
    productId: `p-${overrides.id ?? `h-${reason}`}`,
    position: 0,
    product: { name: "منتج مخفي", nameEn: "Hidden product", thumbnailUrl: null },
    isActive: true,
    startsAt: null,
    endsAt: null,
    isLive: false,
    reason,
    referencePrice: null,
    offerPrice: null,
    discountPercent: null,
    ...overrides,
  };
}
