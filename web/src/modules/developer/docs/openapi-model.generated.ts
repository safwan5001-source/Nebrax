/**
 * ⚠️ ملفّ مولَّد آليّاً — لا تُحرّره يدويّاً.
 *
 * المصدر: docs/openapi/public-api-v1.yaml (عقد OpenAPI 3.1 الرسمي للـ Public API).
 * التوليد: web/scripts/build-openapi-model.mjs (`npm run openapi:generate`).
 * الأنواع: ./openapi-types. اختبار الانحراف يحرس تطابقه مع العقد.
 */
import type { OpenApiModel } from './openapi-types';

export const OPENAPI_MODEL: OpenApiModel = {
  "title": "AWJ Public API",
  "version": "v1",
  "auth": {
    "scheme": "bearerApiKey",
    "type": "bearer",
    "description": "Tenant-owned API Client key presented as `Authorization: Bearer <key>`. Issued server-side; the raw secret is shown only once at issuance and is stored hashed. Keys can be rotated and revoked. The bearer scheme carries no OAuth flow; scopes are attached to the key and enforced per operation."
  },
  "server": {
    "template": "{baseUrl}/api/v1",
    "baseUrlDefault": "https://api.example.com",
    "baseUrlDescription": "Deployment origin (scheme + host), configured per environment."
  },
  "scopes": [
    "invoices:read",
    "invoices:write",
    "partners:read",
    "partners:write",
    "products:read",
    "products:write",
    "webhooks:read",
    "webhooks:write"
  ],
  "events": [
    "partner.created",
    "product.created",
    "invoice.created"
  ],
  "errorCodes": [
    "internal_error",
    "bad_request",
    "not_found",
    "method_not_allowed",
    "validation_failed",
    "unauthenticated",
    "forbidden",
    "tenant_context_required",
    "client_inactive",
    "insufficient_scope",
    "rate_limited",
    "idempotency_key_required",
    "invalid_idempotency_key",
    "idempotency_conflict",
    "idempotency_in_progress"
  ],
  "notableHeaders": [
    {
      "name": "Idempotency-Key",
      "description": "Client-generated key that makes the write safe to retry. 8–255 characters matching `^[A-Za-z0-9._:-]+$`. Bound to the tenant, API client, method, route, and a fingerprint of the request payload."
    },
    {
      "name": "X-Request-Id",
      "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included."
    },
    {
      "name": "X-RateLimit-Limit",
      "description": "The request quota for the applicable window."
    },
    {
      "name": "X-RateLimit-Remaining",
      "description": "Remaining requests in the current window."
    },
    {
      "name": "Retry-After",
      "description": "Seconds to wait before retrying (present on 429)."
    },
    {
      "name": "X-RateLimit-Reset",
      "description": "Unix timestamp when the window resets (present on 429)."
    },
    {
      "name": "Idempotency-Replayed",
      "description": "Set to `true` when the response is a replay of an earlier identical request."
    }
  ],
  "tags": [
    {
      "name": "Health",
      "description": "Unauthenticated service liveness.",
      "operations": [
        {
          "id": "getHealth",
          "method": "get",
          "path": "/health",
          "summary": "Service liveness",
          "description": "Unauthenticated liveness probe. Returns no tenant data and touches no database. Not rate-limited or audited.",
          "tag": "Health",
          "scope": null,
          "requiresAuth": false,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "Service is up.",
              "headers": [
                "X-Request-Id"
              ],
              "data": {
                "kind": "object",
                "itemType": "HealthData",
                "fields": [
                  {
                    "name": "status",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "example": "\"ok\""
                  },
                  {
                    "name": "service",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "example": "\"awj-public-api\""
                  },
                  {
                    "name": "version",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "example": "\"v1\""
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "name": "Partners",
      "description": "Customers and suppliers (read and controlled create).",
      "operations": [
        {
          "id": "listPartners",
          "method": "get",
          "path": "/partners",
          "summary": "List partners",
          "description": "Paginated, tenant-scoped list of partners (customers/suppliers).",
          "tag": "Partners",
          "scope": "partners:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "page",
              "in": "query",
              "required": false,
              "description": "1-based page number.",
              "type": "integer",
              "constraints": "range 1–∞ · default 1"
            },
            {
              "name": "per_page",
              "in": "query",
              "required": false,
              "description": "Page size. Defaults to 25; hard maximum 100.",
              "type": "integer",
              "constraints": "range 1–100 · default 25"
            },
            {
              "name": "search",
              "in": "query",
              "required": false,
              "description": "Free-text match on name, English name, code, or VAT number.",
              "type": "string",
              "constraints": "length 0–120"
            },
            {
              "name": "type",
              "in": "query",
              "required": false,
              "description": "Filter by partner role.",
              "type": "string · enum",
              "constraints": "enum: customer · supplier"
            },
            {
              "name": "is_active",
              "in": "query",
              "required": false,
              "type": "boolean"
            },
            {
              "name": "sort",
              "in": "query",
              "required": false,
              "description": "Sort field with optional leading `-` for descending. Default `-created_at`.",
              "type": "string · enum",
              "constraints": "enum: name · code · created_at · -name · -code · -created_at"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "A page of partners.",
              "headers": [
                "X-Request-Id",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining"
              ],
              "data": {
                "kind": "list",
                "itemType": "Partner",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "code",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: customer · supplier · both"
                  },
                  {
                    "name": "entity_type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": true,
                    "readOnly": false,
                    "constraints": "enum: individual · commercial"
                  },
                  {
                    "name": "name",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "name_en",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "vat_number",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "cr_number",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "email",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "phone",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "mobile",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "address",
                    "type": "PartnerAddress",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Nested address block on the partner read representation."
                  },
                  {
                    "name": "is_active",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "createPartner",
          "method": "post",
          "path": "/partners",
          "summary": "Create a partner",
          "description": "Creates a customer/supplier from a curated field set. `tenant_id` and any field outside the documented schema are ignored. Requires an idempotency key.",
          "tag": "Partners",
          "scope": "partners:write",
          "requiresAuth": true,
          "idempotency": true,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "Idempotency-Key",
              "in": "header",
              "required": true,
              "description": "Client-generated key that makes the write safe to retry. 8–255 characters matching `^[A-Za-z0-9._:-]+$`. Bound to the tenant, API client, method, route, and a fingerprint of the request payload.",
              "type": "string",
              "constraints": "length 8–255 · pattern ^[A-Za-z0-9._:\\-]{8,255}$"
            }
          ],
          "requestBody": {
            "required": true,
            "contentType": "application/json",
            "fields": [
              {
                "name": "name",
                "type": "string",
                "required": true,
                "nullable": false,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "name_en",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "type",
                "type": "string · enum",
                "required": true,
                "nullable": false,
                "readOnly": false,
                "constraints": "enum: customer · supplier · both"
              },
              {
                "name": "entity_type",
                "type": "string · enum",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "enum: individual · commercial"
              },
              {
                "name": "code",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "vat_number",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 15–15"
              },
              {
                "name": "cr_number",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "email",
                "type": "string · email",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "phone",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "mobile",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "address",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "city",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "building_no",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "street",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "district",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "postal_code",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "country",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "is_active",
                "type": "boolean",
                "required": false,
                "nullable": true,
                "readOnly": false
              }
            ],
            "example": {
              "name": "شركة الطموح",
              "type": "customer",
              "vat_number": "300000000000003",
              "email": "billing@example.test"
            }
          },
          "responses": [
            {
              "status": "201",
              "description": "Partner created (or the original response replayed on retry).",
              "headers": [
                "X-Request-Id",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "Idempotency-Replayed"
              ],
              "data": {
                "kind": "object",
                "itemType": "Partner",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "code",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: customer · supplier · both"
                  },
                  {
                    "name": "entity_type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": true,
                    "readOnly": false,
                    "constraints": "enum: individual · commercial"
                  },
                  {
                    "name": "name",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "name_en",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "vat_number",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "cr_number",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "email",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "phone",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "mobile",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "address",
                    "type": "PartnerAddress",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Nested address block on the partner read representation."
                  },
                  {
                    "name": "is_active",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "400",
              "description": "The `Idempotency-Key` header is missing or malformed.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "409",
              "description": "The same `Idempotency-Key` was reused for a different payload/operation (`idempotency_conflict`), or an earlier request with the same key is still being processed (`idempotency_in_progress`).",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "getPartner",
          "method": "get",
          "path": "/partners/{id}",
          "summary": "Get a partner",
          "tag": "Partners",
          "scope": "partners:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "id",
              "in": "path",
              "required": true,
              "description": "Resource identifier (UUID).",
              "type": "string · uuid"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "The partner.",
              "headers": [
                "X-Request-Id"
              ],
              "data": {
                "kind": "object",
                "itemType": "Partner",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "code",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: customer · supplier · both"
                  },
                  {
                    "name": "entity_type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": true,
                    "readOnly": false,
                    "constraints": "enum: individual · commercial"
                  },
                  {
                    "name": "name",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "name_en",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "vat_number",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "cr_number",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "email",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "phone",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "mobile",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "address",
                    "type": "PartnerAddress",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Nested address block on the partner read representation."
                  },
                  {
                    "name": "is_active",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "404",
              "description": "The resource does not exist within the caller's tenant. Identifiers from other tenants are reported as not found without revealing their existence.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "Products",
      "description": "Catalog products (read and controlled create).",
      "operations": [
        {
          "id": "listProducts",
          "method": "get",
          "path": "/products",
          "summary": "List products",
          "description": "Paginated, tenant-scoped catalog list.",
          "tag": "Products",
          "scope": "products:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "page",
              "in": "query",
              "required": false,
              "description": "1-based page number.",
              "type": "integer",
              "constraints": "range 1–∞ · default 1"
            },
            {
              "name": "per_page",
              "in": "query",
              "required": false,
              "description": "Page size. Defaults to 25; hard maximum 100.",
              "type": "integer",
              "constraints": "range 1–100 · default 25"
            },
            {
              "name": "search",
              "in": "query",
              "required": false,
              "description": "Free-text match on name, English name, SKU, or barcode.",
              "type": "string",
              "constraints": "length 0–120"
            },
            {
              "name": "sku",
              "in": "query",
              "required": false,
              "type": "string",
              "constraints": "length 0–120"
            },
            {
              "name": "barcode",
              "in": "query",
              "required": false,
              "type": "string",
              "constraints": "length 0–120"
            },
            {
              "name": "type",
              "in": "query",
              "required": false,
              "type": "string · enum",
              "constraints": "enum: good · service"
            },
            {
              "name": "is_active",
              "in": "query",
              "required": false,
              "type": "boolean"
            },
            {
              "name": "sort",
              "in": "query",
              "required": false,
              "description": "Sort field with optional leading `-`. Default `name`.",
              "type": "string · enum",
              "constraints": "enum: name · sku · sale_price · created_at · -name · -sku · -sale_price · -created_at"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "A page of products.",
              "headers": [
                "X-Request-Id",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining"
              ],
              "data": {
                "kind": "list",
                "itemType": "Product",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "sku",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "barcode",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "name",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "name_en",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: good · service"
                  },
                  {
                    "name": "unit",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "category",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "brand",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "currency",
                    "type": "string · ISO-4217",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "ISO-4217 currency code.",
                    "example": "\"SAR\""
                  },
                  {
                    "name": "sale_price_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "tax_rate",
                    "type": "integer",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "track_inventory",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "is_active",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "createProduct",
          "method": "post",
          "path": "/products",
          "summary": "Create a product",
          "description": "Creates a basic catalog product. Does not create inventory movements, stock balances, or accounting entries. Money is in minor units (`sale_price_minor`). Requires an idempotency key.",
          "tag": "Products",
          "scope": "products:write",
          "requiresAuth": true,
          "idempotency": true,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "Idempotency-Key",
              "in": "header",
              "required": true,
              "description": "Client-generated key that makes the write safe to retry. 8–255 characters matching `^[A-Za-z0-9._:-]+$`. Bound to the tenant, API client, method, route, and a fingerprint of the request payload.",
              "type": "string",
              "constraints": "length 8–255 · pattern ^[A-Za-z0-9._:\\-]{8,255}$"
            }
          ],
          "requestBody": {
            "required": true,
            "contentType": "application/json",
            "fields": [
              {
                "name": "name",
                "type": "string",
                "required": true,
                "nullable": false,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "name_en",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "type",
                "type": "string · enum",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "enum: good · service"
              },
              {
                "name": "unit",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "description",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–2000"
              },
              {
                "name": "sku",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "description": "Unique within the tenant; generated when omitted.",
                "constraints": "length 0–255"
              },
              {
                "name": "barcode",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "description": "Unique within the tenant.",
                "constraints": "length 0–255"
              },
              {
                "name": "sale_price_minor",
                "type": "integer · minor units",
                "required": true,
                "nullable": false,
                "readOnly": false,
                "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
              },
              {
                "name": "tax_rate",
                "type": "integer",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "range 0–100"
              },
              {
                "name": "is_active",
                "type": "boolean",
                "required": false,
                "nullable": true,
                "readOnly": false
              }
            ],
            "example": {
              "name": "خدمة استشارية",
              "type": "service",
              "sale_price_minor": 15000,
              "tax_rate": 15
            }
          },
          "responses": [
            {
              "status": "201",
              "description": "Product created (or the original response replayed on retry).",
              "headers": [
                "X-Request-Id",
                "Idempotency-Replayed"
              ],
              "data": {
                "kind": "object",
                "itemType": "Product",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "sku",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "barcode",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "name",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "name_en",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: good · service"
                  },
                  {
                    "name": "unit",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "category",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "brand",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "currency",
                    "type": "string · ISO-4217",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "ISO-4217 currency code.",
                    "example": "\"SAR\""
                  },
                  {
                    "name": "sale_price_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "tax_rate",
                    "type": "integer",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "track_inventory",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "is_active",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "400",
              "description": "The `Idempotency-Key` header is missing or malformed.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "409",
              "description": "The same `Idempotency-Key` was reused for a different payload/operation (`idempotency_conflict`), or an earlier request with the same key is still being processed (`idempotency_in_progress`).",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "getProduct",
          "method": "get",
          "path": "/products/{id}",
          "summary": "Get a product",
          "tag": "Products",
          "scope": "products:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "id",
              "in": "path",
              "required": true,
              "description": "Resource identifier (UUID).",
              "type": "string · uuid"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "The product.",
              "headers": [
                "X-Request-Id"
              ],
              "data": {
                "kind": "object",
                "itemType": "Product",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "sku",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "barcode",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "name",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "name_en",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: good · service"
                  },
                  {
                    "name": "unit",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "category",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "brand",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "currency",
                    "type": "string · ISO-4217",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "ISO-4217 currency code.",
                    "example": "\"SAR\""
                  },
                  {
                    "name": "sale_price_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "tax_rate",
                    "type": "integer",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "track_inventory",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "is_active",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "404",
              "description": "The resource does not exist within the caller's tenant. Identifiers from other tenants are reported as not found without revealing their existence.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "Invoices",
      "description": "Sales invoices (read and controlled draft create).",
      "operations": [
        {
          "id": "listInvoices",
          "method": "get",
          "path": "/invoices",
          "summary": "List invoices",
          "description": "Paginated, tenant-scoped list of sales invoices (all statuses).",
          "tag": "Invoices",
          "scope": "invoices:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "page",
              "in": "query",
              "required": false,
              "description": "1-based page number.",
              "type": "integer",
              "constraints": "range 1–∞ · default 1"
            },
            {
              "name": "per_page",
              "in": "query",
              "required": false,
              "description": "Page size. Defaults to 25; hard maximum 100.",
              "type": "integer",
              "constraints": "range 1–100 · default 25"
            },
            {
              "name": "search",
              "in": "query",
              "required": false,
              "description": "Free-text match on invoice number or partner name.",
              "type": "string",
              "constraints": "length 0–120"
            },
            {
              "name": "status",
              "in": "query",
              "required": false,
              "type": "string · enum",
              "constraints": "enum: draft · posted · cancelled"
            },
            {
              "name": "payment_status",
              "in": "query",
              "required": false,
              "type": "string · enum",
              "constraints": "enum: unpaid · partial · paid"
            },
            {
              "name": "partner_id",
              "in": "query",
              "required": false,
              "type": "string · uuid"
            },
            {
              "name": "date_from",
              "in": "query",
              "required": false,
              "type": "string · date"
            },
            {
              "name": "date_to",
              "in": "query",
              "required": false,
              "description": "Must be on or after `date_from`.",
              "type": "string · date"
            },
            {
              "name": "sort",
              "in": "query",
              "required": false,
              "description": "Sort field with optional leading `-`. Default `-invoice_date`.",
              "type": "string · enum",
              "constraints": "enum: invoice_date · number · total · created_at · -invoice_date · -number · -total · -created_at"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "A page of invoice summaries.",
              "headers": [
                "X-Request-Id",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining"
              ],
              "data": {
                "kind": "list",
                "itemType": "InvoiceSummary",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "number",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "status",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: draft · posted · cancelled"
                  },
                  {
                    "name": "type",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "example": "\"sale\""
                  },
                  {
                    "name": "payment_type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": true,
                    "readOnly": false,
                    "constraints": "enum: cash · credit"
                  },
                  {
                    "name": "payment_status",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: unpaid · partial · paid"
                  },
                  {
                    "name": "is_paid",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "tax_inclusive",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "invoice_date",
                    "type": "string · date",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "due_date",
                    "type": "string · date",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "partner_id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "partner",
                    "type": "InvoicePartnerRef",
                    "required": false,
                    "nullable": true,
                    "readOnly": false,
                    "description": "Compact partner reference, included when the partner is loaded (list and detail)."
                  },
                  {
                    "name": "currency",
                    "type": "string · ISO-4217",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "ISO-4217 currency code.",
                    "example": "\"SAR\""
                  },
                  {
                    "name": "subtotal_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "discount_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "shipping_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "adjustment_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "tax_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "total_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "paid_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "balance_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "createInvoiceDraft",
          "method": "post",
          "path": "/invoices",
          "summary": "Create an invoice draft",
          "description": "Creates a **draft** sales invoice. The invoice is NOT posted to the ledger, does NOT create cost-of-goods or inventory movements, does NOT record a payment, and is NOT submitted, reported, or cleared to ZATCA by this operation. Totals are computed by the server from the line items; client-supplied totals are ignored. Every referenced entity (partner, product, warehouse, branch) must belong to the caller's tenant. The 201 response is a bounded invoice summary (without line items); fetch the invoice by id to read its lines. Requires an idempotency key.",
          "tag": "Invoices",
          "scope": "invoices:write",
          "requiresAuth": true,
          "idempotency": true,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "Idempotency-Key",
              "in": "header",
              "required": true,
              "description": "Client-generated key that makes the write safe to retry. 8–255 characters matching `^[A-Za-z0-9._:-]+$`. Bound to the tenant, API client, method, route, and a fingerprint of the request payload.",
              "type": "string",
              "constraints": "length 8–255 · pattern ^[A-Za-z0-9._:\\-]{8,255}$"
            }
          ],
          "requestBody": {
            "required": true,
            "contentType": "application/json",
            "fields": [
              {
                "name": "partner_id",
                "type": "string · uuid",
                "required": true,
                "nullable": false,
                "readOnly": false
              },
              {
                "name": "branch_id",
                "type": "string · uuid",
                "required": false,
                "nullable": true,
                "readOnly": false
              },
              {
                "name": "warehouse_id",
                "type": "string · uuid",
                "required": false,
                "nullable": true,
                "readOnly": false
              },
              {
                "name": "invoice_date",
                "type": "string · date",
                "required": false,
                "nullable": true,
                "readOnly": false
              },
              {
                "name": "due_date",
                "type": "string · date",
                "required": false,
                "nullable": true,
                "readOnly": false
              },
              {
                "name": "payment_type",
                "type": "string · enum",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "enum: cash · credit"
              },
              {
                "name": "notes",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "items",
                "type": "array of InvoiceLineCreate",
                "required": true,
                "nullable": false,
                "readOnly": false
              }
            ],
            "example": {
              "partner_id": "6f0b1e2c-8a1d-4c9a-9d2e-0b7a1c2d3e4f",
              "invoice_date": "2026-01-15",
              "payment_type": "credit",
              "items": [
                {
                  "product_id": "7a1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
                  "quantity": 2,
                  "unit_price_minor": 10000,
                  "tax_rate": 15
                }
              ]
            }
          },
          "responses": [
            {
              "status": "201",
              "description": "Draft created (or the original response replayed on retry). The body is a bounded invoice summary without line items.",
              "headers": [
                "X-Request-Id",
                "Idempotency-Replayed"
              ],
              "data": {
                "kind": "object",
                "itemType": "InvoiceSummary",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "number",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "status",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: draft · posted · cancelled"
                  },
                  {
                    "name": "type",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "example": "\"sale\""
                  },
                  {
                    "name": "payment_type",
                    "type": "string · enum",
                    "required": true,
                    "nullable": true,
                    "readOnly": false,
                    "constraints": "enum: cash · credit"
                  },
                  {
                    "name": "payment_status",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: unpaid · partial · paid"
                  },
                  {
                    "name": "is_paid",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "tax_inclusive",
                    "type": "boolean",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "invoice_date",
                    "type": "string · date",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "due_date",
                    "type": "string · date",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "partner_id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "partner",
                    "type": "InvoicePartnerRef",
                    "required": false,
                    "nullable": true,
                    "readOnly": false,
                    "description": "Compact partner reference, included when the partner is loaded (list and detail)."
                  },
                  {
                    "name": "currency",
                    "type": "string · ISO-4217",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "ISO-4217 currency code.",
                    "example": "\"SAR\""
                  },
                  {
                    "name": "subtotal_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "discount_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "shipping_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "adjustment_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "tax_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "total_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "paid_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "balance_minor",
                    "type": "integer · minor units",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "400",
              "description": "The `Idempotency-Key` header is missing or malformed.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "409",
              "description": "The same `Idempotency-Key` was reused for a different payload/operation (`idempotency_conflict`), or an earlier request with the same key is still being processed (`idempotency_in_progress`).",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "getInvoice",
          "method": "get",
          "path": "/invoices/{id}",
          "summary": "Get an invoice",
          "description": "Returns the invoice with its line items.",
          "tag": "Invoices",
          "scope": "invoices:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "id",
              "in": "path",
              "required": true,
              "description": "Resource identifier (UUID).",
              "type": "string · uuid"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "The invoice with line items.",
              "headers": [
                "X-Request-Id"
              ],
              "data": {
                "kind": "object",
                "itemType": "InvoiceDetail",
                "fields": [
                  {
                    "name": "lines",
                    "type": "array of InvoiceLine",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "404",
              "description": "The resource does not exist within the caller's tenant. Identifiers from other tenants are reported as not found without revealing their existence.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "Webhooks",
      "description": "Tenant-owned outbound webhook subscriptions (management + secure signed delivery).",
      "operations": [
        {
          "id": "listWebhooks",
          "method": "get",
          "path": "/webhooks",
          "summary": "List webhook subscriptions",
          "description": "Paginated, tenant-scoped list of webhook subscriptions. Secrets are never returned.",
          "tag": "Webhooks",
          "scope": "webhooks:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "page",
              "in": "query",
              "required": false,
              "description": "1-based page number.",
              "type": "integer",
              "constraints": "range 1–∞ · default 1"
            },
            {
              "name": "per_page",
              "in": "query",
              "required": false,
              "description": "Page size. Defaults to 25; hard maximum 100.",
              "type": "integer",
              "constraints": "range 1–100 · default 25"
            },
            {
              "name": "status",
              "in": "query",
              "required": false,
              "type": "string · enum",
              "constraints": "enum: enabled · disabled"
            },
            {
              "name": "sort",
              "in": "query",
              "required": false,
              "description": "Sort field with optional leading `-`. Default `-created_at`.",
              "type": "string · enum",
              "constraints": "enum: created_at · -created_at"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "A page of webhook subscriptions.",
              "headers": [
                "X-Request-Id",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining"
              ],
              "data": {
                "kind": "list",
                "itemType": "Webhook",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "api_client_id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "url",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "event_types",
                    "type": "array of WebhookEventType",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "status",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: enabled · disabled"
                  },
                  {
                    "name": "secret_prefix",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Non-secret identifier for the signing secret (a short prefix)."
                  },
                  {
                    "name": "disabled_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "last_success_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "last_failure_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "createWebhook",
          "method": "post",
          "path": "/webhooks",
          "summary": "Create a webhook subscription",
          "description": "Registers a tenant-owned webhook subscription. The destination URL is SSRF-validated (HTTPS required; private, loopback, link-local and other non-public addresses are rejected) and event types must be in the catalog. The server generates the signing secret and returns it **once** in this response (`data.secret`); it is stored encrypted and can never be retrieved again — only rotated. Requires an idempotency key.",
          "tag": "Webhooks",
          "scope": "webhooks:write",
          "requiresAuth": true,
          "idempotency": true,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "Idempotency-Key",
              "in": "header",
              "required": true,
              "description": "Client-generated key that makes the write safe to retry. 8–255 characters matching `^[A-Za-z0-9._:-]+$`. Bound to the tenant, API client, method, route, and a fingerprint of the request payload.",
              "type": "string",
              "constraints": "length 8–255 · pattern ^[A-Za-z0-9._:\\-]{8,255}$"
            }
          ],
          "requestBody": {
            "required": true,
            "contentType": "application/json",
            "fields": [
              {
                "name": "url",
                "type": "string · uri",
                "required": true,
                "nullable": false,
                "readOnly": false,
                "description": "HTTPS destination. SSRF-validated: non-public addresses (private, loopback, link-local, etc.) are rejected.",
                "constraints": "length 0–2048"
              },
              {
                "name": "event_types",
                "type": "array of WebhookEventType",
                "required": true,
                "nullable": false,
                "readOnly": false
              },
              {
                "name": "description",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              }
            ],
            "example": {
              "url": "https://example.com/awj/webhooks",
              "event_types": [
                "invoice.created",
                "partner.created"
              ],
              "description": "Billing integration"
            }
          },
          "responses": [
            {
              "status": "201",
              "description": "Subscription created. `data.secret` is present **only** here.",
              "headers": [
                "X-Request-Id",
                "Idempotency-Replayed"
              ],
              "data": {
                "kind": "object",
                "itemType": "WebhookWithSecret",
                "fields": [
                  {
                    "name": "secret",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "The raw signing secret — returned ONLY once, at creation or rotation. Store it securely; it is kept encrypted server-side and cannot be retrieved again."
                  }
                ]
              }
            },
            {
              "status": "400",
              "description": "The `Idempotency-Key` header is missing or malformed.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "409",
              "description": "The same `Idempotency-Key` was reused for a different payload/operation (`idempotency_conflict`), or an earlier request with the same key is still being processed (`idempotency_in_progress`).",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "getWebhook",
          "method": "get",
          "path": "/webhooks/{id}",
          "summary": "Get a webhook subscription",
          "tag": "Webhooks",
          "scope": "webhooks:read",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "id",
              "in": "path",
              "required": true,
              "description": "Resource identifier (UUID).",
              "type": "string · uuid"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "The webhook subscription (without secret).",
              "headers": [
                "X-Request-Id"
              ],
              "data": {
                "kind": "object",
                "itemType": "Webhook",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "api_client_id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "url",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "event_types",
                    "type": "array of WebhookEventType",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "status",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: enabled · disabled"
                  },
                  {
                    "name": "secret_prefix",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Non-secret identifier for the signing secret (a short prefix)."
                  },
                  {
                    "name": "disabled_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "last_success_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "last_failure_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "404",
              "description": "The resource does not exist within the caller's tenant. Identifiers from other tenants are reported as not found without revealing their existence.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "updateWebhook",
          "method": "patch",
          "path": "/webhooks/{id}",
          "summary": "Update a webhook subscription",
          "description": "Partial update of a subscription (URL, event types, description, enable/ disable). A changed URL is re-validated for SSRF. The signing secret is unchanged (rotate it via the dedicated operation).",
          "tag": "Webhooks",
          "scope": "webhooks:write",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "id",
              "in": "path",
              "required": true,
              "description": "Resource identifier (UUID).",
              "type": "string · uuid"
            }
          ],
          "requestBody": {
            "required": true,
            "contentType": "application/json",
            "fields": [
              {
                "name": "url",
                "type": "string · uri",
                "required": false,
                "nullable": false,
                "readOnly": false,
                "constraints": "length 0–2048"
              },
              {
                "name": "event_types",
                "type": "array of WebhookEventType",
                "required": false,
                "nullable": false,
                "readOnly": false
              },
              {
                "name": "description",
                "type": "string",
                "required": false,
                "nullable": true,
                "readOnly": false,
                "constraints": "length 0–255"
              },
              {
                "name": "status",
                "type": "string · enum",
                "required": false,
                "nullable": false,
                "readOnly": false,
                "constraints": "enum: enabled · disabled"
              }
            ],
            "example": {
              "status": "disabled"
            }
          },
          "responses": [
            {
              "status": "200",
              "description": "The updated subscription (without secret).",
              "headers": [
                "X-Request-Id"
              ],
              "data": {
                "kind": "object",
                "itemType": "Webhook",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "api_client_id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "url",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "event_types",
                    "type": "array of WebhookEventType",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "status",
                    "type": "string · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: enabled · disabled"
                  },
                  {
                    "name": "secret_prefix",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "Non-secret identifier for the signing secret (a short prefix)."
                  },
                  {
                    "name": "disabled_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "last_success_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "last_failure_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "created_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  },
                  {
                    "name": "updated_at",
                    "type": "string · date-time",
                    "required": true,
                    "nullable": true,
                    "readOnly": false
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "404",
              "description": "The resource does not exist within the caller's tenant. Identifiers from other tenants are reported as not found without revealing their existence.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "422",
              "description": "The request failed validation. `details` maps fields to messages.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "deleteWebhook",
          "method": "delete",
          "path": "/webhooks/{id}",
          "summary": "Delete a webhook subscription",
          "description": "Permanently removes the subscription and its pending deliveries. Tenant-isolated.",
          "tag": "Webhooks",
          "scope": "webhooks:write",
          "requiresAuth": true,
          "idempotency": false,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "id",
              "in": "path",
              "required": true,
              "description": "Resource identifier (UUID).",
              "type": "string · uuid"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "The subscription was deleted.",
              "headers": [
                "X-Request-Id"
              ],
              "data": {
                "kind": "object",
                "itemType": "WebhookDeleted",
                "fields": [
                  {
                    "name": "id",
                    "type": "string · uuid",
                    "required": true,
                    "nullable": false,
                    "readOnly": false
                  },
                  {
                    "name": "deleted",
                    "type": "boolean · enum",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "constraints": "enum: true"
                  }
                ]
              }
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "404",
              "description": "The resource does not exist within the caller's tenant. Identifiers from other tenants are reported as not found without revealing their existence.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        },
        {
          "id": "rotateWebhookSecret",
          "method": "post",
          "path": "/webhooks/{id}/rotate-secret",
          "summary": "Rotate a webhook signing secret",
          "description": "Generates a new signing secret and returns it **once** (`data.secret`). Signatures made with the previous secret stop verifying immediately. Requires an idempotency key.",
          "tag": "Webhooks",
          "scope": "webhooks:write",
          "requiresAuth": true,
          "idempotency": true,
          "parameters": [
            {
              "name": "X-Request-Id",
              "in": "header",
              "required": false,
              "description": "Optional client-supplied correlation id. When present and matching `^[A-Za-z0-9._-]{8,128}$` it is echoed in the `X-Request-Id` response header and `meta.request_id`; when absent or malformed the server generates one. Applies to every operation, health included.",
              "type": "string",
              "constraints": "length 8–128 · pattern ^[A-Za-z0-9._-]{8,128}$"
            },
            {
              "name": "id",
              "in": "path",
              "required": true,
              "description": "Resource identifier (UUID).",
              "type": "string · uuid"
            },
            {
              "name": "Idempotency-Key",
              "in": "header",
              "required": true,
              "description": "Client-generated key that makes the write safe to retry. 8–255 characters matching `^[A-Za-z0-9._:-]+$`. Bound to the tenant, API client, method, route, and a fingerprint of the request payload.",
              "type": "string",
              "constraints": "length 8–255 · pattern ^[A-Za-z0-9._:\\-]{8,255}$"
            }
          ],
          "responses": [
            {
              "status": "200",
              "description": "The subscription with a freshly rotated `data.secret` (present only here).",
              "headers": [
                "X-Request-Id",
                "Idempotency-Replayed"
              ],
              "data": {
                "kind": "object",
                "itemType": "WebhookWithSecret",
                "fields": [
                  {
                    "name": "secret",
                    "type": "string",
                    "required": true,
                    "nullable": false,
                    "readOnly": false,
                    "description": "The raw signing secret — returned ONLY once, at creation or rotation. Store it securely; it is kept encrypted server-side and cannot be retrieved again."
                  }
                ]
              }
            },
            {
              "status": "400",
              "description": "The `Idempotency-Key` header is missing or malformed.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "401",
              "description": "Missing or invalid API key.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "403",
              "description": "Authenticated but not permitted — insufficient scope, inactive client, missing tenant context, or inactive subscription.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "404",
              "description": "The resource does not exist within the caller's tenant. Identifiers from other tenants are reported as not found without revealing their existence.",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "409",
              "description": "The same `Idempotency-Key` was reused for a different payload/operation (`idempotency_conflict`), or an earlier request with the same key is still being processed (`idempotency_in_progress`).",
              "headers": [
                "X-Request-Id"
              ]
            },
            {
              "status": "429",
              "description": "The per-client rate limit was exceeded.",
              "headers": [
                "X-Request-Id",
                "Retry-After",
                "X-RateLimit-Limit",
                "X-RateLimit-Remaining",
                "X-RateLimit-Reset"
              ]
            }
          ]
        }
      ]
    }
  ],
  "schemas": {
    "InvoiceLine": [
      {
        "name": "product_id",
        "type": "string · uuid",
        "required": true,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "product_name",
        "type": "string",
        "required": true,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "product_sku",
        "type": "string",
        "required": true,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "barcode",
        "type": "string",
        "required": true,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "description",
        "type": "string",
        "required": true,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "quantity",
        "type": "integer",
        "required": true,
        "nullable": false,
        "readOnly": false
      },
      {
        "name": "unit_name",
        "type": "string",
        "required": true,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "tax_rate",
        "type": "integer",
        "required": true,
        "nullable": false,
        "readOnly": false
      },
      {
        "name": "currency",
        "type": "string · ISO-4217",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "description": "ISO-4217 currency code.",
        "example": "\"SAR\""
      },
      {
        "name": "unit_price_minor",
        "type": "integer · minor units",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
      },
      {
        "name": "line_subtotal_minor",
        "type": "integer · minor units",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
      },
      {
        "name": "line_discount_minor",
        "type": "integer · minor units",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
      },
      {
        "name": "line_tax_minor",
        "type": "integer · minor units",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
      },
      {
        "name": "line_total_minor",
        "type": "integer · minor units",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050."
      }
    ],
    "InvoiceLineCreate": [
      {
        "name": "product_id",
        "type": "string · uuid",
        "required": false,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "description",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false,
        "constraints": "length 0–255"
      },
      {
        "name": "quantity",
        "type": "integer",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "constraints": "range 1–1000000"
      },
      {
        "name": "unit",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false,
        "constraints": "length 0–255"
      },
      {
        "name": "unit_price_minor",
        "type": "integer · minor units",
        "required": true,
        "nullable": false,
        "readOnly": false,
        "description": "Monetary amount in integer minor units (e.g. halalas). 100.50 SAR = 10050.",
        "constraints": "range 0–∞"
      },
      {
        "name": "tax_rate",
        "type": "integer",
        "required": false,
        "nullable": true,
        "readOnly": false,
        "constraints": "range 0–100"
      },
      {
        "name": "discount_minor",
        "type": "integer",
        "required": false,
        "nullable": true,
        "readOnly": false,
        "constraints": "range 0–∞"
      }
    ],
    "PartnerAddress": [
      {
        "name": "address",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "city",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "district",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "street",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "building_no",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "postal_code",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false
      },
      {
        "name": "country",
        "type": "string",
        "required": false,
        "nullable": true,
        "readOnly": false
      }
    ]
  }
};
