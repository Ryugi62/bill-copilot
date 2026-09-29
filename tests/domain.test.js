import { test } from 'node:test';
import assert from 'node:assert/strict';
import { energyCharge, basicCharge, seasonOf, TARIFF_GEN_GAP1_LOW, billEstimate } from '../src/domain/tariff.js';
import { appliedKw, prescribeContract } from '../src/domain/contract.js';
import { fitBaseline, verifySavings, detectAnomalies, fractionalSavingsUncertainty } from '../src/domain/baseline.js';
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
  assert.equal(r.confirmed, false);
  assert.match(r.note, /과계약 의심/);
});

test('AC-3b 가동 설비 합계를 넣으면 그 아래로는 권고하지 않는다(저압 계약 = 사용설비 합계)', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, kwh: i === 7 ? 2000 : 1200 }));
  const r = prescribeContract({ contractKw: 15, months, installedKw: 11 });
  assert.equal(r.recommendedKw, 11);
  assert.equal(r.annualSavingKrw, 4 * 6160 * 12);
  assert.equal(r.confirmed, true);
  assert.match(r.note, /1년/);
  assert.match(r.note, /시설부담금/);
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

test('AC-5 기상 보정 분해: 합성 데이터 계수 복원(일수 정규화)', () => {
  const rows = dd.map(d => ({ ...d, kwh: 1000 + 2 * d.hdd + 5 * d.cdd }));
  const m = fitBaseline(rows);
  assert.ok(Math.abs(m.a * 30.4 - 1000) < 10);
  assert.ok(Math.abs(m.h - 2) < 0.02);
  assert.ok(Math.abs(m.c - 5) < 0.05);
  assert.equal(m.verdict, 'ok');
  assert.ok(Math.abs(m.shares.base + m.shares.heating + m.shares.cooling - 1) < 1e-9);
});

test('AC-5b 균형점 탐색: 냉방 22℃ 기준으로 만든 데이터면 22℃를 고른다', () => {
  const rows = dd.map((d, i) => { const r = { month: d.month, days: 30, hdd14: d.hdd * 0.5, hdd16: d.hdd * 0.75, hdd18: d.hdd, cdd20: d.cdd * 1.8 + (i % 3) * 7, cdd22: d.cdd > 0 ? d.cdd * 1.4 + 25 : 0, cdd24: d.cdd }; return { ...r, kwh: 900 + 2 * r.hdd18 + 5 * r.cdd22 }; });
  const m = fitBaseline(rows);
  assert.equal(m.bases.cooling, 22);
});
test('AC-6 잡음이 크면 판정 보류', () => {
  const noise = [900, -700, 800, -900, 700, -800, 900, -600, 850, -750, 800, -900];
  const rows = dd.map((d, i) => ({ ...d, kwh: 1000 + 2 * d.hdd + 5 * d.cdd + noise[i] }));
  const m = fitBaseline(rows);
  assert.equal(m.verdict, 'hold');
  assert.match(m.reason, /CV\(RMSE\)/);
});

test('AC-10 절감 불확도: 잡음 큰 기준선에서 작은 절감은 판정 보류', () => {
  assert.ok(fractionalSavingsUncertainty({ cvrmse: 0.03, n: 12, m: 12, savingRate: 0.10 }) < 0.5);
  assert.ok(fractionalSavingsUncertainty({ cvrmse: 0.15, n: 12, m: 3, savingRate: 0.05 }) > 0.5);
  const noise = [0.12, -0.12, 0.1, -0.1, 0.12, -0.12, 0.1, -0.1, 0.12, -0.12, 0.1, -0.1];
  const rows = dd.map((d, i) => ({ ...d, kwh: (1000 + 2 * d.hdd + 5 * d.cdd) * (1 + noise[i]) }));
  const m = fitBaseline(rows);
  const post = dd.slice(6, 9).map(d => ({ ...d, kwh: 0.97 * (1000 + 2 * d.hdd + 5 * d.cdd) }));
  assert.equal(verifySavings(m, post).verdict, 'hold');
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

test('AC-9 이상 사용 감지: 기준선보다 크게 튄 달만 잡는다', () => {
  const noise = [0.02, -0.02, 0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.02, -0.02, 0.01, -0.01];
  const rows = dd.map((d, i) => ({ ...d, ym: `2025-${String(d.month).padStart(2, '0')}`, kwh: (1000 + 2 * d.hdd + 5 * d.cdd) * (1 + noise[i]) }));
  const m = fitBaseline(rows);
  const post = [{ ...dd[7], ym: '2026-08', kwh: 1.25 * (1000 + 5 * 150) }, { ...dd[8], ym: '2026-09', kwh: 1000 + 5 * 60 }];
  const a = detectAnomalies(m, post);
  assert.equal(a.length, 1);
  assert.equal(a[0].ym, '2026-08');
});

test('AC-11 청구 추정: 기후환경 9·연료비 5원/kWh, 기금 2.7%(10원 미만 절사), 부가세 10%', () => {
  const b = billEstimate({ basic: 61600, energy: 91900, kwh: 1000 });
  assert.equal(b.sub, 61600 + 91900 + 14000);
  assert.equal(b.fund, Math.floor(167500 * 0.027 / 10) * 10);
  assert.equal(b.vat, 16750);
  assert.equal(b.total, b.sub + b.fund + b.vat);
});
