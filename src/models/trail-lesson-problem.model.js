import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// 레슨 ↔ 문제 연결. 문제 본문은 problems 에 있고 여기에는 단계(step)와 단계 안 순서만 둔다.
export const TRAIL_STEPS = Object.freeze(["basic", "practice", "test"]);

export const TrailLessonProblem = sequelize.define(
  "TrailLessonProblem",
  {
    lessonId: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      field: "lesson_id",
      references: { model: "trail_lessons", key: "id" },
    },
    problemId: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      field: "problem_id",
      references: { model: "problems", key: "id" },
    },
    step: { type: DataTypes.ENUM(...TRAIL_STEPS), allowNull: false },
    ord: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
  },
  { tableName: "trail_lesson_problems" },
);
