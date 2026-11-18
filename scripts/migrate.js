// 아주 작은 SQL 마이그레이션 실행기 (Flyway의 V1__xxx.sql 방식과 유사)
// - migrations/*.sql 을 파일명 순서대로 한 번씩만 적용하고 schema_migrations 에 기록한다.
// - sync({force:true}) / alter 를 쓰지 않는다.
// 사용: npm run migrate          (적용)
//       npm run migrate -- status (적용 여부만 출력)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function runMigrations({ statusOnly = false, log = console.log } = {}) {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true, // 마이그레이션 파일 하나에 여러 문장을 허용 (이 스크립트 전용 연결)
    timezone: "Z",
  });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const [rows] = await conn.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) {
        log(`  [적용됨] ${file}`);
        continue;
      }
      if (statusOnly) {
        log(`  [대기]   ${file}`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      // 주의: MySQL의 DDL은 트랜잭션으로 롤백되지 않는다. 실패하면 일부만 적용됐을 수 있으니 확인 후 수동 정리.
      await conn.query(sql);
      await conn.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, UTC_TIMESTAMP())", [file]);
      log(`  [적용]   ${file}`);
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const statusOnly = process.argv[2] === "status";
  runMigrations({ statusOnly }).then(
    () => console.log(statusOnly ? "마이그레이션 상태 확인 완료" : "마이그레이션 완료"),
    (err) => {
      console.error("마이그레이션 실패:", err.code ?? "", err.sqlMessage ?? err.message);
      process.exitCode = 1;
    },
  );
}
