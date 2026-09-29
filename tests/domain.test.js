import { test } from 'node:test';
import assert from 'node:assert/strict';
import { energyCharge, basicCharge, seasonOf, TARIFF_GEN_GAP1_LOW } from '../src/domain/tariff.js';
import { appliedKw, prescribeContract } from '../src/domain/contract.js';
import { fitBaseline, verifySavings } from '../src/domain/baseline.js';
import { equipmentPayback } from '../src/domain/equipment.js';

test('AC-1 전력량요금 여름 1,000kWh = 132,400원', () => {
  assert.equal(seasonOf(8), 'summer');
  assert.equal(energyCharge(1000, 8), 132400);
  assert.equal(energyCharge(1000, 4), 91900);
  assert.equal(energyCharge(1000, 1), 119000);
  assert.equal(basicCharge(10), 61600);
  assert.equal(TARIFF_GEN_GAP1_LOW.basicPerKw, 6160);
});

test('AC-2 요금적용전력 30% 하한 / 20kW 미만은 계약전력', () => {
  const peaks = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, peakKw: 7 }));
  assert.equal(appliedKw({ contractKw: 30, peaks, billMonth: 9 }), 9);
  const p2 = peaks.map(p => ({ ...p, peakKw: p.month === 8 ? 21 : 12 }));
  assert.equal(appliedKw({ contractKw: 30, peaks: p2, billMonth: 9 }), 21);
  // 4월 최대는 창 밖이라 무시
  const p3 = peaks.map(p => ({ ...p, peakKw: p.month === 4 ? 25 : 12 }));
  assert.equal(appliedKw({ contractKw: 30, peaks: p3, billMonth: 9 }), 12);
  assert.equal(appliedKw({ contractKw: 15, peaks, billMonth: 9 }), 15);
});

test('AC-3 20kW 미만 계약전력 하향 처방', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, kwh: i === 7 ? 2000 : 1200 }));
  const r = prescribeContract({ contractKw: 15, months });
  assert.equal(r.recommendedKw, 6);
  assert.equal(r.annualSavingKrw, 9 * 6160 * 12);
  assert.equal(r.overuseMonths.length, 0);
  assert.match(r.note, /1년/);
});

test('AC-4 450시간 초과 위험 경고', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, kwh: i === 7 ? 2400 : 1000 }));
  const r = prescribeContract({ contractKw: 5, months });
  assert.deepEqual(r.overuseMonths, [8]);
  assert.equal(r.recommendedKw, 7); // 2400/450*1.2 = 6.4 → 7 (상향 권고)
  assert.equal(r.annualSavingKrw, 0);
});

const dd = [ // 창원 2025 도일(난방18/냉방24) 근사 입력
  { month: 1, hdd: 507, cdd: 0 }, { month: 2, hdd: 420, cdd: 0 }, { month: 3, hdd: 280, cdd: 0 },
  { month: 4, hdd: 110, cdd: 0 }, { month: 5, hdd: 25, cdd: 5 }, { month: 6, hdd: 0, cdd: 40 },
  { month: 7, hdd: 0, cdd: 130 }, { month: 8, hdd: 0, cdd: 150 }, { month: 9, hdd: 0, cdd: 60 },
  { month: 10, hdd: 40, cdd: 2 }, { month: 11, hdd: 220, cdd: 0 }, { month: 12, hdd: 420, cdd: 0 },
];

test('AC-5 기상 보정 분해: 합성 데이터 계수 복원', () => {
  const rows = dd.map(d => ({ ...d, kwh: 1000 + 2 * d.hdd + 5 * d.cdd }));
  const m = fitBaseline(rows);
  assert.ok(Math.abs(m.a - 1000) < 10);
  assert.ok(Math.abs(m.h - 2) < 0.02);
  assert.ok(Math.abs(m.c - 5) < 0.05);
  assert.equal(m.verdict, 'ok');
  const tot = m.shares.base + m.shares.heating + m.shares.cooling;
  assert.ok(Math.abs(tot - 1) < 1e-9);
});

test('AC-6 잡음이 크면 판정 보류', () => {
  const noise = [900, -700, 800, -900, 700, -800, 900, -600, 850, -750, 800, -900];
  const rows = dd.map((d, i) => ({ ...d, kwh: 1000 + 2 * d.hdd + 5 * d.cdd + noise[i] }));
  const m = fitBaseline(rows);
  assert.equal(m.verdict, 'hold');
  assert.match(m.reason, /CV\(RMSE\)/);
});

test('AC-7 전후 검증: 예측보다 10% 적으면 절감률 ≈ 10%', () => {
  const rows = dd.map(d => ({ ...d, kwh: 1000 + 2 * d.hdd + 5 * d.cdd }));
  const m = fitBaseline(rows);
  const post = dd.slice(6, 9).map(d => ({ ...d, kwh: 0.9 * (1000 + 2 * d.hdd + 5 * d.cdd) }));
  const v = verifySavings(m, post);
  assert.ok(Math.abs(v.savingRate - 0.10) < 0.005);
  assert.equal(v.verdict, 'ok');
});

test('AC-8 고효율기기 회수기간(한전 40%, 한도 160만 원)', () => {
  const r = equipmentPayback({ priceKrw: 3_000_000, annualSavingKwh: 1200, unitPrice: 132.4, kind: 'aircon' });
  assert.equal(r.subsidyKrw, 1_200_000);
  assert.equal(r.paybackYears, 11.3);
  const r2 = equipmentPayback({ priceKrw: 5_000_000, annualSavingKwh: 3000, unitPrice: 132.4, kind: 'fridge' });
  assert.equal(r2.subsidyKrw, 1_600_000);
});
