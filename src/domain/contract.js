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

/**
 * 20kW 미만 저압의 계약전력 점검. 저압 계약전력은 신고된 사용설비 합계로 산정되므로(75kW까지 100% 환산)
 * 사용량만으로 계약을 내릴 수는 없다 → 450시간 기준 필요 kW × 1.2를 「실사용 필요 kW」로 보고,
 * 계약이 그보다 크면 「과계약 의심」 신호 + 잠재 절감(상한). installedKw(실제 가동 설비 합계)를 넣으면 그 아래로는 권고하지 않는다.
 */
export function prescribeContract({ contractKw, months, installedKw, t = TARIFF_GEN_GAP1_LOW, margin = 1.2 }) {
  const maxKwh = Math.max(...months.map(m => m.kwh));
  const needKw = maxKwh / HOURS_CAP_PER_KW;
  const usageKw = Math.max(1, Math.ceil(needKw * margin - 1e-9));
  const recommendedKw = installedKw != null ? Math.max(usageKw, Math.ceil(installedKw - 1e-9)) : usageKw;
  const overuseMonths = months.filter(m => m.kwh > contractKw * HOURS_CAP_PER_KW).map(m => m.month);
  const deltaKw = Math.max(0, contractKw - recommendedKw);
  const annualSavingKrw = deltaKw * t.basicPerKw * 12;
  const confirmed = installedKw != null;
  let note;
  if (overuseMonths.length) note = `${overuseMonths.join('·')}월 사용량이 계약전력×450시간을 넘습니다 — 초과사용 부가금 위험, 계약전력 ${recommendedKw}kW 이상으로 상향 검토`;
  else if (deltaKw > 0 && confirmed) note = `가동 설비 ${installedKw}kW 기준 계약전력 ${contractKw}→${recommendedKw}kW 감소 신청 가능 — 기본요금 연 ${annualSavingKrw.toLocaleString('ko-KR')}원(미사용 설비 신고 정리 후 한전 변경 신청, 1년 유지, 재증설 시 시설부담금)`;
  else if (deltaKw > 0) note = `과계약 의심: 최대 월 사용량으로 본 필요 용량은 ${recommendedKw}kW인데 계약은 ${contractKw}kW — 신고 설비 중 미사용 설비가 있으면 최대 연 ${annualSavingKrw.toLocaleString('ko-KR')}원(상한, 설비 목록 대조 전)`;
  else note = '계약전력이 사용량에 맞습니다(변경 불필요)';
  return { maxKwh, needKw: Math.round(needKw * 100) / 100, usageKw, recommendedKw, deltaKw, annualSavingKrw, confirmed, overuseMonths, note };
}

/** 20kW 이상: 창 월 최대수요를 targetKw로 낮출 때의 기본요금 절감(연). */
export function peakShavingValue({ contractKw, peaks, targetKw, t = TARIFF_GEN_GAP1_LOW }) {
  const now = appliedKw({ contractKw, peaks, billMonth: 9 });
  const after = Math.max(targetKw, contractKw * 0.3);
  return Math.max(0, Math.round((now - after) * t.basicPerKw * 12));
}
