// DATETIME(초 단위) 컬럼과 JWT exp(초 단위)에 맞춰 밀리초를 버린 현재 시각.
// MySQL은 소수 초를 "반올림"하므로, 미리 잘라 두면 DB 값과 JS 값이 정확히 같아진다.
export function nowSeconds() {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

export function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

const KST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Date → KST 기준 'YYYY-MM-DD'. format() 의 표시 형식은 ICU 데이터에 따라 달라질 수 있어 부품으로 직접 조립한다.
export function toKstDateString(date) {
  const parts = Object.fromEntries(KST_DATE.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 'YYYY-MM-DD' 에 일 수를 더한다. UTC 자정 기준으로 계산해서 서머타임/로컬 TZ 영향이 없다.
export function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
