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
