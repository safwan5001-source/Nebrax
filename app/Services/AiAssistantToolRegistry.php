<?php

namespace App\Services;

use App\Contracts\AiAssistantTool;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;

/**
 * سجلّ الأدوات **المغلق**. يُعلَن هنا فقط ما يُسمح للمساعد باستدعائه؛ لا اكتشاف ديناميكي ولا اسم أداة
 * من النموذج يُحلّ خارج هذه القائمة. AI-01: فارغ. AI-02B: ثلاث أدوات قراءة مالية حتمية (قائمة
 * الدخل، أعمار الذمم المدينة، أعمار الذمم الدائنة). AI-04: أداة قراءة مستند مُسقَط صريحة الاستدعاء. أي أداة جديدة قرارٌ مراجَع يُضاف هنا وحده.
 */
class AiAssistantToolRegistry
{
    /** @var array<string, AiAssistantTool>|null */
    private ?array $index = null;

    /** @return list<AiAssistantTool> */
    protected function definitions(): array
    {
        $tenant = app(TenantContext::class);
        $reports = app(ReportService::class);

        return [
            new AiIncomeStatementTool($tenant, $reports),
            new AiAgingReportTool($tenant, $reports, 'receivable'),
            new AiAgingReportTool($tenant, $reports, 'payable'),
            // AI-04: قراءة نصّ مستند مُسقَط — صريحة الاستدعاء فقط (لا يخطّط لها المزوّد).
            app(AiDocumentProjectionTool::class),
        ];
    }

    public function find(string $name): ?AiAssistantTool
    {
        $this->index ??= collect($this->definitions())
            ->mapWithKeys(fn (AiAssistantTool $tool): array => [$tool->name() => $tool])
            ->all();

        return $this->index[$name] ?? null;
    }

    /**
     * الأدوات التي يجوز عرضها على **نموذج خارجي** (AI-07): كلّ المسجَّل عدا الصريحة الاستدعاء (قراءة المستند).
     * فلا يرى النموذج وجودها أصلاً، ولو اقترح اسمها لرفضتها البوابة كـ`tool_not_registered`.
     *
     * @return list<AiAssistantTool>
     */
    public function offeredToModel(): array
    {
        return array_values(array_filter(
            $this->definitions(),
            static fn (AiAssistantTool $tool): bool => ! $tool instanceof \App\Contracts\AiExplicitInvocationOnly,
        ));
    }

    /** @return list<string> */
    public function names(): array
    {
        return array_values(array_map(
            static fn (AiAssistantTool $tool): string => $tool->name(),
            $this->definitions(),
        ));
    }
}
