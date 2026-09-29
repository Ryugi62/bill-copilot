import { TARIFF_GEN_GAP1_LOW } from './tariff.js';

export const DEMAND_METER_MIN_KW = 20;      // 최대수요전력 적용 시작
export const HOURS_CAP_PER_KW = 450;        // 20kW 미만 저압: 계약전력 1kW당 월 450kWh
const WINDOW_MONTHS = new Set([12, 1, 2, 7, 8, 9]);

/** 요금적용전력(약관 제68조): 20kW 이상은 창(12·1·2·7·8·9월+당월) 최대수요 중 최댓값, 계약의 30% 하한. */
export function appliedKw({ contractKw, peaks, billMonth }) {
  if (contractKw < DEMAND_METER_MIN_KW) return contractKw;
  const inWindow = peaks.filter(p => WINDOW_MONTHS.has(p.month) || p.month === billMonth).map(p => p.peakKw);
  const maxPeak = inWindow.length ? Math.max(...inWindow) : contractKw;
  return Math.max(maxPeak, Math.round(contractKw * 0.3 * 100) / 100);
}

/** 20kW 미만 저압의 계약전력 처방: 450시간 기준 필요 kW × 1.2 여유, 1kW 단위 올림. */
export function prescribeContract({ contractKw, months, t = TARIFF_GEN_GAP1_LOW, margin = 1.2 }) {
  const maxKwh = Math.max(...months.map(m => m.kwh));
  const needKw = maxKwh / HOURS_CAP_PER_KW;
  const recommendedKw = Math.max(1, Math.ceil(needKw * margin - 1e-9));
  const overuseMonths = months.filter(m => m.kwh > contractKw * HOURS_CAP_PER_KW).map(m => m.month);
  const deltaKw = Math.max(0, contractKw - recommendedKw);
  const annualSavingKrw = deltaKw * t.basicPerKw * 12;
  let note;
  if (overuseMonths.length) note = `월 ${overuseMonths.join('·')}월 사용량이 계약전력×450시간을 넘습니다 — 초과사용 부가금 위험, 계약전력 ${recommendedKw}kW 이상으로 상향 검토`;
  else if (deltaKw > 0) note = `계약전력 ${contractKw}→${recommendedKw}kW 하향 시 기본요금 연 ${annualSavingKrw.toLocaleString('ko-KR')}원 절감(변경 후 1년 유지, 한전 설비 확인 후 신청)`;
  else note = '계약전력이 사용량에 맞습니다(변경 불필요)';
  return { maxKwh, needKw: Math.round(needKw * 100) / 100, recommendedKw, deltaKw, annualSavingKrw, overuseMonths, note };
}

/** 20kW 이상: 창 월 최대수요를 targetKw로 낮출 때의 기본요금 절감(연). */
export function peakShavingValue({ contractKw, peaks, targetKw, t = TARIFF_GEN_GAP1_LOW }) {
  const now = appliedKw({ contractKw, peaks, billMonth: 9 });
  const after = Math.max(targetKw, contractKw * 0.3);
  return Math.max(0, Math.round((now - after) * t.basicPerKw * 12));
}
