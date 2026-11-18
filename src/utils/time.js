// DATETIME(초 단위) 컬럼과 JWT exp(초 단위)에 맞춰 밀리초를 버린 현재 시각.
// MySQL은 소수 초를 "반올림"하므로, 미리 잘라 두면 DB 값과 JS 값이 정확히 같아진다.
export function nowSeconds() {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

export function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}
