# 소상공인 전기요금 코파일럿 — 진단 엔진 v0.1

고지서 12장의 월 사용량(kWh)·계약전력만으로 ①기상 보정 분해(기저·난방·냉방) ②계약전력/요금적용전력 처방 ③한전 고효율기기 지원(40%) 반영 회수기간 ④전후 절감 검증(IPMVP 옵션 C, 균형점 탐색·일수 정규화, CV(RMSE)≤20%·절감 불확도≤50% 판정)을 계산합니다.

- 데모: https://bill-copilot.vercel.app/?example (예시 입력은 가상 데이터)
- 스펙: [SPEC.md](SPEC.md) · 테스트: `npm test` (node --test, 15개) · 2026-09 착수 v0.1(실고객 데이터 없음, 예시는 가상)
- 계층: `src/domain`(순수 계산) ← `src/application`(성적표) ← `src/adapters`(화면)
- 출처: 한전 전기요금표 일반용(갑)Ⅰ 저압(2023-11-09 시행) · Open-Meteo Historical Weather(CC BY 4.0) · 한전 소상공인 고효율기기 지원사업(2026)
