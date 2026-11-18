import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// MySQL BINARY(32) 컬럼용 타입. Sequelize 6에는 고정 길이 BINARY 타입이 없으므로
// DDL 문자열을 그대로 지정하고, 값은 항상 32바이트 Buffer(SHA-256 digest)만 허용한다.
const BINARY_32 = "BINARY(32)";

export const RefreshToken = sequelize.define(
  "RefreshToken",
  {
    // BIGINT UNSIGNED: config/db.js 의 bigNumberStrings 설정으로 JS에서는 항상 문자열이다.
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    sessionId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "session_id",
      references: { model: "auth_sessions", key: "id" },
    },
    tokenHash: {
      type: BINARY_32,
      allowNull: false,
      unique: true,
      field: "token_hash",
      validate: {
        is32ByteBuffer(value) {
          if (!Buffer.isBuffer(value) || value.length !== 32) {
            throw new Error("tokenHash는 32바이트 Buffer여야 합니다.");
          }
        },
      },
    },
    issuedAt: { type: DataTypes.DATE, allowNull: false, field: "issued_at" },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
    usedAt: { type: DataTypes.DATE, allowNull: true, field: "used_at" },
  },
  { tableName: "refresh_tokens" },
);
