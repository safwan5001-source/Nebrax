<?php

namespace App\Services\Reporting;

use App\Models\FuelStationAuditEvent;
use App\Models\User;
use App\Support\FuelReportFormatter as F;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * مُصدِّر ملفات تقارير الوقود (XLSX/CSV) من **الحمولة نفسها** التي تعرضها الشاشة — لا استعلام ثانٍ ولا حساب مالي ثانٍ: الأعمدة المحذوفة بالصلاحية
 * غير موجودة أصلاً في الحمولة فلا تصل ملفاً. التحويل الوحيد هنا وحدات العرض (مللتر ← لتر، هللة ← ريال) بأعداد صحيحة.
 *
 * - XLSX: ورقة «ملخص» (بيانات التقرير والفلاتر والملاحظات والمؤشرات) ثم ورقة لكل جدول، وصف إجمالي لكل جدول له إجماليات؛ القيم الرقمية تبقى أرقاماً بدقتها.
 * - CSV: جدول واحد (`table` أو الأول) بـUTF-8 مع BOM؛ حقن الصيغ مُعالَج **بحسب نوع العمود**: عمود نصي يبدأ بـ`= + - @` أو tab/CR يُسبَق بـ`'`،
 *   أما الأعمدة الرقمية (من المحرك لا من المستخدم) فتبقى سالبها سالبة لا نصاً.
 * - لا ملفات عامة: الملف المؤقت في مجلد النظام المؤقت يُحذف فور القراءة، والاستجابة `no-store` بلا رابط تنزيل مخزَّن.
 */
final class FuelReportExporter
{
    public const MAX_ROWS = 50000;

    public function xlsx(array $payload, string $lang): string
    {
        $sheets = [$this->summarySheet($payload, $lang)];
        foreach ($payload['tables'] as $table) {
            [$headers, $rows, $types] = $this->flatten($payload, $table, $lang);
            $sheets[] = ['name' => $table['title'][$lang], 'headers' => $headers, 'rows' => $rows, 'types' => $types];
        }
        $this->assertWithinLimit($payload);

        $path = tempnam(sys_get_temp_dir(), 'awj-fuel-report-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف التصدير المؤقت.');
        }
        try {
            SpreadsheetWriter::workbookXlsx($path, $sheets);
            $contents = file_get_contents($path);
            if ($contents === false) {
                throw new RuntimeException('تعذر قراءة ملف التصدير.');
            }

            return $contents;
        } finally {
            @unlink($path);
        }
    }

    public function csv(array $payload, string $lang, ?string $tableKey = null): string
    {
        $this->assertWithinLimit($payload);
        $table = $tableKey === null ? ($payload['tables'][0] ?? null) : collect($payload['tables'])->firstWhere('key', $tableKey);
        if ($table === null) {
            throw new RuntimeException('الجدول المطلوب غير موجود في هذا التقرير.');
        }
        [$headers, $rows, $types] = $this->flatten($payload, $table, $lang);

        $lines = [$this->csvLine($headers, array_fill(0, count($headers), SpreadsheetWriter::TYPE_TEXT))];
        foreach ($rows as $row) {
            $lines[] = $this->csvLine($row, $types);
        }

        return "\xEF\xBB\xBF".implode("\r\n", $lines)."\r\n";
    }

    /** يسجّل حدث تدقيق للتصدير (فاعل، تقرير، صيغة، فلاتر، عدد الصفوف) بلا أي قيمة مالية أو بيانات صفوف. */
    public function audit(User $user, array $payload, string $format, string $lang): void
    {
        $tenantId = app(TenantContext::class)->id();
        $stationIds = array_column($payload['stations'], 'id');
        FuelStationAuditEvent::create([
            'tenant_id' => $tenantId,
            'branch_id' => null,
            'fuel_station_id' => count($stationIds) === 1 ? $stationIds[0] : null,
            'warehouse_id' => null,
            'actor_id' => $user->id,
            'action' => 'report.exported',
            'subject_type' => 'fuel_report',
            'subject_id' => (string) Str::uuid(),
            'before' => null,
            'after' => [
                'report' => $payload['report']['key'], 'format' => $format, 'lang' => $lang, 'filters' => $payload['filters'],
                'rows' => array_sum(array_map(fn ($t) => count($t['rows']), $payload['tables'])), 'station_count' => count($stationIds),
            ],
            'reason' => null,
            'occurred_at' => now(),
        ]);
    }

    /**
     * يسجّل إجراء طباعة/PDF/مشاركة نُفِّذ في المتصفح من حمولة سبق تفويضها (بلا بيانات صفوف). التفويض بالصلاحية يتحقق منه المتحكّم قبل الاستدعاء.
     *
     * @param  array<string,mixed>  $filters  المرشحات المسموحة للتقرير فقط
     */
    public function auditClientAction(User $user, string $reportKey, string $action, array $filters): void
    {
        FuelStationAuditEvent::create([
            'tenant_id' => app(TenantContext::class)->id(),
            'branch_id' => null,
            'fuel_station_id' => isset($filters['station_id']) && is_string($filters['station_id']) ? $filters['station_id'] : null,
            'warehouse_id' => null,
            'actor_id' => $user->id,
            'action' => 'report.'.$action,
            'subject_type' => 'fuel_report',
            'subject_id' => (string) Str::uuid(),
            'before' => null,
            'after' => ['report' => $reportKey, 'filters' => $filters],
            'reason' => null,
            'occurred_at' => now(),
        ]);
    }

    public function filename(array $payload, string $lang, string $extension): string
    {
        $key = str_replace('.', '-', $payload['report']['key']);
        $period = $payload['period'] === null ? now()->format('Ymd') : $payload['period']['from'].'_'.$payload['period']['to'];

        return 'fuel-'.$key.'-'.$period.'-'.$lang.'.'.$extension;
    }

    // ───────── داخلي ─────────

    private function assertWithinLimit(array $payload): void
    {
        $rows = array_sum(array_map(fn ($t) => count($t['rows']), $payload['tables']));
        if ($rows > self::MAX_ROWS) {
            throw new RuntimeException('عدد الصفوف يتجاوز حد التصدير ('.self::MAX_ROWS.')؛ ضيّق الفترة.');
        }
    }

    /**
     * @param  array<string,mixed>  $table
     * @return array{0:list<string>,1:list<list<string|int|null>>,2:list<string>}
     */
    private function flatten(array $payload, array $table, string $lang): array
    {
        $columns = $table['columns'];
        $headers = array_map(fn ($c) => $c['label'][$lang], $columns);
        $types = array_map(fn ($c) => in_array($c['type'], ['int', 'liters', 'money', 'bp'], true) ? SpreadsheetWriter::TYPE_NUMBER : SpreadsheetWriter::TYPE_TEXT, $columns);
        $tz = $payload['timezone'];

        $rows = [];
        foreach ($table['rows'] as $row) {
            $rows[] = array_map(fn ($c) => $this->cell($c, $row[$c['key']] ?? null, $lang, $tz), $columns);
        }
        if ($table['totals'] !== null) {
            $total = [];
            foreach ($columns as $i => $c) {
                $total[] = $i === 0 ? ($lang === 'ar' ? 'الإجمالي' : 'Total') : (array_key_exists($c['key'], $table['totals']) ? $this->cell($c, $table['totals'][$c['key']], $lang, $tz) : null);
            }
            $rows[] = $total;
        }

        return [$headers, $rows, $types];
    }

    private function cell(array $column, mixed $value, string $lang, string $timezone): string|int|null
    {
        if ($value === null) {
            return null;
        }

        return match ($column['type']) {
            'liters' => F::liters((int) $value),
            'money' => F::money((int) $value),
            'bp' => F::percentBp((int) $value),
            'int' => (int) $value,
            'datetime' => F::dateTime((string) $value, $timezone),
            'status' => ($column['values'][$value][$lang] ?? (string) $value),
            default => (string) $value,
        };
    }

    /** @return array{name:string,headers:list<string>,rows:list<list<string|int|null>>,types:list<string>} */
    private function summarySheet(array $payload, string $lang): array
    {
        $ar = $lang === 'ar';
        $tz = $payload['timezone'];
        $rows = [
            [$ar ? 'التقرير' : 'Report', $payload['report']['title'][$lang]],
            [$ar ? 'المؤسسة' : 'Company', $payload['tenant']['name'] ?? ''],
            [$ar ? 'المحطات' : 'Stations', implode('، ', array_column($payload['stations'], 'name'))],
            [$ar ? 'الفترة' : 'Period', $payload['period'] === null ? ($ar ? 'الحالة الراهنة' : 'Current state') : $payload['period']['from'].' → '.$payload['period']['to']],
            [$ar ? 'المنطقة الزمنية' : 'Time zone', $tz],
            [$ar ? 'وقت الإنشاء' : 'Generated at', F::dateTime($payload['generated_at'], $tz)],
            [$ar ? 'مصدر البيانات' : 'Data source', $payload['source']['kind']],
            [$ar ? 'اكتمال البيانات' : 'Data complete', $payload['data_quality']['complete'] ? ($ar ? 'نعم' : 'Yes') : ($ar ? 'لا' : 'No')],
        ];
        foreach ($payload['summary'] as $item) {
            $value = $item['value'];
            $shown = $value === null ? '' : match ($item['type']) {
                'liters' => F::liters((int) $value),
                'money' => F::money((int) $value),
                'bp' => F::percentBp((int) $value),
                'datetime' => (string) F::dateTime((string) $value, $tz),
                default => (string) $value,
            };
            $rows[] = [$item['label'][$lang], $shown];
        }
        foreach ($payload['data_quality']['notes'] as $note) {
            $rows[] = [$ar ? 'ملاحظة' : 'Note', $note[$lang]];
        }
        foreach ($payload['data_quality']['gaps'] as $gap) {
            $rows[] = [$ar ? 'فجوة بيانات' : 'Data gap', $gap];
        }

        return ['name' => $ar ? 'ملخص' : 'Summary', 'headers' => [$ar ? 'البند' : 'Item', $ar ? 'القيمة' : 'Value'], 'rows' => $rows, 'types' => [SpreadsheetWriter::TYPE_TEXT, SpreadsheetWriter::TYPE_TEXT]];
    }

    /**
     * @param  array<int,string|int|null>  $values
     * @param  array<int,string>  $types
     */
    private function csvLine(array $values, array $types): string
    {
        $cells = [];
        foreach (array_values($values) as $i => $value) {
            $text = $value === null ? '' : (string) $value;
            // الحقن: النصوص (بما فيها ما يأتي من المستخدم) فقط؛ الأرقام من المحرك فسالبها يبقى رقماً.
            if (($types[$i] ?? SpreadsheetWriter::TYPE_TEXT) === SpreadsheetWriter::TYPE_TEXT && $text !== '' && str_contains("=+-@\t\r", $text[0])) {
                $text = "'".$text;
            }
            $cells[] = preg_match('/[",\r\n]/', $text) === 1 ? '"'.str_replace('"', '""', $text).'"' : $text;
        }

        return implode(',', $cells);
    }
}
