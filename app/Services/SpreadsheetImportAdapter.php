<?php

namespace App\Services;

use App\Contracts\ImportDomainAdapter;
use App\Support\SpreadsheetReader;

/**
 * أساس مشترك لمحوّلات الجداول أحادية الورقة (CSV/XLSX): الفحص الهيكلي وتعريف «صفوف البيانات الفعلية» في مكان واحد
 * بدل نسختين. المحوّلات المشتقة تعلن المجال والوحدة والسقف وتنفّذ `applyChunk`.
 */
abstract class SpreadsheetImportAdapter implements ImportDomainAdapter
{
    use CanonicalizesImportOptions;

    /** الأعمدة لم تتغيّر لأي مجال — سقفٌ واحد (٢٠٠) يبقى كافياً وموحَّداً. */
    protected const MAX_COLUMNS = ProductImportService::MAX_COLUMNS;

    public function inspect(string $tmpPath, string $extension): array
    {
        $rows = SpreadsheetReader::read($tmpPath, $extension, $this->maxRows(), self::MAX_COLUMNS);

        return [$this->countDataRows($rows), $rows === [] ? 0 : count($rows[0])];
    }

    public function recountOnFirstApply(string $tmpPath, string $extension): ?int
    {
        return null;
    }

    /**
     * عدد صفوف البيانات الفعلية (بلا صف العناوين ولا الصفوف الفارغة) — التعريف الوحيد المستعمل لـ`row_count` ولاكتمال
     * الترحيل معاً، مطابقاً حرفياً لتعريف `dataIndex` في `ProductImportService::parse()`.
     *
     * @param  array<int, array<int, string>>  $rows  ناتج `SpreadsheetReader::read()` كاملاً (يشمل صف العناوين).
     */
    protected function countDataRows(array $rows): int
    {
        $dataRows = $rows === [] ? [] : array_slice($rows, 1);

        return count(array_filter(
            $dataRows,
            static fn (array $row): bool => ! ProductImportService::isBlankRow($row)
        ));
    }
}
