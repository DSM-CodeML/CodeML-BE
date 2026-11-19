import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// 로그인 1회 = 1행. express-session(HttpSession)이 아니라 JWT/RTR의 "로그인 단위" 기록이다.
// revokedAt 이 채워지면 이 로그인으로 발급된 액세스 JWT와 리프레시 토큰이 모두 무효가 된다.
export const AuthSession = sequelize.define(
  "AuthSession",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "user_id",
      references: { model: "users", key: "id" },
    },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: "expires_at" },
    revokedAt: { type: DataTypes.DATE, allowNull: true, field: "revoked_at" },
  },
  { tableName: "auth_sessions" },
);
