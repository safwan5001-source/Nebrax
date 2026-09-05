<?php

namespace Tests\Feature;

use App\Services\DocumentCenter\DocumentExtractionNormalizer;
use Tests\TestCase;

class DocumentExtractionNormalizerTest extends TestCase
{
    /** @test */
    public function a_field_without_explicit_evidence_confidence_does_not_inherit_the_document_level_confidence(): void
    {
        $payload = [
            'document_type' => 'delivery_note',
            'language' => 'ar',
            'confidence' => '0.9200',
            'fields' => [
                'issuer_name' => 'مورد تجريبي',
                // لا evidence صريحة لهذا الحقل — لا يوجد تقييم ثقة حقيقي له.
                'recipient_tax_number' => null,
            ],
            'lines' => [
                ['description' => 'صندوق أدوات', 'quantity' => '2'],
            ],
            'warnings' => [],
        ];

        $normalized = DocumentExtractionNormalizer::normalize(json_encode($payload, JSON_THROW_ON_ERROR), 'test_fixture', 'local');

        $this->assertSame(9200, $normalized['confidence_basis_points']);
        $this->assertNull($normalized['field_evidence']['recipient_tax_number']['confidence_basis_points']);
        $this->assertNull($normalized['field_evidence']['issuer_name']['confidence_basis_points']);
        $this->assertNull($normalized['lines'][0]['confidence_basis_points']);
    }

    /** @test */
    public function real_explicit_field_and_line_confidence_is_preserved_unchanged(): void
    {
        $payload = [
            'document_type' => 'purchase_invoice',
            'language' => 'ar',
            'confidence' => '0.9200',
            'fields' => [
                'issuer_name' => 'مورد تجريبي',
                'issuer_name_evidence' => ['confidence' => '0.6500', 'source' => 'printed'],
            ],
            'lines' => [
                ['description' => 'صمام صناعي', 'quantity' => '1', 'confidence' => '0.4100'],
            ],
            'warnings' => [],
        ];

        $normalized = DocumentExtractionNormalizer::normalize(json_encode($payload, JSON_THROW_ON_ERROR), 'test_fixture', 'local');

        $this->assertSame(9200, $normalized['confidence_basis_points']);
        $this->assertSame(6500, $normalized['field_evidence']['issuer_name']['confidence_basis_points']);
        $this->assertSame('printed', $normalized['field_evidence']['issuer_name']['source']);
        $this->assertSame(4100, $normalized['lines'][0]['confidence_basis_points']);
    }

    /** @test */
    public function a_line_with_a_quantity_but_no_description_is_kept_not_silently_discarded(): void
    {
        $payload = [
            'document_type' => 'delivery_note',
            'language' => 'ar',
            'confidence' => '0.9000',
            'fields' => [],
            'lines' => [
                // منتج سند التسليم ثابت (ديزل) — لا يحتاج كل سطر وصفاً نصياً.
                ['quantity' => '4000'],
            ],
            'warnings' => [],
        ];

        $normalized = DocumentExtractionNormalizer::normalize(json_encode($payload, JSON_THROW_ON_ERROR), 'test_fixture', 'local');

        $this->assertCount(1, $normalized['lines']);
        $this->assertSame('4000', $normalized['lines'][0]['quantity']);
        $this->assertNull($normalized['lines'][0]['description']);
    }

    /** @test */
    public function a_line_with_neither_description_nor_quantity_is_dropped_as_before(): void
    {
        $payload = [
            'document_type' => 'delivery_note',
            'language' => 'ar',
            'confidence' => '0.9000',
            'fields' => [],
            'lines' => [
                ['sku' => null, 'description' => null, 'quantity' => null],
                ['description' => 'صمام صناعي', 'quantity' => '3'],
            ],
            'warnings' => [],
        ];

        $normalized = DocumentExtractionNormalizer::normalize(json_encode($payload, JSON_THROW_ON_ERROR), 'test_fixture', 'local');

        $this->assertCount(1, $normalized['lines']);
        $this->assertSame('صمام صناعي', $normalized['lines'][0]['description']);
    }
}
