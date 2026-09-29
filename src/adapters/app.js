import { buildScorecard } from '../application/scorecard.js';
import { verifySavings } from '../domain/baseline.js';
import { EXAMPLE } from '../../data/example.js';

const $ = id => document.getElementById(id);
const won = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
let DD = null, last = null;

function monthsEnding(ym, n) {
  let [y, m] = ym.split('-').map(Number); const out = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
  return out;
}
function renderBills(yms, vals = {}) {
  $('bills').innerHTML = yms.map(ym => `<tr><td>${ym}</td><td><input inputmode="numeric" data-ym="${ym}" class="kwh" value="${vals[ym]?.kwh ?? ''}"></td><td><input inputmode="decimal" data-ym="${ym}" class="peak" value="${vals[ym]?.peakKw ?? ''}"></td></tr>`).join('');
}
function renderPost(yms) {
  $('post').innerHTML = yms.map(ym => `<tr><td>${ym}</td><td><input inputmode="numeric" data-ym="${ym}" class="pk"></td></tr>`).join('');
}
function readBills() {
  const peaks = Object.fromEntries([...document.querySelectorAll('.peak')].map(i => [i.dataset.ym, i.value]));
  return [...document.querySelectorAll('.kwh')].filter(i => i.value !== '').map(i => ({ ym: i.dataset.ym, kwh: Number(i.value), peakKw: peaks[i.dataset.ym] ? Number(peaks[i.dataset.ym]) : undefined }));
}

function run() {
  const city = $('city').value;
  let sc;
  try {
    sc = buildScorecard({ contractKw: Number($('contract').value), bills: readBills(), degreeDays: DD.cities[city],
      aircon: { priceKrw: Number($('acPrice').value), efficiencyGain: Number($('acGain').value) } });
  } catch (e) { alert(e.message); return; }
  last = sc; $('out').hidden = false;
  const m = sc.model, best = sc.prescriptions.filter(p => p.annualSavingKrw > 0).reduce((s, p) => s + p.annualSavingKrw, 0);
  $('kpis').innerHTML = [
    ['연 전기요금(기본+전력량)', won(sc.bill.total)], ['그중 기본요금', won(sc.bill.basic)],
    ['처방 합계 연 절감', won(best)], ['연 사용량', `${Math.round(sc.rows.reduce((s, r) => s + r.kwh, 0)).toLocaleString('ko-KR')}kWh`],
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join('');
  $('verdict').innerHTML = m.verdict === 'ok' ? '<span class="badge ok">판정 가능</span>' : '<span class="badge hold">판정 보류</span>';
  if (m.verdict === 'ok') {
    const seg = [['기저', m.shares.base, '#4e5968'], ['난방', m.shares.heating, '#f04452'], ['냉방', m.shares.cooling, '#3182f6']];
    $('bar').innerHTML = seg.map(([k, s, c]) => `<div style="width:${(s * 100).toFixed(1)}%;background:${c}">${s > 0.07 ? `${k} ${Math.round(s * 100)}%` : ''}</div>`).join('');
    $('fit').textContent = `기상 보정 모델: 월 사용량 = ${Math.round(m.a)} + ${m.h.toFixed(2)}×난방도일 + ${m.c.toFixed(2)}×냉방도일 · R² ${m.r2.toFixed(2)} · CV(RMSE) ${(m.cvrmse * 100).toFixed(1)}% · NMBE ${(m.nmbe * 100).toFixed(1)}%`;
  } else { $('bar').innerHTML = ''; $('fit').textContent = m.reason; }
  $('rx').innerHTML = sc.prescriptions.map(p => `<div class="rx"><h3>${p.title} ${p.annualSavingKrw ? `<span class="won">연 ${won(p.annualSavingKrw)}</span>` : ''}</h3><div>${p.detail}</div></div>`).join('');
  renderPost(nextMonths(sc.rows.at(-1).ym, 3));
}
function nextMonths(ym, n) { let [y, m] = ym.split('-').map(Number); const o = []; for (let i = 0; i < n; i++) { m++; if (m > 12) { m = 1; y++; } o.push(`${y}-${String(m).padStart(2, '0')}`); } return o; }

function verify() {
  if (!last) { $('verifyOut').textContent = '먼저 성적표를 만드세요.'; return; }
  const dd = DD.cities[$('city').value];
  const rows = [...document.querySelectorAll('.pk')].filter(i => i.value !== '').map(i => ({ ym: i.dataset.ym, kwh: Number(i.value), ...(dd[i.dataset.ym] || {}) }));
  if (!rows.length || rows.some(r => r.hdd == null)) { $('verifyOut').textContent = '해당 월의 기온 자료가 아직 없습니다(자료는 2026-08까지).'; return; }
  const v = verifySavings(last.model, rows);
  $('verifyOut').innerHTML = v.verdict === 'ok'
    ? `기온 보정 예측 ${Math.round(v.predicted).toLocaleString('ko-KR')}kWh 대비 실측 ${Math.round(v.actual).toLocaleString('ko-KR')}kWh → <b>절감 ${(v.savingRate * 100).toFixed(1)}%</b>`
    : `<span class="badge hold">판정 보류</span> ${v.reason}`;
}

async function init() {
  DD = await (await fetch('data/degree-days.json')).json();
  $('city').innerHTML = Object.keys(DD.cities).map(c => `<option>${c}</option>`).join('');
  renderBills(monthsEnding('2026-08', 12));
  $('run').onclick = run; $('verify').onclick = verify;
  $('example').onclick = () => {
    $('city').value = EXAMPLE.city; $('contract').value = EXAMPLE.contractKw;
    $('acPrice').value = EXAMPLE.aircon.priceKrw; $('acGain').value = EXAMPLE.aircon.efficiencyGain;
    renderBills(EXAMPLE.bills.map(b => b.ym), Object.fromEntries(EXAMPLE.bills.map(b => [b.ym, b])));
    $('sampleFlag').hidden = false; run();
    document.querySelectorAll('.pk').forEach((i, k) => { i.value = EXAMPLE.post[k]?.kwh ?? ''; }); verify();
  };
  if (new URLSearchParams(location.search).has('example')) $('example').click();
}
init();
