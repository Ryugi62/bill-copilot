// 기상 보정 기준선(IPMVP 옵션 C, 월 고지서): 일평균 kWh = a + h·HDD_b/일 + c·CDD_b/일.
// 균형점(난방 14/16/18℃, 냉방 20/22/24℃)은 CV(RMSE)가 가장 작은 조합을 고른다(change-point 5P 근사).
// 판정: 기준선 CV(RMSE) ≤ 20%, 절감 판정은 분수 절감 불확도 FSU ≤ 50%(68% 신뢰) — ASHRAE Guideline 14 Annex B 근사식.
export const CVRMSE_MAX = 0.20;
export const FSU_MAX = 0.50;
const DAYS_DEFAULT = 30.4;

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
function ols(X, y) {
  const p = X[0].length;
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xty = Array.from({ length: p }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  return solve(XtX, Xty);
}
const daysOf = r => r.days ?? DAYS_DEFAULT;
const hddOf = (r, b) => r[`hdd${b}`] ?? r.hdd ?? 0;
const cddOf = (r, b) => r[`cdd${b}`] ?? r.cdd ?? 0;

function fitAt(rows, hb, cb) {
  let terms = ['h', 'c'].filter(t => rows.some(r => (t === 'h' ? hddOf(r, hb) : cddOf(r, cb)) > 0));
  const feats = (r, ts) => [1, ...ts.map(t => (t === 'h' ? hddOf(r, hb) : cddOf(r, cb)) / daysOf(r))];
  const y = rows.map(r => r.kwh / daysOf(r));
  let beta = ols(rows.map(r => feats(r, terms)), y);
  for (let g = 0; beta && g < 2; g++) {
    const neg = terms.filter((t, i) => beta[i + 1] < 0);
    if (!neg.length) break;
    terms = terms.filter(t => !neg.includes(t)); beta = ols(rows.map(r => feats(r, terms)), y);
  }
  if (!beta) return null;
  const coef = { a: beta[0], h: 0, c: 0 }; terms.forEach((t, i) => { coef[t] = beta[i + 1]; });
  // a: 하루 기저 kWh, h·c: 도일당 kWh
  const predict = r => coef.a * daysOf(r) + coef.h * hddOf(r, hb) + coef.c * cddOf(r, cb);
  const n = rows.length, p = 1 + terms.length;
  const mean = rows.reduce((s, r) => s + r.kwh, 0) / n;
  const sse = rows.reduce((s, r) => s + (r.kwh - predict(r)) ** 2, 0);
  const sst = rows.reduce((s, r) => s + (r.kwh - mean) ** 2, 0);
  return { ...coef, bases: { heating: hb, cooling: cb }, terms, n, p, meanKwh: mean, predict,
    cvrmse: Math.sqrt(sse / (n - p)) / mean, r2: sst > 0 ? 1 - sse / sst : 1 };
}

export function fitBaseline(rows, { heatingBases = [14, 16, 18], coolingBases = [20, 22, 24] } = {}) {
  if (rows.length < 12) return { verdict: 'hold', reason: `표본 ${rows.length}개월 < 12개월` };
  const multi = rows.every(r => heatingBases.every(b => r[`hdd${b}`] != null) && coolingBases.every(b => r[`cdd${b}`] != null));
  const combos = multi ? heatingBases.flatMap(h => coolingBases.map(c => [h, c])) : [[18, 24]];
  const fits = combos.map(([h, c]) => fitAt(rows, h, c)).filter(Boolean);
  if (!fits.length) return { verdict: 'hold', reason: '회귀 불가(입력 부족)' };
  const m = fits.reduce((best, f) => (f.cvrmse < best.cvrmse ? f : best));
  const hb = m.bases.heating, cb = m.bases.cooling;
  const base = rows.reduce((s, r) => s + m.a * daysOf(r), 0);
  const heating = rows.reduce((s, r) => s + m.h * hddOf(r, hb), 0);
  const cooling = rows.reduce((s, r) => s + m.c * cddOf(r, cb), 0);
  const modeled = base + heating + cooling;
  const ok = m.cvrmse <= CVRMSE_MAX;
  return {
    ...m, shares: { base: base / modeled, heating: heating / modeled, cooling: cooling / modeled },
    coolingKwh: cooling, heatingKwh: heating, total: rows.reduce((s, r) => s + r.kwh, 0),
    verdict: ok ? 'ok' : 'hold',
    reason: ok ? '' : `기준선 CV(RMSE) ${(m.cvrmse * 100).toFixed(1)}% > 20% — 기온만으로 설명되지 않는 변동이 커서 판정 보류`,
  };
}

/** 분수 절감 불확도(ASHRAE G14 Annex B 근사, 월 자료 1.26 보정, 68% 신뢰 t≈1). */
export function fractionalSavingsUncertainty({ cvrmse, n, m, savingRate, t = 1.0 }) {
  if (savingRate <= 0) return Infinity;
  return (t * 1.26 * cvrmse * Math.sqrt((n / m) * (1 + 2 / n))) / savingRate;
}

/** IPMVP 옵션 C: 사후 실측을 기준선 모델(사후 기상)의 예측과 비교. FSU > 50%면 절감을 주장하지 않는다. */
export function verifySavings(model, postRows) {
  if (!model || model.verdict !== 'ok') return { verdict: 'hold', reason: '기준선 모델이 판정 보류 상태', savingKwh: 0, savingRate: 0 };
  const predicted = postRows.reduce((s, r) => s + model.predict(r), 0);
  const actual = postRows.reduce((s, r) => s + r.kwh, 0);
  const savingKwh = predicted - actual, savingRate = savingKwh / predicted;
  const fsu = fractionalSavingsUncertainty({ cvrmse: model.cvrmse, n: model.n, m: postRows.length, savingRate });
  const ok = fsu <= FSU_MAX;
  return { verdict: ok ? 'ok' : 'hold', predicted, actual, savingKwh, savingRate, fsu,
    reason: ok ? '' : `절감 불확도 ${Number.isFinite(fsu) ? Math.round(fsu * 100) + '%' : '∞'} > 50% — 기간을 늘려 다시 판정` };
}

/** 이상 사용 감지(구독의 반복 가치): 기준선 예측보다 k×RMSE 넘게 많이 쓴 달 → 설비 고장·누전·운영 변화 점검 신호. */
export function detectAnomalies(model, rows, k = 2) {
  if (!model || model.verdict !== 'ok') return [];
  const rmse = model.cvrmse * model.meanKwh;
  return rows.map(r => ({ ym: r.ym, month: r.month, actual: r.kwh, expected: model.predict(r), excess: r.kwh - model.predict(r) }))
    .filter(x => x.excess > k * rmse)
    .map(x => ({ ...x, excessRate: x.excess / x.expected }));
}
