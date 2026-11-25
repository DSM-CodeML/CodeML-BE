import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// 트레일(학습 경로) 하나. 실제 테이블은 migrations/005 가 만들고 값은 006 이 넣는다.
export const Trail = sequelize.define(
  "Trail",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    ord: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    eyebrow: { type: DataTypes.STRING(100), allowNull: false },
    title: { type: DataTypes.STRING(100), allowNull: false },
  },
  { tableName: "trails" },
);
