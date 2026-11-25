import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// 챕터의 레슨. ord 는 챕터 안 순서(화면의 노드 번호, "LESSON n").
export const TrailLesson = sequelize.define(
  "TrailLesson",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    chapterId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "chapter_id",
      references: { model: "trail_chapters", key: "id" },
    },
    ord: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(100), allowNull: false },
    tag: { type: DataTypes.STRING(30), allowNull: false },
  },
  { tableName: "trail_lessons" },
);
