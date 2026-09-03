import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { transformOpenApi } from '../../../../../scripts/openapi-transform.mjs';
import { OPENAPI_MODEL } from '../openapi-model.generated';

/**
 * حارس الانحراف: النموذج المُودَع (`openapi-model.generated.ts`) هو مُدخل بناء الواجهة،
 * والعقد (`docs/openapi/public-api-v1.yaml`) هو مصدر الحقيقة. هذا الاختبار يعيد اشتقاق
 * النموذج من العقد ويقارنه بالمُودَع، فلا يتباعدان صامتَين.
 *
 * حين يُسحب المستودع كاملاً (Web CI محليّاً) يكون العقد حاضراً فيعمل الحارس. في بيئة لا
 * تضمّ `docs/` (نشر يقتصر على `web/`) يُتخطّى — البناء يستعمل المُودَع على أي حال.
 */
const specPath = resolve(process.cwd(), '../docs/openapi/public-api-v1.yaml');
const specPresent = existsSync(specPath);

describe('OpenAPI docs model', () => {
  it.runIf(specPresent)('matches the committed model (no drift from the contract)', () => {
    const spec = parse(readFileSync(specPath, 'utf8'));
    const fresh = transformOpenApi(spec);
    // مقارنة بنيويّة عميقة عبر جولة JSON (تُطابق ما يُسلسَل فعلاً في الملف المولَّد).
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(OPENAPI_MODEL);
  });

  it('exposes the eight contract scopes and three webhook events', () => {
    expect(OPENAPI_MODEL.scopes).toEqual([
      'invoices:read', 'invoices:write',
      'partners:read', 'partners:write',
      'products:read', 'products:write',
      'webhooks:read', 'webhooks:write',
    ]);
    expect(OPENAPI_MODEL.events).toEqual(['partner.created', 'product.created', 'invoice.created']);
  });

  it('covers the five resource groups and sixteen operations', () => {
    expect(OPENAPI_MODEL.tags.map((tag) => tag.name)).toEqual(['Health', 'Partners', 'Products', 'Invoices', 'Webhooks']);
    const operations = OPENAPI_MODEL.tags.flatMap((tag) => tag.operations);
    expect(operations).toHaveLength(16);
  });
});
