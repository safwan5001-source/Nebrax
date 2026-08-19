<?php

use App\Support\PrintTemplateContract;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * يرقي نسخة التصميم المهاجرة إلى مراجعة حديثة قابلة للحل الحي.
 *
 * لا يحرر تعريف `legacy_sales_designs` ولا يحذف الإعداد القديم. كل قالب مهاجر
 * يحصل على مراجعة منشورة جديدة، وتبقى اللقطة الأولى محفوظة ومعلّمة superseded
 * بالنمط نفسه الذي تستعمله خدمة النشر. لا يستبدل التعيين الضريبي إذا اختار
 * المستأجر لاحقاً مراجعة أخرى، ولا ينشئ تعيينات لباقي الأنواع عند وجود افتراضي
 * مؤسسة صريح لها.
 */
return new class extends Migration
{
    private const COMPATIBILITY_TYPES = [
        'quotation' => 'تصميم عروض الأسعار المهاجر',
        'credit_note' => 'تصميم الإشعارات الدائنة المهاجر',
        'debit_note' => 'تصميم الإشعارات المدينة المهاجر',
        'receipt_voucher' => 'تصميم سندات القبض المهاجر',
        'payment_voucher' => 'تصميم سندات الصرف المهاجر',
    ];

    public function up(): void
    {
        DB::table('print_templates')
            ->where('source', 'migrated')
            ->orderBy('id')
            ->get()
            ->each(fn (object $template) => $this->upgrade($template));
    }

    public function down(): void
    {
        // الترقية تحفظ اللقطات الأصلية وتعيينات المستأجرين اللاحقة، ولذلك لا
        // يوجد rollback آمن آلياً. يستمر تعريف legacy_sales_designs والإعداد
        // القديم كمسار استعادة صريح عند الحاجة.
    }

    private function upgrade(object $template): void
    {
        $published = DB::table('print_template_revisions')
            ->where('id', $template->published_revision_id)
            ->first();
        $legacy = $published === null ? null : $this->legacyDefinition($published->definition);

        if ($legacy === null) {
            return;
        }

        DB::transaction(function () use ($template, $published, $legacy): void {
            $now = now();
            $taxDefinition = $this->definition($legacy, true);
            $taxRevisionId = (string) Str::uuid();
            $nextVersion = (int) DB::table('print_template_revisions')
                ->where('print_template_id', $template->id)
                ->max('version') + 1;

            DB::table('print_template_revisions')
                ->where('print_template_id', $template->id)
                ->where('status', 'published')
                ->update(['status' => 'superseded', 'updated_at' => $now]);

            $this->insertRevision(
                id: $taxRevisionId,
                tenantId: $template->tenant_id,
                templateId: $template->id,
                version: $nextVersion,
                types: ['tax_invoice'],
                definition: $taxDefinition,
                now: $now,
            );

            DB::table('print_templates')
                ->where('id', $template->id)
                ->update([
                    'document_types' => json_encode(['tax_invoice']),
                    'status' => 'published',
                    'published_revision_id' => $taxRevisionId,
                    'updated_at' => $now,
                ]);

            // لا يتغير قرار مستأجر اختار مراجعة أخرى بعد الهجرة الأولى.
            DB::table('print_template_assignments')
                ->where('print_template_revision_id', $published->id)
                ->where('document_type', 'tax_invoice')
                ->where('usage', 'print')
                ->update([
                    'print_template_revision_id' => $taxRevisionId,
                    'updated_at' => $now,
                ]);

            foreach (self::COMPATIBILITY_TYPES as $documentType => $name) {
                $hasCompanyDefault = DB::table('print_template_assignments')
                    ->where('tenant_id', $template->tenant_id)
                    ->whereNull('branch_id')
                    ->where('document_type', $documentType)
                    ->where('usage', 'print')
                    ->exists();

                if ($hasCompanyDefault) {
                    continue;
                }

                $compatibilityTemplateId = (string) Str::uuid();
                $compatibilityRevisionId = (string) Str::uuid();

                // لا يوجد FK دائري: ننشئ القالب أولاً من دون مرجع منشور، ثم
                // المراجعة، ثم نصل published_revision_id في التحديث التالي.
                DB::table('print_templates')->insert([
                    'id' => $compatibilityTemplateId,
                    'tenant_id' => $template->tenant_id,
                    'name' => $name,
                    'source' => 'migrated',
                    'status' => 'published',
                    'document_types' => json_encode([$documentType]),
                    'published_revision_id' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                $this->insertRevision(
                    id: $compatibilityRevisionId,
                    tenantId: $template->tenant_id,
                    templateId: $compatibilityTemplateId,
                    version: 1,
                    types: [$documentType],
                    // تخطيط البنود القديم لا يحقق عقد السند؛ دَع سجل النوع
                    // يمد التخطيط الافتراضي الصحيح للسندات وحدها.
                    definition: $this->definition($legacy, ! in_array($documentType, ['receipt_voucher', 'payment_voucher'], true)),
                    now: $now,
                );

                DB::table('print_templates')
                    ->where('id', $compatibilityTemplateId)
                    ->update(['published_revision_id' => $compatibilityRevisionId, 'updated_at' => $now]);

                DB::table('print_template_assignments')->insert([
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $template->tenant_id,
                    'branch_id' => null,
                    'document_type' => $documentType,
                    'usage' => 'print',
                    'print_template_revision_id' => $compatibilityRevisionId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        });
    }

    /** @return array<string, mixed>|null */
    private function legacyDefinition(mixed $raw): ?array
    {
        $definition = is_array($raw) ? $raw : json_decode((string) $raw, true);
        $legacy = is_array($definition) ? ($definition['legacy_sales_designs'] ?? null) : null;

        return is_array($legacy) ? $legacy : null;
    }

    /** @param array<string, mixed> $legacy
     *  @return array<string, mixed>
     */
    private function definition(array $legacy, bool $copyLayout): array
    {
        $template = (string) ($legacy['template'] ?? 'classic');
        $templateId = str_starts_with($template, 'tax-invoice-')
            ? $template
            : 'tax-invoice-'.$template;
        $definition = [
            'schema_version' => 1,
            'template_id' => in_array($templateId, ['tax-invoice-classic', 'tax-invoice-modern', 'tax-invoice-minimal', 'tax-invoice-retail'], true)
                ? $templateId
                : 'tax-invoice-classic',
            'theme_id' => is_string($legacy['theme'] ?? null) ? $legacy['theme'] : null,
            'show_logo' => ($legacy['show_logo'] ?? true) !== false,
            'logo_height' => is_numeric($legacy['logo_height'] ?? null) ? (int) $legacy['logo_height'] : null,
            'footer_text' => is_string($legacy['footer_text'] ?? null) ? $legacy['footer_text'] : null,
            'terms_text' => is_string($legacy['terms_text'] ?? null) ? $legacy['terms_text'] : null,
            'bank_text' => is_string($legacy['bank_text'] ?? null) ? $legacy['bank_text'] : null,
            'stamp' => is_string($legacy['stamp'] ?? null) ? $legacy['stamp'] : null,
            'signature' => is_string($legacy['signature'] ?? null) ? $legacy['signature'] : null,
            'migrated_legacy_sales_designs' => true,
        ];

        if ($copyLayout && is_array($legacy['sections'] ?? null) && array_is_list($legacy['sections']) && $legacy['sections'] !== []) {
            $definition['layout'] = $legacy['sections'];
        }

        return array_filter($definition, static fn (mixed $value): bool => $value !== null);
    }

    /** @param array<int, string> $types
     *  @param array<string, mixed> $definition
     */
    private function insertRevision(string $id, string $tenantId, string $templateId, int $version, array $types, array $definition, mixed $now): void
    {
        DB::table('print_template_revisions')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'print_template_id' => $templateId,
            'version' => $version,
            'status' => 'published',
            'schema_version' => 1,
            'document_types' => json_encode($types),
            'definition' => json_encode($definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'checksum' => PrintTemplateContract::checksum($definition),
            'published_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
};
