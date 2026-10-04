"use client";

import { useTranslations } from "next-intl";
import type { ContentBlock } from "@/lib/commerce/pdp-gifting";

/**
 * FLOWERS-H11 — merchant-authored structured product information (ADR-17):
 * composition, care, allergens, … Plain text only, rendered as text (never
 * HTML), each under its type's own heading. This is information the merchant
 * provides, not a compliance claim, and nothing is rendered for a product
 * without blocks.
 */
export function ContentBlocks({ blocks }: { blocks: readonly ContentBlock[] }) {
  const t = useTranslations("products");
  if (blocks.length === 0) return null;
  return (
    <section
      data-content-blocks=""
      className="mt-5 border-t border-store-border pt-5"
    >
      <h2 className="mb-3 text-sm font-bold text-store-foreground">
        {t("contentBlocksTitle")}
      </h2>
      <dl className="space-y-3">
        {blocks.map((block, index) => (
          // A product may carry several blocks of one type (ordered by sort).
          <div key={`${block.type}-${index}`}>
            <dt className="text-xs font-semibold text-store-muted-foreground">
              {t(`contentBlock_${block.type}`)}
            </dt>
            <dd className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-store-foreground">
              {block.body}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
