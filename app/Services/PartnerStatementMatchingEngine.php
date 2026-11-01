<?php

namespace App\Services;

/**
 * محرك مطابقة كشوف الأطراف الحتمي — IMP-PS-A2c (خطة PS-A2 §3). **دالة نقيّة**: لا قاعدة بيانات ولا ساعة ولا عشوائية؛ نفس المدخلات تعطي نفس المخرجات بالترتيب نفسه.
 * لا تكتب شيئاً ولا تعرف الأستاذ: تستقبل أسطر الكشف المخزَّنة ووحدات المرشحين (من `PartnerLedgerCandidates`) وتُعيد نتائج.
 *
 * **سلّم القواعد (الأولى التي تصيب تحسم):**
 *  - **R1** `our_reference_key` = مفتاح رقم مستندنا. **R2** `reference_key` = مفتاح نظيره عندنا (المشتريات: رقم فاتورة المورد؛ غيرها: رقم المستند).
 *  - **R3** بلا مفتاح يصيب: اتجاه مُعاكَس + مبلغ ضمن P-2 + تاريخ ضمن P-1، **وحيد من الجهتين**؛ غير ذلك `ambiguous` — لا تخمين.
 *  المنظور (D-PS-11): الأسطر بمنظور الطرف المقابل؛ مدينه = دائننا ودائنه = مدييننا لكلا الدورين.
 *
 * **النتائج:** `matched` · `amount_difference` · `date_difference` · `ambiguous` · `missing_in_books` (جهة الكشف)؛ و`matched` · `missing_in_statement` · `needs_review`
 * · `neutralised` · `incomplete` (جهة الدفتر). `rule` مرتبة قوة دليل (R1 > R2 > R3) **لا نسبة احتمال**: لا درجة ثقة مخترعة.
 *
 * **ضمانات:** لا مطابقة تلقائية لوحدة `incomplete` أو `neutralised` أو صافيها صفر؛ لا استعمال مزدوج للوحدة (وحدة مطلوبة من أكثر من سطر ⇒ كل أسطرها `ambiguous`)؛
 * many-to-one لا يُطبَّق أبداً — يُجهَّز كاقتراحات (`suggestions`) للمراجعة اليدوية فقط.
 */
final class PartnerStatementMatchingEngine
{
    public const VERSION = '1';

    public const MAX_SUGGESTION_POOL = 20;

    public const MAX_SUGGESTION_LINES = 200;

    public const MAX_SUGGESTIONS_PER_LINE = 5;

    /** @var array<string, array{invoice: string, payment: string, credit_note: string}> اتجاه كشف الطرف المقابل المتوقع لكل نوع حركة بحسب الدور. */
    private const KIND_SIDE = [
        'customer' => ['invoice' => 'credit', 'payment' => 'debit', 'credit_note' => 'debit'],
        'supplier' => ['invoice' => 'debit', 'payment' => 'credit', 'credit_note' => 'credit'],
    ];

    /**
     * @param  list<array<string, mixed>>  $lines  id, ordinal, date, reference_key, our_reference_key, debit_minor, credit_minor, kind
     * @param  list<array<string, mixed>>  $units  وحدات `PartnerLedgerCandidates` مع `doc` = {number, number_key, external_key}
     * @param  array{date_tolerance_days: int, amount_tolerance_minor: int}  $policy
     * @return array{statement: list<array<string, mixed>>, ledger: list<array<string, mixed>>, counts: array<string, int>}
     */
    public function match(array $lines, array $units, array $policy, string $role): array
    {
        $dateTol = (int) $policy['date_tolerance_days'];
        $amountTol = (int) $policy['amount_tolerance_minor'];

        usort($lines, fn (array $a, array $b): int => $a['ordinal'] <=> $b['ordinal']);
        usort($units, fn (array $a, array $b): int => strcmp((string) $a['key'], (string) $b['key']));

        $byKey = [];
        foreach ($units as $unit) {
            $byKey[$unit['key']] = $unit;
        }
        [$r1Index, $r2Index] = $this->indexes($units);

        $results = [];      // ordinal => نتيجة
        $claims = [];       // unit key => [ordinal, ...] للنتائج المرتبطة بالوحدة (matched/amount/date)
        $pendingB = [];     // أسطر بلا إصابة مفتاح
        $inReview = [];     // وحدات مرشّحة لسطر غامض — تُعرض «تحتاج مراجعة» لا «مفقودة من الكشف»
        $wants = [];        // unit key => أسطر غامضة (مرجعها يصيب عدة وثائق) تطلب هذه الوحدة

        // ───────────── المرحلة A: المفاتيح (R1 ثم R2) ─────────────
        foreach ($lines as $line) {
            $ordinal = (int) $line['ordinal'];
            $base = $this->base($line, $role);
            [$rule, $hitKeys] = $this->keyHits($line, $r1Index, $r2Index);
            if ($hitKeys === []) {
                $pendingB[] = $line;

                continue;
            }

            $hits = array_map(fn (string $k): array => $byKey[$k], $hitKeys);
            if (count($hits) > 1) {
                $results[$ordinal] = $base + $this->row('ambiguous', $rule, 'ambiguous_multiple_documents_for_reference', ['reference_units' => count($hits)], candidates: $this->snapshots($hits));
                foreach ($hits as $hit) {
                    $inReview[$hit['key']] = true;
                    $wants[$hit['key']][] = $ordinal;   // السطر الغامض «يطلب» وحداته في كشف التعارض أيضاً (Codex #1908 P2)
                }

                continue;
            }

            $unit = $hits[0];
            $results[$ordinal] = $base + $this->keyOutcome($line, $unit, $rule, $amountTol, $dateTol);
            if (in_array($results[$ordinal]['outcome'], ['matched', 'amount_difference', 'date_difference'], true) && $unit['state'] === 'active') {
                $claims[$unit['key']][] = $ordinal;
            }
        }

        // وحدة مطلوبة من أكثر من سطر ⇒ كل أسطرها ambiguous ولا ترتبط بأيٍّ منها.
        $disputed = [];
        foreach ($claims as $unitKey => $ordinals) {
            $wanting = count($ordinals) + count($wants[$unitKey] ?? []);
            if ($wanting < 2) {
                continue;
            }
            $disputed[$unitKey] = true;
            foreach ($ordinals as $ordinal) {
                $rule = $results[$ordinal]['rule'];
                $results[$ordinal] = $this->baseOf($results[$ordinal]) + $this->row('ambiguous', $rule, 'unit_claimed_by_several_lines', ['claiming_lines' => $wanting], candidates: $this->snapshots([$byKey[$unitKey]]));
            }
            unset($claims[$unitKey]);
        }

        // ───────────── المرحلة B: R3 (المبلغ + التاريخ + الاتجاه، وحيد من الجهتين) ─────────────
        // وحدات مرشّحة لمرجع غامض (`$inReview`) ما زالت مطلوبة من سطر غامض: لا تُعرَض على R3 لأي سطر آخر (Codex #1908 P2).
        $free = array_filter($units, fn (array $u): bool => $u['state'] === 'active' && ! isset($claims[$u['key']]) && ! isset($disputed[$u['key']]) && ! isset($inReview[$u['key']]));
        $candidatesOf = [];   // ordinal => [unit key,...]
        $reverse = [];        // unit key => [ordinal,...]
        foreach ($pendingB as $line) {
            $ordinal = (int) $line['ordinal'];
            foreach ($free as $unit) {
                if ($this->directionOk($line, $unit) && $this->amountDiff($line, $unit) !== null && abs($this->amountDiff($line, $unit)) <= $amountTol
                    && abs($this->dayDiff($line, $unit)) <= $dateTol) {
                    $candidatesOf[$ordinal][] = $unit['key'];
                    $reverse[$unit['key']][] = $ordinal;
                }
            }
        }
        foreach ($pendingB as $line) {
            $ordinal = (int) $line['ordinal'];
            $base = $this->base($line, $role);
            $keys = $candidatesOf[$ordinal] ?? [];
            if ($keys === []) {
                $results[$ordinal] = $base + $this->row('missing_in_books', null, 'no_candidate_in_books');

                continue;
            }
            if (count($keys) > 1) {
                $results[$ordinal] = $base + $this->row('ambiguous', 'R3', 'ambiguous_multiple_candidates', ['candidates' => count($keys)], candidates: $this->snapshots(array_map(fn (string $k): array => $byKey[$k], $keys)));
                foreach ($keys as $k) {
                    $inReview[$k] = true;
                }

                continue;
            }
            $unit = $byKey[$keys[0]];
            if (count($reverse[$unit['key']]) > 1) {
                $results[$ordinal] = $base + $this->row('ambiguous', 'R3', 'unit_claimed_by_several_lines', ['claiming_lines' => count($reverse[$unit['key']])], candidates: $this->snapshots([$unit]));
                $disputed[$unit['key']] = true;

                continue;
            }
            $claims[$unit['key']][] = $ordinal;
            $results[$ordinal] = $base + $this->row('matched', 'R3', 'matched_by_amount_date_unique', [], unit: $unit, difference: $this->amountDiff($line, $unit), days: $this->dayDiff($line, $unit));
        }

        // ───────────── اقتراحات many-to-one (للمراجعة اليدوية فقط) ─────────────
        $usable = array_values(array_filter($units, fn (array $u): bool => $u['state'] === 'active' && ! isset($claims[$u['key']]) && ! isset($disputed[$u['key']]) && ! isset($inReview[$u['key']])));
        $suggested = 0;
        foreach ($lines as $line) {
            $ordinal = (int) $line['ordinal'];
            if (! in_array($results[$ordinal]['outcome'], ['missing_in_books', 'ambiguous'], true)) {
                continue;
            }
            if ($suggested >= self::MAX_SUGGESTION_LINES) {
                $results[$ordinal]['explanation']['params']['suggestions_truncated'] = true;

                continue;
            }
            $suggested++;
            $results[$ordinal]['suggestions'] = $this->suggestions($line, $usable, $amountTol);
        }

        ksort($results);
        $statement = array_values($results);

        // ───────────── جهة الدفتر ─────────────
        $matchedUnits = [];
        foreach ($claims as $unitKey => $ordinals) {
            $row = $results[$ordinals[0]];
            $matchedUnits[$unitKey] = ['ordinal' => $ordinals[0], 'matched' => $row['outcome'] === 'matched'];
        }
        $ledger = [];
        foreach ($units as $unit) {
            if (! $unit['in_period']) {
                continue;
            }
            $state = $unit['state'];
            [$outcome, $code, $ordinal] = match (true) {
                $state === 'neutralised' => ['neutralised', 'reversed_pair_excluded', null],
                $state === 'incomplete' => ['incomplete', 'reversal_chain_incomplete', null],
                $state !== 'active' => [null, null, null],
                isset($matchedUnits[$unit['key']]) => [$matchedUnits[$unit['key']]['matched'] ? 'matched' : 'needs_review', $matchedUnits[$unit['key']]['matched'] ? 'matched_to_statement_line' : 'linked_with_difference', $matchedUnits[$unit['key']]['ordinal']],
                isset($disputed[$unit['key']]) => ['needs_review', 'claimed_by_several_lines', null],
                isset($inReview[$unit['key']]) => ['needs_review', 'candidate_of_ambiguous_line', null],
                default => ['missing_in_statement', 'no_statement_line', null],
            };
            if ($outcome === null) {
                continue;
            }
            $ledger[] = [
                'side' => 'ledger', 'line_id' => null, 'ordinal' => $ordinal, 'outcome' => $outcome, 'rule' => null, 'unit_key' => $unit['key'],
                'difference_minor' => null, 'day_difference' => null, 'explanation' => ['code' => $code, 'params' => $state === 'incomplete' ? ['reasons' => $unit['reasons']] : []],
                'warnings' => [], 'unit' => $this->snapshot($unit), 'candidates' => null, 'suggestions' => null,
            ];
        }

        $counts = [];
        foreach (array_merge($statement, $ledger) as $row) {
            $key = $row['side'].'.'.$row['outcome'];
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }
        ksort($counts);

        return ['statement' => $statement, 'ledger' => $ledger, 'counts' => $counts];
    }

    // ═══════════════════════════════ المفاتيح ═══════════════════════════════

    /** @param list<array<string, mixed>> $units @return array{0: array<string, list<string>>, 1: array<string, list<string>>} */
    private function indexes(array $units): array
    {
        $r1 = $r2 = [];
        foreach ($units as $unit) {
            $number = (string) ($unit['doc']['number_key'] ?? '');
            $external = (string) ($unit['doc']['external_key'] ?? '');
            if ($number !== '') {
                $r1[$number][] = $unit['key'];
            }
            // R2: نظير رقمنا — المشتريات: رقم فاتورة المورد؛ غيرها: رقم المستند.
            $counterpart = $unit['kind'] === 'purchase' ? $external : $number;
            if ($counterpart !== '') {
                $r2[$counterpart][] = $unit['key'];
            }
        }

        return [$r1, $r2];
    }

    /** @return array{0: ?string, 1: list<string>} */
    private function keyHits(array $line, array $r1, array $r2): array
    {
        $ours = (string) ($line['our_reference_key'] ?? '');
        if ($ours !== '' && isset($r1[$ours])) {
            return ['R1', array_values(array_unique($r1[$ours]))];
        }
        $theirs = (string) ($line['reference_key'] ?? '');
        if ($theirs !== '' && isset($r2[$theirs])) {
            return ['R2', array_values(array_unique($r2[$theirs]))];
        }

        return [null, []];
    }

    /** @return array<string, mixed> */
    private function keyOutcome(array $line, array $unit, string $rule, int $amountTol, int $dateTol): array
    {
        $viaOurs = $rule === 'R1' ? 'our_reference' : 'reference';
        $state = $unit['state'];
        if ($state === 'neutralised') {
            // الوحدة معكوسة عندنا بالكامل: لا تُطابَق؛ الفرق = مبلغ الكشف كله مقابل صافٍ صفري.
            return $this->row('amount_difference', $rule, 'reversed_in_books', ['via' => $viaOurs], unit: $unit, difference: $this->lineAmount($line));
        }
        if ($state !== 'active') {
            return $this->row('ambiguous', $rule, $state === 'incomplete' ? 'candidate_reversal_incomplete' : 'candidate_not_matchable', ['state' => $state, 'reasons' => $unit['reasons']], candidates: $this->snapshots([$unit]));
        }
        if (! $this->directionOk($line, $unit)) {
            return $this->row('amount_difference', $rule, 'direction_mismatch', ['via' => $viaOurs, 'direction_mismatch' => true], unit: $unit, difference: $this->lineAmount($line) + $this->unitAmount($unit));
        }
        $diff = $this->amountDiff($line, $unit);
        if (abs($diff) > $amountTol) {
            return $this->row('amount_difference', $rule, 'amount_differs', ['via' => $viaOurs], unit: $unit, difference: $diff, days: $this->dayDiff($line, $unit));
        }
        $days = $this->dayDiff($line, $unit);
        if (abs($days) > $dateTol) {
            return $this->row('date_difference', $rule, 'date_differs', ['via' => $viaOurs], unit: $unit, difference: $diff, days: $days);
        }

        return $this->row('matched', $rule, $rule === 'R1' ? 'matched_by_our_reference' : 'matched_by_reference', [], unit: $unit, difference: $diff, days: $days);
    }

    // ═══════════════════════════════ الأدوات ═══════════════════════════════

    private function lineAmount(array $line): int
    {
        return (int) $line['debit_minor'] > 0 ? (int) $line['debit_minor'] : (int) $line['credit_minor'];
    }

    /** اتجاه الوحدة المتوقع بمنظورنا لسطر الكشف: مدينه دائننا والعكس. */
    private function mirrored(array $line): string
    {
        return (int) $line['debit_minor'] > 0 ? 'credit' : 'debit';
    }

    private function unitAmount(array $unit): int
    {
        return $unit['direction'] === 'debit' ? (int) $unit['debit_minor'] : ($unit['direction'] === 'credit' ? (int) $unit['credit_minor'] : 0);
    }

    private function directionOk(array $line, array $unit): bool
    {
        return $unit['direction'] === $this->mirrored($line);
    }

    /** مبلغ الكشف − مبلغ الوحدة (موجب: الكشف أكبر). */
    private function amountDiff(array $line, array $unit): int
    {
        return $this->lineAmount($line) - $this->unitAmount($unit);
    }

    /** تاريخ الكشف − تاريخ الوحدة بالأيام (موجب: الكشف أحدث). */
    private function dayDiff(array $line, array $unit): int
    {
        $a = new \DateTimeImmutable((string) $line['date']);
        $b = new \DateTimeImmutable((string) $unit['date']);

        return (int) $a->diff($b)->format('%r%a') * -1;
    }

    /** @return array<string, mixed> */
    private function base(array $line, string $role): array
    {
        $warnings = [];
        $kind = $line['kind'] ?? null;
        $expected = self::KIND_SIDE[$role][$kind] ?? null;
        if ($expected !== null) {
            $actual = (int) $line['debit_minor'] > 0 ? 'debit' : 'credit';
            if ($actual !== $expected) {
                $warnings[] = ['code' => 'kind_side_mismatch', 'params' => ['kind' => $kind, 'expected' => $expected, 'actual' => $actual]];
            }
        }

        return ['side' => 'statement', 'line_id' => $line['id'], 'ordinal' => (int) $line['ordinal'], 'warnings' => $warnings];
    }

    /** @return array<string, mixed> */
    private function baseOf(array $row): array
    {
        return ['side' => 'statement', 'line_id' => $row['line_id'], 'ordinal' => $row['ordinal'], 'warnings' => $row['warnings']];
    }

    /**
     * @param  array<string, mixed>  $params
     * @param  list<array<string, mixed>>|null  $candidates
     * @return array<string, mixed>
     */
    private function row(string $outcome, ?string $rule, string $code, array $params = [], ?array $unit = null, ?int $difference = null, ?int $days = null, ?array $candidates = null): array
    {
        return [
            'outcome' => $outcome, 'rule' => $rule, 'unit_key' => $unit['key'] ?? null, 'difference_minor' => $difference, 'day_difference' => $days,
            'explanation' => ['code' => $code, 'params' => $params], 'unit' => $unit !== null ? $this->snapshot($unit) : null,
            'candidates' => $candidates, 'suggestions' => null,
        ];
    }

    /** @return array<string, mixed> */
    private function snapshot(array $unit): array
    {
        return [
            'key' => $unit['key'], 'kind' => $unit['kind'], 'doc_number' => $unit['doc']['number'] ?? null, 'date' => $unit['date'], 'direction' => $unit['direction'],
            'amount_minor' => $this->unitAmount($unit), 'state' => $unit['state'], 'entry_numbers' => $unit['numbers'], 'entry_ids' => $unit['entry_ids'],
        ];
    }

    /** @param list<array<string, mixed>> $units @return list<array<string, mixed>> */
    private function snapshots(array $units): array
    {
        return array_map(fn (array $u): array => $this->snapshot($u), $units);
    }

    /**
     * اقتراحات many-to-one: مجموعات من 2–3 وحدات حرة بالاتجاه المُعاكَس مجموعها ضمن P-2 من مبلغ السطر. **اقتراح لا تطبيق**: لا تُسند ولا تُحجز؛ المرجع يقرّر لاحقاً (PS-A3).
     *
     * @param  list<array<string, mixed>>  $usable
     * @return list<array<string, mixed>>
     */
    private function suggestions(array $line, array $usable, int $amountTol): array
    {
        $amount = $this->lineAmount($line);
        $pool = array_values(array_filter($usable, fn (array $u): bool => $this->directionOk($line, $u) && $this->unitAmount($u) > 0 && $this->unitAmount($u) <= $amount + $amountTol));
        $pool = array_slice($pool, 0, self::MAX_SUGGESTION_POOL);
        $n = count($pool);
        $found = [];
        for ($size = 2; $size <= 3 && count($found) < self::MAX_SUGGESTIONS_PER_LINE; $size++) {
            if ($n < $size) {
                break;
            }
            $indexes = range(0, $size - 1);
            while (true) {
                $sum = 0;
                foreach ($indexes as $i) {
                    $sum += $this->unitAmount($pool[$i]);
                }
                if (abs($sum - $amount) <= $amountTol) {
                    $found[] = ['suggestion' => true, 'unit_keys' => array_map(fn (int $i): string => $pool[$i]['key'], $indexes), 'sum_minor' => $sum, 'difference_minor' => $amount - $sum];
                    if (count($found) >= self::MAX_SUGGESTIONS_PER_LINE) {
                        break;
                    }
                }
                $i = $size - 1;
                while ($i >= 0 && $indexes[$i] === $n - $size + $i) {
                    $i--;
                }
                if ($i < 0) {
                    break;
                }
                $indexes[$i]++;
                for ($j = $i + 1; $j < $size; $j++) {
                    $indexes[$j] = $indexes[$j - 1] + 1;
                }
            }
        }

        return $found;
    }
}
