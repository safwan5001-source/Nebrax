# Platform AI provider connection test

The provider connection test is intentionally independent from the Document Center extraction-engine switch.

This lets a platform administrator configure and verify OpenAI, Anthropic, or Google Gemini before enabling document extraction. Testing a provider does not activate the extraction engine, queue worker, malware scanner, durable storage, or document sending by itself.
