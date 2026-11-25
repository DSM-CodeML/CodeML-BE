import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";
import { User } from "./user.model.js";
import { Problem } from "./problem.model.js";

// 제출 1회 = 1행. 정답/오답/컴파일 오류 모두 저장한다. 코드는 제출 목록 API 로 내보내지 않는다.
export const Submission = sequelize.define(
  "Submission",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true }, // bigNumberStrings 때문에 문자열로 나온다
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "user_id", references: { model: "users", key: "id" } },
    problemId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "problem_id",
      references: { model: "problems", key: "id" },
    },
    result: { type: DataTypes.ENUM("Accepted", "Wrong Answer", "Compile Error"), allowNull: false },
    language: { type: DataTypes.STRING(20), allowNull: false },
    code: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  },
  { tableName: "submissions" },
);

Submission.belongsTo(User, { foreignKey: "userId", as: "user" });
Submission.belongsTo(Problem, { foreignKey: "problemId", as: "problem" });
