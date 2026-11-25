import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";
import { Week } from "./week.model.js";

// 문제 한 개. *_html 은 운영자가 넣는 값이라 프론트가 innerHTML 로 그려도 된다(사용자 입력 저장 금지).
export const Problem = sequelize.define(
  "Problem",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    weekN: { type: DataTypes.STRING(8), allowNull: false, field: "week_n", references: { model: "weeks", key: "n" } },
    title: { type: DataTypes.STRING(100), allowNull: false },
    level: { type: DataTypes.ENUM("Easy", "Medium"), allowNull: false },
    xp: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 10 },
    chapter: { type: DataTypes.STRING(100), allowNull: false },
    statementHtml: { type: DataTypes.TEXT, allowNull: false, field: "statement_html" },
    solutionHtml: { type: DataTypes.TEXT, allowNull: false, field: "solution_html" },
    conceptHtml: { type: DataTypes.TEXT, allowNull: false, field: "concept_html" },
    starterCode: { type: DataTypes.TEXT, allowNull: false, field: "starter_code" },
  },
  { tableName: "problems" },
);

Week.hasMany(Problem, { foreignKey: "weekN" });
