<?php

namespace App\Services\PrintTemplates;

use App\Models\Branch;
use App\Models\PrintTemplate;
use App\Models\PrintTemplateAssignment;
use App\Models\PrintTemplateRevision;
use App\Models\User;
use App\Support\PrintTemplateContract;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة حياة قوالب الطباعة.
 *
 * نقطة القرار الوحيدة للمراجعات والتعيينات: لا ينشئ المتحكم مراجعة منشورة، ولا
 * يقبل تعييناً يشير إلى مسودة. عند إصدار المستند ستضيف مرحلة الإخراج binding
 * يشير إلى `PrintTemplateRevision` المنشورة التي حلّها هذا المسار.
 */
class PrintTemplateService
{
    public function create(array $data, ?User $actor): PrintTemplate
    {
        return DB::transaction(function () use ($data, $actor) {
            $types = PrintTemplateContract::assertDocumentTypes($data['document_types']);
            $definition = PrintTemplateContract::assertDefinition($data['definition'], $types);
            $name = $this->normalizedName($data['name']);
            $this->assertNameFree($name);

            $template = PrintTemplate::create([
                'name'           => $name,
                'source'         => 'custom',
                'status'         => 'draft',
                'document_types' => $types,
                'created_by'     => $actor?->id,
            ]);

            $this->createRevision($template, $types, $definition, $actor, $data['schema_version'] ?? 1);

            return $template->fresh(['draftRevision', 'publishedRevision']);
        });
    }

    /**
     * يحدّث المسودة الوحيدة. إن كان القالب منشوراً فقط، ينشئ نسخة تالية أولاً؛
     * لذلك لا تنقلب طباعة مستند تاريخي حين يعدّل المستخدم قالباً وافق عليه سابقاً.
     */
    public function updateDraft(PrintTemplate $template, array $data, ?User $actor): PrintTemplate
    {
        return DB::transaction(function () use ($template, $data, $actor) {
            $template = PrintTemplate::lockForUpdate()->findOrFail($template->id);
            $types = array_key_exists('document_types', $data)
                ? PrintTemplateContract::assertDocumentTypes($data['document_types'])
                : $template->document_types;

            $revision = $this->draftFor($template, $types, $actor);
            $definition = array_key_exists('definition', $data)
                ? PrintTemplateContract::assertDefinition($data['definition'], $types)
                : PrintTemplateContract::assertDefinition($revision->definition, $types);

            if (array_key_exists('name', $data)) {
                $name = $this->normalizedName($data['name']);
                $this->assertNameFree($name, $template->id);
                $template->name = $name;
            }

            $template->document_types = $types;
            // وجود مراجعة منشورة يبقي القالب صالحاً للتعيين والطباعة؛ المسودة
            // اللاحقة اقتراح فقط، ولا تسحب النسخة المعتمدة من المستخدمين.
            $template->status = $template->published_revision_id !== null
                ? PrintTemplateRevision::STATUS_PUBLISHED
                : PrintTemplateRevision::STATUS_DRAFT;
            $template->save();

            $revision->update([
                'document_types' => $types,
                'definition'     => $definition,
                'checksum'       => PrintTemplateContract::checksum($definition),
                'schema_version' => $data['schema_version'] ?? $revision->schema_version,
            ]);

            return $template->fresh(['draftRevision', 'publishedRevision']);
        });
    }

    /** تنشر مسودة بعد أن تستبدل أي مراجعة منشورة سابقة بحالة superseded. */
    public function publish(PrintTemplate $template): PrintTemplate
    {
        return DB::transaction(function () use ($template) {
            $template = PrintTemplate::lockForUpdate()->findOrFail($template->id);
            $revision = PrintTemplateRevision::where('print_template_id', $template->id)
                ->where('status', PrintTemplateRevision::STATUS_DRAFT)
                ->orderByDesc('version')
                ->lockForUpdate()
                ->first();

            if ($revision === null) {
                throw new RuntimeException('لا توجد مسودة قابلة للنشر لهذا القالب.');
            }

            // إعادة الفحص هنا مهمة: لا تُنشر بياناتٍ أدخلتها رحلة API قديمة أو عميلٌ متجاوز.
            $types = PrintTemplateContract::assertDocumentTypes($revision->document_types);
            $definition = PrintTemplateContract::assertDefinition($revision->definition, $types);

            PrintTemplateRevision::where('print_template_id', $template->id)
                ->where('status', PrintTemplateRevision::STATUS_PUBLISHED)
                ->update(['status' => PrintTemplateRevision::STATUS_SUPERSEDED]);

            $revision->update([
                'status'         => PrintTemplateRevision::STATUS_PUBLISHED,
                'published_at'   => now(),
                'document_types' => $types,
                'definition'     => $definition,
                'checksum'       => PrintTemplateContract::checksum($definition),
            ]);

            $template->update([
                'status'                => PrintTemplateRevision::STATUS_PUBLISHED,
                'document_types'        => $types,
                'published_revision_id' => $revision->id,
            ]);

            return $template->fresh(['publishedRevision', 'draftRevision']);
        });
    }

    /** ينشئ مسودة مستقلة من آخر مراجعة متاحة؛ لا يحرّر مصدر النسخ. */
    public function duplicate(PrintTemplate $source, string $name, ?User $actor): PrintTemplate
    {
        return DB::transaction(function () use ($source, $name, $actor) {
            $source = PrintTemplate::with(['publishedRevision', 'draftRevision'])->findOrFail($source->id);
            $base = $source->publishedRevision ?? $source->draftRevision;
            if ($base === null) {
                throw new RuntimeException('القالب المصدر لا يحتوي مراجعة قابلة للنسخ.');
            }

            $name = $this->normalizedName($name);
            $this->assertNameFree($name);
            $types = PrintTemplateContract::assertDocumentTypes($base->document_types);
            $definition = PrintTemplateContract::assertDefinition($base->definition, $types);

            $template = PrintTemplate::create([
                'name'           => $name,
                'source'         => 'custom',
                'status'         => 'draft',
                'document_types' => $types,
                'created_by'     => $actor?->id,
            ]);
            $this->createRevision($template, $types, $definition, $actor, $base->schema_version);

            return $template->fresh(['draftRevision', 'publishedRevision']);
        });
    }

    /**
     * يعيّن مراجعة منشورة لسياق. التعيين العام (`branch_id = null`) صريح؛ الفرع
     * لا يرث نسخة جديدة بل يتجاوز قرار الاختيار فقط.
     */
    public function assign(array $data, ?User $actor): PrintTemplateAssignment
    {
        return DB::transaction(function () use ($data, $actor) {
            $usage = PrintTemplateContract::assertUsage($data['usage'] ?? PrintTemplateAssignment::USAGE_PRINT);
            $documentType = PrintTemplateContract::assertDocumentTypes([$data['document_type']])[0];
            $branchId = $data['branch_id'] ?? null;

            if ($branchId !== null && ! Branch::whereKey($branchId)->exists()) {
                throw new RuntimeException('الفرع المحدد غير موجود.');
            }

            $revision = PrintTemplateRevision::with('template')
                ->whereKey($data['print_template_revision_id'])
                ->where('status', PrintTemplateRevision::STATUS_PUBLISHED)
                ->first();

            if ($revision === null) {
                throw new RuntimeException('لا يمكن تعيين مراجعة غير منشورة أو غير موجودة.');
            }
            if (! in_array($documentType, $revision->document_types, true)) {
                throw new RuntimeException('مراجعة القالب لا تدعم نوع المستند المحدد.');
            }

            $query = PrintTemplateAssignment::where('branch_id', $branchId)
                ->where('document_type', $documentType)
                ->where('usage', $usage);
            $assignment = $branchId === null
                ? $query->whereNull('branch_id')->first()
                : $query->first();

            if ($assignment === null) {
                $assignment = new PrintTemplateAssignment([
                    'branch_id'     => $branchId,
                    'document_type' => $documentType,
                    'usage'         => $usage,
                    'created_by'    => $actor?->id,
                ]);
            }

            $assignment->print_template_revision_id = $revision->id;
            $assignment->save();

            return $assignment->fresh('revision.template');
        });
    }

    /** أولوية اختيار واحدة: الفرع أولاً، ثم افتراضي المؤسسة. */
    public function resolve(string $documentType, string $usage, ?string $branchId): ?PrintTemplateAssignment
    {
        $usage = PrintTemplateContract::assertUsage($usage);
        $documentType = PrintTemplateContract::assertDocumentTypes([$documentType])[0];

        $query = PrintTemplateAssignment::with('revision.template')
            ->where('document_type', $documentType)
            ->where('usage', $usage);

        if ($branchId !== null) {
            $branchAssignment = (clone $query)->where('branch_id', $branchId)->first();
            if ($branchAssignment !== null) {
                return $branchAssignment;
            }
        }

        return $query->whereNull('branch_id')->first();
    }

    /**
     * يحل لقطة الإخراج الكاملة عند لحظة إصدار واحدة. تبقى القيمة null إن لم
     * يوجد تعيين؛ يقرأ المستهلك عندها العارض الافتراضي الآمن، لا تعييناً حياً
     * ينشأ لاحقاً.
     *
     * @return array{print_template_revision_id: ?string, pdf_template_revision_id: ?string, thermal_template_revision_id: ?string}
     */
    public function resolveOutputRevisionIds(string $documentType, ?string $branchId): array
    {
        $print = $this->resolve($documentType, 'print', $branchId);
        $pdf = $this->resolve($documentType, 'pdf', $branchId);
        $thermal = $this->resolve($documentType, 'thermal', $branchId);

        return [
            'print_template_revision_id' => $print?->print_template_revision_id,
            'pdf_template_revision_id' => $pdf?->print_template_revision_id,
            'thermal_template_revision_id' => $thermal?->print_template_revision_id,
        ];
    }

    private function draftFor(PrintTemplate $template, array $types, ?User $actor): PrintTemplateRevision
    {
        $draft = PrintTemplateRevision::where('print_template_id', $template->id)
            ->where('status', PrintTemplateRevision::STATUS_DRAFT)
            ->orderByDesc('version')
            ->lockForUpdate()
            ->first();

        if ($draft !== null) {
            return $draft;
        }

        $base = $template->publishedRevision;
        $definition = $base?->definition ?? [];

        return $this->createRevision($template, $types, $definition, $actor, $base?->schema_version ?? 1);
    }

    private function createRevision(
        PrintTemplate $template,
        array $types,
        array $definition,
        ?User $actor,
        int $schemaVersion = 1,
    ): PrintTemplateRevision
    {
        $version = (int) PrintTemplateRevision::where('print_template_id', $template->id)->max('version') + 1;

        return PrintTemplateRevision::create([
            'print_template_id' => $template->id,
            'version'           => $version,
            'status'            => PrintTemplateRevision::STATUS_DRAFT,
            'schema_version'    => $schemaVersion,
            'document_types'    => $types,
            'definition'        => $definition,
            'checksum'          => PrintTemplateContract::checksum($definition),
            'created_by'        => $actor?->id,
        ]);
    }

    private function normalizedName(string $name): string
    {
        $name = trim($name);
        if ($name === '') {
            throw new RuntimeException('اسم القالب مطلوب.');
        }

        return $name;
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = PrintTemplate::where('name', $name);
        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }

        if ($query->exists()) {
            throw new RuntimeException('يوجد قالب طباعة بهذا الاسم.');
        }
    }
}
