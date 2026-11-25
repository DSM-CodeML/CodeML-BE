import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";
import { Problem } from "./problem.model.js";

// 채점용 테스트케이스. isSample=true 인 것만 사용자에게 보여 준다(숨김 케이스는 정답 유출 방지).
export const ProblemCase = sequelize.define(
  "ProblemCase",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    problemId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "problem_id",
      references: { model: "problems", key: "id" },
    },
    ord: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    inputText: { type: DataTypes.TEXT, allowNull: false, field: "input_text" },
    expectedOutput: { type: DataTypes.TEXT, allowNull: false, field: "expected_output" },
    isSample: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "is_sample" },
  },
  { tableName: "problem_cases" },
);

Problem.hasMany(ProblemCase, { foreignKey: "problemId" });
