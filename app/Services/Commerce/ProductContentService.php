<?php

namespace App\Services\Commerce;

use App\Models\CommerceProductContentBlock;
use App\Models\Product;
use App\Support\Commerce\PlainText;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * FLOWERS-H5 / ADR-17 — كتل المحتوى المهيكلة لكل منتج. الاستبدال ذرّي للمجموعة كلها؛ الترتيب
 * = ترتيب المصفوفة. لا سعر ولا مخزون ولا أثر محاسبي.
 */
final class ProductContentService
{
    public const MAX_LINES = 40;

    /** @return list<array<string, mixed>> */
    public function blocks(Product $product): array
    {
        $this->assertProductTenant($product);

        return $this->query($product->id, activeOnly: false)->map(fn ($b) => $this->present($b, true))->values()->all();
    }

    /** @return list<array<string, mixed>> الكتل **النشطة** فقط (عامة) */
    public function publicBlocks(string $productId): array
    {
        return $this->query($productId, activeOnly: true)->map(fn ($b) => $this->present($b, false))->values()->all();
    }

    /**
     * @param  list<array{block_type: string, body: string, body_en?: ?string, is_active?: bool}>  $blocks
     * @return list<array<string, mixed>>
     */
    public function replace(Product $product, array $blocks): array
    {
        $this->assertProductTenant($product);

        $types = array_column($blocks, 'block_type');
        if (count($types) !== count(array_unique($types))) {
            throw new DomainException('كتلة واحدة فقط لكل نوع محتوى.');
        }

        $normalized = [];
        foreach ($blocks as $block) {
            $body = PlainText::normalize($block['body'] ?? null, true);
            if ($body === null) {
                throw new DomainException('نص كتلة المحتوى مطلوب.');
            }
            $bodyEn = PlainText::normalize($block['body_en'] ?? null, true);
            foreach ([$body, $bodyEn] as $text) {
                if ($text !== null && (PlainText::length($text) > CommerceProductContentBlock::MAX_BODY_LENGTH || substr_count($text, "\n") + 1 > self::MAX_LINES)) {
                    throw new DomainException('نص كتلة المحتوى يتجاوز الحد المسموح.');
                }
            }
            $normalized[] = ['block_type' => $block['block_type'], 'body' => $body, 'body_en' => $bodyEn, 'is_active' => (bool) ($block['is_active'] ?? true)];
        }

        return DB::transaction(function () use ($product, $normalized) {
            Product::withoutGlobalScopes()->whereKey($product->id)->lockForUpdate()->first();
            CommerceProductContentBlock::query()->where('product_id', $product->id)->delete();

            foreach ($normalized as $position => $row) {
                CommerceProductContentBlock::create($row + ['product_id' => $product->id, 'sort_order' => $position]);
            }

            return $this->query($product->id, activeOnly: false)->map(fn ($b) => $this->present($b, true))->values()->all();
        });
    }

    private function query(string $productId, bool $activeOnly)
    {
        return CommerceProductContentBlock::query()
            ->where('product_id', $productId)
            ->when($activeOnly, fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')
            ->orderBy('block_type')
            ->get();
    }

    /** @return array<string, mixed> */
    private function present(CommerceProductContentBlock $block, bool $admin): array
    {
        // الإدارة تعيد الشكل نفسه الذي يقبله `replace()` (block_type + is_active) فيصحّ ردّ المخرجات كما هي؛
        // الواجهة العامة تبقى على `type` (عقدها المنشور).
        if ($admin) {
            return ['block_type' => $block->block_type, 'body' => $block->body, 'body_en' => $block->body_en, 'is_active' => $block->is_active];
        }

        return ['type' => $block->block_type, 'body' => $block->body, 'body_en' => $block->body_en];
    }

    private function assertProductTenant(Product $product): void
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null || $product->tenant_id !== $tenantId) {
            throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
        }
    }
}
