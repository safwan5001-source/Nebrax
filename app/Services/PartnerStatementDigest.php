<?php

namespace App\Services;

use App\Models\PartnerStatementLine;

/**
 * بصمة موثوقة لسطور كشف الطرف (IMP-PS-A3c): SHA-256 لقائمة سطور المقارنة مرتَّبةً برقم الصف، بكل أعمدة المحتوى **ومعرّف السطر** (القرارات تشير إلى المعرّفات).
 * تُحسب عند الاستيراد (`lines_digest` على المقارنة، مرة واحدة)، وعند كل تشغيلة مطابقة (`statement_digest`)، وتُقارَن عند القرار وعند وضع المقارنة في `reviewed`: أي تعديل
 * أو حذف أو إدراج لسطر **خارج التطبيق** (SQL خام) يغيّر البصمة فتُرفض المراجعة (`statement_changed`). قراءة فقط.
 */
final class PartnerStatementDigest
{
    public const VERSION = 1;

    public function for(string $reconciliationId): string
    {
        $rows = [];
        foreach (PartnerStatementLine::query()->where('reconciliation_id', $reconciliationId)->orderBy('ordinal')->orderBy('id')->get() as $line) {
            $rows[] = [
                (string) $line->id, (int) $line->ordinal, $line->line_date->toDateString(), $line->reference, $line->reference_key, $line->our_reference, $line->our_reference_key,
                $line->description, (int) $line->debit_minor, (int) $line->credit_minor, $line->balance_minor === null ? null : (int) $line->balance_minor, $line->kind,
            ];
        }

        return hash('sha256', json_encode(['v' => self::VERSION, 'rows' => $rows], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }
}
