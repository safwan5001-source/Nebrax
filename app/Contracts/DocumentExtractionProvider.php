<?php

namespace App\Contracts;

use App\Services\DocumentCenter\DocumentExtractionRequest;
use App\Services\DocumentCenter\DocumentProviderConfiguration;
use App\Services\DocumentCenter\ProviderConfigurationValidationResult;
use App\Services\DocumentCenter\ProviderConnectionTestResult;
use App\Services\DocumentCenter\ProviderExtractionResult;

interface DocumentExtractionProvider
{
    public function key(): string;

    public function validateConfiguration(DocumentProviderConfiguration $configuration): ProviderConfigurationValidationResult;

    public function testConnection(DocumentProviderConfiguration $configuration): ProviderConnectionTestResult;

    public function extract(DocumentExtractionRequest $request): ProviderExtractionResult;
}
