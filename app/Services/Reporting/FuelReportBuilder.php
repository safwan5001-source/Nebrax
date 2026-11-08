<?php

namespace App\Services\Reporting;

use App\Support\FuelReportDefinition;

/**
 * بانٍ لعائلة تقارير وقود: يستقبل تعريف التقرير والسياق ويعيد جزء الحمولة الخاص به فقط
 * (`summary`, `tables`, `gaps`, `truncated`, `notes`, `period`). التجميع والصلاحيات الحسّاسة والإجماليات يتولاها `FuelReportEngine` وحده.
 */
interface FuelReportBuilder
{
    /**
     * @return array{summary?:list<array<string,mixed>>,tables:list<array<string,mixed>>,gaps?:list<string>,truncated?:bool,notes?:list<array{ar:string,en:string}>,period?:bool}
     */
    public function build(FuelReportDefinition $definition, FuelReportContext $context): array;
}
