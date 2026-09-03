import { describe, expect, it } from 'vitest';
import { OPENAPI_MODEL } from '../openapi-model.generated';
import { buildCurl, buildExamples, buildJavaScript } from '../examples';
import type { ApiOperation } from '../openapi-types';

const ALL = OPENAPI_MODEL.tags.flatMap((tag) => tag.operations);
const find = (id: string): ApiOperation => {
  const op = ALL.find((operation) => operation.id === id);
  if (!op) throw new Error(`operation ${id} not found`);
  return op;
};

describe('code examples derived from the contract', () => {
  it('a write example includes the Idempotency-Key header and real allowed fields', () => {
    const curl = buildCurl(find('createInvoiceDraft'));
    expect(curl).toContain('-X POST');
    expect(curl).toContain('Idempotency-Key: $(uuidgen)');
    expect(curl).toContain('Authorization: Bearer $AWJ_API_KEY');
    expect(curl).toContain('Content-Type: application/json');
    // حقول من المخطّط الحقيقي (لا حقول ملفّقة)، وبالوحدات الصغرى:
    expect(curl).toContain('"partner_id"');
    expect(curl).toContain('"unit_price_minor"');
    expect(curl).not.toContain('total'); // الإجماليات يشتقّها الخادم، لا تُرسَل
  });

  it('never embeds a real secret and never targets an internal route', () => {
    for (const op of ALL) {
      const curl = buildCurl(op);
      const js = buildJavaScript(op);
      expect(curl).not.toMatch(/Bearer\s+(?!\$AWJ_API_KEY)[A-Za-z0-9]/); // فقط عنصر نائب
      expect(curl).toContain('$AWJ_API_BASE');
      expect(curl).not.toContain('/api/developer');
      expect(curl).not.toContain('/api/v1'); // الأصل متغيّر بيئة، لا مسار مثبَّت
      expect(js).not.toContain('/api/developer');
    }
  });

  it('a read example carries no body and no idempotency header', () => {
    const curl = buildCurl(find('listPartners'));
    expect(curl).toContain('-X GET');
    expect(curl).not.toContain('Idempotency-Key');
    expect(curl).not.toContain("-d '");
    expect(curl).toContain('?page=1&per_page=25');
  });

  it('the JavaScript example uses crypto.randomUUID for idempotent writes', () => {
    const js = buildJavaScript(find('createPartner'));
    expect(js).toContain('crypto.randomUUID()');
    expect(js).toContain('body: JSON.stringify(');
    expect(js).toContain('await fetch(');
  });

  it('exposes exactly a cURL and a JavaScript example per operation', () => {
    const examples = buildExamples(find('getHealth'));
    expect(examples.map((example) => example.language)).toEqual(['bash', 'javascript']);
    // health عمليّة عامة: لا ترويسة مصادقة
    expect(buildCurl(find('getHealth'))).not.toContain('Authorization');
  });
});
