import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// 주차(대표 커리큘럼의 한 단계). 실제 테이블은 migrations/003 이 만들고 값은 004 가 넣는다.
// total 은 "목표 문제 수"라서 등록된 문제 수(problems 행 수)보다 클 수 있다.
export const Week = sequelize.define(
  "Week",
  {
    n: { type: DataTypes.STRING(8), primaryKey: true },
    ord: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    course: { type: DataTypes.STRING(100), allowNull: false },
    libs: { type: DataTypes.STRING(100), allowNull: false },
    project: { type: DataTypes.STRING(200), allowNull: false },
    optional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    total: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
  },
  { tableName: "weeks" },
);
