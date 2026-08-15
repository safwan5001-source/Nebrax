<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * ═══════════════════════════════════════════════════════════════
 *  نقل إعدادات `sales_config.designs` إلى مكتبة قوالب مؤصّلة
 * ═══════════════════════════════════════════════════════════════
 *
 * الانتقال **نسخ لا نقل**: تظل الإعدادات القديمة كما هي، فلا يتغير مسار طباعة
 * قائم قبل أن تتبنى الواجهة في المرحلة التالية API القوالب الجديدة. لكل مستأجر
 * يملك إعداد تصميم محفوظ ننشئ:
 *
 *   قالباً باسم واضح → مراجعة v1 منشورة → تعيين شركة للفواتير الضريبية.
 *
 * لا ننشئ سجلاً لمستأجر لم يحفظ إعداداً أصلاً؛ يظل سلوك الافتراضي الحالي
 * مصدراً للحقيقة له حتى ينشئ أو يختار قالباً من المكتبة الجديدة.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('tenants')->get(['id', 'settings']) as $tenant) {
            $settings = $this->decode($tenant->settings);
            $designs = $settings['sales_config']['designs'] ?? null;

            if (! is_array($designs) || $designs === []) {
                continue;
            }

            // هجرة قابلة للإعادة يدوياً: لا تكرر قالب انتقال لهذا المستأجر.
            if (DB::table('print_templates')
                ->where('tenant_id', $tenant->id)
                ->where('source', 'migrated')
                ->exists()) {
                continue;
            }

            $templateId = (string) Str::uuid();
            $revisionId = (string) Str::uuid();
            $now = now();
            $types = ['tax_invoice'];
            $definition = [
                'schema_version' => 1,
                'legacy_sales_designs' => $designs,
            ];
            $checksum = hash('sha256', json_encode($definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            DB::table('print_templates')->insert([
                'id'                    => $templateId,
                'tenant_id'             => $tenant->id,
                'name'                  => 'تصميم الفواتير المهاجر',
                'source'                => 'migrated',
                'status'                => 'published',
                'document_types'        => json_encode($types),
                'published_revision_id' => $revisionId,
                'created_at'            => $now,
                'updated_at'            => $now,
            ]);

            DB::table('print_template_revisions')->insert([
                'id'                => $revisionId,
                'tenant_id'         => $tenant->id,
                'print_template_id' => $templateId,
                'version'           => 1,
                'status'            => 'published',
                'schema_version'    => 1,
                'document_types'    => json_encode($types),
                'definition'        => json_encode($definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'checksum'          => $checksum,
                'published_at'      => $now,
                'created_at'        => $now,
                'updated_at'        => $now,
            ]);

            DB::table('print_template_assignments')->insert([
                'id'                         => (string) Str::uuid(),
                'tenant_id'                  => $tenant->id,
                'branch_id'                  => null,
                'document_type'              => 'tax_invoice',
                'usage'                      => 'print',
                'print_template_revision_id' => $revisionId,
                'created_at'                 => $now,
                'updated_at'                 => $now,
            ]);
        }
    }

    public function down(): void
    {
        $templateIds = DB::table('print_templates')->where('source', 'migrated')->pluck('id');
        if ($templateIds->isEmpty()) {
            return;
        }

        // الترتيب يحترم قيود FK، والإعداد القديم لم يمسّ فيبقى مسار الرجوع آمناً.
        DB::table('print_template_assignments')
            ->whereIn('print_template_revision_id', DB::table('print_template_revisions')->whereIn('print_template_id', $templateIds)->select('id'))
            ->delete();
        DB::table('print_template_revisions')->whereIn('print_template_id', $templateIds)->delete();
        DB::table('print_templates')->whereIn('id', $templateIds)->delete();
    }

    /** settings JSON قد يصل نصاً أو مصفوفةً حسب السائق. */
    private function decode(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }

        return json_decode((string) $raw, true) ?: [];
    }
};
