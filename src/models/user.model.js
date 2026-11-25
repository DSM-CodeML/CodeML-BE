import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// JPA @Entity User 에 해당. 실제 테이블은 migrations/001_create_auth_tables.sql 이 만든다.
export const User = sequelize.define(
  "User",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    googleSub: { type: DataTypes.STRING(255), allowNull: false, unique: true, field: "google_sub" },
    email: { type: DataTypes.STRING(254), allowNull: true },
    nickname: { type: DataTypes.STRING(50), allowNull: false },
    xp: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }, // 문제를 처음 맞힐 때마다 problems.xp 만큼 증가
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
    lastLoginAt: { type: DataTypes.DATE, allowNull: false, field: "last_login_at" },
  },
  { tableName: "users" },
);
