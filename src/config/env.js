// 환경변수를 한 곳에서 읽고 검증한다. (Spring의 @ConfigurationProperties + 시작 시 검증 역할)
// 필수 값이 없거나 약하면 서버를 띄우지 않고 바로 실패시킨다(fail fast).

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`환경변수 ${name}가 설정되지 않았습니다. .env.example을 참고하세요.`);
  }
  return value.trim();
}

function parseOrigins(raw) {
  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    // Origin은 "scheme://host[:port]" 형태여야 하며 경로/끝 슬래시가 있으면 브라우저 Origin 헤더와 절대 일치하지 않는다.
    const url = new URL(origin);
    if (url.origin !== origin) {
      throw new Error(`FRONTEND_URL 항목 "${origin}"은 정확한 Origin이어야 합니다. 예: ${url.origin}`);
    }
  }
  if (origins.length === 0) throw new Error("FRONTEND_URL에 허용할 Origin이 없습니다.");
  return origins;
}

const jwtSecret = required("JWT_SECRET");
if (Buffer.byteLength(jwtSecret, "utf8") < 32) {
  throw new Error(
    "JWT_SECRET이 너무 짧습니다(32바이트 이상). 생성 예: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
  );
}

// 채점 실행 방식. docker(기본)는 격리된 컨테이너, local 은 서버에서 바로 실행(격리 없음, 개발용).
const judgeRunner = process.env.JUDGE_RUNNER?.trim() || "docker";
if (!["docker", "local"].includes(judgeRunner)) {
  throw new Error(`JUDGE_RUNNER는 docker 또는 local 이어야 합니다. (현재: ${judgeRunner})`);
}
if (judgeRunner === "local" && process.env.NODE_ENV === "production") {
  throw new Error("운영 환경(NODE_ENV=production)에서는 JUDGE_RUNNER=local(격리 없음)을 쓸 수 없습니다.");
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 3000),

  // 쉼표로 여러 개 지정 가능. 정확히 일치하는 Origin만 허용한다.
  allowedOrigins: parseOrigins(required("FRONTEND_URL")),

  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    name: required("DB_NAME"),
  },

  judge: {
    runner: judgeRunner,
    dockerImage: process.env.JUDGE_DOCKER_IMAGE?.trim() || "python:3.12-slim",
  },

  // (JUDGE_RUNNER=local 전용) 채점에 쓰는 파이썬 실행 파일. 기본값: Windows 는 python, 그 외는 python3
  pythonBin: process.env.PYTHON_BIN?.trim() || (process.platform === "win32" ? "python" : "python3"),

  googleClientId: required("GOOGLE_CLIENT_ID"),

  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER?.trim() || "codeml-api",
    audience: process.env.JWT_AUDIENCE?.trim() || "codeml-web",
  },

  // 운영(NODE_ENV=production)에서는 기본 Secure. 로컬 http 개발에서는 false.
  cookieSecure:
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
});
