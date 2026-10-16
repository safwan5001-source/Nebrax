<?php

namespace App\Services;

use App\Contracts\AiAssistantTool;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;

/**
 * سجلّ الأدوات **المغلق**. يُعلَن هنا فقط ما يُسمح للمساعد باستدعائه؛ لا اكتشاف ديناميكي ولا اسم أداة
 * من النموذج يُحلّ خارج هذه القائمة. AI-01: فارغ. AI-02B: ثلاث أدوات قراءة مالية حتمية فقط (قائمة
 * الدخل، أعمار الذمم المدينة، أعمار الذمم الدائنة). أي أداة جديدة قرارٌ مراجَع يُضاف هنا وحده.
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
        ];
    }

    public function find(string $name): ?AiAssistantTool
    {
        $this->index ??= collect($this->definitions())
            ->mapWithKeys(fn (AiAssistantTool $tool): array => [$tool->name() => $tool])
            ->all();

        return $this->index[$name] ?? null;
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
