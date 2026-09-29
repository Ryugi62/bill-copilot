// 한전 일반용 전력(갑)Ⅰ 저압 — cyber.kepco.co.kr 전기요금표(2023-11-09 시행), 2026-09-29 조회
export const TARIFF_GEN_GAP1_LOW = Object.freeze({
  name: '일반용(갑)Ⅰ 저압',
  basicPerKw: 6160,
  energyPerKwh: Object.freeze({ summer: 132.4, springFall: 91.9, winter: 119.0 }),
});

export function seasonOf(month) {
  if (month >= 6 && month <= 8) return 'summer';
  if ((month >= 3 && month <= 5) || month === 9 || month === 10) return 'springFall';
  return 'winter';
}

export const unitPriceOf = (month, t = TARIFF_GEN_GAP1_LOW) => t.energyPerKwh[seasonOf(month)];
export const energyCharge = (kwh, month, t = TARIFF_GEN_GAP1_LOW) => Math.round(kwh * unitPriceOf(month, t));
export const basicCharge = (appliedKw, t = TARIFF_GEN_GAP1_LOW) => Math.round(appliedKw * t.basicPerKw);

// 고지서 청구 추정(2026-3분기 기준): 기후환경요금 9원/kWh, 연료비조정요금 +5원/kWh, 전력산업기반기금 2.7%, 부가가치세 10%.
export const SURCHARGE_2026Q3 = Object.freeze({ climatePerKwh: 9, fuelAdjPerKwh: 5, fundRate: 0.027, vatRate: 0.10 });
export function billEstimate({ basic, energy, kwh }, sc = SURCHARGE_2026Q3) {
  const sub = basic + energy + Math.round(kwh * (sc.climatePerKwh + sc.fuelAdjPerKwh));
  const fund = Math.floor(sub * sc.fundRate / 10) * 10;
  const vat = Math.round(sub * sc.vatRate);
  return { sub, fund, vat, total: sub + fund + vat };
}
