<?php

namespace App\Services;

use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `partner_statement` (IMP-PS-A1): استيراد كشف حساب طرف إلى جداول تجهيز المقارنة، **ذرّي بطبيعته** — وحدته الملف كله. مسجَّل في `ImportDomainRegistry` و`ImportJobDomain`
 * (مربوط بمعاينة وحده). لا قيد ولا مستند ولا رصيد ولا ZATCA من هنا أبداً، **ولا مسار ذكاء اصطناعي**. الطرف والدور والفترة والسياسات خيارات مجمَّدة مع بصمة المعاينة.
 */
class PartnerStatementImportAdapter extends SpreadsheetImportAdapter
{
    public const DOMAIN = ImportJobDomain::PARTNER_STATEMENT;

    public function domain(): string
    {
        return self::DOMAIN;
    }

    public function unit(): string
    {
        return self::UNIT_FILE;
    }

    /** ذرّي: سقفه سقف خدمته نفسه غير مرفوع. */
    public function maxRows(): int
    {
        return PartnerStatementImportService::MAX_ROWS;
    }

    public function canonicalOptions(array $raw): array
    {
        $options = [
            'partner_id' => strtolower(trim((string) ($raw['partner_id'] ?? ''))),
            'role' => (string) ($raw['role'] ?? ''),
            'period_from' => (string) ($raw['period_from'] ?? ''),
            'period_to' => (string) ($raw['period_to'] ?? ''),
            'currency' => strtoupper(trim((string) (($raw['currency'] ?? '') !== '' ? $raw['currency'] : 'SAR'))),
            'amount_direction' => $this->nullableText($raw['amount_direction'] ?? null),
            // القيم غير الرقمية تبقى كما وردت ليرفضها التحقق بدل أن يُخفيها التحويل.
            'date_tolerance_days' => $this->intOrRaw($raw['date_tolerance_days'] ?? PartnerStatementImportService::DEFAULT_DATE_TOLERANCE_DAYS),
            'amount_tolerance_minor' => $this->intOrRaw($raw['amount_tolerance_minor'] ?? PartnerStatementImportService::DEFAULT_AMOUNT_TOLERANCE_MINOR),
            'branch_id' => ($branch = $this->nullableText($raw['branch_id'] ?? null)) === null ? null : strtolower($branch),
        ];

        return $this->withMapping($options, $raw);
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $result = app(PartnerStatementImportService::class)->apply(
            $chunk->file,
            array_intersect_key($chunk->options, array_flip(['partner_id', 'role', 'period_from', 'period_to', 'currency', 'amount_direction', 'date_tolerance_days', 'amount_tolerance_minor', 'branch_id', 'mapping'])),
            $chunk->userId,
            (string) $chunk->job->getKey(),
        );

        return new ImportChunkResult((int) $chunk->job->row_count, $result);
    }

    private function intOrRaw(mixed $value): mixed
    {
        return is_int($value) || (is_string($value) && preg_match('/^\d{1,9}$/', trim($value)) === 1) ? (int) $value : $value;
    }

    private function nullableText(mixed $value): ?string
    {
        $text = trim((string) ($value ?? ''));

        return $text === '' ? null : $text;
    }
}
