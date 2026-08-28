<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaXmlCanonicalizer;
use DOMDocument;
use DOMElement;
use DOMXPath;
use RuntimeException;
use Tests\TestCase;

class ZatcaXmlCanonicalizerContextTest extends TestCase
{
    /** @test */
    public function it_copies_the_complete_inherited_namespace_context_before_c14n11(): void
    {
        $document = $this->document(
            '<Invoice xmlns="urn:invoice"'
            .' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"'
            .' xmlns:ext="urn:ext" xmlns:cac="urn:cac"'
            .' xmlns:sig="urn:sig" xmlns:xades="urn:xades">'
            .'<sig:Container><ds:SignedInfo><ds:Reference URI=""/></ds:SignedInfo></sig:Container>'
            .'</Invoice>'
        );
        $signedInfo = $this->signedInfo($document);

        $canonical = app(ZatcaXmlCanonicalizer::class)
            ->canonicalizeElementInContext($signedInfo);

        $this->assertStringStartsWith('<ds:SignedInfo', $canonical);
        $this->assertStringContainsString('xmlns="urn:invoice"', $canonical);
        $this->assertStringContainsString('xmlns:ds="http://www.w3.org/2000/09/xmldsig#"', $canonical);
        $this->assertStringContainsString('xmlns:ext="urn:ext"', $canonical);
        $this->assertStringContainsString('xmlns:cac="urn:cac"', $canonical);
        $this->assertStringContainsString('xmlns:sig="urn:sig"', $canonical);
        $this->assertStringContainsString('xmlns:xades="urn:xades"', $canonical);
        $this->assertStringEndsWith('</ds:SignedInfo>', $canonical);
        $this->assertStringNotContainsString('<Invoice', $canonical);
        $this->assertStringNotContainsString('<sig:Container', $canonical);
    }

    /** @test */
    public function changing_an_inherited_namespace_changes_the_canonical_signed_info(): void
    {
        $first = $this->document(
            '<Invoice xmlns="urn:first" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">'
            .'<ds:SignedInfo/></Invoice>'
        );
        $second = $this->document(
            '<Invoice xmlns="urn:second" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">'
            .'<ds:SignedInfo/></Invoice>'
        );
        $canonicalizer = app(ZatcaXmlCanonicalizer::class);

        $this->assertNotSame(
            $canonicalizer->canonicalizeElementInContext($this->signedInfo($first)),
            $canonicalizer->canonicalizeElementInContext($this->signedInfo($second))
        );
    }

    /** @test */
    public function the_result_is_stable_after_serializing_and_reparsing_the_final_document(): void
    {
        $xml = '<Invoice xmlns="urn:invoice"'
            .' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"'
            .' xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">'
            .'<ds:Signature><ds:SignedInfo><ds:Reference URI="#properties"/>'
            .'</ds:SignedInfo></ds:Signature></Invoice>';
        $canonicalizer = app(ZatcaXmlCanonicalizer::class);
        $first = $this->document($xml);
        $serialized = $first->saveXML();
        $this->assertIsString($serialized);
        $second = $this->document($serialized);

        $this->assertSame(
            $canonicalizer->canonicalizeElementInContext($this->signedInfo($first)),
            $canonicalizer->canonicalizeElementInContext($this->signedInfo($second))
        );
    }

    /** @test */
    public function inherited_xml_attributes_are_rejected_instead_of_silently_changing_the_signature(): void
    {
        $document = $this->document(
            '<Invoice xml:lang="ar" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">'
            .'<ds:SignedInfo/></Invoice>'
        );

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('xml:*');

        app(ZatcaXmlCanonicalizer::class)
            ->canonicalizeElementInContext($this->signedInfo($document));
    }

    /** @test */
    public function elements_owned_by_a_dtd_document_are_rejected(): void
    {
        $document = new DOMDocument();
        $this->assertTrue($document->loadXML(
            '<!DOCTYPE root [<!ELEMENT root ANY>]><root><child/></root>'
        ));
        $child = $document->getElementsByTagName('child')->item(0);
        $this->assertInstanceOf(DOMElement::class, $child);

        $this->expectException(RuntimeException::class);

        app(ZatcaXmlCanonicalizer::class)->canonicalizeElementInContext($child);
    }

    private function document(string $xml): DOMDocument
    {
        $document = new DOMDocument();
        $this->assertTrue($document->loadXML($xml, LIBXML_NONET));

        return $document;
    }

    private function signedInfo(DOMDocument $document): DOMElement
    {
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', 'http://www.w3.org/2000/09/xmldsig#');
        $element = $xpath->query('//ds:SignedInfo')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $element);

        return $element;
    }
}
