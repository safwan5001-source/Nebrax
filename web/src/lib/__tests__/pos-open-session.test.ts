import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPosSessionOpenPayload,
  canSubmitPosSessionOpen,
  findMyOpenSession,
  selectableActiveRecords,
} from '@/lib/pos-open-session';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('buildPosSessionOpenPayload', () => {
  it('يرفض الجهاز الفارغ قبل أي إرسال', () => {
    expect(buildPosSessionOpenPayload({
      openingBalanceRiyal: '0',
      posDeviceId: '',
      posShiftId: 'shift-1',
    })).toEqual({ ok: false, error: 'device_required' });
  });

  it('يرفض وردية POS الفارغة ولا يرسل shift_id', () => {
    const parsed = buildPosSessionOpenPayload({
      openingBalanceRiyal: '10',
      posDeviceId: 'device-1',
      posShiftId: '  ',
    });
    expect(parsed).toEqual({ ok: false, error: 'shift_required' });
    expect(JSON.stringify(parsed)).not.toContain('shift_id');
  });

  it('يرسل pos_shift_id ويحوّل الريال إلى هللات', () => {
    expect(buildPosSessionOpenPayload({
      openingBalanceRiyal: '100.50',
      posDeviceId: 'device-1',
      posShiftId: 'pos-shift-morning',
    })).toEqual({
      ok: true,
      payload: {
        opening_balance: 10050,
        pos_device_id: 'device-1',
        pos_shift_id: 'pos-shift-morning',
      },
    });
  });

  it('يقبل العهدة الصفرية ولا يرفضها لأنها falsy', () => {
    for (const openingBalanceRiyal of ['0', '0.00', 0, '']) {
      const parsed = buildPosSessionOpenPayload({
        openingBalanceRiyal,
        posDeviceId: 'device-1',
        posShiftId: 'pos-shift-morning',
      });
      expect(parsed).toEqual({
        ok: true,
        payload: {
          opening_balance: 0,
          pos_device_id: 'device-1',
          pos_shift_id: 'pos-shift-morning',
        },
      });
    }
    expect(canSubmitPosSessionOpen({
      openingBalanceRiyal: '0',
      posDeviceId: 'device-1',
      posShiftId: 'pos-shift-morning',
    }, false)).toBe(true);
    expect(canSubmitPosSessionOpen({
      openingBalanceRiyal: '0',
      posDeviceId: 'device-1',
      posShiftId: 'pos-shift-morning',
    }, true)).toBe(false);
  });

  it('يرفض السالب والمشوّه', () => {
    expect(buildPosSessionOpenPayload({
      openingBalanceRiyal: '-1',
      posDeviceId: 'device-1',
      posShiftId: 'pos-shift-morning',
    })).toEqual({ ok: false, error: 'opening_balance_invalid' });
    expect(buildPosSessionOpenPayload({
      openingBalanceRiyal: '12.345',
      posDeviceId: 'device-1',
      posShiftId: 'pos-shift-morning',
    })).toEqual({ ok: false, error: 'opening_balance_invalid' });
  });
});

describe('findMyOpenSession / selectableActiveRecords', () => {
  it('يتبنّى أول جلسة open ولا يصنع جلسة جديدة من القائمة', () => {
    expect(findMyOpenSession([
      { id: 'closed', status: 'closed' },
      { id: 'open', status: 'open' },
    ])).toEqual({ id: 'open', status: 'open' });
    expect(findMyOpenSession([{ id: 'closed', status: 'closed' }])).toBeNull();
  });

  it('يخفي المعطّل في القائمة فقط دون اعتبار ذلك حماية خادمية', () => {
    expect(selectableActiveRecords([
      { id: 'a', is_active: true },
      { id: 'b', is_active: false },
    ])).toEqual([{ id: 'a', is_active: true }]);
  });
});

describe('حارس مسار فتح الجلسة في الواجهة', () => {
  it('يجعل بدء البيع يفتح /pos/start لا /pos مباشرة', () => {
    const workspace = source('src/lib/pos-workspace.ts');
    expect(workspace).toContain("export const POS_START_HREF = '/pos/start'");
    expect(workspace).toContain("export const POS_SELLING_HREF = '/pos'");
  });

  it('يمنع مسار HR shift_id من بوابة البيع الحديثة', () => {
    const posPage = source('src/app/(pos)/pos/page.tsx');
    const startPage = source('src/app/(pos)/pos/start/page.tsx');
    const helper = source('src/lib/pos-open-session.ts');
    expect(posPage).not.toContain("'/shifts'");
    expect(posPage).not.toContain('shift_id: shiftId');
    expect(posPage).toContain("router.replace(sessionInvalid ? `${POS_START_HREF}?reason=closed` : POS_START_HREF)");
    expect(startPage).toContain('body: parsed.payload');
    expect(startPage).toContain("'/pos-sessions/open'");
    expect(startPage).toContain("'/pos-shifts'");
    expect(startPage).not.toContain("'/shifts'");
    expect(helper).toContain('pos_shift_id');
    expect(helper).not.toMatch(/(?:^|[^a-z_])shift_id(?:[^a-z_]|$)/m);
  });
});
