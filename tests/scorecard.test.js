import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildScorecard } from '../src/application/scorecard.js';
import { EXAMPLE } from '../public/example.js';

const DD = JSON.parse(readFileSync(new URL('../data/degree-days.json', import.meta.url)));

test('예시 카페(창원) 성적표: 분해 ok · 계약전력 처방 · 냉방 교체 회수기간', () => {
  const sc = buildScorecard({ ...EXAMPLE, degreeDays: DD.cities[EXAMPLE.city] });
  assert.equal(sc.rows.length, 12);
  assert.equal(sc.model.verdict, 'ok');
  assert.ok(sc.model.shares.cooling > 0.1);
  const c = sc.prescriptions.find(p => p.kind === 'contract');
  assert.ok(c.annualSavingKrw > 0);
  assert.ok(sc.bill.total > sc.bill.basic);
  const a = sc.prescriptions.find(p => p.kind === 'aircon');
  assert.ok(a.data.subsidyKrw <= 1_600_000);
});

test('기상 자료 없는 달이면 오류', () => {
  assert.throws(() => buildScorecard({ contractKw: 10, bills: [{ ym: '1999-01', kwh: 1 }], degreeDays: {} }), /기상 자료 없음/);
});

test('도메인·애플리케이션 층은 DOM·fetch를 모른다', () => {
  for (const f of ['domain/tariff.js', 'domain/contract.js', 'domain/baseline.js', 'domain/equipment.js', 'application/scorecard.js']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /document\.|window\.|fetch\(|adapters\//, f);
  }
});
