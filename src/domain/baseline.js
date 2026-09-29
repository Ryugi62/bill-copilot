// 기상 보정 기준선: kWh = a + h·HDD + c·CDD (월). 판정 기준 ASHRAE Guideline 14(월 단위 CV(RMSE) ≤ 15%, |NMBE| ≤ 5%).
export const CVRMSE_MAX = 0.15;
export const NMBE_MAX = 0.05;

function solve(A, b) { // 가우스 소거 (작은 정방행렬)
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

function ols(rows, terms) {
  const X = rows.map(r => [1, ...terms.map(t => r[t])]);
  const y = rows.map(r => r.kwh);
  const p = X[0].length;
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xty = Array.from({ length: p }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  return solve(XtX, Xty);
}

export function fitBaseline(rows) {
  if (rows.length < 12) return { verdict: 'hold', reason: `표본 ${rows.length}개월 < 12개월` };
  let terms = ['hdd', 'cdd'].filter(t => rows.some(r => r[t] > 0));
  let beta = ols(rows, terms);
  // 음수 계수(물리적으로 불가)는 그 항을 빼고 다시 맞춘다
  for (let guard = 0; beta && guard < 2; guard++) {
    const neg = terms.filter((t, i) => beta[i + 1] < 0);
    if (!neg.length) break;
    terms = terms.filter(t => !neg.includes(t)); beta = ols(rows, terms);
  }
  if (!beta) return { verdict: 'hold', reason: '회귀 불가(입력 부족)' };
  const coef = { a: beta[0], h: 0, c: 0 };
  terms.forEach((t, i) => { coef[t === 'hdd' ? 'h' : 'c'] = beta[i + 1]; });
  const predict = r => coef.a + coef.h * r.hdd + coef.c * r.cdd;
  const n = rows.length, p = 1 + terms.length;
  const mean = rows.reduce((s, r) => s + r.kwh, 0) / n;
  const resid = rows.map(r => r.kwh - predict(r));
  const sse = resid.reduce((s, e) => s + e * e, 0);
  const sst = rows.reduce((s, r) => s + (r.kwh - mean) ** 2, 0);
  const cvrmse = Math.sqrt(sse / (n - p)) / mean;
  const nmbe = resid.reduce((s, e) => s + e, 0) / ((n - p) * mean);
  const total = rows.reduce((s, r) => s + r.kwh, 0);
  const base = coef.a * n, heating = coef.h * rows.reduce((s, r) => s + r.hdd, 0), cooling = coef.c * rows.reduce((s, r) => s + r.cdd, 0);
  const modeled = base + heating + cooling;
  const shares = { base: base / modeled, heating: heating / modeled, cooling: cooling / modeled };
  const ok = cvrmse <= CVRMSE_MAX && Math.abs(nmbe) <= NMBE_MAX;
  return {
    ...coef, terms, r2: sst > 0 ? 1 - sse / sst : 1, cvrmse, nmbe, shares, total, predict,
    verdict: ok ? 'ok' : 'hold',
    reason: ok ? '' : `CV(RMSE) ${(cvrmse * 100).toFixed(1)}%·NMBE ${(nmbe * 100).toFixed(1)}% — ASHRAE G14 월 기준(15%·±5%) 미달, 판정 보류`,
  };
}

/** IPMVP 옵션 C 방식: 사후 실측을 기준선 모델(사후 기상)의 예측과 비교. */
export function verifySavings(model, postRows) {
  if (!model || model.verdict !== 'ok') return { verdict: 'hold', reason: '기준선 모델이 판정 보류 상태', savingKwh: 0, savingRate: 0 };
  const predicted = postRows.reduce((s, r) => s + model.predict(r), 0);
  const actual = postRows.reduce((s, r) => s + r.kwh, 0);
  const savingKwh = predicted - actual;
  return { verdict: 'ok', predicted, actual, savingKwh, savingRate: savingKwh / predicted };
}
