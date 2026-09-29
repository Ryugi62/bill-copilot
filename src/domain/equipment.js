// 한전 소상공인 고효율기기 지원사업(2026): 구매가(부가세 제외) 40%, 사업자당 냉(난)방기·냉장고 160만 원, 세탁기·건조기 80만 원
export const SUBSIDY = Object.freeze({ rate: 0.4, cap: { aircon: 1_600_000, fridge: 1_600_000, washer: 800_000, dryer: 800_000 } });

export function equipmentPayback({ priceKrw, annualSavingKwh, unitPrice, kind }) {
  const subsidyKrw = Math.min(Math.round(priceKrw * SUBSIDY.rate), SUBSIDY.cap[kind] ?? 0);
  const netKrw = priceKrw - subsidyKrw;
  const annualSavingKrw = Math.round(annualSavingKwh * unitPrice);
  const paybackYears = annualSavingKrw > 0 ? Math.round((netKrw / annualSavingKrw) * 10) / 10 : Infinity;
  return { subsidyKrw, netKrw, annualSavingKrw, paybackYears };
}
