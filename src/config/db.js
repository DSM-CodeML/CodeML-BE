import { Sequelize } from "sequelize";
import { env } from "./env.js";

// mysql2 pool 대신 Sequelize 인스턴스 (Spring의 DataSource + EntityManager 역할)
export const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: "mysql", // 드라이버는 mysql2
  timezone: "+00:00", // DB 세션과 Date 변환 모두 UTC
  logging: false, // SQL 로그에 토큰 해시 등이 찍히지 않도록 기본 off
  dialectOptions: {
    // BIGINT는 항상 문자열로 받는다. JS Number(2^53)로 바꾸며 정밀도를 잃지 않게 하기 위함.
    supportBigNumbers: true,
    bigNumberStrings: true,
  },
  define: {
    underscored: true,
    timestamps: false, // 시각 컬럼은 서비스에서 UTC 초 단위로 직접 넣는다.
    freezeTableName: true,
  },
  pool: { max: 10, min: 0, idle: 10_000, acquire: 30_000 },
});
