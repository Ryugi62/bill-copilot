import { energyCharge, basicCharge, unitPriceOf } from '../domain/tariff.js';
import { appliedKw, prescribeContract, DEMAND_METER_MIN_KW } from '../domain/contract.js';
import { fitBaseline } from '../domain/baseline.js';
import { equipmentPayback } from '../domain/equipment.js';

export const PAYBACK_MAX_YEARS = 7; // 이보다 길면 교체 처방을 내지 않는다(설비 수명 대비)

/**
 * 성적표 조립. input = { contractKw, bills:[{ym:'2025-09', kwh, peakKw?}], degreeDays:{'2025-09':{hdd,cdd}}, aircon?:{priceKrw, efficiencyGain} }
 * efficiencyGain(교체 시 냉방 전력 절감률)은 사용자가 넣는 가정값 — 기본값 없음(없으면 교체 처방은 계산하지 않는다).
 */
export function buildScorecard(input) {
  const { contractKw, bills, degreeDays, aircon, installedKw } = input;
  const rows = bills.map(b => {
    const month = Number(b.ym.slice(5, 7));
    const d = degreeDays[b.ym];
    if (!d) throw new Error(`기상 자료 없음: ${b.ym}`);
    return { ...d, ym: b.ym, month, kwh: b.kwh, peakKw: b.peakKw };
  });
  const model = fitBaseline(rows);
  const peaks = rows.filter(r => r.peakKw != null).map(r => ({ month: r.month, peakKw: r.peakKw }));
  const bill = rows.reduce((acc, r) => {
    const kw = contractKw >= DEMAND_METER_MIN_KW ? appliedKw({ contractKw, peaks, billMonth: r.month }) : contractKw;
    acc.basic += basicCharge(kw); acc.energy += energyCharge(r.kwh, r.month); return acc;
  }, { basic: 0, energy: 0 });
  bill.total = bill.basic + bill.energy;

  const prescriptions = [];
  if (contractKw < DEMAND_METER_MIN_KW) {
    const c = prescribeContract({ contractKw, months: rows, installedKw });
    prescriptions.push({ kind: 'contract', title: c.confirmed ? '계약전력 감소 신청' : '계약전력 점검(과계약 의심)', upperBound: !c.confirmed, annualSavingKrw: c.annualSavingKrw, detail: c.note, data: c });
  } else {
    const a = appliedKw({ contractKw, peaks, billMonth: 9 });
    prescriptions.push({ kind: 'peak', title: '피크(최대수요) 관리', annualSavingKrw: Math.round(a * 0.1 * 6160 * 12),
      detail: `요금적용전력 ${a}kW — 12·1·2·7·8·9월 15분 최대수요를 10% 낮추면 기본요금 연 ${Math.round(a * 0.1 * 6160 * 12).toLocaleString('ko-KR')}원`, data: { appliedKw: a } });
  }
  if (model.verdict === 'ok' && aircon && aircon.efficiencyGain > 0) {
    const coolingKwh = model.coolingKwh;
    const saveKwh = coolingKwh * aircon.efficiencyGain;
    const p = equipmentPayback({ priceKrw: aircon.priceKrw, annualSavingKwh: saveKwh, unitPrice: unitPriceOf(8), kind: 'aircon' });
    const worth = p.paybackYears <= PAYBACK_MAX_YEARS;
    prescriptions.push({ kind: 'aircon', title: worth ? '냉방기 1등급 교체(한전 40% 지원)' : '냉방기 교체 보류', annualSavingKrw: worth ? p.annualSavingKrw : null,
      detail: `냉방분 연 ${Math.round(coolingKwh).toLocaleString('ko-KR')}kWh × 개선 ${Math.round(aircon.efficiencyGain * 100)}%(가정) → 지원금 ${p.subsidyKrw.toLocaleString('ko-KR')}원, 회수 ${p.paybackYears}년` + (worth ? '' : ` — ${PAYBACK_MAX_YEARS}년 초과라 지금 교체는 손해, 고장·노후 교체 시점에만 1등급 선택`), data: p });
  }
  if (model.verdict === 'ok') {
    prescriptions.push({ kind: 'base', title: '기저부하 점검', annualSavingKrw: null,
      detail: `기온과 무관한 기저 사용 월 약 ${Math.round(model.a * 30.4).toLocaleString('ko-KR')}kWh(${Math.round(model.shares.base * 100)}%) — 영업시간 외 냉장·조명·대기전력 점검 대상` });
  }
  prescriptions.sort((x, y) => (y.annualSavingKrw ?? -1) - (x.annualSavingKrw ?? -1));
  return { rows, model, bill, prescriptions };
}
