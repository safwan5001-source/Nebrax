<?php

namespace App\Services\DocumentCenter;

use App\Models\Partner;

final class DocumentCounterpartyMatcher
{
    public function __construct(private readonly DocumentMatchScorer $scorer)
    {
    }

    /** @param array<string, mixed> $fields
     *  @return list<array<string, mixed>>
     */
    public function candidates(array $fields, string $documentType): array
    {
        $role = $this->roleFor($documentType);
        $name = $role === 'supplier' ? ($fields['issuer_name'] ?? null) : ($fields['recipient_name'] ?? null);
        $tax = $role === 'supplier' ? ($fields['issuer_tax_number'] ?? null) : ($fields['recipient_tax_number'] ?? null);
        $email = $role === 'supplier' ? ($fields['issuer_email'] ?? null) : ($fields['recipient_email'] ?? null);
        $phone = $role === 'supplier' ? ($fields['issuer_phone'] ?? null) : ($fields['recipient_phone'] ?? null);
        $partners = Partner::query()->whereIn('type', $role === 'supplier' ? ['supplier', 'both'] : ['customer', 'both'])->get();
        $candidates = [];

        foreach ($partners as $partner) {
            $match = $this->scorer->exact((string) $tax, $partner->vat_number, 10000, 'exact_tax_id')
                ?? $this->scorer->exact(is_string($email) ? $email : null, $partner->email, 9600, 'normalized_email_match')
                ?? $this->scorer->exact(is_string($phone) ? $phone : null, $partner->phone, 9500, 'normalized_phone_match')
                ?? $this->scorer->nameSimilarity((string) $name, $partner->name)
                ?? $this->scorer->nameSimilarity((string) $name, $partner->name_en);
            if ($match === null) {
                continue;
            }
            $candidates[] = [
                'candidate_type' => Partner::class,
                'candidate_id' => $partner->id,
                'score_basis_points' => $match['score_basis_points'],
                'strategy' => $match['strategy'],
                'explanation_codes' => [...$match['explanation_codes'], ...(! $partner->is_active ? ['inactive_candidate'] : [])],
                'snapshot' => ['name' => $partner->name, 'type' => $partner->type, 'vat_number' => $partner->vat_number, 'is_active' => $partner->is_active],
            ];
        }

        return $candidates;
    }

    private function roleFor(string $documentType): string
    {
        $type = mb_strtolower($documentType);
        return str_contains($type, 'purchase') || str_contains($type, 'expense') ? 'supplier' : 'customer';
    }
}
