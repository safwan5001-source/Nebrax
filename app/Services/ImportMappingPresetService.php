<?php

namespace App\Services;

use App\Models\ImportMappingPreset;
use App\Support\ImportHeaderMatcher;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * مطابقات الأعمدة المحفوظة (IMP-H8-S2a). تخزّن **عناوين الأعمدة** مع مفاتيح الحقول، وتُطبَّق على ملفٍ جديد بمطابقة العنوان المطبَّع (`ImportHeaderMatcher::normalize`)
 * لا بالفهرس. **لا تتحقق من مفتاح الحقل مقابل عقد المجال** (لكل مجال عقده وخدمته): المطابقة مدخلٌ استرشادي للواجهة، ويتحقق طلب المعاينة/التشغيلة نفسه
 * من كل مفتاح كما اليوم (`Rule::in`)؛ مفتاحٌ لا يعرفه المجال يرفضه الخادم عند المعاينة لا هنا.
 * البوابات (صلاحية المجال + قدرته) يفرضها المتحكّم عبر `ImportJobAccess`.
 */
class ImportMappingPresetService
{
    public const MAX_PER_DOMAIN = 50;

    public const MAX_COLUMNS = 200;

    public const NAME_MAX = 80;

    public const HEADER_MAX = 200;

    /** @return Collection<int, ImportMappingPreset> */
    public function list(string $domain): Collection
    {
        return ImportMappingPreset::query()->where('domain', $domain)->orderBy('name_key')->get();
    }

    /**
     * @param  list<array{header: string, field: ?string}>  $columns
     */
    public function create(string $domain, string $name, array $columns, ?string $userId): ImportMappingPreset
    {
        $name = trim($name);
        $nameKey = ImportHeaderMatcher::normalize($name);
        if ($name === '' || $nameKey === '') {
            throw new RuntimeException('اسم المطابقة مطلوب.');
        }
        if (mb_strlen($name) > self::NAME_MAX) {
            throw new RuntimeException('اسم المطابقة يتجاوز '.self::NAME_MAX.' حرفاً.');
        }

        $normalized = $this->normalizeColumns($columns);
        $tenantId = app(TenantContext::class)->id();

        // الفحص ثم الإدراج تحت قفلٍ استشاري لكل (مؤسسة، مجال): على PostgreSQL لا يُلتقط خطأ التفرّد داخل المعاملة (تُسمَّم)، والقيد الفريد شبكة الأمان الأخيرة.
        return DB::transaction(function () use ($domain, $name, $nameKey, $normalized, $tenantId, $userId): ImportMappingPreset {
            if (DB::getDriverName() === 'pgsql') {
                DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['import-mapping-presets:'.$tenantId.':'.$domain]);
            }
            if (ImportMappingPreset::query()->where('domain', $domain)->where('name_key', $nameKey)->exists()) {
                throw new RuntimeException('توجد مطابقة محفوظة بهذا الاسم لهذا الاستيراد. اختر اسماً آخر أو احذف القديمة.');
            }
            if (ImportMappingPreset::query()->where('domain', $domain)->count() >= self::MAX_PER_DOMAIN) {
                throw new RuntimeException('بلغت الحد الأقصى من المطابقات المحفوظة لهذا الاستيراد ('.self::MAX_PER_DOMAIN.'). احذف مطابقة لا تحتاجها.');
            }

            return ImportMappingPreset::query()->create([
                'tenant_id' => $tenantId, 'domain' => $domain, 'name' => $name, 'name_key' => $nameKey, 'columns' => $normalized, 'created_by' => $userId,
            ]);
        });
    }

    public function delete(ImportMappingPreset $preset): void
    {
        $preset->delete();
    }

    /**
     * يطبّق مطابقةً محفوظة على عناوين ملفٍ جديد: كل عمود يطابق عنواناً محفوظاً (بالمفتاح المطبَّع) يأخذ حقله، وغير المطابق `null` (يبقى للمطابقة التلقائية/المستخدم).
     * عنوان محفوظ مكرر المفتاح (عمودان بالعنوان نفسه) يُستهلك بالترتيب: أول عمود مطابق يأخذ أول إدخال، فلا يُربَط حقلٌ بعمودين.
     *
     * @param  list<string>  $headers
     * @return array{mapping: array<int, ?string>, matched: int, unmatched: list<int>}
     */
    public function match(ImportMappingPreset $preset, array $headers): array
    {
        $pool = [];
        foreach ((array) $preset->columns as $column) {
            $pool[(string) ($column['header_key'] ?? '')][] = $column['field'] ?? null;
        }

        $mapping = [];
        $unmatched = [];
        $matched = 0;
        foreach (array_values($headers) as $index => $header) {
            $key = ImportHeaderMatcher::normalize((string) $header);
            if ($key !== '' && ! empty($pool[$key])) {
                $mapping[$index] = array_shift($pool[$key]);
                $matched++;
            } else {
                $mapping[$index] = null;
                $unmatched[] = $index;
            }
        }

        return ['mapping' => $mapping, 'matched' => $matched, 'unmatched' => $unmatched];
    }

    /**
     * @param  list<array{header: string, field: ?string}>  $columns
     * @return list<array{header: string, header_key: string, field: ?string}>
     */
    private function normalizeColumns(array $columns): array
    {
        if ($columns === [] || count($columns) > self::MAX_COLUMNS) {
            throw new RuntimeException('المطابقة تحتاج بين عمود و'.self::MAX_COLUMNS.' عموداً.');
        }

        $out = [];
        $assigned = [];
        foreach ($columns as $column) {
            $header = trim((string) ($column['header'] ?? ''));
            $field = isset($column['field']) && $column['field'] !== '' && $column['field'] !== 'ignore' ? (string) $column['field'] : null;
            if (mb_strlen($header) > self::HEADER_MAX) {
                throw new RuntimeException('عنوان عمود يتجاوز '.self::HEADER_MAX.' حرفاً.');
            }
            if ($field !== null) {
                if (isset($assigned[$field])) {
                    throw new RuntimeException('أكثر من عمود مربوط بالحقل نفسه؛ اربط كل حقل بعمود واحد.');
                }
                $assigned[$field] = true;
            }
            $out[] = ['header' => $header, 'header_key' => ImportHeaderMatcher::normalize($header), 'field' => $field];
        }

        return $out;
    }
}
