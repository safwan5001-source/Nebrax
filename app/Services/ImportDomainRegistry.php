<?php

namespace App\Services;

use App\Contracts\ImportDomainAdapter;
use RuntimeException;

/**
 * سجلّ محوّلات مجالات الاستيراد (IMP-H1-S2) — **الباب الوحيد** الذي يحلّ به محرّك التشغيلات مجالاً إلى كوده. مجال غير
 * مسجَّل يفشل مغلقاً (لا افتراضي). إضافة مجال = محوّل جديد يُضاف هنا + بواباته في `ImportJobDomain::authorization()`؛
 * يحرس تطابق الثلاثة (المجالات المسجَّلة، والمحوّلات، والبوابات) `ImportDomainRegistryTest`.
 */
class ImportDomainRegistry
{
    /** @var array<string, ImportDomainAdapter> */
    private array $adapters = [];

    public function __construct(
        ProductCatalogImportAdapter $catalog,
        ProductWorkbookImportAdapter $workbook,
        InventoryOpeningImportAdapter $opening,
        PartnerImportAdapter $partners,
    ) {
        foreach ([$catalog, $workbook, $opening, $partners] as $adapter) {
            $this->adapters[$adapter->domain()] = $adapter;
        }
    }

    public function has(string $domain): bool
    {
        return isset($this->adapters[$domain]);
    }

    /** @throws RuntimeException لمجال بلا محوّل. */
    public function for(string $domain): ImportDomainAdapter
    {
        return $this->adapters[$domain] ?? throw new RuntimeException('لا يوجد محرّك ترحيل مجزّأ لهذا المجال بعد.');
    }

    /** @return list<string> */
    public function domains(): array
    {
        return array_keys($this->adapters);
    }
}
